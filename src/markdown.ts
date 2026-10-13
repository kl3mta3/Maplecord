// Markdown, read into a small tree that the app draws itself (see components/Markdown.tsx). Our own, on purpose: the
// app takes the common marks (headings, emphasis, lists, quotes, code, links, tables) and nothing else. There is no
// HTML in it at any point, so text that looks like a tag is drawn as the text it is; and a picture written in
// Markdown is drawn as a link to press, never fetched, because the app does not load things from other sites.

/** A run inside a line: plain text, or text with a mark on it. */
export type Inline =
  | { t: 'text'; s: string }
  | { t: 'b' | 'i' | 's'; c: Inline[] }
  | { t: 'code'; s: string }
  | { t: 'a'; href: string; c: Inline[] }
  | { t: 'br' }

/** A block of the text. */
export type Block =
  | { t: 'h'; n: number; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'code'; s: string }
  | { t: 'quote'; c: Block[] }
  | { t: 'ul'; items: Block[][] }
  | { t: 'ol'; start: number; items: Block[][] }
  | { t: 'hr' }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }

/** Only web addresses are links. Anything else that is written as one stays text. */
const safeLink = (href: string) => /^https?:\/\/[^\s<>"']+$/i.test(href)

// The marks inside a line, tried in this order at each place: an escaped character, code, a picture or a link,
// bold, struck through, italic, and a bare web address. Underscores only count at the edge of a word, so that
// snake_case_names stay as they are.
const MARK = new RegExp([
  /\\([\\`*_~[\]()#>!|-])/.source,
  /(`+)([^`]|[^`][\s\S]*?[^`])\2(?!`)/.source,
  /(!?)\[([^\]\n]+)\]\(([^)\s]+)\)/.source,
  /\*\*(?=\S)([\s\S]*?\S)\*\*/.source,
  /(?<![A-Za-z0-9])__(?=\S)([\s\S]*?\S)__(?![A-Za-z0-9])/.source,
  /~~(?=\S)([\s\S]*?\S)~~/.source,
  /\*(?=[^\s*])([\s\S]*?[^\s*])\*/.source,
  /(?<![A-Za-z0-9])_(?=[^\s_])([\s\S]*?[^\s_])_(?![A-Za-z0-9])/.source,
  /(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]])/.source,
].join('|'))

/** The runs of one stretch of text. A line break in it is kept as one. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  const say = (s: string) => {
    s.split('\n').forEach((line, i) => {
      if (i > 0) out.push({ t: 'br' })
      if (!line) return
      const last = out[out.length - 1]
      if (last?.t === 'text') last.s += line
      else out.push({ t: 'text', s: line })
    })
  }
  let rest = text
  while (rest) {
    const m = MARK.exec(rest)
    if (!m) { say(rest); break }
    say(rest.slice(0, m.index))
    rest = rest.slice(m.index + m[0].length)
    if (m[1] !== undefined) say(m[1])
    else if (m[2] !== undefined) out.push({ t: 'code', s: m[3]!.trim() ? m[3]!.replace(/^ (.*) $/s, '$1') : m[3]! })
    else if (m[5] !== undefined) {
      // A picture is its words, as a link: nothing is loaded from another site.
      if (safeLink(m[6]!)) out.push({ t: 'a', href: m[6]!, c: parseInline(m[5]!) })
      else say(m[0])
    }
    else if (m[7] !== undefined) out.push({ t: 'b', c: parseInline(m[7]) })
    else if (m[8] !== undefined) out.push({ t: 'b', c: parseInline(m[8]) })
    else if (m[9] !== undefined) out.push({ t: 's', c: parseInline(m[9]) })
    else if (m[10] !== undefined) out.push({ t: 'i', c: parseInline(m[10]) })
    else if (m[11] !== undefined) out.push({ t: 'i', c: parseInline(m[11]) })
    else if (m[12] !== undefined) out.push({ t: 'a', href: m[12], c: [{ t: 'text', s: m[12] }] })
  }
  return out
}

const FENCE = /^\s{0,3}(```+|~~~+)(.*)$/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/
const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim())
/** Two lines that start a table: a row with bars, and under it a rule with as many cells. */
const startsTable = (lines: string[], i: number) => lines[i]!.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]!) && cells(lines[i + 1]!).length === cells(lines[i]!).length

/** The blocks of a text written in Markdown. */
export function parseMarkdown(text: string, depth = 0): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) { i++; continue }

    const fence = FENCE.exec(line)
    if (fence) {
      const code: string[] = []
      i++
      while (i < lines.length && !new RegExp('^\\s{0,3}' + fence[1]![0]!.repeat(fence[1]!.length) + '+\\s*$').test(lines[i]!)) code.push(lines[i++]!)
      i++
      blocks.push({ t: 'code', s: code.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) { blocks.push({ t: 'h', n: heading[1]!.length, c: parseInline(heading[2]!) }); i++; continue }
    if (RULE.test(line)) { blocks.push({ t: 'hr' }); i++; continue }

    if (QUOTE.test(line)) {
      const inside: string[] = []
      while (i < lines.length && QUOTE.test(lines[i]!)) inside.push(QUOTE.exec(lines[i++]!)![1]!)
      // Quotes inside quotes are followed a few deep and no further: text cannot make the app work without end.
      blocks.push({ t: 'quote', c: depth < 4 ? parseMarkdown(inside.join('\n'), depth + 1) : [{ t: 'p', c: parseInline(inside.join('\n')) }] })
      continue
    }

    const item = ITEM.exec(line)
    if (item) {
      const ordered = /\d/.test(item[2]!)
      const indent = item[1]!.length
      const items: string[][] = []
      while (i < lines.length) {
        const here = lines[i]!
        const next = ITEM.exec(here)
        // Another item of this list: the same kind, no further in than this one.
        if (next && next[1]!.length <= indent + 1 && /\d/.test(next[2]!) === ordered) { items.push([next[3]!]); i++; continue }
        // Further in: it belongs to the item above. A line that starts at the edge ends the list, as people writing
        // a few lines one under the other expect.
        if (items.length > 0 && here.trim() && new RegExp('^\\s{' + (indent + 2) + ',}').test(here)) { items[items.length - 1]!.push(here.replace(new RegExp('^\\s{0,' + (indent + 4) + '}'), '')); i++; continue }
        // A blank line, then something further in: still the item above.
        if (items.length > 0 && !here.trim() && i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]!)) { items[items.length - 1]!.push(''); i++; continue }
        break
      }
      const made = items.map(body => (depth < 4 ? parseMarkdown(body.join('\n'), depth + 1) : [{ t: 'p', c: parseInline(body.join('\n')) } as Block]))
      blocks.push(ordered ? { t: 'ol', start: Number(/\d+/.exec(item[2]!)![0]), items: made } : { t: 'ul', items: made })
      continue
    }

    if (startsTable(lines, i)) {
      const head = cells(line).map(parseInline)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes('|')) {
        const row = cells(lines[i++]!)
        rows.push(head.map((_, c) => parseInline(row[c] ?? '')))
      }
      blocks.push({ t: 'table', head, rows })
      continue
    }

    const said: string[] = []
    while (i < lines.length && lines[i]!.trim() && !FENCE.test(lines[i]!) && !HEADING.test(lines[i]!) && !RULE.test(lines[i]!) && !QUOTE.test(lines[i]!) && !(said.length > 0 && (ITEM.test(lines[i]!) || startsTable(lines, i)))) said.push(lines[i++]!.replace(/^\s+/, ''))
    if (said.length === 0) said.push(lines[i++]!)
    blocks.push({ t: 'p', c: parseInline(said.join('\n')) })
  }
  return blocks
}

/** The first words of a Markdown text with its marks taken off: for a one-line preview. */
export function markdownFirstLine(text: string, most = 120): string {
  const flat = (runs: Inline[]): string => runs.map(r => (r.t === 'text' || r.t === 'code' ? r.s : r.t === 'br' ? ' ' : flat(r.c))).join('')
  const of = (blocks: Block[]): string => {
    for (const b of blocks) {
      const s = b.t === 'h' || b.t === 'p' ? flat(b.c) : b.t === 'code' ? b.s : b.t === 'quote' ? of(b.c) : b.t === 'ul' || b.t === 'ol' ? of(b.items[0] ?? []) : b.t === 'table' ? b.head.map(flat).join(' ') : ''
      if (s.trim()) return s.trim()
    }
    return ''
  }
  const line = of(parseMarkdown(text)).replace(/\s+/g, ' ')
  return line.length > most ? line.slice(0, most) + '…' : line
}
