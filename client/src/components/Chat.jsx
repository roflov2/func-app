import { useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rowLabel } from '../lib/chat.js'
import { downloadFile, toCsv } from '../lib/files.js'
import DataTable from './DataTable.jsx'
import { Alert, Caption, CodeBlock, Tabs } from './ui.jsx'

const AVATARS = {
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5Z',
  assistant:
    'M20 9V7a2 2 0 0 0-2-2h-3V3h-2v2h-2V3H9v2H6a2 2 0 0 0-2 2v2H2v2h2v2H2v2h2v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2h2v-2h-2v-2h2V9h-2ZM9 11a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm-6 5h6v1.5H9V16Z',
}

/** One chat turn with an avatar, like st.chat_message. */
export function ChatMessage({ role, children }) {
  return (
    <div className={`chat-message chat-${role}`}>
      <div className="avatar" aria-label={role === 'user' ? 'You' : 'Assistant'} role="img">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d={AVATARS[role]} fill="currentColor" />
        </svg>
      </div>
      <div className="chat-content">{children}</div>
    </div>
  )
}

const markdownComponents = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  table: ({ node: _node, ...props }) => (
    <div className="markdown-table">
      <table {...props} />
    </div>
  ),
}

export function MarkdownText({ children }) {
  return (
    <div className="markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {children}
      </Markdown>
    </div>
  )
}

function ResultsTab({ message, fileKey }) {
  // Built on demand so a long chat doesn't hold a CSV copy of every table.
  const download = () =>
    downloadFile(`query_results_${fileKey}.csv`, toCsv(message.columns, message.rows), 'text/csv;charset=utf-8')
  return (
    <>
      <DataTable columns={message.columns} rows={message.rows} />
      <button type="button" className="button" onClick={download}>
        Download CSV
      </button>
    </>
  )
}

/** An assistant message: answer text, then results, SQL and failed attempts. */
export function Answer({ message, fileKey }) {
  const hasFrame = Array.isArray(message.rows)
  const failed = useMemo(() => (message.attempts ?? []).filter((attempt) => !attempt.success), [message.attempts])

  const tabs = []
  if (hasFrame) {
    tabs.push({ label: `Results (${rowLabel(message)})`, content: <ResultsTab message={message} fileKey={fileKey} /> })
  }
  if (message.sql) {
    tabs.push({
      label: 'SQL',
      content: (
        <>
          <CodeBlock code={message.sql} language="sql" />
          {message.dictionary && <Caption>Written with the data dictionary {message.dictionary}.</Caption>}
        </>
      ),
    })
  }
  if (failed.length) {
    tabs.push({
      label: `Failed attempts (${failed.length})`,
      content: failed.map((attempt, index) => (
        <div key={index} className="attempt">
          <CodeBlock code={attempt.query || '(no query)'} language="sql" />
          <Caption>{attempt.error || 'No error message returned.'}</Caption>
        </div>
      )),
    })
  }

  return (
    <>
      {message.error && <Alert kind="error">{message.error}</Alert>}
      {message.content && <MarkdownText>{message.content}</MarkdownText>}
      {message.dataNote && <Caption>{message.dataNote} The full result is in the table below.</Caption>}
      {tabs.length > 0 && <Tabs tabs={tabs} />}
    </>
  )
}

/** The question box pinned to the bottom of the page, like st.chat_input. */
export function ChatInput({ placeholder, disabled, onSubmit }) {
  const [text, setText] = useState('')

  function submit(event) {
    event.preventDefault()
    if (!text.trim() || disabled) return
    onSubmit(text)
    setText('')
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event)
  }

  return (
    <form className="chat-input" onSubmit={submit}>
      <textarea
        rows={1}
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="submit" className="send-button" disabled={disabled || !text.trim()} aria-label="Send">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M3 20.5 21 12 3 3.5v6.6l12.9 1.9L3 13.9z" fill="currentColor" />
        </svg>
      </button>
    </form>
  )
}
