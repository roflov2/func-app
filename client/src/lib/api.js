import { proxyPrefix } from './proxyPrefix.js'

async function request(path, options) {
  let response
  try {
    response = await fetch(`${proxyPrefix}${path}`, options)
  } catch (err) {
    throw new Error(`Couldn't reach the app's API (${err.message}).`)
  }
  let body = null
  try {
    body = await response.json()
  } catch {
    // Not JSON: fall back to the status code below.
  }
  if (!response.ok) {
    throw new Error(body?.error || `The API returned HTTP ${response.status}.`)
  }
  return body
}

const postJson = (path, body) =>
  request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

/** Default connection settings (from the Function App's settings) and input limits. */
export const getConfig = () => request('/api/config')

/** Connect to the table. Returns its columns, sample rows and a data dictionary template. */
export const connect = (config) => postJson('/api/connect', { config })

/** Read an uploaded data dictionary and check which of the columns it names. */
export function readDictionary(file, columnNames) {
  const form = new FormData()
  form.append('file', file)
  form.append('columns', JSON.stringify(columnNames))
  return request('/api/dictionary', { method: 'POST', body: form })
}

/** Ask one question. Returns the assistant's chat message. */
export const askQuestion = (body) => postJson('/api/query', body)
