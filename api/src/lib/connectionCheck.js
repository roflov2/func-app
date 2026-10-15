// Checks both services a connection needs: Azure SQL (by reading the table
// schema) and the Azure OpenAI deployment (with one tiny chat request). Both
// run at once, so a single Connect reports every service that's broken.

const SERVICE_LABELS = { sql: 'Azure SQL', model: 'Azure OpenAI' };

const errorText = (err) => err?.message || String(err);

/**
 * Send the smallest chat request the deployment answers, using the same client
 * and settings as real questions.
 *
 * @returns {Promise<string>} The model the deployment runs, e.g. gpt-4o-2024-11-20.
 */
async function checkModel(openaiClient, deployment) {
    const response = await openaiClient.chat.completions.create({
        model: deployment,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 1,
        temperature: 0, // what questions send, so a model that rejects it fails here
    });
    return response.model || deployment;
}

/** A connection where at least one service failed. `services` says which. */
class ConnectionError extends Error {
    constructor(services) {
        super(
            Object.entries(services)
                .filter(([, check]) => !check.ok)
                .map(([key, check]) => `${SERVICE_LABELS[key]}: ${check.error}`)
                .join('\n'),
        );
        this.name = 'ConnectionError';
        this.services = services;
    }
}

/**
 * Create the agent (which reads the table schema) and check the model together.
 *
 * @param {object} checks
 * @param {{ close(): Promise<void> }} checks.sqlClient Closed if either check fails.
 * @param {() => Promise<object>} checks.createAgent Resolves to a TextToSQLAgent;
 *   a schema it couldn't read is reported in `schemaError`.
 * @param {() => Promise<string>} checks.checkModel Resolves to the model name.
 * @returns The agent, with `services` saying what each check found.
 * @throws {ConnectionError} If either service failed.
 */
async function connectServices({ sqlClient, createAgent, checkModel: callModel }) {
    const [agentResult, modelResult] = await Promise.allSettled([createAgent(), callModel()]);
    const agent = agentResult.status === 'fulfilled' ? agentResult.value : null;

    const services = {
        sql: !agent
            ? { ok: false, error: errorText(agentResult.reason) }
            : agent.schemaError
              ? { ok: false, error: agent.schemaError }
              : { ok: true },
        model:
            modelResult.status === 'fulfilled'
                ? { ok: true, model: modelResult.value }
                : { ok: false, error: errorText(modelResult.reason) },
    };

    if (!services.sql.ok || !services.model.ok) {
        await sqlClient.close().catch(() => {});
        throw new ConnectionError(services);
    }
    agent.services = services;
    return agent;
}

module.exports = { checkModel, connectServices, ConnectionError };
