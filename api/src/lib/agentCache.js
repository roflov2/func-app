const { DefaultAzureCredential, getBearerTokenProvider } = require('@azure/identity');
const { AzureOpenAI } = require('openai');
const { createSqlClient } = require('./sqlClient');
const { TextToSQLAgent } = require('./textToSqlAgent');
const { checkModel, connectServices } = require('./connectionCheck');

const COGNITIVE_SERVICES_SCOPE = 'https://cognitiveservices.azure.com/.default';

// `az login` locally, the Function App's managed identity in Azure.
let credential = null;

/**
 * Build the Azure OpenAI and Azure SQL clients for one set of connection
 * settings. Both sign in with the same Entra ID credential, so no keys or SQL
 * passwords are stored. Nothing connects until the first request.
 */
function createClients(config) {
    credential ??= new DefaultAzureCredential();
    const openaiClient = new AzureOpenAI({
        endpoint: config.endpoint,
        apiVersion: config.apiVersion,
        deployment: config.deployment,
        azureADTokenProvider: getBearerTokenProvider(credential, COGNITIVE_SERVICES_SCOPE),
    });
    const sqlClient = createSqlClient({ server: config.server, database: config.database, credential });
    return { openaiClient, sqlClient };
}

/**
 * Create an agent for one set of connection settings, checking that both the
 * table and the model deployment answer.
 *
 * The agent is shared by every user, so it holds no per-user state; each
 * user's data dictionary is passed in with their questions instead.
 *
 * @throws {ConnectionError} If either service fails, so a broken agent is never cached.
 */
async function buildAgent(config) {
    const { openaiClient, sqlClient } = createClients(config);
    return connectServices({
        sqlClient,
        createAgent: () =>
            TextToSQLAgent.create({
                tableName: config.table,
                openaiClient,
                sqlClient,
                deploymentName: config.deployment,
                llmPreviewLimit: config.previewLimit,
            }),
        checkModel: () => checkModel(openaiClient, config.deployment),
    });
}

const agents = new Map();

/**
 * Return the agent for these settings, creating it on first use. Requests that
 * arrive while it is still connecting share the same attempt.
 */
function getAgent(config, build = buildAgent) {
    const key = JSON.stringify([
        config.server,
        config.database,
        config.table,
        config.endpoint,
        config.apiVersion,
        config.deployment,
        config.previewLimit,
    ]);
    let pending = agents.get(key);
    if (!pending) {
        pending = build(config);
        agents.set(key, pending);
        pending.catch(() => {
            if (agents.get(key) === pending) agents.delete(key);
        });
    }
    return pending;
}

module.exports = { buildAgent, getAgent };
