# Scamwatch SQL assistant

A chat app for asking plain-English questions about one Azure SQL table. Azure OpenAI writes
T-SQL, the app runs it read-only, and the model explains what it found. Each answer comes
with the full result (sortable, downloadable as CSV), the SQL it ran, and any failed attempts.

It's a React single-page app served by a Node.js Azure Functions app (programming model v4).
It is a port of the Streamlit app (`app.py` and `text_to_sql_agent.py`) and works the same
way:

- **Connection settings** in the sidebar: SQL server, database, table, Azure OpenAI endpoint,
  API version, deployment, and how many rows of each result the model reads. **Connect** checks
  both services and shows each one as connected or failed, with the error and what to fix.
- **Data dictionary.** Upload an optional `.txt` file describing the columns, codes and
  business rules. It's sent with every question, inside the system prompt. You can download a
  template that already lists every column. The page shows which columns the file names, and
  warns when it's over 40,000 characters (the rest isn't sent).
- **Answering settings:** SQL attempts per question (1–5), follow-up questions (sends the last
  3 question/answer pairs, with the SQL each answer used), and clearing the conversation.
- **Table overview:** the columns and types (plus whether the dictionary covers each one),
  three sample rows, and the dictionary text.
- **Read-only SQL.** Only a single `SELECT` (or `WITH … SELECT`) runs. Write keywords,
  multiple statements and `SELECT … INTO` are rejected before the query reaches the database,
  as are statement keywords such as `BEGIN TRAN`, `SET`, `USE` and `KILL` (T-SQL doesn't need a
  `;` between statements). This check is a backstop: the identity's SQL permissions are the real
  limit.
  The model sees at most the preview row limit, with min/max/mean for numeric columns. The
  table always shows the full result, up to 50,000 rows.

## Layout

```text
.
├── package.json                 # root scripts (install / build / start / test)
├── client/                      # React SPA
│   └── src/
│       ├── App.jsx              # page: connection state, chat, table overview, examples
│       ├── components/          # sidebar, chat messages, data table, small UI pieces
│       └── lib/                 # API calls, chat history, CSV download, AML proxy prefix
└── api/                         # Azure Functions v4 (Node.js, CommonJS)
    ├── host.json                # routePrefix "" so the SPA can be served from "/"
    ├── local.settings.json      # local app settings
    ├── scripts/checkConnection.js  # `npm run check:connection`: test both connections from a terminal
    ├── src/functions/           # HTTP endpoints (one file each)
    ├── src/lib/
    │   ├── textToSqlAgent.js    # the agent: schema, tool-calling loop, previews, stats
    │   ├── sqlSafety.js         # read-only query check
    │   ├── dataDictionary.js    # decode, tidy, cap and check uploaded dictionaries; template
    │   ├── sqlClient.js         # Azure SQL over Entra ID (mssql/tedious, no ODBC driver)
    │   ├── agentCache.js        # builds the Azure clients; one agent per connection setting
    │   ├── connectionCheck.js   # checks Azure SQL and the model deployment together
    │   ├── config.js            # default settings from app settings; validation
    │   └── answers.js           # request validation and reply shaping
    └── test/                    # node:test tests
```

## Endpoints

| Route                  | Function     | What it does                                                                    |
| ---------------------- | ------------ | ------------------------------------------------------------------------------- |
| `GET /api/config`      | `getConfig`  | Default connection settings (from app settings) and input limits                |
| `POST /api/connect`    | `connect`    | Connects to SQL and the model (or reuses the connection); returns each service's status, columns, sample rows, template |
| `POST /api/dictionary` | `dictionary` | Reads an uploaded `.txt` dictionary (multipart: `file`, `columns`)              |
| `POST /api/query`      | `ask`        | Answers one question: `{ config, question, history, maxAttempts, dictionary }`  |
| `GET /api/status`      | `apiStatus`  | Health check                                                                    |
| `GET /{*path}`         | `spaHandler` | The built SPA from `client/dist`                                                |

The browser sends the connection settings with every request, so the API keeps no per-user
state. Each Functions worker caches one agent per distinct setting, like Streamlit's
`st.cache_resource`. A connection that fails is never cached, so selecting **Connect** again
retries. Connecting reads the table schema and sends the deployment one chat request (capped at
one output token) at the same time, so a missing role or a wrong deployment shows up on
**Connect**, not on the first question. If either fails, the reply says which (`services` in the
JSON) and nothing is cached.

## Prerequisites

- Node.js 20.19+ or 22.12+ (Vite 8 needs it; `npm install` in `client/` refuses older versions)
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
  (`npm install -g azure-functions-core-tools@4`)
- The [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), signed in with an
  account that can read the table and call the Azure OpenAI deployment (see
  [Connecting to Azure SQL and Azure OpenAI](#connecting-to-azure-sql-and-azure-openai))
- Network access from the machine running the Functions host to the SQL server on port 1433

No ODBC driver is needed. The Node SQL driver talks to Azure SQL directly.

## Connecting to Azure SQL and Azure OpenAI

The app connects the same way the Python app does. One `DefaultAzureCredential` signs in to both
services with Microsoft Entra ID, so there are no keys or SQL passwords to store:

- **Azure OpenAI** (the `gpt-4o` deployment on `nasc-prod-east-mlp-oai`, managed in Azure AI
  Foundry): an `AzureOpenAI` client with a bearer-token provider for
  `https://cognitiveservices.azure.com/.default`.
- **Azure SQL:** the `mssql` driver with a token from the same credential.

`DefaultAzureCredential` uses your `az login` account locally and the Function App's managed
identity in Azure. Whichever identity it finds needs the access below.

### Check both connections from a terminal

```sh
az login
npm run check:connection
```

This builds the clients exactly as the app does, reads the table schema, sends the deployment one
tiny chat request, then closes the connection:

```text
Azure SQL:    OK
Azure OpenAI: OK (gpt-4o-2024-11-20)
```

Otherwise it prints each error and exits with 1. Settings come from the environment, then
`Values` in `api/local.settings.json`, then the defaults, so you can try others with e.g.
`SQL_DATABASE=DEV npm run check:connection`.

### Locally

1. Sign in, in the tenant that holds the resources: `az login --tenant <tenant-id>`.
2. Let your IP through the SQL server's firewall:
   `az sql server firewall-rule create -g <resource-group> -s sqlnascdlpsprod -n my-ip --start-ip-address <your-ip> --end-ip-address <your-ip>`
3. Create a database user for your account. Someone who is the server's Entra admin runs this
   in `NASC_ODS`:
   `CREATE USER [you@example.com] FROM EXTERNAL PROVIDER; GRANT SELECT ON Reporting.ScamWatchReportFiltered TO [you@example.com];`
4. Give your account the *Cognitive Services OpenAI User* role on the Azure OpenAI resource:

   ```sh
   az role assignment create --assignee you@example.com --role "Cognitive Services OpenAI User" \
     --scope $(az cognitiveservices account show -n nasc-prod-east-mlp-oai -g <resource-group> --query id -o tsv)
   ```

   Role assignments can take a few minutes to apply.
5. Run `npm run check:connection`, then `npm start`.

### In a Function App

1. Turn on a managed identity: `az functionapp identity assign -n <app> -g <resource-group>`.
   If you use a user-assigned identity instead, also set the app setting `AZURE_CLIENT_ID` to
   its client ID, so `DefaultAzureCredential` picks it.
2. Create a database user for the identity (named after the Function App, or the user-assigned
   identity):
   `CREATE USER [<app>] FROM EXTERNAL PROVIDER; GRANT SELECT ON Reporting.ScamWatchReportFiltered TO [<app>];`
3. Give the identity the *Cognitive Services OpenAI User* role on the Azure OpenAI resource, as
   above, with `--assignee-object-id <principal-id> --assignee-principal-type ServicePrincipal`.
4. Let the app reach SQL: turn on *Allow Azure services and resources to access this server* on
   the SQL server, or use VNet integration with a private endpoint. Do the same for the Azure
   OpenAI resource if it limits network access.
5. Set the settings below as app settings if they differ from the defaults:
   `az functionapp config appsettings set -n <app> -g <resource-group> --settings SQL_SERVER=... AZURE_OPENAI_DEPLOYMENT=...`

Then open the app and select **Connect**. Both services should show as connected.

## Run locally

```sh
az login
npm install                # also installs client/ and api/ dependencies
npm run check:connection   # optional: checks Azure SQL and Azure OpenAI before starting
npm start                  # builds client/dist, then runs `func start` in api/
```

Then open http://localhost:7071/.

| Command              | What it does                                                    |
| -------------------- | --------------------------------------------------------------- |
| `npm run build`      | Builds the SPA into `client/dist`                               |
| `npm run start:api`  | Runs `func start` without rebuilding the SPA                    |
| `npm run dev:client` | Vite dev server with hot reload on :5173; proxies `/api` to :7071 |
| `npm test`           | Runs the API tests (no database, model or Functions host needed) |
| `npm run check:connection` | Connects to Azure SQL and Azure OpenAI with your settings and reports each |
| `npm run lint`       | Lints the client                                                |

## Settings

Set these as app settings in Azure, or under `Values` in `api/local.settings.json`. They
become the defaults in the connection form, so the same code runs in dev and prod.

| Setting                        | Default                                            |
| ------------------------------ | -------------------------------------------------- |
| `SQL_SERVER`                   | `sqlnascdlpsprod.database.windows.net`             |
| `SQL_DATABASE`                 | `NASC_ODS`                                         |
| `SQL_TABLE`                    | `Reporting.ScamWatchReportFiltered`                |
| `AZURE_OPENAI_ENDPOINT`        | `https://nasc-prod-east-mlp-oai.openai.azure.com/` |
| `AZURE_OPENAI_API_VERSION`     | `2024-12-01-preview`                               |
| `AZURE_OPENAI_DEPLOYMENT`      | `gpt-4o`                                           |
| `LLM_PREVIEW_LIMIT`            | `20`                                               |
| `ALLOWED_SQL_SERVER_SUFFIXES`  | `.database.windows.net`                            |
| `ALLOWED_OPENAI_HOST_SUFFIXES` | `.openai.azure.com,.cognitiveservices.azure.com,.services.ai.azure.com` |
| `SPA_DIST_PATH`                | `../client/dist` (relative to `api/`)              |

**Why the allowed suffixes exist.** The app signs in to SQL and Azure OpenAI with its own
identity: your `az login` account locally, or the Function App's managed identity in Azure.
The connection form can still point it at any server, but the API only accepts hosts on these
suffixes, so an access token is never sent to a server someone else controls. Change them for
sovereign clouds (e.g. `.database.usgovcloudapi.net`). The table name must be a plain
`schema.table` identifier.

## Deploying to Azure

- **Turn on authentication.** The functions use `authLevel: 'anonymous'`, so put App Service
  Authentication (Easy Auth) with Microsoft Entra ID in front of the Function App. Otherwise
  anyone who finds the URL can query the table with the app's identity.
- **Grant access.** Give the Function App a managed identity and the SQL and Azure OpenAI
  access described under [In a Function App](#in-a-function-app).
- **Ship the SPA.** Only `api/` is deployed, so put the build inside it. For example, copy
  `client/dist` to `api/www` before publishing and set `SPA_DIST_PATH` to `www`.
- **Timeouts.** Azure ends HTTP requests to a Function App after 230 seconds. Each SQL query
  times out after 180 seconds, but several slow attempts in one question can still hit the
  limit.

## Running behind the Azure ML Jupyter proxy

On an Azure ML compute instance, the app is reached at `https://<instance>/proxy/7071/`. The
proxy strips that prefix before forwarding to the Functions host. `client/src/lib/proxyPrefix.js`
detects the prefix at runtime and adds it to every API call. Anywhere else the prefix doesn't
match, so calls go to `/api/...` as usual.

Compute instances can come with an older Node. Check `node --version` first; if it's below
20.19 or 22.12, install a newer one, e.g. with [nvm](https://github.com/nvm-sh/nvm):

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 22        # then: rm -rf node_modules client/node_modules api/node_modules
```

The built `index.html` must also load its assets relative to the proxy path, so build with a
relative base on AML:

```sh
npm install
npm run build --prefix client -- --base=./   # or: cd client && npx vite build --base=./
npm run start:api
```

The API serves the build straight from `client/dist`, so there's nothing to copy. The page and
the API share the proxy's origin, so `func start` needs no `--cors` flag.

Keep the relative base out of `vite.config.js`. The default absolute base is right everywhere
else.
