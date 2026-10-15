// Connection settings. Environment variables (Function App settings, or Values in
// local.settings.json) override the defaults, so the same code runs in dev and prod.

function defaultConfig(env = process.env) {
    return {
        server: env.SQL_SERVER || 'sqlnascdlpsprod.database.windows.net',
        database: env.SQL_DATABASE || 'NASC_ODS',
        table: env.SQL_TABLE || 'Reporting.ScamWatchReportFiltered',
        endpoint: env.AZURE_OPENAI_ENDPOINT || 'https://nasc-prod-east-mlp-oai.openai.azure.com/',
        apiVersion: env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview',
        deployment: env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
        previewLimit: parseInt(env.LLM_PREVIEW_LIMIT || '20', 10),
    };
}

const PREVIEW_LIMIT_RANGE = { min: 5, max: 200 };

// The app signs in to both services with its own Entra ID identity, and the
// connection settings come from the browser. Only hosts on these suffixes are
// accepted, so an access token is never sent to a server someone else controls.
function suffixList(value, fallback) {
    return (value || fallback)
        .split(',')
        .map((suffix) => suffix.trim().toLowerCase())
        .filter(Boolean);
}

function allowedSuffixes(env = process.env) {
    return {
        sql: suffixList(env.ALLOWED_SQL_SERVER_SUFFIXES, '.database.windows.net'),
        openai: suffixList(
            env.ALLOWED_OPENAI_HOST_SUFFIXES,
            '.openai.azure.com,.cognitiveservices.azure.com,.services.ai.azure.com',
        ),
    };
}

const IDENTIFIER = String.raw`(?:\[[^\[\]]+\]|[A-Za-z_][\w@$#]*)`;
const TABLE_NAME = new RegExp(`^${IDENTIFIER}(?:\\.${IDENTIFIER})?$`);
const URL_SAFE_NAME = /^[\w.-]+$/;

function hostAllowed(host, suffixes) {
    const lower = host.toLowerCase();
    return suffixes.some((suffix) => lower.endsWith(suffix) && lower.length > suffix.length);
}

function suffixText(suffixes) {
    return suffixes.length === 1 ? suffixes[0] : `${suffixes.slice(0, -1).join(', ')} or ${suffixes.at(-1)}`;
}

/**
 * Check connection settings sent by the browser.
 *
 * @returns {{ config: object|null, error: string|null }} The trimmed settings, or
 *   a message saying which one to fix.
 */
function validateConfig(input, env = process.env) {
    if (!input || typeof input !== 'object') {
        return { config: null, error: 'Connection settings are missing.' };
    }
    const labels = {
        server: 'SQL server',
        database: 'Database',
        table: 'Table',
        endpoint: 'Azure OpenAI endpoint',
        apiVersion: 'API version',
        deployment: 'Model deployment',
    };
    const config = {};
    for (const [key, label] of Object.entries(labels)) {
        const value = typeof input[key] === 'string' ? input[key].trim() : '';
        if (!value) {
            return { config: null, error: `${label} is required.` };
        }
        config[key] = value;
    }

    const previewLimit = Number(input.previewLimit);
    if (!Number.isInteger(previewLimit) || previewLimit < PREVIEW_LIMIT_RANGE.min || previewLimit > PREVIEW_LIMIT_RANGE.max) {
        return {
            config: null,
            error: `Rows the model reads per result must be a whole number from ${PREVIEW_LIMIT_RANGE.min} to ${PREVIEW_LIMIT_RANGE.max}.`,
        };
    }
    config.previewLimit = previewLimit;

    const suffixes = allowedSuffixes(env);
    if (!/^[A-Za-z0-9.-]+$/.test(config.server) || !hostAllowed(config.server, suffixes.sql)) {
        return {
            config: null,
            error: `SQL server must be a host name ending in ${suffixText(suffixes.sql)}, without tcp: or a port.`,
        };
    }

    let endpoint;
    try {
        endpoint = new URL(config.endpoint);
    } catch {
        endpoint = null;
    }
    if (!endpoint || endpoint.protocol !== 'https:' || !hostAllowed(endpoint.hostname, suffixes.openai)) {
        return {
            config: null,
            error: `Azure OpenAI endpoint must be an https:// address on ${suffixText(suffixes.openai)}.`,
        };
    }

    if (!TABLE_NAME.test(config.table)) {
        return {
            config: null,
            error: 'Table must be a table name, optionally schema-qualified, e.g. Reporting.ScamWatchReportFiltered.',
        };
    }
    if (!URL_SAFE_NAME.test(config.deployment)) {
        return { config: null, error: 'Model deployment can only contain letters, numbers, dots, dashes and underscores.' };
    }
    if (!URL_SAFE_NAME.test(config.apiVersion)) {
        return { config: null, error: 'API version can only contain letters, numbers, dots, dashes and underscores.' };
    }
    return { config, error: null };
}

module.exports = { defaultConfig, validateConfig, PREVIEW_LIMIT_RANGE };
