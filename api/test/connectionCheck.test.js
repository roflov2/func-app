// Checks that connecting tests both services and reports each one, with fake
// clients standing in for Azure SQL and Azure OpenAI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkModel, connectServices, ConnectionError } = require('../src/lib/connectionCheck');

function fakeOpenAI(reply) {
    const calls = [];
    return {
        calls,
        chat: {
            completions: {
                async create(params) {
                    calls.push(params);
                    if (reply instanceof Error) throw reply;
                    return reply;
                },
            },
        },
    };
}

function fakeSqlClient() {
    return {
        closed: 0,
        async close() {
            this.closed += 1;
        },
    };
}

test('checkModel sends one tiny request to the deployment and returns its model', async () => {
    const openai = fakeOpenAI({ model: 'gpt-4o-2024-11-20', choices: [{ message: { content: 'OK' } }] });
    assert.equal(await checkModel(openai, 'gpt-4o'), 'gpt-4o-2024-11-20');
    assert.equal(openai.calls.length, 1);
    assert.equal(openai.calls[0].model, 'gpt-4o');
    assert.equal(openai.calls[0].max_tokens, 1);
    assert.equal(openai.calls[0].temperature, 0);

    assert.equal(await checkModel(fakeOpenAI({ choices: [] }), 'gpt-4o'), 'gpt-4o');
    await assert.rejects(checkModel(fakeOpenAI(new Error('401 PermissionDenied')), 'gpt-4o'), /PermissionDenied/);
});

test('connectServices returns the agent when both services answer', async () => {
    const sqlClient = fakeSqlClient();
    const agent = { schemaError: null };
    const result = await connectServices({
        sqlClient,
        createAgent: async () => agent,
        checkModel: async () => 'gpt-4o-2024-11-20',
    });
    assert.equal(result, agent);
    assert.deepEqual(agent.services, { sql: { ok: true }, model: { ok: true, model: 'gpt-4o-2024-11-20' } });
    assert.equal(sqlClient.closed, 0);
});

test('connectServices reports a model failure even when SQL works', async () => {
    const sqlClient = fakeSqlClient();
    const err = await connectServices({
        sqlClient,
        createAgent: async () => ({ schemaError: null }),
        checkModel: async () => {
            throw new Error('404 DeploymentNotFound');
        },
    }).catch((caught) => caught);
    assert.ok(err instanceof ConnectionError);
    assert.deepEqual(err.services, { sql: { ok: true }, model: { ok: false, error: '404 DeploymentNotFound' } });
    assert.equal(err.message, 'Azure OpenAI: 404 DeploymentNotFound');
    assert.equal(sqlClient.closed, 1);
});

test('connectServices reports a schema that could not be read', async () => {
    const sqlClient = fakeSqlClient();
    const err = await connectServices({
        sqlClient,
        createAgent: async () => ({ schemaError: 'Login failed for user <token-identified principal>.' }),
        checkModel: async () => 'gpt-4o-2024-11-20',
    }).catch((caught) => caught);
    assert.deepEqual(err.services.sql, { ok: false, error: 'Login failed for user <token-identified principal>.' });
    assert.equal(err.services.model.ok, true);
    assert.equal(err.message, 'Azure SQL: Login failed for user <token-identified principal>.');
    assert.equal(sqlClient.closed, 1);
});

test('connectServices names every service that failed and closes SQL', async () => {
    const sqlClient = fakeSqlClient();
    const err = await connectServices({
        sqlClient,
        createAgent: async () => {
            throw new Error('ENOTFOUND');
        },
        checkModel: async () => {
            throw new Error('401 PermissionDenied');
        },
    }).catch((caught) => caught);
    assert.equal(err.message, 'Azure SQL: ENOTFOUND\nAzure OpenAI: 401 PermissionDenied');
    assert.equal(err.services.sql.ok, false);
    assert.equal(err.services.model.ok, false);
    assert.equal(sqlClient.closed, 1);
});
