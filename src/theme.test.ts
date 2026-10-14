// Run with: node src/theme.test.ts
import { EDITABLE, MOST_SAVED_THEMES, SAVED_THEME_NAME, THEMES, colorsOf, contrast, fromThemeCode, ownColors, themeCode, withSaved } from './theme.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++ }

console.log('A person\'s own theme')
const fromForest = colorsOf('forest')
check(Object.keys(fromForest).length === EDITABLE.length && fromForest['--accent'] === THEMES.forest!.vars['--accent'] && fromForest['--text'] === '#e8e8f0',
  'starting from a theme takes its colours, and the default for the ones it leaves alone')
check(JSON.stringify(colorsOf('maple')) === JSON.stringify(Object.fromEntries(EDITABLE.map(e => [e.name, e.usual]))), 'Maple night is the defaults themselves')
const kept = ownColors({ '--bg0': '#ABCDEF', '--text': 'red', '--accent': '#12345' })
check(kept['--bg0'] === '#abcdef' && kept['--text'] === '#e8e8f0' && kept['--accent'] === '#9000ff' && Object.keys(kept).length === EDITABLE.length,
  'only real colours are used; anything else, or anything missing, is the default')
check(Object.keys(ownColors(null)).length === EDITABLE.length, 'nothing kept yet: the defaults')

console.log('Whether text can be read')
check(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01 && Math.abs(contrast('#777777', '#777777') - 1) < 0.01, 'black on white is 21, a colour on itself is 1')
check(contrast('#e8e8f0', '#14141c') > 4.5 && contrast('#e8e8f0', '#f4f4f8') < 4.5, 'the usual text reads on the usual panels, and not on a light one')
check(contrast('#14141c', '#e8e8f0') === contrast('#e8e8f0', '#14141c'), 'either way round')

console.log('A theme as a code')
const sakura = colorsOf('sakura')
const code = themeCode(sakura)
check(/^[A-Za-z0-9+/]+$/.test(code) && code.length < 45, `it is letters and digits, and short (${code.length}): ${code}`)
check(JSON.stringify(fromThemeCode(code)) === JSON.stringify(sakura), 'read back, it gives the same colours')
check(JSON.stringify(fromThemeCode('  ' + code.slice(0, 20) + '\n' + code.slice(20) + ' ')) === JSON.stringify(sakura), 'spaces and line breaks picked up when copying do not matter')
check(themeCode(colorsOf('forest')) !== code, 'another theme, another code')
const typo = code.slice(0, 10) + (code[10] === 'A' ? 'B' : 'A') + code.slice(11)
check(fromThemeCode(typo) === null && fromThemeCode(code.slice(0, -4)) === null && fromThemeCode('') === null && fromThemeCode('CYGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWoMbNjxMDMmlZmZmBMDWmZbGzY') === null && fromThemeCode('<script>alert(1)</script>') === null,
  'a mistyped, cut-short or made-up code, or something else entirely, is refused')

console.log('Themes saved under names')
const one = withSaved(undefined, '  Raid   night ', code)
check(JSON.stringify(one) === JSON.stringify([{ name: 'Raid night', code }]), 'saved under its name, tidied')
const two = withSaved(one!, 'Pastel', themeCode(colorsOf('forest')))
check(two!.length === 2 && two![0]!.name === 'Pastel', 'the newest comes first')
const again = withSaved(two!, 'raid NIGHT', themeCode(colorsOf('slate')))
check(again!.length === 2 && again![0]!.name === 'raid NIGHT' && again![0]!.code === themeCode(colorsOf('slate')), 'saving under a name that is there already replaces that one')
check(withSaved(two!, '   ', code) === null && withSaved(two!, 'Broken', 'not a code') === null, 'no name, or no real theme, is not saved')
const full = Array.from({ length: MOST_SAVED_THEMES }, (_, i) => ({ name: 'T' + i, code }))
check(withSaved(full, 'One more', code) === null && withSaved(full, 't3', code)!.length === MOST_SAVED_THEMES, `at most ${MOST_SAVED_THEMES}; one already there can still be replaced`)
check(withSaved(undefined, 'x'.repeat(80), code)![0]!.name.length === SAVED_THEME_NAME, 'a long name is cut short')

console.log(failures === 0 ? 'theme: all passed' : `theme: ${failures} FAILED`)
if (failures > 0) throw new Error(`${failures} theme checks failed`)
