// Turns driver values into plain JSON values, for the model and for display.
// The JavaScript counterpart of the Streamlit app's _arrow_safe / json.dumps(default=str).

function pad(value, width = 2) {
    return String(value).padStart(width, '0');
}

// mssql reads SQL date/time values as UTC (useUTC defaults to true), so the UTC
// fields hold the stored wall-clock value. Formatted the way Python's str() would.
function formatDate(value, declaration) {
    const date = `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
    const ms = value.getUTCMilliseconds();
    const time =
        `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}` +
        (ms ? `.${pad(ms, 3)}000` : '');
    if (declaration === 'date') return date;
    if (declaration === 'time') return time;
    if (declaration === 'datetimeoffset') return `${date} ${time}+00:00`;
    return `${date} ${time}`;
}

/**
 * Convert one value returned by the SQL driver into a JSON-safe value.
 *
 * @param {*} value Value from the driver.
 * @param {string} [declaration] SQL type of the column, e.g. "bigint" or "datetime2".
 */
function normalizeValue(value, declaration) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'string') {
        // The driver returns bigint as a string so large values keep their precision.
        if (declaration === 'bigint' && Number.isSafeInteger(Number(value))) {
            return Number(value);
        }
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'bigint') {
        return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : formatDate(value, declaration);
    }
    if (value instanceof Uint8Array) {
        return Buffer.from(value).toString('hex');
    }
    try {
        return JSON.stringify(value); // geography, hierarchyid and other structured values
    } catch {
        return String(value);
    }
}

module.exports = { normalizeValue };
