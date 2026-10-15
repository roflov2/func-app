// About 10k tokens. The dictionary is resent on every model call, so this bounds cost.
const MAX_DICTIONARY_CHARS = 40_000;
const MAX_DICTIONARY_UPLOAD_BYTES = 1_000_000; // far beyond a hand-written dictionary

/**
 * Tidy a data dictionary for the prompt and cap its length.
 *
 * Line endings are normalised, trailing spaces and runs of blank lines are
 * dropped, and anything past `maxChars` is cut at the last line break so no
 * entry is left half-written. Running it twice gives the same result.
 *
 * @returns {{ text: string, truncated: boolean }}
 */
function prepareDataDictionary(text, maxChars = MAX_DICTIONARY_CHARS) {
    const lines = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const tidy = lines
        .map((line) => line.trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (tidy.length <= maxChars) {
        return { text: tidy, truncated: false };
    }
    const cut = tidy.lastIndexOf('\n', maxChars);
    return { text: tidy.slice(0, cut > 0 ? cut : maxChars).trimEnd(), truncated: true };
}

/** Decode an uploaded text file, allowing for the encodings Windows tools save in. */
function decodeText(raw) {
    const bytes = Buffer.from(raw);
    // Notepad's "Unicode" option writes UTF-16 with a byte order mark.
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(bytes);
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(bytes);
    }
    try {
        // Strips a UTF-8 byte order mark, like Python's utf-8-sig.
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        // Latin-1 maps every byte, so the last fallback can't fail.
        return decodeCp1252(bytes) ?? bytes.toString('latin1');
    }
}

// Bytes 0x80-0x9F in Windows-1252 (null where the code page leaves a byte undefined).
// Node's TextDecoder treats windows-1252 as Latin-1, so these are mapped here.
const CP1252_HIGH = [
    '\u20ac', null, '\u201a', '\u0192', '\u201e', '\u2026', '\u2020', '\u2021',
    '\u02c6', '\u2030', '\u0160', '\u2039', '\u0152', null, '\u017d', null,
    null, '\u2018', '\u2019', '\u201c', '\u201d', '\u2022', '\u2013', '\u2014',
    '\u02dc', '\u2122', '\u0161', '\u203a', '\u0153', null, '\u017e', '\u0178',
];

function decodeCp1252(bytes) {
    let text = '';
    for (const byte of bytes) {
        if (byte >= 0x80 && byte <= 0x9f) {
            const char = CP1252_HIGH[byte - 0x80];
            if (char === null) return null; // not cp1252
            text += char;
        } else {
            text += String.fromCharCode(byte);
        }
    }
    return text;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Return the column names that appear in text as whole words, ignoring case. */
function columnsMentioned(text, columnNames) {
    return columnNames.filter((name) =>
        new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(name)}(?![\\p{L}\\p{N}_])`, 'iu').test(text),
    );
}

/**
 * Turn an uploaded file into a data dictionary.
 *
 * @param {string} fileName Name of the uploaded file, shown back to the user.
 * @param {Uint8Array} raw File contents.
 * @param {string[]} columnNames Columns of the connected table, to check coverage against.
 * @returns {{ dictionary: object|null, error: string|null }}
 */
function readDictionary(fileName, raw, columnNames) {
    if (raw.length > MAX_DICTIONARY_UPLOAD_BYTES) {
        const limitMb = MAX_DICTIONARY_UPLOAD_BYTES / 1_000_000;
        return {
            dictionary: null,
            error: `${fileName} is ${(raw.length / 1_000_000).toFixed(1)} MB. Upload a text file under ${limitMb} MB.`,
        };
    }
    const { text, truncated } = prepareDataDictionary(decodeText(raw));
    if (!text) {
        return {
            dictionary: null,
            error: `${fileName} is empty. Add descriptions of the columns and upload it again.`,
        };
    }
    return {
        dictionary: { name: fileName, text, truncated, mentioned: columnsMentioned(text, columnNames) },
        error: null,
    };
}

/** A starter data dictionary that already lists every column in the table. */
function dictionaryTemplate(table, columns) {
    const lines = [
        `Data dictionary for ${table}`,
        '',
        'Everything in this file is sent to the assistant with each question. Write what a new',
        'analyst would need to know to query this table correctly. Any layout works. Delete these',
        "notes and any section you don't need.",
        '',
        '== About the table ==',
        'One row represents:',
        'Rows to leave out unless someone asks for them (test data, duplicates, withdrawn records):',
        '',
        '== Columns ==',
        'After each column, add what it means, its units, what its codes stand for, and how to',
        'read blanks or NULLs. Columns you leave blank are fine to keep or delete.',
        '',
        ...columns.map(({ name, type }) => `${name} (${type}):`),
        '',
        '== Terms ==',
        'How everyday terms map to the data, for example: "a loss report is one where <column> > 0".',
        '',
        '== Example questions and the SQL that answers them ==',
        'Q:',
        'SQL:',
    ];
    return lines.join('\n') + '\n';
}

function templateFileName(table) {
    return 'data_dictionary_' + table.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + '.txt';
}

module.exports = {
    MAX_DICTIONARY_CHARS,
    MAX_DICTIONARY_UPLOAD_BYTES,
    prepareDataDictionary,
    decodeText,
    columnsMentioned,
    readDictionary,
    dictionaryTemplate,
    templateFileName,
};
