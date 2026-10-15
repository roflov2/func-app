const { app } = require('@azure/functions');
const { defaultConfig, PREVIEW_LIMIT_RANGE } = require('../lib/config');
const { MAX_ATTEMPTS_RANGE } = require('../lib/answers');
const { MAX_DICTIONARY_CHARS } = require('../lib/dataDictionary');
const { jsonResponse } = require('../lib/http');

app.http('getConfig', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'api/config',
    handler: async () =>
        jsonResponse({
            config: defaultConfig(),
            limits: {
                previewLimit: PREVIEW_LIMIT_RANGE,
                maxAttempts: MAX_ATTEMPTS_RANGE,
                maxDictionaryChars: MAX_DICTIONARY_CHARS,
            },
        }),
});
