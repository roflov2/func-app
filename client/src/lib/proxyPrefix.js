// Azure ML's Jupyter proxy serves the app under /proxy/<port>/ rather than at the
// site root, so API calls need that prefix to stay inside the proxy. It's empty
// everywhere else (localhost, a deployed Function App).
export const proxyPrefix = window.location.pathname.match(/^(\/proxy\/\d+)/)?.[1] ?? ''
