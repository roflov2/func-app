// Exercises the agent loop with a scripted model and an in-memory SQL client.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TextToSQLAgent } = require('../src/lib/textToSqlAgent');

const COLUMNS = [
    ['report_id', 'int'],
    ['other_product_name', 'nvarchar'],
    ['amount_lost', 'decimal'],
];

function fakeSql(results = {}) {
    const queries = [];
    return {
        queries,
        async query(text, options = {}) {
            queries.push({ text, options });
            if (text.includes('INFORMATION_SCHEMA.COLUMNS')) {
                if (results.schemaError) throw new Error(results.schemaError);
                return { columns: ['COLUMN_NAME', 'DATA_TYPE'], rows: COLUMNS, hasMore: false };
            }
            if (text.startsWith('SELECT TOP 3 *')) {
                return {
                    columns: ['report_id', 'other_product_name', 'amount_lost'],
                    rows: [[1, 'x'.repeat(250), 10.5]],
                    hasMore: false,
                };
            }
            const result = results[text];
            if (result instanceof Error) throw result;
            if (!result) throw new Error(`Invalid column name in: ${text}`);
            return result;
        },
        async close() {},
    };
}

function fakeOpenAI(replies) {
    const calls = [];
    return {
        calls,
        chat: {
            completions: {
                async create(params) {
                    calls.push(structuredClone(params));
                    if (!replies.length) throw new Error('Unexpected model call');
                    return { choices: [{ message: replies.shift() }] };
                },
            },
        },
    };
}

const sqlCall = (id, query) => ({
    role: 'assistant',
    content: null,
    refusal: null,
    tool_calls: [{ id, type: 'function', function: { name: 'execute_sql', arguments: JSON.stringify({ query }) } }],
});
const answer = (content) => ({ role: 'assistant', content, refusal: null });

async function makeAgent(sql, openai, options = {}) {
    return TextToSQLAgent.create({
        tableName: 'Reporting.Reports',
        sqlClient: sql,
        openaiClient: openai,
        deploymentName: 'gpt-4o',
        llmPreviewLimit: 2,
        ...options,
    });
}

test('create reads the columns and sample rows into the schema', async () => {
    const sql = fakeSql();
    const agent = await makeAgent(sql, fakeOpenAI([]));
    assert.equal(agent.schemaError, null);
    assert.deepEqual(agent.columns, [
        { name: 'report_id', type: 'int' },
        { name: 'other_product_name', type: 'nvarchar' },
        { name: 'amount_lost', type: 'decimal' },
    ]);
    assert.deepEqual(sql.queries[0].options.params, { table: 'Reports', schema: 'Reporting' });
    assert.deepEqual(agent.sampleRows.columns, ['report_id', 'other_product_name', 'amount_lost']);
    assert.match(agent.schema, /^Table: Reporting\.Reports\nColumns:\n {2}- report_id \(int\)\n/);
    assert.match(agent.schema, /Sample data:\n {2}\{"report_id":1,"other_product_name":"x{200}…","amount_lost":10\.5\}\n$/);
});

test('table names without a schema default to dbo, and brackets are stripped', async () => {
    const sql = fakeSql();
    await makeAgent(sql, fakeOpenAI([]), { tableName: '[Reports]' });
    assert.deepEqual(sql.queries[0].options.params, { table: 'Reports', schema: 'dbo' });
});

test('create records a schema error instead of throwing', async () => {
    const agent = await makeAgent(fakeSql({ schemaError: 'Login failed for user' }), fakeOpenAI([]));
    assert.equal(agent.schemaError, 'Login failed for user');
    assert.equal(agent.schema, 'Error fetching schema: Login failed for user');
});

test('query retries a failed SQL attempt, then answers from the full result', async () => {
    const good = 'SELECT other_product_name, COUNT(*) n FROM Reporting.Reports GROUP BY other_product_name';
    const sql = fakeSql({
        [good]: {
            columns: ['other_product_name', 'n'],
            rows: [
                ['Crypto', 5],
                ['Gift cards', 3],
                ['Shares', 1],
            ],
            hasMore: false,
        },
    });
    const openai = fakeOpenAI([
        sqlCall('call_1', 'DELETE FROM Reporting.Reports'),
        sqlCall('call_2', 'SELECT nope FROM Reporting.Reports'),
        sqlCall('call_3', good),
        answer('Crypto is the most common.'),
    ]);
    const agent = await makeAgent(sql, openai);

    const history = [
        { role: 'user', content: 'How many reports?' },
        { role: 'assistant', content: 'There are 9.\n\nSQL used:\nSELECT COUNT(*) FROM Reporting.Reports' },
    ];
    const result = await agent.query('Most common products?', {
        maxAttempts: 3,
        history,
        dataDictionary: 'other_product_name: free text  \r\n',
    });

    assert.equal(result.answer, 'Crypto is the most common.');
    assert.equal(result.sqlQuery, good);
    assert.deepEqual(result.columnNames, ['other_product_name', 'n']);
    assert.deepEqual(result.fullResults[0], { other_product_name: 'Crypto', n: 5 });
    assert.equal(result.totalRows, 3);
    assert.equal(result.interpretationBasedOn, 2);
    assert.equal(result.dataNote, 'Interpretation based on the first 2 of 3 rows.');
    assert.deepEqual(result.attempts, [
        {
            query: 'DELETE FROM Reporting.Reports',
            success: false,
            error: 'Only SELECT queries are allowed (a leading WITH clause is fine).',
        },
        { query: 'SELECT nope FROM Reporting.Reports', success: false, error: 'Invalid column name in: SELECT nope FROM Reporting.Reports' },
        { query: good, success: true, error: null },
    ]);

    // First call: system prompt with the tidied dictionary, then history, then the question.
    const first = openai.calls[0];
    assert.equal(first.model, 'gpt-4o');
    assert.equal(first.tool_choice, 'auto');
    assert.equal(first.temperature, 0);
    assert.match(first.messages[0].content, /<data_dictionary>\nother_product_name: free text\n<\/data_dictionary>\n$/);
    assert.deepEqual(first.messages.slice(1), [...history, { role: 'user', content: 'Most common products?' }]);

    // The model sees the read-only rejection and the hint for driver errors.
    const second = openai.calls[1];
    // Empty fields (content: null, refusal: null) are left out of the assistant turn.
    assert.deepEqual(second.messages.at(-2), {
        role: 'assistant',
        tool_calls: sqlCall('call_1', 'DELETE FROM Reporting.Reports').tool_calls,
    });
    assert.equal(second.messages.at(-1).role, 'tool');
    assert.equal(second.messages.at(-1).tool_call_id, 'call_1');
    assert.match(JSON.parse(openai.calls[2].messages.at(-1).content).hint, /use TOP instead of LIMIT/);

    // The final call has no tools and sees a preview capped at llmPreviewLimit rows, with stats.
    const final = openai.calls[3];
    assert.equal(final.tools, undefined);
    const preview = JSON.parse(final.messages.at(-1).content);
    assert.equal(preview.rows_shown, 2);
    assert.equal(preview.showing_all, false);
    assert.equal(preview.note, 'Showing first 2 rows of 3 total rows.');
    assert.deepEqual(preview.column_statistics, { n: { min: 1, max: 5, avg: 3, count: 3, null_count: 0 } });
});

test('query without a dictionary leaves it out of the system prompt', async () => {
    const openai = fakeOpenAI([answer('Hi.')]);
    const agent = await makeAgent(fakeSql(), openai);
    await agent.query('Hello');
    assert.doesNotMatch(openai.calls[0].messages[0].content, /data_dictionary|8\. Use the data dictionary/);
    assert.match(openai.calls[0].messages[0].content, /7\. Earlier messages may be context/);
});

test('query returns the model text when it answers without SQL', async () => {
    const agent = await makeAgent(fakeSql(), fakeOpenAI([answer('Ask me about reports.')]));
    const result = await agent.query('Hello');
    assert.deepEqual(result, {
        answer: 'Ask me about reports.',
        sqlQuery: null,
        fullResults: null,
        columnNames: [],
        totalRows: 0,
        interpretationBasedOn: 0,
        truncated: false,
        attempts: [],
    });
});

test('query gives up after maxAttempts rounds of failed SQL', async () => {
    const openai = fakeOpenAI([sqlCall('a', 'SELECT bad1 FROM t'), sqlCall('b', 'SELECT bad2 FROM t')]);
    const agent = await makeAgent(fakeSql(), openai);
    const result = await agent.query('?', { maxAttempts: 2 });
    assert.equal(result.answer, "I couldn't complete the query after multiple attempts.");
    assert.equal(result.error, 'Max attempts reached');
    assert.equal(result.attempts.length, 2);
    assert.equal(openai.calls.length, 2);
});

test('get_table_info and unknown tools are answered without running SQL', async () => {
    const openai = fakeOpenAI([
        {
            role: 'assistant',
            content: null,
            tool_calls: [
                { id: 'i', type: 'function', function: { name: 'get_table_info', arguments: '{}' } },
                { id: 'u', type: 'function', function: { name: 'drop_everything', arguments: '{}' } },
                { id: 'j', type: 'function', function: { name: 'execute_sql', arguments: '{not json' } },
            ],
        },
        answer('Done.'),
    ]);
    const agent = await makeAgent(fakeSql(), openai);
    const result = await agent.query('Describe the table');
    assert.equal(result.answer, 'Done.');
    assert.deepEqual(result.attempts, [{ query: '', success: false, error: result.attempts[0].error }]);
    assert.match(result.attempts[0].error, /^Tool arguments were not valid JSON/);
    const toolMessages = openai.calls[1].messages.filter((m) => m.role === 'tool');
    assert.equal(JSON.parse(toolMessages[0].content), agent.schema);
    assert.deepEqual(JSON.parse(toolMessages[1].content), { error: 'Unknown function: drop_everything' });
});

test('results over maxResultRows are capped and flagged', async () => {
    const query = 'SELECT report_id FROM Reporting.Reports';
    const sql = fakeSql({ [query]: { columns: ['report_id'], rows: [[1], [2], [3]], hasMore: true } });
    const agent = await makeAgent(sql, fakeOpenAI([sqlCall('c', query), answer('Lots.')]), { maxResultRows: 3 });
    const result = await agent.query('All ids');
    assert.equal(sql.queries.at(-1).options.maxRows, 3);
    assert.equal(result.truncated, true);
    assert.equal(result.dataNote, 'Interpretation based on the first 2 of 3 rows. Results were capped at 3 rows.');

    const [preview] = await agent.run(query);
    assert.equal(preview.total_rows_is_lower_bound, true);
    assert.equal(
        preview.note,
        'Showing first 2 rows of 3 total rows. The query returned more than 3 rows; only the first 3 were fetched. Prefer aggregating in SQL.',
    );
});

test('duplicate column names keep the last value, like a Python dict', async () => {
    const query = 'SELECT a.x, b.x FROM t a JOIN t b ON 1 = 1';
    const sql = fakeSql({ [query]: { columns: ['x', 'x'], rows: [[1, 2]], hasMore: false } });
    const agent = await makeAgent(sql, fakeOpenAI([]));
    const full = await agent.executeSqlFull(query);
    assert.deepEqual(full.results, [{ x: 2 }]);
    assert.deepEqual(full.columnNames, ['x', 'x']);
});

test('calculateStats covers numeric columns only and counts nulls', () => {
    const rows = [
        { n: 1, s: 'a', b: true, m: null },
        { n: null, s: 'b', b: false, m: null },
        { n: 4, s: 'c', b: true, m: null },
    ];
    assert.deepEqual(TextToSQLAgent.calculateStats(rows, ['n', 's', 'b', 'm']), {
        n: { min: 1, max: 4, avg: 2.5, count: 2, null_count: 1 },
    });
});
