import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react'
import { parseMarkdown, type Block, type Inline } from '../markdown'

// Markdown, drawn. The text is read into a tree (markdown.ts) and the tree is drawn as ordinary elements: no HTML is
// ever made from what someone typed. A link opens in the browser when pressed, like any link in a message; nothing
// is loaded from it before that.

const runs = (list: Inline[]): ReactNode => list.map((r, i) =>
  r.t === 'text' ? <Fragment key={i}>{r.s}</Fragment>
    : r.t === 'br' ? <br key={i} />
    : r.t === 'code' ? <code key={i}>{r.s}</code>
    : r.t === 'a' ? <a key={i} className="msglink" href={r.href} target="_blank" rel="noopener noreferrer" title="Opens in your browser">{runs(r.c)}</a>
    : r.t === 'b' ? <b key={i}>{runs(r.c)}</b>
    : r.t === 'i' ? <i key={i}>{runs(r.c)}</i>
    : <s key={i}>{runs(r.c)}</s>)

const blocks = (list: Block[]): ReactNode => list.map((b, i) => {
  switch (b.t) {
    case 'h': { const H = `h${Math.min(6, b.n)}` as 'h1'; return <H key={i}>{runs(b.c)}</H> }
    case 'p': return <p key={i}>{runs(b.c)}</p>
    case 'code': return <pre key={i}><code>{b.s}</code></pre>
    case 'quote': return <blockquote key={i}>{blocks(b.c)}</blockquote>
    case 'ul': return <ul key={i}>{b.items.map((item, j) => <li key={j}>{blocks(item)}</li>)}</ul>
    case 'ol': return <ol key={i} start={b.start}>{b.items.map((item, j) => <li key={j}>{blocks(item)}</li>)}</ol>
    case 'hr': return <hr key={i} />
    case 'table': return (
      <div key={i} className="mdtablewrap">
        <table>
          <thead><tr>{b.head.map((c, j) => <th key={j}>{runs(c)}</th>)}</tr></thead>
          <tbody>{b.rows.map((row, j) => <tr key={j}>{row.map((c, k) => <td key={k}>{runs(c)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    )
  }
})

/** A text written in Markdown, drawn. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const tree = useMemo(() => parseMarkdown(text), [text])
  return <div className={'md' + (className ? ' ' + className : '')}>{blocks(tree)}</div>
}

/**
 * A box to write in, as plain text or as Markdown. Switched to Markdown it has buttons that put the marks in for you,
 * a preview of how it will be drawn, and a way to bring in a .md file's text. Plain, it is an ordinary text box and
 * what is typed is shown exactly as typed.
 */
export function MarkdownBox({ value, onChange, markdown, onMarkdown, rows = 4, maxLength, placeholder, onPaste }: {
  value: string; onChange: (text: string) => void
  markdown: boolean; onMarkdown: (on: boolean) => void
  rows?: number; maxLength: number; placeholder?: string
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
}) {
  const box = useRef<HTMLTextAreaElement>(null)
  const pick = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState(false)
  const [notice, setNotice] = useState('')

  /** Puts the text in place of what is selected, and selects `from`..`to` of the result. */
  const put = (text: string, from: number, to: number) => {
    onChange(text.slice(0, maxLength))
    requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(Math.min(from, maxLength), Math.min(to, maxLength)) })
  }
  /** A mark either side of what is selected (or of a word to type over). */
  const wrap = (mark: string, sample: string, close = mark) => {
    const el = box.current
    const [a, b] = el ? [el.selectionStart, el.selectionEnd] : [value.length, value.length]
    const inside = value.slice(a, b) || sample
    put(value.slice(0, a) + mark + inside + close + value.slice(b), a + mark.length, a + mark.length + inside.length)
  }
  /** A mark at the start of every selected line (or of the line the cursor is on). */
  const lines = (mark: (i: number) => string) => {
    const el = box.current
    const [a, b] = el ? [el.selectionStart, el.selectionEnd] : [value.length, value.length]
    const start = value.lastIndexOf('\n', a - 1) + 1
    const end = value.indexOf('\n', b) < 0 ? value.length : value.indexOf('\n', b)
    const made = value.slice(start, end).split('\n').map((l, i) => mark(i) + l).join('\n')
    put(value.slice(0, start) + made + value.slice(end), start, start + made.length)
  }
  const bringIn = async (file: File | undefined) => {
    if (!file) return
    const text = (await file.text()).replace(/\r\n?/g, '\n')
    setNotice(text.length > maxLength ? `Only the first ${maxLength.toLocaleString()} characters of ${file.name} fit here.` : '')
    onChange(text.slice(0, maxLength))
    onMarkdown(true)
  }

  return (
    <div className="mdbox">
      <div className="mdbar">
        {markdown && !preview && (
          <>
            <button type="button" title="Bold" onClick={() => wrap('**', 'bold')}><b>B</b></button>
            <button type="button" title="Italic" onClick={() => wrap('*', 'italic')}><i>I</i></button>
            <button type="button" title="Struck through" onClick={() => wrap('~~', 'struck')}><s>S</s></button>
            <button type="button" title="Heading" onClick={() => lines(() => '## ')}>H</button>
            <button type="button" title="List" onClick={() => lines(() => '- ')}>•</button>
            <button type="button" title="Numbered list" onClick={() => lines(i => `${i + 1}. `)}>1.</button>
            <button type="button" title="Quote" onClick={() => lines(() => '> ')}>❝</button>
            <button type="button" title="Code" onClick={() => wrap('`', 'code')}>{'</>'}</button>
            <button type="button" title="Link" onClick={() => wrap('[', 'words', '](https://)')}>🔗</button>
          </>
        )}
        <span className="grow" />
        {markdown && <button type="button" className={preview ? 'on' : ''} aria-pressed={preview} title="See how it will be drawn" onClick={() => setPreview(p => !p)}>Preview</button>}
        <button type="button" title="Bring in the text of a .md file from your computer. It is put in this box; nothing is uploaded" onClick={() => pick.current?.click()}>Import .md</button>
        <label className="mdswitch" title="Plain: shown exactly as typed. Markdown: headings, lists, bold, links and tables are drawn">
          <input type="checkbox" checked={markdown} onChange={e => { onMarkdown(e.target.checked); if (!e.target.checked) setPreview(false) }} /> Markdown
        </label>
        <input ref={pick} type="file" hidden accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={e => { void bringIn(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      {markdown && preview
        ? <div className="mdpreview">{value.trim() ? <Markdown text={value} /> : <span className="muted">Nothing to show yet.</span>}</div>
        : <textarea ref={box} value={value} rows={rows} maxLength={maxLength} placeholder={placeholder} onChange={e => onChange(e.target.value)} onPaste={onPaste} />}
      {notice && <div className="muted">{notice}</div>}
    </div>
  )
}
