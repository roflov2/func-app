// Invokes the function handlers directly with real @azure/functions request
// objects, so the routing/static-file logic can be tested without `func start`.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, HttpRequest, InvocationContext } = require('@azure/functions');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-test-'));
const distDir = path.join(tmpRoot, 'dist');
const handlers = {};

before(() => {
    fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><div id="root"></div>');
    fs.writeFileSync(path.join(distDir, 'assets', 'index-abc123.js'), 'console.log("hi")');
    fs.writeFileSync(path.join(distDir, 'favicon.svg'), '<svg/>');
    fs.writeFileSync(path.join(tmpRoot, 'outside-dist.txt'), 'secret');

    process.env.SPA_DIST_PATH = distDir;
    app.http = (name, options) => {
        handlers[name] = options;
    };
    require('../src/functions/apiStatus.js');
    require('../src/functions/spaHandler.js');
});

after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function invoke(name, urlPath, method = 'GET') {
    const request = new HttpRequest({ method, url: `http://localhost:7071${urlPath}` });
    return handlers[name].handler(request, new InvocationContext({ functionName: name }));
}

test('functions register the expected routes', () => {
    assert.equal(handlers.apiStatus.route, 'api/status');
    assert.equal(handlers.spaHandler.route, '{*path}');
});

test('GET /api/status returns JSON status', async () => {
    const res = await invoke('apiStatus', '/api/status');
    assert.equal(res.status, 200);
    assert.equal(res.jsonBody.status, 'ok');
    assert.match(res.jsonBody.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('GET / serves index.html without long-term caching', async () => {
    const res = await invoke('spaHandler', '/');
    assert.equal(res.status, 200);
    assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
    assert.equal(res.headers['Cache-Control'], 'no-cache');
    assert.match(res.body.toString(), /<div id="root">/);
});

test('client-side routes fall back to index.html', async () => {
    for (const route of ['/about', '/users/42/profile', '/about?tab=1']) {
        const res = await invoke('spaHandler', route);
        assert.equal(res.status, 200, route);
        assert.match(res.body.toString(), /<div id="root">/, route);
    }
});

test('hashed assets are served with their MIME type and immutable caching', async () => {
    const res = await invoke('spaHandler', '/assets/index-abc123.js');
    assert.equal(res.status, 200);
    assert.equal(res.headers['Content-Type'], 'text/javascript; charset=utf-8');
    assert.equal(res.headers['Cache-Control'], 'public, max-age=31536000, immutable');
    assert.equal(res.body.toString(), 'console.log("hi")');
});

test('public files are served from the dist root', async () => {
    const res = await invoke('spaHandler', '/favicon.svg');
    assert.equal(res.status, 200);
    assert.equal(res.headers['Content-Type'], 'image/svg+xml');
});

test('HEAD requests return headers without a body', async () => {
    const res = await invoke('spaHandler', '/assets/index-abc123.js', 'HEAD');
    assert.equal(res.status, 200);
    assert.equal(res.body, undefined);
});

test('missing files with an extension return 404 instead of index.html', async () => {
    const res = await invoke('spaHandler', '/assets/missing-old-hash.js');
    assert.equal(res.status, 404);
});

test('unknown /api routes return a JSON 404', async () => {
    const res = await invoke('spaHandler', '/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.jsonBody.error, 'Not Found');
});

test('path traversal cannot escape the dist directory', async () => {
    for (const attempt of ['/..%2Foutside-dist.txt', '/%2e%2e/outside-dist.txt', '/assets/..%2F..%2Foutside-dist.txt']) {
        const res = await invoke('spaHandler', attempt);
        assert.notEqual(res.status, 200, attempt);
    }
});

test('malformed percent-encoding returns 400', async () => {
    const res = await invoke('spaHandler', '/%E0%A4%A');
    assert.equal(res.status, 400);
});
