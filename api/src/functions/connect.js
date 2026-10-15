const { app } = require('@azure/functions');
const { validateConfig } = require('../lib/config');
const { getAgent } = require('../lib/agentCache');
const { dictionaryTemplate, templateFileName } = require('../lib/dataDictionary');
const { readJson, errorResponse, jsonResponse } = require('../lib/http');

// Connects to the table (or reuses the cached connection) and returns what the
// page shows about it: columns, sample rows and a data dictionary template.
app.http('connect', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'api/connect',
    handler: async (request, context) => {
        const body = await readJson(request);
        const { config, error } = validateConfig(body?.config);
        if (error) {
            return errorResponse(400, error);
        }

        let agent;
        try {
            agent = await getAgent(config);
        } catch (err) {
            context.warn(`Couldn't connect to ${config.table} on ${config.server}: ${err.message}`);
            return errorResponse(502, err.message || String(err));
        }

        return jsonResponse({
            config,
            columns: agent.columns,
            sampleRows: agent.sampleRows,
            template: dictionaryTemplate(config.table, agent.columns),
            templateFileName: templateFileName(config.table),
        });
    },
});
