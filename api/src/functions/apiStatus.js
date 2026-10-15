const { app } = require('@azure/functions');

const startedAt = new Date();

app.http('apiStatus', {
    methods: ['GET'],
    authLevel: 'anonymous',
    // host.json sets routePrefix to "", so the "api/" segment is spelled out here.
    route: 'api/status',
    handler: async (request, context) => {
        context.log(`apiStatus invoked: ${request.method} ${request.url}`);

        return {
            status: 200,
            headers: { 'Cache-Control': 'no-store' },
            jsonBody: {
                status: 'ok',
                service: 'scamwatch-sql-assistant-api',
                timestamp: new Date().toISOString(),
                uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
                node: process.version,
                invocationId: context.invocationId,
            },
        };
    },
});
