// Calls the text-to-SQL HTTP handlers with real @azure/functions requests. The
// agent cache is swapped for a stub, since there is no database to connect to.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { app, HttpRequest, InvocationContext } = require('@azure/functions');
const agentCache = require('../src/lib/agentCache');
const { ConnectionError } = require('../src/lib/connectionCheck');

const handlers = {};
const CONFIG = {
    server: 'myserver.database.windows.net',
    database: 'DB',
    table: 'Reporting.Reports',
    endpoint: 'https://my-oai.openai.azure.com/',
    apiVersion: '2024-12-01-preview',
    deployment: 'gpt-4o',
    previewLimit: 20,
};
const SERVICES = { sql: { ok: true }, model: { ok: true, model: 'gpt-4o-2024-11-20' } };
const fakeAgent = {
    services: SERVICES,
    columns: [
        { name: 'report_id', type: 'int' },
        { name: 'status', type: 'nvarchar' },
    ],
    sampleRows: { columns: ['report_id', 'status'], rows: [[1, 'open']] },
    async query(question) {
        return {
            answer: `You asked: ${question}`,
            sqlQuery: 'SELECT 1 AS n',
            fullResults: [{ n: 1 }],
            columnNames: ['n'],
            totalRows: 1,
            truncated: false,
            attempts: [{ query: 'SELECT 1 AS n', success: true, error: null }],
        };
    },
};
let connectError = null;

before(() => {
    agentCache.getAgent = async (config) => {
        if (connectError instanceof Error) throw connectError;
        if (connectError) throw new Error(connectError);
        assert.equal(config.server, CONFIG.server);
        return fakeAgent;
    };
    app.http = (name, options) => {
        handlers[name] = options;
    };
    for (const name of ['getConfig', 'connect', 'dictionary', 'ask']) {
        require(`../src/functions/${name}.js`);
    }
});

function invoke(name, init) {
    const request = new HttpRequest({ url: 'http://localhost:7071/api/x', method: 'POST', ...init });
    return handlers[name].handler(request, new InvocationContext({ functionName: name }));
}

const postJson = (name, body) =>
    invoke(name, { body: { string: JSON.stringify(body) }, headers: { 'content-type': 'application/json' } });

async function postForm(name, form) {
    const encoded = new Response(form);
    return invoke(name, {
        body: { bytes: new Uint8Array(await encoded.arrayBuffer()) },
        headers: { 'content-type': encoded.headers.get('content-type') },
    });
}

test('routes are mounted under /api', () => {
    assert.equal(handlers.getConfig.route, 'api/config');
    assert.deepEqual(handlers.getConfig.methods, ['GET']);
    assert.equal(handlers.connect.route, 'api/connect');
    assert.equal(handlers.dictionary.route, 'api/dictionary');
    assert.equal(handlers.ask.route, 'api/query');
});

test('GET /api/config returns the default settings and limits', async () => {
    const res = await invoke('getConfig', { method: 'GET' });
    assert.equal(res.jsonBody.config.table, 'Reporting.ScamWatchReportFiltered');
    assert.deepEqual(res.jsonBody.limits.maxAttempts, { min: 1, max: 5 });
    assert.equal(res.jsonBody.limits.maxDictionaryChars, 40000);
});

test('POST /api/connect returns each service, columns, sample rows and a template', async () => {
    const res = await postJson('connect', { config: CONFIG });
    assert.equal(res.status, 200);
    assert.deepEqual(res.jsonBody.services, SERVICES);
    assert.deepEqual(res.jsonBody.columns, fakeAgent.columns);
    assert.deepEqual(res.jsonBody.sampleRows, fakeAgent.sampleRows);
    assert.match(res.jsonBody.template, /\nreport_id \(int\):\nstatus \(nvarchar\):\n/);
    assert.equal(res.jsonBody.templateFileName, 'data_dictionary_Reporting_Reports.txt');
});

test('POST /api/connect reports bad settings and connection failures', async () => {
    const bad = await postJson('connect', { config: { ...CONFIG, server: 'evil.example.com' } });
    assert.equal(bad.status, 400);
    assert.match(bad.jsonBody.error, /^SQL server must be/);

    connectError = 'Login failed for user <token-identified principal>.';
    try {
        const failed = await postJson('connect', { config: CONFIG });
        assert.equal(failed.status, 502);
        assert.equal(failed.jsonBody.error, connectError);
    } finally {
        connectError = null;
    }

    const notJson = await invoke('connect', { body: { string: '{' }, headers: { 'content-type': 'application/json' } });
    assert.equal(notJson.status, 400);
});

test('connection failures say which service failed', async () => {
    const services = { sql: { ok: true }, model: { ok: false, error: '404 DeploymentNotFound' } };
    connectError = new ConnectionError(services);
    try {
        const connect = await postJson('connect', { config: CONFIG });
        assert.equal(connect.status, 502);
        assert.deepEqual(connect.jsonBody, { error: 'Azure OpenAI: 404 DeploymentNotFound', services });

        const ask = await postJson('ask', { config: CONFIG, question: 'q' });
        assert.equal(ask.status, 502);
        assert.deepEqual(ask.jsonBody, { error: "Couldn't connect. Azure OpenAI: 404 DeploymentNotFound", services });
    } finally {
        connectError = null;
    }
});

test('endpoints that run queries refuse bodies that are not sent as JSON', async () => {
    // A cross-site page can post text/plain without a CORS preflight.
    for (const name of ['connect', 'ask']) {
        const res = await invoke(name, {
            body: { string: JSON.stringify({ config: CONFIG, question: 'q' }) },
            headers: { 'content-type': 'text/plain;charset=UTF-8' },
        });
        assert.equal(res.status, 415, name);
    }
    const withCharset = await invoke('connect', {
        body: { string: JSON.stringify({ config: CONFIG }) },
        headers: { 'content-type': 'application/json; charset=utf-8' },
    });
    assert.equal(withCharset.status, 200);
});

test('POST /api/dictionary reads an uploaded file', async () => {
    const form = new FormData();
    form.append('file', new File([Buffer.from('status: open or closed\n')], 'dict.txt', { type: 'text/plain' }));
    form.append('columns', JSON.stringify(['report_id', 'status']));
    const res = await postForm('dictionary', form);
    assert.equal(res.status, 200);
    assert.deepEqual(res.jsonBody, {
        dictionary: { name: 'dict.txt', text: 'status: open or closed', truncated: false, mentioned: ['status'] },
        maxChars: 40000,
    });
});

test('POST /api/dictionary explains why a file was rejected', async () => {
    const form = new FormData();
    form.append('file', new File(['\n\n'], 'blank.txt'));
    form.append('columns', '[]');
    const res = await postForm('dictionary', form);
    assert.equal(res.status, 400);
    assert.equal(res.jsonBody.error, 'blank.txt is empty. Add descriptions of the columns and upload it again.');

    const noFile = new FormData();
    noFile.append('columns', '[]');
    assert.equal((await postForm('dictionary', noFile)).jsonBody.error, 'No file was uploaded.');
});

test('POST /api/query answers a question', async () => {
    const res = await postJson('ask', {
        config: CONFIG,
        question: 'How many?',
        history: [{ role: 'user', content: 'Hi' }],
        maxAttempts: 3,
        dictionary: null,
    });
    assert.equal(res.status, 200);
    assert.equal(res.jsonBody.content, 'You asked: How many?');
    assert.deepEqual(res.jsonBody.columns, ['n']);
    assert.deepEqual(res.jsonBody.rows, [[1]]);
});

test('POST /api/query rejects bad requests and reports connection failures', async () => {
    assert.equal((await postJson('ask', { config: CONFIG, question: '' })).status, 400);
    assert.equal((await postJson('ask', { question: 'q' })).status, 400);

    connectError = 'Timeout';
    try {
        const res = await postJson('ask', { config: CONFIG, question: 'q' });
        assert.equal(res.status, 502);
        assert.equal(res.jsonBody.error, "Couldn't connect. Timeout");
    } finally {
        connectError = null;
    }
});
