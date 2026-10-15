const HISTORY_ROLES = new Set(['user', 'assistant']);
const MAX_ATTEMPTS_RANGE = { min: 1, max: 5 };

/**
 * Check the question part of a request from the browser.
 *
 * @returns {{ ask: object|null, error: string|null }}
 */
function validateQuestion(body) {
    const question = typeof body?.question === 'string' ? body.question : '';
    if (!question.trim()) {
        return { ask: null, error: 'Ask a question.' };
    }

    const history = body.history ?? [];
    if (
        !Array.isArray(history) ||
        !history.every((turn) => HISTORY_ROLES.has(turn?.role) && typeof turn.content === 'string')
    ) {
        return { ask: null, error: 'history must be a list of user and assistant messages.' };
    }

    const maxAttempts = body.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < MAX_ATTEMPTS_RANGE.min || maxAttempts > MAX_ATTEMPTS_RANGE.max) {
        return {
            ask: null,
            error: `SQL attempts per question must be from ${MAX_ATTEMPTS_RANGE.min} to ${MAX_ATTEMPTS_RANGE.max}.`,
        };
    }

    const dictionary = body.dictionary ?? null;
    if (dictionary !== null && (typeof dictionary.name !== 'string' || typeof dictionary.text !== 'string')) {
        return { ask: null, error: 'dictionary must have a name and text.' };
    }

    return {
        ask: {
            question,
            history: history.map(({ role, content }) => ({ role, content })),
            maxAttempts,
            dictionary: dictionary && { name: dictionary.name, text: dictionary.text },
        },
        error: null,
    };
}

/** Run one question through the agent and shape the result as a chat message. */
async function askAgent(agent, { question, history, maxAttempts, dictionary }) {
    let result;
    try {
        result = await agent.query(question, {
            maxAttempts,
            history,
            dataDictionary: dictionary ? dictionary.text : null,
        });
    } catch (err) {
        // Shown inline so the rest of the conversation keeps working.
        return {
            role: 'assistant',
            content: '',
            error: `The question couldn't be answered. ${err?.name || 'Error'}: ${err?.message ?? err}`,
        };
    }

    const reply = {
        role: 'assistant',
        content: result.answer || '',
        sql: result.sqlQuery ?? null,
        dataNote: result.dataNote ?? null,
        attempts: result.attempts ?? [],
        totalRows: result.totalRows ?? 0,
        truncated: result.truncated ?? false,
        dictionary: dictionary ? dictionary.name : null,
    };
    if (result.fullResults !== null && result.fullResults !== undefined) {
        const columns = [...new Set(result.columnNames ?? [])];
        reply.columns = columns;
        reply.rows = result.fullResults.map((record) => columns.map((name) => record[name] ?? null));
    }
    return reply;
}

module.exports = { validateQuestion, askAgent, MAX_ATTEMPTS_RANGE };
