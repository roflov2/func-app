export const HISTORY_TURNS = 3 // question/answer pairs sent back to the model for follow-ups

export const EXAMPLE_QUESTIONS = [
  'What kind of field is other_product_name? Sample the column and describe its subject matter.',
  'How many reports are in the table in total?',
  'What are the 10 most common values of other_product_name?',
]

/** Turn recent chat turns into model messages, including the SQL each answer used. */
export function buildHistory(messages) {
  const history = []
  for (const message of messages.slice(-HISTORY_TURNS * 2)) {
    if (message.role === 'user') {
      history.push({ role: 'user', content: message.content })
    } else if (message.content) {
      let text = message.content
      if (message.sql) text += `\n\nSQL used:\n${message.sql}`
      history.push({ role: 'assistant', content: text })
    }
  }
  return history
}

export function rowLabel(message) {
  const total = message.totalRows ?? 0
  const plus = message.truncated ? '+' : ''
  return `${total.toLocaleString('en-US')}${plus} row` + (total === 1 && !plus ? '' : 's')
}
