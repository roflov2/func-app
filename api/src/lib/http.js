// Another site can make a visitor's browser post text/plain or form data here
// without asking first, but application/json needs a CORS preflight, which the
// API doesn't allow. So endpoints that run queries only accept JSON.
function isJsonRequest(request) {
    return /^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '');
}

/** Parse a JSON request body. Returns undefined when the body isn't valid JSON. */
async function readJson(request) {
    try {
        return await request.json();
    } catch {
        return undefined;
    }
}

function errorResponse(status, error) {
    return { status, headers: { 'Cache-Control': 'no-store' }, jsonBody: { error } };
}

function jsonResponse(body) {
    return { status: 200, headers: { 'Cache-Control': 'no-store' }, jsonBody: body };
}

module.exports = { isJsonRequest, readJson, errorResponse, jsonResponse };
