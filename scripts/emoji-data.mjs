// node scripts/emoji-data.mjs <emojibase-data folder> <emoji-test.txt> <twemoji assets/svg folder> [<Maplecord server repo>]
//
// Makes the emoji the app offers, from three sources, when a new emoji version comes out:
//   - Unicode's emoji-test.txt (https://www.unicode.org/Public/<version>/emoji/emoji-test.txt): which emojis there are,
//     exactly as each is written (fully qualified), in Unicode's order and groups;
//   - the emojibase-data package (npm, MIT): their :names: (JoyPixels', as Discord uses, with GitHub's and Slack's as
//     other names) and the words they are found by;
//   - Twemoji (github.com/jdecked/twemoji, graphics CC-BY 4.0): the pictures.
// Writes src/emojiData.ts, public/emoji/*.svg (only the pictures of these emojis) and, given the server's folder, its
// Services/EmojiList.cs (what may be reacted with).
import fs from 'node:fs'
import path from 'node:path'

const [baseDir, testFile, svgDir, serverDir] = process.argv.slice(2)
if (!baseDir || !testFile || !svgDir) {
  console.error('node scripts/emoji-data.mjs <emojibase-data folder> <emoji-test.txt> <twemoji assets/svg folder> [<server repo>]')
  process.exit(2)
}
const here = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const json = file => JSON.parse(fs.readFileSync(path.join(baseDir, file), 'utf8'))

// ---- Unicode's list ------------------------------------------------------------------------------------------------
const test = fs.readFileSync(testFile, 'utf8')
const version = /^# Version: ([\d.]+)/m.exec(test)?.[1]
if (!version) throw new Error('That is not emoji-test.txt')
/** Unicode's groups, as the picker shows them: the two of people made one, and the parts (skin tones alone) left out. */
const GROUPS = { 'Smileys & Emotion': 'People', 'People & Body': 'People', 'Animals & Nature': 'Nature', 'Food & Drink': 'Food', 'Activities': 'Activities',
  'Travel & Places': 'Travel', 'Objects': 'Objects', 'Symbols': 'Symbols', 'Flags': 'Flags' }
const groupNames = [...new Set(Object.values(GROUPS))]
const all = [] // every fully qualified emoji, in order: { emoji, hex, group }
let group = null
for (const line of test.split(/\r?\n/)) {
  const g = /^# group: (.+)$/.exec(line)
  if (g) { group = GROUPS[g[1].trim()] ?? null; continue }
  const m = /^([0-9A-F ]+?)\s*; fully-qualified\s*#\s*(\S+)/.exec(line)
  if (!m || !group) continue
  const cps = m[1].trim().split(/\s+/)
  all.push({ emoji: String.fromCodePoint(...cps.map(c => parseInt(c, 16))), hex: cps.filter(c => c !== 'FE0F').join('-'), group })
}
const byHex = new Map(all.map(e => [e.hex, e]))

// ---- Names and words ----------------------------------------------------------------------------------------------
const data = json('en/data.json')
const joy = json('en/shortcodes/joypixels.json'), github = json('en/shortcodes/github.json'), slack = json('en/shortcodes/iamcal.json'), plain = json('en/shortcodes/emojibase.json')
const list = v => (v === undefined ? [] : Array.isArray(v) ? v : [v])
const strip = hex => hex.split('-').filter(c => c !== 'FE0F').join('-')
const rows = []
const toned = new Set() // the skin tone forms offered by tone, so they are not listed by themselves too
const SKIN = /-1F3F[B-F]/
for (const e of data) {
  const own = byHex.get(strip(e.hexcode))
  if (!own) continue
  const names = [...new Set([...list(joy[e.hexcode]), ...list(github[e.hexcode]), ...list(slack[e.hexcode]), ...list(plain[e.hexcode])].map(n => n.toLowerCase()))]
  if (names.length === 0) names.push(e.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''))
  const words = [...new Set([...e.label.toLowerCase().split(/[^a-z0-9+]+/), ...(e.tags ?? [])].filter(w => w && !names.includes(w)))]
  // One skin tone for all of it (not two people of different tones), in the order light to dark.
  const tones = (e.skins ?? []).filter(s => typeof s.tone === 'number').sort((a, b) => a.tone - b.tone).map(s => byHex.get(strip(s.hexcode))?.emoji)
  for (const s of e.skins ?? []) toned.add(strip(s.hexcode))
  rows.push({ order: all.indexOf(own), row: [own.emoji, names.join(' '), words.join(' '), groupNames.indexOf(own.group), ...(tones.length === 5 && tones.every(Boolean) ? [tones] : [])] })
}
rows.sort((a, b) => a.order - b.order)
const listed = new Set(rows.map(r => r.row[0]))
const unnamed = all.filter(e => !listed.has(e.emoji) && !toned.has(e.hex) && !SKIN.test(e.hex))
if (unnamed.length) console.log(`No names for ${unnamed.length}, left out: ${unnamed.slice(0, 10).map(e => e.emoji).join(' ')}`)

fs.writeFileSync(path.join(here, 'src/emojiData.ts'), `// Made by scripts/emoji-data.mjs from Unicode's emoji-test.txt ${version} and emojibase-data; do not change by hand.
// Fetched only when an emoji picker is opened (see emoji.ts).

export const EMOJI_VERSION = '${version}'
export const EMOJI_GROUPS = ${JSON.stringify(groupNames)}
/** Each emoji: as written, its :names: (the first is the one shown), the words it is found by, its group in EMOJI_GROUPS,
 *  and its five skin tones, light to dark, if it has them. */
export type EmojiRow = [string, string, string, number, string[]?]
export const EMOJIS: EmojiRow[] = [
${rows.map(r => '  ' + JSON.stringify(r.row)).join(',\n')},
]
`)

// ---- Pictures -----------------------------------------------------------------------------------------------------
/** The name of an emoji's Twemoji picture: its code points, without the presentation selector unless joined (ZWJ). */
const pictureName = emoji => { const cps = [...emoji].map(c => c.codePointAt(0).toString(16)); return (emoji.includes('\u200d') ? cps : cps.filter(c => c !== 'fe0f')).join('-') }
const out = path.join(here, 'public/emoji')
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
let copied = 0
const missing = []
for (const e of all) {
  const name = pictureName(e.emoji) + '.svg'
  // (A few joined ones are named without their selectors too: kept here under the name the app asks for.)
  const from = [name, name.replace(/-fe0f/g, '')].map(n => path.join(svgDir, n)).find(f => fs.existsSync(f))
  if (!from) { missing.push(e.emoji); continue }
  if (!fs.existsSync(path.join(out, name))) { fs.copyFileSync(from, path.join(out, name)); copied++ }
}
fs.writeFileSync(path.join(out, 'LICENSE.txt'), `The pictures in this folder are Twemoji (https://github.com/jdecked/twemoji),
copyright Twitter, Inc. and other contributors, licensed under CC-BY 4.0:
https://creativecommons.org/licenses/by/4.0/
`)
if (missing.length) console.log(`No picture for ${missing.length} (they are written as text): ${missing.slice(0, 12).join(' ')}`)

// ---- The server's list --------------------------------------------------------------------------------------------
if (serverDir) {
  const file = path.join(serverDir, 'src/Maplecord.Server/Services/EmojiList.cs')
  const lines = []
  for (let i = 0; i < all.length; i += 40) lines.push('        ' + JSON.stringify(all.slice(i, i + 40).map(e => e.emoji).join(' ')) + (i + 40 < all.length ? ' + " " +' : ';'))
  fs.writeFileSync(file, `// Made by the app's scripts/emoji-data.mjs from Unicode's emoji-test.txt ${version}; do not change by hand.
namespace Maplecord.Server.Services;

/// <summary>Every emoji there is (Unicode ${version}), each exactly as written when fully qualified: what may be reacted with.</summary>
public static class EmojiList
{
    private const string All =
${lines.join('\n')}

    private static readonly HashSet<string> Set = [.. All.Split(' ')];

    public static bool Contains(string emoji) => Set.Contains(emoji);
}
`.replace(/\n/g, '\r\n'))
  console.log(`Wrote ${file}`)
}
console.log(`Emoji ${version}: ${rows.length} emojis offered (${rows.filter(r => r.row[4]).length} with skin tones), ${all.length} that may be reacted with, ${copied} pictures in public/emoji.`)
