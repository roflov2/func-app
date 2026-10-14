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
                service: 'func-app-api',
                message: 'Hello from the Azure Functions v4 backend!',
                timestamp: new Date().toISOString(),
                uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
                node: process.version,
                invocationId: context.invocationId,
            },
        };
    },
});
