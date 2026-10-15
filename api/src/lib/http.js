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

module.exports = { readJson, errorResponse, jsonResponse };
