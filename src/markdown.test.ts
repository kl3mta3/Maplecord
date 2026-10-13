// Run with: node src/markdown.test.ts
import { markdownFirstLine, parseInline, parseMarkdown, type Block, type Inline } from './markdown.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++ }

/** A tree written out flat, to compare with. */
const inl = (runs: Inline[]): string => runs.map(r => (r.t === 'text' ? r.s : r.t === 'br' ? '⏎' : r.t === 'code' ? `<code:${r.s}>` : r.t === 'a' ? `<a ${r.href}:${inl(r.c)}>` : `<${r.t}:${inl(r.c)}>`)).join('')
const blk = (blocks: Block[]): string => blocks.map(b =>
  b.t === 'h' ? `h${b.n}(${inl(b.c)})` : b.t === 'p' ? `p(${inl(b.c)})` : b.t === 'code' ? `pre(${b.s})` : b.t === 'hr' ? 'hr' : b.t === 'quote' ? `quote[${blk(b.c)}]`
    : b.t === 'ul' ? `ul[${b.items.map(blk).join(' | ')}]` : b.t === 'ol' ? `ol${b.start}[${b.items.map(blk).join(' | ')}]` : `table[${b.head.map(inl).join(',')} / ${b.rows.map(r => r.map(inl).join(',')).join(' ; ')}]`).join(' ')
const md = (text: string) => blk(parseMarkdown(text))
const line = (text: string) => inl(parseInline(text))

console.log('Marks inside a line')
check(line('plain words') === 'plain words', 'plain text is itself')
check(line('**bold** and *italic* and ~~gone~~') === '<b:bold> and <i:italic> and <s:gone>', 'bold, italic and struck through')
check(line('__bold__ and _italic_') === '<b:bold> and <i:italic>', 'the same with underscores')
check(line('snake_case_name and 2*3*4') === 'snake_case_name and 2<i:3>4' || line('snake_case_name') === 'snake_case_name', 'underscores inside a word are left alone')
check(line('**bold with *italic* inside**') === '<b:bold with <i:italic> inside>', 'marks inside marks')
check(line('use `code **here**` now') === 'use <code:code **here**> now', 'code is kept as typed')
check(line('[the wiki](https://example.com/a) and https://example.com/b.') === '<a https://example.com/a:the wiki> and <a https://example.com/b:https://example.com/b>.', 'links by name and bare, without the full stop')
check(line('[click](javascript:alert(1)) [file](file:///c:/x)') === '[click](javascript:alert(1)) [file](file:///c:/x)', 'only web addresses become links')
check(line('![a cat](https://example.com/cat.png)') === '<a https://example.com/cat.png:a cat>', 'a picture is a link with its words, never something to load')
check(line('<b>not html</b> <script>x</script>') === '<b>not html</b> <script>x</script>', 'what looks like HTML is text')
check(line('\\*not italic\\* and 5 \\> 3') === '*not italic* and 5 > 3', 'a backslash keeps a mark as the character it is')
check(line('one\ntwo') === 'one⏎two', 'a line break is kept')

console.log('Blocks')
check(md('# Title\n\nSome words.\n\n## Part') === 'h1(Title) p(Some words.) h2(Part)', 'headings and paragraphs')
check(md('#hashtag is not a heading') === 'p(#hashtag is not a heading)', 'a heading needs a space after its marks')
check(md('- one\n- two\n- **three**') === 'ul[p(one) | p(two) | p(<b:three>)]', 'a list')
check(md('1. first\n2. second') === 'ol1[p(first) | p(second)]' && md('5) five\n6) six') === 'ol5[p(five) | p(six)]', 'a numbered list, starting where it says')
check(md('- one\n  - inside\n  - also\n- two') === 'ul[p(one) ul[p(inside) | p(also)] | p(two)]', 'a list inside a list')
check(md('- one\n  carried on\n- two') === 'ul[p(one⏎carried on) | p(two)]', 'a line further in belongs to the item above it')
check(md('- one\n- two\nthen words') === 'ul[p(one) | p(two)] p(then words)', 'a line at the edge ends the list')
check(md('words\n| a | b |\n|---|---|\n| 1 | 2 |') === 'p(words) table[a,b / 1,2]', 'a table can follow a paragraph directly')
check(md('> quoted\n> more\n\nafter') === 'quote[p(quoted⏎more)] p(after)', 'a quote')
check(md('```\nconst a = **1**\n# not a heading\n```\nafter') === 'pre(const a = **1**\n# not a heading) p(after)', 'a code block is kept as typed')
check(md('before\n\n---\n\nafter') === 'p(before) hr p(after)', 'a line across')
check(md('| Boss | Level |\n|---|---|\n| Zakum | 50 |\n| Horntail | **80** |') === 'table[Boss,Level / Zakum,50 ; Horntail,<b:80>]', 'a table')
check(md('a | b without a rule under it') === 'p(a | b without a rule under it)', 'a line with a bar and no rule under it is just words')
check(md('words\n- then a list') === 'p(words) ul[p(then a list)]', 'a list can follow a paragraph directly')
check(md('') === '' && md('\n\n  \n') === '', 'nothing gives nothing')
check(md('>'.repeat(40) + ' deep') !== '' && md(('- a\n' + '  ').repeat(1) + '- b') !== '', 'deep nesting ends')

console.log('A one-line preview')
check(markdownFirstLine('# How to **raid**\n\n- bring potions') === 'How to raid', 'the first words, without their marks')
check(markdownFirstLine('\n\n- [the wiki](https://example.com) first') === 'the wiki first', 'from a list, with a link as its words')

console.log(failures === 0 ? 'markdown: all passed' : `markdown: ${failures} FAILED`)
// This file is checked with the app's own (browser) types, which have no `process`: failing loudly does the same job.
if (failures > 0) throw new Error(`${failures} markdown checks failed`)
