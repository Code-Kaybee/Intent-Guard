# Public web demo

The public console is hosted at https://code-kaybee.github.io/Intent-Guard/.

GitHub Pages serves a static interface backed by `docs/sandbox-evidence.json`. This bundle contains original NEAR Sandbox transactions, receipt errors, account balances, key permissions, and UTC timestamps. The browser labels the results as recorded, never signs transactions, and keeps one copy of a receipt when a case is replayed. Downloading proof returns the complete original bundle.

## Preview and check

```sh
npm ci --ignore-scripts
npm run build:web
npm run preview
```

Open http://127.0.0.1:4174/. The build uses relative asset paths and also works under GitHub's `/Intent-Guard/` project path. It serves frontend assets and validated public evidence.

```sh
npm test
npx playwright install chromium --only-shell
npm run test:web
```

The browser checks cover desktop and phone interactions, search and case filters, theme persistence with restricted storage, original receipt downloads, evidence loading failures, live startup recovery, and reconciliation after a lost payment response. Layout checks cover widths from 320 to 1920 pixels in both themes. A local Google Chrome installation can be used automatically; `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select another installed Chromium.

Appearance offers Light, Dark, and System. System follows operating-system changes; explicit selections persist and apply before first paint. Desktop navigation can collapse to a named icon rail. On phones and tablets, the navigation button opens a dismissible drawer with keyboard focus support. Fonts are self-hosted with the static assets.

## Refresh the captured evidence

```sh
npm ci
npm run build:contract
npm run benchmark
npm run export:evidence
npm run build:web
npm test
npm run test:web
```

The exporter and web build reject incomplete evidence, failed checks, inconsistent totals, and nested private credentials. Review and commit the new public evidence bundle along with the frontend changes.

The normalized contract is written to `target/near/intentguard_vault.wasm`. Cargo's raw compiler output remains separate, so repeated builds produce the same digest.

## Deploy

GitHub Pages uses **GitHub Actions** as its build source. Pushing `main` runs `.github/workflows/pages.yml`: dependency installation, the static build, unit checks, browser checks, and Pages deployment. The workflow can also be dispatched manually. Its deployment environment reports the public URL.

The live local console runs with `npm start` after a contract build. Its transaction endpoints use the loopback Node server; the public Pages artifact contains the recorded demonstration.
