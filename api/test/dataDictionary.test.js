const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    MAX_DICTIONARY_UPLOAD_BYTES,
    prepareDataDictionary,
    decodeText,
    columnsMentioned,
    readDictionary,
    dictionaryTemplate,
    templateFileName,
} = require('../src/lib/dataDictionary');

test('prepareDataDictionary tidies line endings, trailing spaces and blank runs', () => {
    const { text, truncated } = prepareDataDictionary('\r\n  a  \r\nb\t\r\r\r\n\n\nc  \n\n');
    assert.equal(text, 'a\nb\n\nc');
    assert.equal(truncated, false);
});

test('prepareDataDictionary cuts long text at the last line break', () => {
    const { text, truncated } = prepareDataDictionary('line one\nline two\nline three', 15);
    assert.equal(text, 'line one');
    assert.equal(truncated, true);
    // No line break to cut at: hard cut.
    assert.deepEqual(prepareDataDictionary('abcdefghij', 4), { text: 'abcd', truncated: true });
});

test('prepareDataDictionary is idempotent', () => {
    const once = prepareDataDictionary('x  \r\n\r\n\r\ny\nzzzz\nw', 10).text;
    assert.equal(prepareDataDictionary(once, 10).text, once);
});

test('decodeText handles the encodings Windows tools save in', () => {
    assert.equal(decodeText(Buffer.from([0xff, 0xfe, 0x68, 0x00, 0xe9, 0x00])), 'hé'); // UTF-16 LE
    assert.equal(decodeText(Buffer.from([0xfe, 0xff, 0x00, 0x68, 0x00, 0xe9])), 'hé'); // UTF-16 BE
    assert.equal(decodeText(Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0xc3, 0xa9])), 'hé'); // UTF-8 with BOM
    assert.equal(decodeText(Buffer.from('café — ok', 'utf8')), 'café — ok');
    assert.equal(decodeText(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x96, 0x80])), 'café –€'); // cp1252
    assert.equal(decodeText(Buffer.from([0xe9, 0x81])), 'é\x81'); // 0x81 isn't cp1252: Latin-1
});

test('columnsMentioned matches whole words, ignoring case', () => {
    const text = 'Amount_Lost is in dollars. PAID means settled. id: row key.';
    assert.deepEqual(columnsMentioned(text, ['amount_lost', 'id', 'aid', 'status', 'paid']), [
        'amount_lost',
        'id',
        'paid',
    ]);
    assert.deepEqual(columnsMentioned('cost (in $)', ['cost', 'in $', 'co']), ['cost', 'in $']);
});

test('readDictionary returns the tidied dictionary and the columns it names', () => {
    const { dictionary, error } = readDictionary('dict.txt', Buffer.from('status: open or closed\r\n'), [
        'status',
        'amount',
    ]);
    assert.equal(error, null);
    assert.deepEqual(dictionary, {
        name: 'dict.txt',
        text: 'status: open or closed',
        truncated: false,
        mentioned: ['status'],
    });
});

test('readDictionary rejects files that are too large or empty', () => {
    const big = readDictionary('big.txt', new Uint8Array(MAX_DICTIONARY_UPLOAD_BYTES + 100_000), []);
    assert.equal(big.dictionary, null);
    assert.equal(big.error, 'big.txt is 1.1 MB. Upload a text file under 1 MB.');

    const empty = readDictionary('empty.txt', Buffer.from(' \r\n\t\n'), []);
    assert.equal(empty.error, 'empty.txt is empty. Add descriptions of the columns and upload it again.');
});

test('dictionaryTemplate lists every column', () => {
    const template = dictionaryTemplate('Reporting.T', [
        { name: 'id', type: 'int' },
        { name: 'other_product_name', type: 'nvarchar' },
    ]);
    assert.match(template, /^Data dictionary for Reporting\.T\n/);
    assert.match(template, /\nid \(int\):\nother_product_name \(nvarchar\):\n/);
    assert.ok(template.endsWith('Q:\nSQL:\n'));
});

test('templateFileName makes a safe file name from the table', () => {
    assert.equal(templateFileName('Reporting.ScamWatchReportFiltered'), 'data_dictionary_Reporting_ScamWatchReportFiltered.txt');
    assert.equal(templateFileName('[dbo].[My Table]'), 'data_dictionary_dbo_My_Table.txt');
});
