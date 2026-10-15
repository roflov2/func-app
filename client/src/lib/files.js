function csvCell(value) {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'boolean' ? (value ? 'True' : 'False') : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV with a byte order mark, so Excel opens non-English text correctly. */
export function toCsv(columns, rows) {
  const lines = [columns, ...rows].map((row) => row.map(csvCell).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/** Have the browser save text as a file. */
export function downloadFile(fileName, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
