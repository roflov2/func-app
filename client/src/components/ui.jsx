import { useId, useState } from 'react'

const ICONS = {
  error: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z',
  warning: 'M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z',
}

export function Icon({ path, size = 18 }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} fill="currentColor" />
    </svg>
  )
}

/** A coloured message box, like st.error / st.warning / st.info. */
export function Alert({ kind = 'info', children }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon path={ICONS[kind]} />
      <div className="alert-body">{children}</div>
    </div>
  )
}

export function Caption({ children }) {
  return <p className="caption">{children}</p>
}

export function Spinner({ children }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-wheel" aria-hidden="true" />
      {children}
    </div>
  )
}

/** A collapsible section, like st.expander. */
export function Expander({ title, children }) {
  return (
    <details className="expander">
      <summary>{title}</summary>
      <div className="expander-body">{children}</div>
    </details>
  )
}

/** Tabs, like st.tabs. `tabs` is a list of { label, content }. */
export function Tabs({ tabs }) {
  const [active, setActive] = useState(0)
  const id = useId()
  const current = Math.min(active, tabs.length - 1)

  function onKeyDown(event) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
    if (!step) return
    const next = (current + step + tabs.length) % tabs.length
    setActive(next)
    document.getElementById(`${id}-tab-${next}`)?.focus()
  }

  return (
    <div className="tabs">
      <div className="tab-list" role="tablist" onKeyDown={onKeyDown}>
        {tabs.map((tab, index) => (
          <button
            key={tab.label}
            id={`${id}-tab-${index}`}
            type="button"
            role="tab"
            aria-selected={index === current}
            aria-controls={`${id}-panel`}
            tabIndex={index === current ? 0 : -1}
            className="tab"
            onClick={() => setActive(index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="tab-panel" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${current}`}>
        {tabs[current].content}
      </div>
    </div>
  )
}

const SQL_KEYWORDS = new Set(
  (
    'select from where group by order having top as on join left right inner outer full cross and or not in ' +
    'is null like between case when then else end distinct with union all desc asc over partition cast ' +
    'convert count sum avg min max coalesce isnull exists any offset fetch next rows only percent ties ' +
    'apply pivot unpivot except intersect within year month day datepart datename dateadd datediff getdate ' +
    'lower upper len trim ltrim rtrim substring charindex replace round abs try_cast try_convert format ' +
    'string_agg row_number rank dense_rank lag lead nullif iif'
  ).split(' '),
)
const SQL_TOKEN =
  /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(N?'(?:[^']|'')*'?)|(\[[^\]]*\]?|"[^"]*"?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w@$#]*)/g

function highlightSql(code) {
  const parts = []
  let last = 0
  for (const match of code.matchAll(SQL_TOKEN)) {
    const [text, comment, string, , number, word] = match
    let kind = null
    if (comment) kind = 'comment'
    else if (string) kind = 'string'
    else if (number) kind = 'number'
    else if (word && SQL_KEYWORDS.has(word.toLowerCase())) kind = 'keyword'
    if (!kind) continue
    if (match.index > last) parts.push(code.slice(last, match.index))
    parts.push(
      <span key={match.index} className={`sql-${kind}`}>
        {text}
      </span>,
    )
    last = match.index + text.length
  }
  parts.push(code.slice(last))
  return parts
}

/** A code block with a copy button, like st.code. */
export function CodeBlock({ code, language, wrap = false }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be blocked (e.g. inside an iframe); nothing to do.
    }
  }

  return (
    <div className="code-block">
      <pre className={wrap ? 'wrap' : undefined}>
        <code>{language === 'sql' ? highlightSql(code) : code}</code>
      </pre>
      <button type="button" className="copy-button" onClick={copy} aria-label="Copy to clipboard">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/** An on/off switch, like st.toggle. */
export function Toggle({ label, help, checked, onChange }) {
  return (
    <label className="toggle" title={help}>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  )
}
