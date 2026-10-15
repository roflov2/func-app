import { useId, useRef, useState } from 'react'
import { downloadFile } from '../lib/files.js'
import { Alert, Caption, Spinner, Toggle } from './ui.jsx'

const CONNECTION_FIELDS = [
  { key: 'server', label: 'SQL server' },
  { key: 'database', label: 'Database' },
  { key: 'table', label: 'Table', help: 'Schema-qualified, e.g. Reporting.ScamWatchReportFiltered' },
  { key: 'endpoint', label: 'Azure OpenAI endpoint' },
  { key: 'apiVersion', label: 'API version' },
  { key: 'deployment', label: 'Model deployment' },
]

/** A labelled input with an optional "?" tooltip, like Streamlit's help= argument. */
function Field({ label, help, children }) {
  const id = useId()
  return (
    <div className="field">
      <span className="field-label">
        <label htmlFor={id}>{label}</label>
        {help && (
          <span className="help" title={help} aria-hidden="true">
            ?
          </span>
        )}
      </span>
      {children({ id, 'aria-describedby': help ? `${id}-help` : undefined })}
      {help && (
        <span id={`${id}-help`} className="visually-hidden">
          {help}
        </span>
      )}
    </div>
  )
}

/** The connection form. Connect applies the new settings. */
export function ConnectionSettings({ config, limits, onConnect }) {
  const [form, setForm] = useState(config)
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value })

  function submit(event) {
    event.preventDefault()
    const next = {}
    for (const { key } of CONNECTION_FIELDS) next[key] = String(form[key] ?? '').trim()
    next.previewLimit = parseInt(form.previewLimit, 10)
    onConnect(next)
  }

  return (
    <section className="sidebar-section">
      <h2>Connection</h2>
      <form className="form-box" onSubmit={submit}>
        {CONNECTION_FIELDS.map(({ key, label, help }) => (
          <Field key={key} label={label} help={help}>
            {(props) => (
              <input
                {...props}
                type="text"
                value={form[key] ?? ''}
                onChange={set(key)}
                spellCheck={false}
                autoComplete="off"
              />
            )}
          </Field>
        ))}
        <Field
          label="Rows the model reads per result"
          help="Only limits what's sent to the model. The full result always appears in the table."
        >
          {(props) => (
            <input
              {...props}
              type="number"
              min={limits.previewLimit.min}
              max={limits.previewLimit.max}
              step={1}
              required
              value={form.previewLimit}
              onChange={set('previewLimit')}
            />
          )}
        </Field>
        <button type="submit" className="button button-primary">
          Connect
        </button>
      </form>
    </section>
  )
}

function formatSize(bytes) {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/** A .txt file picker with drag and drop, like st.file_uploader(type=["txt"]). */
function FileUpload({ file, onFile, label }) {
  const input = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [typeError, setTypeError] = useState(null)

  function choose(chosen) {
    if (!chosen) return
    if (!chosen.name.toLowerCase().endsWith('.txt')) {
      setTypeError(`${chosen.name} isn't a .txt file.`)
      return
    }
    setTypeError(null)
    onFile(chosen)
  }

  function onDrop(event) {
    event.preventDefault()
    setDragging(false)
    choose(event.dataTransfer.files[0])
  }

  return (
    <div className="file-upload">
      <div
        className={`drop-zone${dragging ? ' dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="drop-text">
          <span>Drag and drop a file here</span>
          <span className="caption">TXT, up to 1 MB</span>
        </div>
        <button type="button" className="button" onClick={() => input.current?.click()}>
          Browse files
        </button>
        <input
          ref={input}
          type="file"
          accept=".txt,text/plain"
          aria-label={label}
          hidden
          onChange={(event) => {
            choose(event.target.files[0])
            event.target.value = '' // allow choosing the same file again after removing it
          }}
        />
      </div>
      {typeError && <Alert kind="error">{typeError}</Alert>}
      {file && (
        <div className="file-chip">
          <span className="file-name">{file.name}</span>
          <span className="caption">{formatSize(file.size)}</span>
          <button type="button" className="icon-button" onClick={() => onFile(null)} aria-label={`Remove ${file.name}`}>
            ×
          </button>
        </div>
      )}
    </div>
  )
}

/** The data dictionary uploader and template download. */
export function DictionarySettings({ table, connection, file, dictionary, onFile }) {
  const columnCount = connection.columns.length
  return (
    <section className="sidebar-section">
      <h2>Data dictionary</h2>
      <Caption>
        Optional. A .txt file explaining what the columns mean, what codes stand for, and which rows or definitions
        your team uses. It&apos;s sent with every question to steer the SQL.
      </Caption>
      <FileUpload file={file} onFile={onFile} label="Data dictionary file" />
      {dictionary.loading && <Spinner>Reading the file…</Spinner>}
      {dictionary.error && <Alert kind="error">{dictionary.error}</Alert>}
      {dictionary.value && (
        <>
          <Caption>
            Used for new questions. Names {dictionary.value.mentioned.length} of {columnCount} columns in {table}.
          </Caption>
          {dictionary.value.truncated && (
            <Alert kind="warning">
              Only the first {dictionary.maxChars.toLocaleString('en-US')} characters are sent. Cut the file down to
              what matters for querying so nothing important is lost.
            </Alert>
          )}
        </>
      )}
      <button
        type="button"
        className="button"
        title="A .txt file listing every column, ready for you to add descriptions."
        onClick={() => downloadFile(connection.templateFileName, connection.template, 'text/plain')}
      >
        Download a template for this table
      </button>
    </section>
  )
}

/** The answering controls. */
export function AnsweringSettings({ settings, limits, onChange, canClear, onClear }) {
  return (
    <section className="sidebar-section">
      <h2>Answering</h2>
      <Field label="SQL attempts per question" help="How many times the model may rewrite a query that fails.">
        {(props) => (
          <div className="slider">
            <input
              {...props}
              type="range"
              min={limits.maxAttempts.min}
              max={limits.maxAttempts.max}
              step={1}
              value={settings.maxAttempts}
              onChange={(event) => onChange({ ...settings, maxAttempts: Number(event.target.value) })}
            />
            <output htmlFor={props.id}>{settings.maxAttempts}</output>
          </div>
        )}
      </Field>
      <Toggle
        label="Allow follow-up questions"
        help="Sends your last few questions and answers with each new one, so you can ask things like “now break that down by month”."
        checked={settings.useHistory}
        onChange={(useHistory) => onChange({ ...settings, useHistory })}
      />
      <button type="button" className="button" disabled={!canClear} onClick={onClear}>
        Clear conversation
      </button>
    </section>
  )
}
