// Everything that isn't executable SQL: string literals, comments and quoted identifiers.
// A single alternation scans left to right, so "--" inside a string stays part of the string.
const NON_CODE = new RegExp(
    [
        "N?'(?:[^']|'')*'", // string literal ('' is an escaped quote)
        '--[^\\n]*', // line comment
        '/\\*[\\s\\S]*?\\*/', // block comment
        '\\[[^\\]]*\\]', // [bracketed identifier]
        '"[^"]*"', // "quoted identifier"
    ].join('|'),
    'g',
);

// T-SQL doesn't need semicolons between statements ("SELECT 1 KILL 53" is a valid
// batch), so the second group blocks words that can only start a statement:
// transactions and locks, session state, admin commands and legacy text writes.
// They're all reserved words, so a column can only use them in [brackets] or
// "quotes", which are masked before this check.
const WRITE_KEYWORDS = new RegExp(
    '\\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|' +
        'REVOKE|DENY|INTO|BACKUP|RESTORE|SHUTDOWN|DBCC|BULK|OPENROWSET|OPENQUERY|OPENDATASOURCE|' +
        'BEGIN|COMMIT|ROLLBACK|SAVE|TRAN|TRANSACTION|SET|USE|DECLARE|WAITFOR|WHILE|KILL|' +
        'RECONFIGURE|CHECKPOINT|SETUSER|WRITETEXT|UPDATETEXT|TRIGGER)\\b',
    'i',
);

function maskNonCode(text) {
    return text.startsWith('--') || text.startsWith('/*') ? ' ' : ' _ ';
}

/**
 * Check that a query is a single read-only SELECT statement.
 *
 * This is defence in depth. The real guarantee should come from a database
 * login that only has SELECT permission on the table.
 *
 * @param {string} query T-SQL text produced by the model.
 * @returns {string|null} null if the query looks safe to run, otherwise a short reason it was rejected.
 */
function validateReadOnly(query) {
    const code = String(query ?? '')
        .replace(NON_CODE, maskNonCode)
        .trim()
        .replace(/;+$/, '')
        .trim();
    if (!code) {
        return 'The query is empty.';
    }
    const firstWord = code.split(/\s+/, 1)[0].toUpperCase();
    if (firstWord !== 'SELECT' && firstWord !== 'WITH') {
        return 'Only SELECT queries are allowed (a leading WITH clause is fine).';
    }
    if (code.includes(';')) {
        return 'Only one statement is allowed per query.';
    }
    const match = code.match(WRITE_KEYWORDS);
    if (match) {
        return `'${match[1].toUpperCase()}' is not allowed in a read-only query.`;
    }
    return null;
}

module.exports = { validateReadOnly };
