import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { SandboxDemo } from "../lib/sandbox.mjs";
import { ATTACK_CASES } from "../src/attack-cases.js";

const port = Number(process.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");
const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
const allowedOrigins = new Set([...allowedHosts].map((host) => `http://${host}`));
let demo = null;
let startupError = null;
let queue = Promise.resolve();

function serialize(operation) {
  const task = queue.then(operation);
  queue = task.catch(() => {});
  return task;
}

async function initialize() {
  const previous = demo;
  demo = null;
  startupError = null;
  if (previous) await previous.close();
  try {
    demo = await SandboxDemo.create();
    console.log(`Vault ready: ${demo.vault.accountId} · execute_payment key only`);
  } catch (error) {
    startupError = error.message;
    console.error(`Sandbox setup failed: ${startupError}`);
  }
}

function json(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

async function requestBody(request) {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
    throw new Error("Use application/json for this request.");
  }
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 2048) throw new Error("Request is too large.");
  }
  return JSON.parse(body);
}

const server = createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");
  if (!allowedHosts.has(request.headers.host)) return json(response, 403, { error: "Use the local demo address." });
  const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  try {
    if (pathname.startsWith("/api/")) {
      if (request.method === "POST" && request.headers.origin && !allowedOrigins.has(request.headers.origin)) {
        return json(response, 403, { error: "This demo accepts requests from its own page." });
      }
      if (pathname === "/api/status" && request.method === "GET") {
        return json(response, 200, demo ? { ready: true, ...await demo.status() } : { ready: false, error: startupError });
      }
      if (pathname === "/api/reset" && request.method === "POST") {
        await requestBody(request);
        await serialize(initialize);
        return json(response, startupError ? 503 : 200, demo ? { ready: true, ...await demo.status() } : { error: startupError });
      }
      if (!demo) return json(response, 503, { error: startupError ?? "The local NEAR chain is starting." });
      if (pathname === "/api/scenarios" && request.method === "GET") {
        return json(response, 200, { scenarios: ATTACK_CASES.map((scenario) => demo.describe(scenario.id)) });
      }
      if (pathname === "/api/report" && request.method === "GET") {
        return json(response, 200, await demo.report());
      }
      if (pathname === "/api/run" && request.method === "POST") {
        const body = await requestBody(request);
        if (typeof body.scenario_id !== "string" || Object.keys(body).length !== 1
            || !ATTACK_CASES.some((scenario) => scenario.id === body.scenario_id)) {
          return json(response, 400, { error: "Choose an available scenario." });
        }
        const payload = await serialize(async () => {
          const result = await demo.run(body.scenario_id);
          const { results, ...status } = await demo.status();
          return { result, status };
        });
        return json(response, 200, payload);
      }
      return json(response, 404, { error: "Unknown demo endpoint." });
    }

    if (!["GET", "HEAD"].includes(request.method)) return json(response, 405, { error: "Method not supported." });
    let resource;
    if (pathname === "/" || pathname === "/index.html") resource = new URL("../index.html", import.meta.url);
    else if (pathname === "/styles.css") resource = new URL("../styles.css", import.meta.url);
    else if (/^\/assets\/[a-z0-9/-]+\.(css|svg|woff2|txt)$/.test(pathname)) resource = new URL(`..${pathname}`, import.meta.url);
    else if (/^\/src\/[a-z0-9-]+\.js$/.test(pathname)) resource = new URL(`..${pathname}`, import.meta.url);
    else return json(response, 404, { error: "Not found." });
    const contents = await readFile(resource);
    response.writeHead(200, {
      "Content-Type": pathname.endsWith(".js") ? "text/javascript; charset=utf-8"
        : pathname.endsWith(".css") ? "text/css; charset=utf-8"
          : pathname.endsWith(".svg") ? "image/svg+xml"
            : pathname.endsWith(".woff2") ? "font/woff2" : "text/html; charset=utf-8",
      "Content-Length": contents.length,
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : contents);
  } catch (error) {
    return json(response, error.code === "ENOENT" ? 404 : 500, { error: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`IntentGuard: http://localhost:${port}`);
  console.log("Starting a local NEAR runtime with isolated test funds…");
  void serialize(initialize);
});

async function shutdown() {
  server.close();
  await queue;
  if (demo) await demo.close();
  process.exit(0);
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
