# client

Vite + React SPA served by the Azure Functions app in `../api`. See the root `README.md`
for how to build and run it on `http://localhost:7071`.

- `npm run dev`: Vite dev server on :5173, proxying `/api` to the Functions host on :7071
- `npm run build`: production build into `dist/`, which `api/src/functions/spaHandler.js` serves
- `npm run lint`: oxlint
