const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateReadOnly } = require('../src/lib/sqlSafety');

test('allows single SELECT and WITH statements', () => {
    for (const query of [
        'SELECT TOP 10 * FROM Reporting.T',
        '  select count(*) from t;  ',
        'SELECT 1;;',
        'WITH c AS (SELECT a FROM t) SELECT * FROM c',
        "SELECT * FROM t WHERE note = 'DROP TABLE x; --'",
        "SELECT * FROM t WHERE note = N'it''s; DELETE'",
        'SELECT [Update], "Insert" FROM t',
        'SELECT a -- DROP TABLE t;\nFROM t',
        'SELECT a /* ; DELETE FROM t */ FROM t',
        'SELECT created_at, updated_by FROM t',
    ]) {
        assert.equal(validateReadOnly(query), null, query);
    }
});

test('rejects empty queries', () => {
    assert.equal(validateReadOnly(''), 'The query is empty.');
    assert.equal(validateReadOnly(' ; -- nothing'), 'The query is empty.');
});

test('rejects statements that are not SELECT or WITH', () => {
    for (const query of ['UPDATE t SET a = 1', 'EXEC sp_who', '(SELECT 1)', 'DECLARE @a int']) {
        assert.equal(validateReadOnly(query), 'Only SELECT queries are allowed (a leading WITH clause is fine).', query);
    }
});

test('rejects more than one statement', () => {
    assert.equal(validateReadOnly('SELECT 1; SELECT 2'), 'Only one statement is allowed per query.');
    assert.equal(validateReadOnly('SELECT 1; DROP TABLE t'), 'Only one statement is allowed per query.');
});

test('rejects write keywords anywhere in the code', () => {
    assert.equal(validateReadOnly('SELECT * INTO backup FROM t'), "'INTO' is not allowed in a read-only query.");
    assert.equal(
        validateReadOnly('WITH x AS (SELECT 1 a) delete FROM x'),
        "'DELETE' is not allowed in a read-only query.",
    );
    assert.equal(
        validateReadOnly("SELECT * FROM OPENROWSET('x', 'y')"),
        "'OPENROWSET' is not allowed in a read-only query.",
    );
});
