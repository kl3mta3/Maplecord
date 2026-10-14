// Run with: node src/theme.test.ts
import { EDITABLE, THEMES, colorsOf, contrast, ownColors } from './theme.ts'

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

console.log(failures === 0 ? 'theme: all passed' : `theme: ${failures} FAILED`)
if (failures > 0) throw new Error(`${failures} theme checks failed`)
