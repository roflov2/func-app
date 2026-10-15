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
        'SELECT * FROM t ORDER BY a OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY',
        'SELECT @@ROWCOUNT, data_set, [begin], "set", IIF(a > 1, 1, 0) FROM t',
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

test('rejects statements chained without a semicolon', () => {
    for (const [query, word] of [
        ['SELECT 1 BEGIN TRAN SELECT * FROM t WITH (TABLOCKX, HOLDLOCK)', 'BEGIN'],
        ['SELECT 1 KILL 53', 'KILL'],
        ["SELECT 1 WAITFOR DELAY '01:00:00'", 'WAITFOR'],
        ['SELECT 1 USE master', 'USE'],
        ['SELECT 1 SET ROWCOUNT 1', 'SET'],
        ['SELECT 1 DISABLE TRIGGER trg ON t', 'TRIGGER'],
        ['SELECT 1 WHILE 1 = 1 SELECT 2', 'WHILE'],
    ]) {
        assert.equal(validateReadOnly(query), `'${word}' is not allowed in a read-only query.`, query);
    }
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
