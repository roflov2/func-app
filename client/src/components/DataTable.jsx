import { useMemo, useState } from 'react'

const PAGE_SIZE = 100

// One collator for every comparison: localeCompare with options builds a new one
// each call, which takes seconds to sort a 50,000-row result.
const collator = new Intl.Collator(undefined, { numeric: true })

function compareValues(a, b) {
  if (a === b) return 0
  if (a === null || a === undefined) return 1 // blanks sort last either way
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return collator.compare(String(a), String(b))
}

function Cell({ value }) {
  if (value === null || value === undefined) {
    return <td className="cell-null">None</td>
  }
  if (typeof value === 'boolean') {
    return (
      <td className="cell-bool">
        <input type="checkbox" checked={value} readOnly tabIndex={-1} aria-label={value ? 'Yes' : 'No'} />
      </td>
    )
  }
  if (typeof value === 'number') {
    return <td className="cell-number">{String(value)}</td>
  }
  const text = String(value)
  return <td title={text.length > 60 ? text : undefined}>{text}</td>
}

/**
 * A scrollable, sortable table, like st.dataframe(hide_index=True).
 * Click a header to sort; long results are split into pages.
 */
export default function DataTable({ columns, rows }) {
  const [sort, setSort] = useState(null) // { index, descending }
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const direction = sort.descending ? -1 : 1
    // Array.prototype.sort is stable, so equal values keep their query order.
    return [...rows].sort((a, b) => {
      const av = a[sort.index]
      const bv = b[sort.index]
      // Blanks stay last in both directions.
      if (av === null || av === undefined || bv === null || bv === undefined) return compareValues(av, bv)
      return direction * compareValues(av, bv)
    })
  }, [rows, sort])

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const start = current * PAGE_SIZE
  const visible = sorted.slice(start, start + PAGE_SIZE)

  function toggleSort(index) {
    setPage(0)
    setSort((previous) => {
      if (previous?.index !== index) return { index, descending: false }
      if (!previous.descending) return { index, descending: true }
      return null
    })
  }

  return (
    <div className="data-table">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((name, index) => {
                const state = sort?.index === index ? (sort.descending ? 'descending' : 'ascending') : 'none'
                return (
                  <th key={index} aria-sort={state}>
                    <button type="button" onClick={() => toggleSort(index)}>
                      {name || '(no name)'}
                      <span className="sort-mark" aria-hidden="true">
                        {state === 'ascending' ? '↑' : state === 'descending' ? '↓' : ''}
                      </span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, rowIndex) => (
              <tr key={start + rowIndex}>
                {row.map((value, index) => (
                  <Cell key={index} value={value} />
                ))}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td className="cell-empty" colSpan={Math.max(columns.length, 1)}>
                  No rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="pager">
          <span>
            Rows {(start + 1).toLocaleString('en-US')}–{(start + visible.length).toLocaleString('en-US')} of{' '}
            {sorted.length.toLocaleString('en-US')}
          </span>
          <button type="button" onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Previous page">
            ‹
          </button>
          <button
            type="button"
            onClick={() => setPage(current + 1)}
            disabled={current === pages - 1}
            aria-label="Next page"
          >
            ›
          </button>
        </div>
      )}
    </div>
  )
}
