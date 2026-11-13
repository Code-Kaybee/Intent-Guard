import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";

const argumentsList = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argumentsList.indexOf(name);
  return index === -1 ? fallback : argumentsList[index + 1];
};
const previewPort = Number(option("--port", "4174"));
const basePath = option("--base-path", "/");
if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65535) throw new Error("Invalid preview port.");
if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath)) throw new Error("The preview base path must begin and end with a slash.");
const directory = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain" };
const server = createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405); response.end("Method not supported."); return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (basePath !== "/" && (pathname === "/" || pathname === basePath.slice(0, -1))) {
      response.writeHead(302, { Location: basePath }); response.end(); return;
    }
    if (!pathname.startsWith(basePath)) { response.writeHead(404); response.end("Not found."); return; }
    const relative = pathname.slice(basePath.length) || "index.html";
    const resource = resolve(directory, relative);
    if (!resource.startsWith(directory + sep) || !types[extname(resource)]) {
      response.writeHead(404); response.end("Not found."); return;
    }
    const contents = await readFile(resource);
    response.writeHead(200, { "Content-Type": types[extname(resource)] + (extname(resource) === ".woff2" ? "" : "; charset=utf-8"), "Content-Length": contents.length });
    response.end(request.method === "HEAD" ? undefined : contents);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 400); response.end("Not found.");
  }
});
server.listen(previewPort, "127.0.0.1", () => console.log(`Public demo preview: http://127.0.0.1:${previewPort}${basePath}`));
process.once("SIGINT", () => server.close());
process.once("SIGTERM", () => server.close());
