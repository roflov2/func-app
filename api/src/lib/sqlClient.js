const sql = require('mssql');
const { normalizeValue } = require('./values');

// Long enough for heavy aggregations, short enough to answer within the
// 230-second limit Azure puts on HTTP requests to a Function App.
const REQUEST_TIMEOUT_MS = 180_000;

/**
 * Connect to Azure SQL with Microsoft Entra ID. The credential supplies a fresh
 * access token for every new connection, so no SQL passwords are stored.
 *
 * Connections are opened lazily and checked with SELECT 1 before reuse, so
 * ones that went stale while the app sat idle are replaced.
 */
function createSqlClient({ server, database, credential }) {
    const pool = new sql.ConnectionPool({
        server,
        database,
        port: 1433,
        authentication: { type: 'token-credential', options: { credential } },
        options: { encrypt: true, trustServerCertificate: false },
        connectionTimeout: 30_000,
        requestTimeout: REQUEST_TIMEOUT_MS,
    });
    let connecting = null;

    function connected() {
        connecting ??= pool.connect().catch((err) => {
            connecting = null; // let the next call try again
            throw err;
        });
        return connecting;
    }

    /**
     * Run one statement and return its first result set.
     *
     * @param {string} text T-SQL to run.
     * @param {{ params?: object, maxRows?: number }} [options] Named parameters
     *   (referenced as @name), and the most rows to fetch.
     * @returns {Promise<{ columns: string[], rows: any[][], hasMore: boolean }>}
     *   Rows hold JSON-safe values. hasMore is true when rows were left unread.
     */
    async function query(text, { params, maxRows = Infinity } = {}) {
        await connected();
        const request = new sql.Request(pool);
        request.stream = true;
        request.arrayRowMode = true; // keeps duplicate column names apart
        for (const [name, value] of Object.entries(params ?? {})) {
            request.input(name, value);
        }

        return new Promise((resolve, reject) => {
            let recordsets = 0;
            let declarations = [];
            const columns = [];
            const rows = [];
            let hasMore = false;
            let settled = false;
            const settle = (fn, value) => {
                if (!settled) {
                    settled = true;
                    fn(value);
                }
            };
            const result = () => ({ columns, rows, hasMore });

            request.on('recordset', (meta) => {
                recordsets += 1;
                if (recordsets === 1) {
                    columns.push(...meta.map((column) => column.name));
                    declarations = meta.map((column) => column.type?.declaration);
                }
            });
            request.on('row', (row) => {
                if (recordsets !== 1 || hasMore) return;
                if (rows.length >= maxRows) {
                    hasMore = true;
                    request.cancel(); // stop reading; the rows so far are the result
                    settle(resolve, result());
                    return;
                }
                rows.push(row.map((value, index) => normalizeValue(value, declarations[index])));
            });
            request.on('error', (err) => {
                if (!hasMore) settle(reject, err);
            });
            request.on('done', () => settle(resolve, result()));

            if (params && Object.keys(params).length) {
                request.query(text);
            } else {
                request.batch(text); // sent as written, like a query typed into SSMS
            }
        });
    }

    async function close() {
        connecting = null;
        await pool.close();
    }

    return { query, close };
}

module.exports = { createSqlClient };
