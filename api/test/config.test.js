const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultConfig, validateConfig } = require('../src/lib/config');

const VALID = {
    server: 'myserver.database.windows.net',
    database: 'NASC_ODS',
    table: 'Reporting.ScamWatchReportFiltered',
    endpoint: 'https://my-oai.openai.azure.com/',
    apiVersion: '2024-12-01-preview',
    deployment: 'gpt-4o',
    previewLimit: 20,
};

test('defaultConfig uses the built-in defaults', () => {
    assert.deepEqual(defaultConfig({}), {
        server: 'sqlnascdlpsprod.database.windows.net',
        database: 'NASC_ODS',
        table: 'Reporting.ScamWatchReportFiltered',
        endpoint: 'https://nasc-prod-east-mlp-oai.openai.azure.com/',
        apiVersion: '2024-12-01-preview',
        deployment: 'gpt-4o',
        previewLimit: 20,
    });
});

test('environment variables override the defaults', () => {
    const config = defaultConfig({
        SQL_SERVER: 'dev.database.windows.net',
        SQL_DATABASE: 'DEV',
        SQL_TABLE: 'dbo.T',
        AZURE_OPENAI_ENDPOINT: 'https://dev.openai.azure.com/',
        AZURE_OPENAI_API_VERSION: '2025-01-01',
        AZURE_OPENAI_DEPLOYMENT: 'gpt-4.1',
        LLM_PREVIEW_LIMIT: '50',
    });
    assert.equal(config.server, 'dev.database.windows.net');
    assert.equal(config.deployment, 'gpt-4.1');
    assert.equal(config.previewLimit, 50);
});

test('validateConfig trims settings and accepts the defaults', () => {
    const { config, error } = validateConfig({ ...VALID, server: '  myserver.database.windows.net ', previewLimit: '30' });
    assert.equal(error, null);
    assert.equal(config.server, 'myserver.database.windows.net');
    assert.equal(config.previewLimit, 30);
    assert.equal(validateConfig(defaultConfig({}), {}).error, null);
    assert.equal(validateConfig({ ...VALID, table: '[dbo].[My Table]' }).error, null);
    assert.equal(validateConfig({ ...VALID, endpoint: 'https://x.cognitiveservices.azure.com' }).error, null);
});

test('validateConfig rejects missing and out-of-range settings', () => {
    assert.equal(validateConfig(null).error, 'Connection settings are missing.');
    assert.equal(validateConfig({ ...VALID, database: ' ' }).error, 'Database is required.');
    for (const previewLimit of [4, 201, 2.5, 'x', null]) {
        assert.match(validateConfig({ ...VALID, previewLimit }).error, /^Rows the model reads per result/, String(previewLimit));
    }
});

test('validateConfig only sends tokens to Azure SQL and Azure OpenAI hosts', () => {
    for (const server of ['evil.example.com', 'tcp:x.database.windows.net,1433', 'database.windows.net', 'x.database.windows.net.evil.com']) {
        assert.match(validateConfig({ ...VALID, server }).error, /^SQL server must be a host name ending in \.database\.windows\.net/, server);
    }
    for (const endpoint of ['http://my-oai.openai.azure.com/', 'https://evil.example.com/', 'not a url', 'https://openai.azure.com.evil.com/']) {
        assert.match(validateConfig({ ...VALID, endpoint }).error, /^Azure OpenAI endpoint must be an https:\/\/ address/, endpoint);
    }
});

test('allowed host suffixes can be changed with app settings', () => {
    const env = {
        ALLOWED_SQL_SERVER_SUFFIXES: '.database.usgovcloudapi.net',
        ALLOWED_OPENAI_HOST_SUFFIXES: '.openai.azure.us',
    };
    assert.equal(
        validateConfig({ ...VALID, server: 'x.database.usgovcloudapi.net', endpoint: 'https://x.openai.azure.us/' }, env).error,
        null,
    );
    assert.match(validateConfig(VALID, env).error, /^SQL server/);
});

test('validateConfig rejects table names that are not plain identifiers', () => {
    for (const table of ['t; DROP TABLE x', 'a.b.c', 't WHERE 1=1', "t'", '']) {
        assert.ok(validateConfig({ ...VALID, table }).error, table);
    }
    assert.match(validateConfig({ ...VALID, deployment: '../models' }).error, /^Model deployment/);
});
