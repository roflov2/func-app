// Checks the live connection to Azure SQL and the Azure OpenAI deployment with
// the same settings, identity and clients the app uses, without starting the
// Functions host. Sign in first, then run it from the repository root:
//
//     az login
//     npm run check:connection
//
// Settings come from the environment, then Values in api/local.settings.json,
// then the built-in defaults, e.g. SQL_DATABASE=DEV npm run check:connection.
// Exits with 1 if either service fails.

const fs = require('node:fs');
const path = require('node:path');
const { defaultConfig, validateConfig } = require('../src/lib/config');
const { buildAgent } = require('../src/lib/agentCache');

function localSettings() {
    try {
        const file = path.join(__dirname, '..', 'local.settings.json');
        return JSON.parse(fs.readFileSync(file, 'utf8')).Values ?? {};
    } catch {
        return {};
    }
}

async function main() {
    const env = { ...localSettings(), ...process.env };
    const { config, error } = validateConfig(defaultConfig(env), env);
    if (error) {
        console.error(error);
        return 1;
    }

    console.log(`Azure SQL:    ${config.server} / ${config.database}, table ${config.table}`);
    console.log(`Azure OpenAI: ${config.endpoint} deployment ${config.deployment} (API ${config.apiVersion})`);
    console.log('Connecting…\n');

    let services;
    try {
        const agent = await buildAgent(config);
        services = agent.services;
        await agent.sql.close();
    } catch (err) {
        if (!err.services) throw err;
        services = err.services; // the SQL connection is already closed
    }

    const failed = (check) => `FAILED\n${check.error.replace(/^/gm, '  ')}`;
    console.log(`Azure SQL:    ${services.sql.ok ? 'OK' : failed(services.sql)}`);
    console.log(`Azure OpenAI: ${services.model.ok ? `OK (${services.model.model})` : failed(services.model)}`);
    return services.sql.ok && services.model.ok ? 0 : 1;
}

main().then(
    (code) => {
        process.exitCode = code;
    },
    (err) => {
        console.error(err);
        process.exitCode = 1;
    },
);
