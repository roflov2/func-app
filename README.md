# func-app

A Vite + React single-page app wrapped in a Node.js Azure Functions app (programming model v4).
One Functions host on `http://localhost:7071` serves both:

| Route         | Function       | Response                                                   |
| ------------- | -------------- | ---------------------------------------------------------- |
| `/api/status` | `apiStatus`    | Mock JSON status payload                                   |
| `/{*path}`    | `spaHandler`   | Files from `client/dist`, or `index.html` for SPA routes   |

```text
.
├── package.json             # root scripts (install / build / start / test)
├── client/                  # Vite + React frontend (React Router)
└── api/                     # Azure Functions v4 Node.js backend (CommonJS)
    ├── host.json            # routePrefix "" so the catch-all can own "/"
    ├── local.settings.json  # FUNCTIONS_WORKER_RUNTIME=node, SPA_DIST_PATH
    ├── package.json         # "main": "src/functions/*.js"
    ├── src/functions/
    │   ├── apiStatus.js
    │   └── spaHandler.js
    └── test/                # node:test tests for both handlers
```

## Prerequisites

- Node.js 20 or newer
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local), which provides the `func` command:

  ```sh
  npm install -g azure-functions-core-tools@4
  # or: brew tap azure/functions && brew install azure-functions-core-tools@4
  # or: winget install Microsoft.Azure.FunctionsCoreTools
  ```

## Run locally

```sh
npm install      # also installs client/ and api/ dependencies (postinstall)
npm start        # builds client/dist, then runs `func start` in api/
```

Then open:

- http://localhost:7071/ (the SPA)
- http://localhost:7071/about (a client-side route; reloading it still works)
- http://localhost:7071/api/status (the JSON API)

### Other scripts

| Command              | What it does                                                          |
| -------------------- | --------------------------------------------------------------------- |
| `npm run build`      | Builds the SPA into `client/dist`                                     |
| `npm run start:api`  | Runs `func start` without rebuilding the SPA                          |
| `npm run dev:client` | Vite dev server with HMR on :5173; proxies `/api` to :7071            |
| `npm test`           | Runs the API handler tests (no Functions host needed)                 |
| `npm run lint`       | Lints the client                                                      |

For frontend work with hot reload, run `npm run start:api` in one terminal and
`npm run dev:client` in another, then use http://localhost:5173.

## How it works

- **Route prefix.** `api/host.json` sets `extensions.http.routePrefix` to `""`, so function
  routes are mounted at the site root. `apiStatus` declares `route: 'api/status'`, and
  `spaHandler` declares the catch-all `route: '{*path}'`. The host matches more specific
  routes first, so `/api/status` never reaches the catch-all.
- **Static files.** `spaHandler` reads from `SPA_DIST_PATH` (set to `../client/dist` in
  `local.settings.json`; relative paths resolve against `api/`). It returns a file when one
  exists, with a matching `Content-Type`. Vite's hashed `/assets/*` files get
  `Cache-Control: immutable`, and everything else gets `no-cache`.
- **SPA fallback.** Extensionless paths with no matching file (`/about`, `/users/42`) return
  `index.html`, and React Router renders the view. Missing paths that have a file extension
  return `404` instead of HTML. Unknown `/api/*` paths return a JSON `404`. Requests that
  try to escape the dist directory are blocked.
- If `client/dist` hasn't been built yet, the catch-all returns `503` with a message to run
  `npm run build`.

## Running behind the Azure ML Jupyter proxy

On an Azure ML compute instance, the app is reached at `https://<instance>/proxy/7071/`, and the
proxy strips that prefix before forwarding to the Functions host. The client handles this at
runtime. `client/src/main.jsx` uses `/proxy/<port>` as the React Router `basename`, and
`client/src/App.jsx` prepends it to the `/api/status` call. Anywhere else (localhost, a real
Function App) the prefix doesn't match, so the router root stays `/` and the call stays
`/api/status`.

The built `index.html` must also load assets relative to the proxy path, so build with a
relative base on AML:

```sh
npm run build --prefix client -- --base=./   # or: cd client && npx vite build --base=./
npm run start:api
```

Keep the relative base out of `vite.config.js`. With `--base=./`, reloading a client route two
or more levels deep (e.g. `/does/not/exist`) loads assets from `/does/not/assets/...` and shows a
blank page. The default absolute base used by `npm run build` doesn't have this problem.

## Deploying to Azure

Only `api/` is deployed as the Function App, so ship the SPA build inside it. For example,
copy `client/dist` to `api/www` before publishing and set the `SPA_DIST_PATH` app setting
to `www`. `local.settings.json` is local-only and excluded via `.funcignore`.
