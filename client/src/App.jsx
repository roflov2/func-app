import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { askQuestion, connect, getConfig, readDictionary } from './lib/api.js'
import { buildHistory, EXAMPLE_QUESTIONS } from './lib/chat.js'
import { Answer, ChatInput, ChatMessage, MarkdownText } from './components/Chat.jsx'
import DataTable from './components/DataTable.jsx'
import { AnsweringSettings, ConnectionSettings, DictionarySettings } from './components/Sidebar.jsx'
import { Alert, Caption, CodeBlock, Expander, Spinner } from './components/ui.jsx'
import './App.css'

const WIDE_SCREEN = '(min-width: 900px)'

const FAILURES = {
  sql: {
    title: (config) => `Couldn't connect to ${config.table} on ${config.server}.`,
    hints: (
      <>
        <li>
          the app&apos;s Azure identity can read the table: your <code>az login</code> account when running locally,
          or the Function App&apos;s managed identity in Azure
        </li>
        <li>the Functions host can reach the server on port 1433 (the server&apos;s firewall allows it)</li>
      </>
    ),
  },
  model: {
    title: (config) => `Couldn't use the ${config.deployment} deployment at ${config.endpoint}.`,
    hints: (
      <>
        <li>
          the same identity has the <em>Cognitive Services OpenAI User</em> role on the Azure OpenAI resource
        </li>
        <li>the endpoint, deployment name and API version match the deployment in Azure AI Foundry</li>
      </>
    ),
  },
}

/**
 * Says which service failed and how to fix it. `services` is missing when the request never
 * reached them, e.g. a setting was rejected.
 */
function ConnectionError({ config, error, services }) {
  const failed = services ? Object.keys(FAILURES).filter((key) => !services[key]?.ok) : null
  return (
    <>
      <Alert kind="error">
        {failed ? (
          failed.map((key) => (
            <div key={key}>
              <p>
                <strong>{FAILURES[key].title(config)}</strong>
              </p>
              <p className="pre-line">{services[key].error}</p>
            </div>
          ))
        ) : (
          <>
            <p>
              Couldn&apos;t connect to {config.table} on {config.server}.
            </p>
            <p className="pre-line">{error}</p>
          </>
        )}
      </Alert>
      <div className="markdown">
        <p>To fix this, check that:</p>
        <ul>
          {(failed ?? Object.keys(FAILURES)).map((key) => (
            <Fragment key={key}>{FAILURES[key].hints}</Fragment>
          ))}
        </ul>
        <p>
          Then update the settings in the sidebar if needed and select <strong>Connect</strong>.
        </p>
      </div>
    </>
  )
}

/** The table's columns and, when one is loaded, the data dictionary. */
function TableOverview({ info, table, dictionary }) {
  const mentioned = new Set(dictionary?.mentioned ?? [])
  const columnRows = info.columns.map(({ name, type }) => (dictionary ? [name, type, mentioned.has(name)] : [name, type]))
  const missing = info.columns.length - mentioned.size

  return (
    <>
      <Expander title={`Columns in ${table} (${info.columns.length})`}>
        <DataTable columns={dictionary ? ['Column', 'Type', 'In dictionary'] : ['Column', 'Type']} rows={columnRows} />
        {dictionary && missing > 0 && (
          <Caption>
            Not named in the dictionary: {missing}. For these the assistant goes on the column name, type and sample
            rows alone.
          </Caption>
        )}
        {info.sampleRows.rows.length > 0 && (
          <>
            <Caption>Sample rows</Caption>
            <DataTable columns={info.sampleRows.columns} rows={info.sampleRows.rows} />
          </>
        )}
      </Expander>
      {dictionary && (
        <Expander title={`Data dictionary: ${dictionary.name}`}>
          <Caption>This text is sent to the assistant with each question.</Caption>
          <div className="dictionary-scroll">
            <CodeBlock code={dictionary.text} wrap />
          </div>
        </Expander>
      )}
    </>
  )
}

function Examples({ hasDictionary, disabled, onAsk }) {
  return (
    <div className="examples">
      {!hasDictionary && (
        <Alert kind="info">
          Answers improve when the assistant knows what the columns mean. Upload a data dictionary in the sidebar, or
          download the template there to write one.
        </Alert>
      )}
      <p>Ask anything about the table, or start with one of these:</p>
      {EXAMPLE_QUESTIONS.map((question) => (
        <button key={question} type="button" className="button example" disabled={disabled} onClick={() => onAsk(question)}>
          {question}
        </button>
      ))}
    </div>
  )
}

export default function App() {
  const [boot, setBoot] = useState({ defaults: null, error: null })
  // status: idle | connecting | ready | error. `info` is the /api/connect response, and
  // `services` says how Azure SQL and Azure OpenAI each answered.
  const [connection, setConnection] = useState({
    status: 'idle',
    config: null,
    info: null,
    services: null,
    error: null,
  })
  const [file, setFile] = useState(null)
  const [dictionaryResult, setDictionaryResult] = useState(null)
  const [settings, setSettings] = useState({ maxAttempts: 3, useHistory: true })
  const [messages, setMessages] = useState([])
  const [pending, setPending] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia(WIDE_SCREEN).matches)
  const latestConnect = useRef(0)
  const bottom = useRef(null)

  const connectTo = useCallback(async (config) => {
    const attempt = ++latestConnect.current
    setConnection({ status: 'connecting', config, info: null, services: null, error: null })
    try {
      const info = await connect(config)
      if (attempt === latestConnect.current) {
        setConnection({ status: 'ready', config: info.config, info, services: info.services, error: null })
      }
    } catch (err) {
      if (attempt === latestConnect.current) {
        setConnection({ status: 'error', config, info: null, services: err.services, error: err.message })
      }
    }
  }, [])

  // Load the default settings, then connect with them, as the Streamlit app does on first load.
  useEffect(() => {
    getConfig().then(
      (defaults) => {
        setBoot({ defaults, error: null })
        connectTo(defaults.config)
      },
      (err) => setBoot({ defaults: null, error: err.message }),
    )
  }, [connectTo])

  // Read the uploaded dictionary against the connected table's columns. It's read
  // again after reconnecting, since which columns it names depends on the table.
  const info = connection.info
  useEffect(() => {
    if (!file || !info) return
    let cancelled = false
    readDictionary(
      file,
      info.columns.map((column) => column.name),
    ).then(
      (result) =>
        !cancelled && setDictionaryResult({ file, info, value: result.dictionary, maxChars: result.maxChars, error: null }),
      (err) => !cancelled && setDictionaryResult({ file, info, value: null, error: err.message }),
    )
    return () => {
      cancelled = true
    }
  }, [file, info])

  const current = dictionaryResult?.file === file && dictionaryResult?.info === info ? dictionaryResult : null
  const dictionary = {
    loading: Boolean(file && info && !current),
    value: file ? (current?.value ?? null) : null,
    error: file ? (current?.error ?? null) : null,
    maxChars: current?.maxChars ?? boot.defaults?.limits.maxDictionaryChars ?? 0,
  }

  useEffect(() => {
    if (messages.length) bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, pending])

  async function ask(question) {
    if (pending || connection.status !== 'ready') return
    const history = settings.useHistory ? buildHistory(messages) : []
    const used = dictionary.value
    setMessages((previous) => [...previous, { role: 'user', content: question }])
    setPending(true)
    let reply
    try {
      reply = await askQuestion({
        config: connection.config,
        question,
        history,
        maxAttempts: settings.maxAttempts,
        dictionary: used && { name: used.name, text: used.text },
      })
    } catch (err) {
      reply = { role: 'assistant', content: '', error: `The question couldn't be answered. ${err.message}` }
    }
    setMessages((previous) => [...previous, reply])
    setPending(false)
  }

  const ready = connection.status === 'ready'
  const table = connection.config?.table

  return (
    <div className={`layout${sidebarOpen ? ' sidebar-open' : ''}`}>
      <aside className="sidebar" aria-label="Settings" inert={!sidebarOpen}>
        <div className="sidebar-header">
          <button type="button" className="icon-button" onClick={() => setSidebarOpen(false)} aria-label="Close settings">
            «
          </button>
        </div>
        {boot.defaults && (
          // The connection form comes first so it's still there to fix if connecting fails.
          <ConnectionSettings
            config={boot.defaults.config}
            limits={boot.defaults.limits}
            connection={connection}
            onConnect={connectTo}
          />
        )}
        {ready && (
          <>
            <DictionarySettings
              table={table}
              connection={connection.info}
              file={file}
              dictionary={dictionary}
              onFile={setFile}
            />
            <AnsweringSettings
              settings={settings}
              limits={boot.defaults.limits}
              onChange={setSettings}
              canClear={messages.length > 0 && !pending}
              onClear={() => setMessages([])}
            />
          </>
        )}
      </aside>
      <div className="scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />

      <div className="main">
        {!sidebarOpen && (
          <button
            type="button"
            className="sidebar-toggle icon-button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open settings"
          >
            »
          </button>
        )}
        <main className="content">
          <h1>Scamwatch SQL assistant</h1>
          {!boot.defaults && !boot.error && <Spinner>Loading settings…</Spinner>}
          {boot.error && <Alert kind="error">Couldn&apos;t load the app&apos;s settings. {boot.error}</Alert>}
          {connection.status === 'connecting' && <Spinner>Connecting to Azure SQL and Azure OpenAI…</Spinner>}
          {connection.status === 'error' && (
            <ConnectionError config={connection.config} error={connection.error} services={connection.services} />
          )}
          {ready && (
            <>
              <Caption>
                Ask a question in plain English. The assistant writes T-SQL, runs it against {table} in{' '}
                {connection.config.database}, and explains what it found.
              </Caption>
              <TableOverview info={connection.info} table={table} dictionary={dictionary.value} />

              <div className="messages">
                {messages.map((message, index) => (
                  <ChatMessage key={index} role={message.role}>
                    {message.role === 'user' ? (
                      <MarkdownText>{message.content}</MarkdownText>
                    ) : (
                      <Answer message={message} fileKey={index} />
                    )}
                  </ChatMessage>
                ))}
                {pending && (
                  <ChatMessage role="assistant">
                    <Spinner>Writing and running SQL…</Spinner>
                  </ChatMessage>
                )}
              </div>
              {!messages.length && !pending && (
                <Examples hasDictionary={Boolean(dictionary.value)} disabled={dictionary.loading} onAsk={ask} />
              )}
              <div ref={bottom} />
            </>
          )}
        </main>
        {ready && (
          <div className="chat-input-bar">
            <ChatInput placeholder="Ask about the scam reports…" disabled={pending || dictionary.loading} onSubmit={ask} />
          </div>
        )}
      </div>
    </div>
  )
}
