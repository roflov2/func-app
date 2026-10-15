const { app } = require('@azure/functions');
const { readDictionary, MAX_DICTIONARY_CHARS } = require('../lib/dataDictionary');
const { errorResponse, jsonResponse } = require('../lib/http');

// Reads an uploaded data dictionary: decodes it, tidies and caps it, and checks
// which of the table's columns it names. Expects multipart/form-data with a
// "file" field and a "columns" field holding a JSON array of column names.
app.http('dictionary', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'api/dictionary',
    handler: async (request) => {
        let form;
        try {
            form = await request.formData();
        } catch {
            return errorResponse(400, 'Send the file as multipart/form-data.');
        }

        const file = form.get('file');
        if (!file || typeof file === 'string') {
            return errorResponse(400, 'No file was uploaded.');
        }
        let columns;
        try {
            columns = JSON.parse(form.get('columns') ?? '[]');
        } catch {
            columns = null;
        }
        if (!Array.isArray(columns) || !columns.every((name) => typeof name === 'string')) {
            return errorResponse(400, 'columns must be a JSON array of column names.');
        }

        const raw = new Uint8Array(await file.arrayBuffer());
        const { dictionary, error } = readDictionary(file.name || 'dictionary.txt', raw, columns);
        if (error) {
            return errorResponse(400, error);
        }
        return jsonResponse({ dictionary, maxChars: MAX_DICTIONARY_CHARS });
    },
});
