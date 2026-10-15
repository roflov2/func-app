const { app } = require('@azure/functions');
const { validateConfig } = require('../lib/config');
const { getAgent } = require('../lib/agentCache');
const { validateQuestion, askAgent } = require('../lib/answers');
const { readJson, errorResponse, jsonResponse } = require('../lib/http');

// Answers one question: the model writes T-SQL, it runs against the table, and
// the reply carries the answer, the SQL, any failed attempts and the full result.
app.http('ask', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'api/query',
    handler: async (request, context) => {
        const body = await readJson(request);
        const { config, error: configError } = validateConfig(body?.config);
        if (configError) {
            return errorResponse(400, configError);
        }
        const { ask, error: askError } = validateQuestion(body);
        if (askError) {
            return errorResponse(400, askError);
        }

        let agent;
        try {
            agent = await getAgent(config);
        } catch (err) {
            context.warn(`Couldn't connect to ${config.table} on ${config.server}: ${err.message}`);
            return errorResponse(502, `Couldn't connect to ${config.table} on ${config.server}. ${err.message}`);
        }

        return jsonResponse(await askAgent(agent, ask));
    },
});
