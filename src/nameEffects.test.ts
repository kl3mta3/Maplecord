// Run with: node src/nameEffects.test.ts
import { NAME_EFFECTS, chooseEffect, effectCss, effectSpec, lookOf, parseEffect, withLook } from './nameEffects.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++ }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

console.log('An effect as text')
check(same(parseEffect('neon'), { id: 'neon', angle: null, extra: [] }), 'a bare name')
check(same(parseEffect('gradient;135'), { id: 'gradient', angle: 135, extra: [] }), 'with an angle')
check(same(parseEffect('PRISM;90;#22C55E,#3b82f6,#a855f7'), { id: 'prism', angle: 90, extra: ['#22c55e', '#3b82f6', '#a855f7'] }), 'with more colours, in any case')
check(same(parseEffect('glitch;;#ff0000'), { id: 'glitch', angle: null, extra: ['#ff0000'] }), 'more colours and no angle')
check([null, '', 'sparkles', 'solid', 'neon;360', 'neon;abc', 'prism;1;red', 'prism;1;#111111,#222222,#333333,#444444', 'neon;1;#111111;x'].every(s => parseEffect(s) === null), 'anything else is no effect')
check(effectSpec('neon', null, []) === 'neon' && effectSpec('gradient', 135, []) === 'gradient;135' && effectSpec('prism', 90, ['#22C55E', 'nonsense', '#3b82f6']) === 'prism;90;#22c55e,#3b82f6' && effectSpec('glitch', null, ['#ff0000']) === 'glitch;;#ff0000', 'written back the same way')
check(effectSpec('solid', 10, ['#ffffff']) === '' && effectSpec('gradient', 365, []) === 'gradient;5' && effectSpec('gradient', -90, []) === 'gradient;270', 'solid is no effect; an angle is brought within a turn')
check(NAME_EFFECTS.filter(e => e.id !== 'solid').every(e => same(parseEffect(effectSpec(e.id, e.angle ?? null, e.colors.slice(2).map(c => c.usual)))?.id, e.id)), 'every effect there is survives being written and read')

console.log('How a name is drawn')
check(lookOf(null).kind.id === 'solid' && lookOf(null).plain && effectCss(lookOf(null)).className === '' && same(effectCss(lookOf(null)).vars, {}), 'nothing chosen: a plain name, nothing added')
check(lookOf({ nameColor: '#ff0000' }).kind.id === 'solid' && same(effectCss(lookOf({ nameColor: '#ff0000' })).vars, { color: '#ff0000' }), 'one colour: that colour')
const old = lookOf({ nameColor: '#ff0000', nameColor2: '#0000ff' })
check(old.kind.id === 'gradient' && old.angle === 90 && effectCss(old).vars['--ng'] === '#ff0000, #0000ff', 'two colours and no effect: the gradient it always was, left to right')
check(lookOf({ nameColor: '#ff0000', nameColor2: '#0000ff', nameEffect: 'gradient;45' }).angle === 45, 'an angle of their own')
const neon = lookOf({ nameColor: '#ffffff', nameEffect: 'neon' })
check(neon.kind.id === 'neon' && same(neon.colors, ['#ffffff', '#a855f7']) && effectCss(neon).className === 'fx fx-neon' && effectCss(neon).vars['--n2'] === '#a855f7', 'a colour they did not pick is the effect\'s usual one')
const prism = lookOf({ nameColor: '#111111', nameColor2: '#222222', nameEffect: 'prism;10;#333333' })
check(same(prism.colors, ['#111111', '#222222', '#333333', '#ec4899', '#6366f1']) && effectCss(prism).vars['--na'] === '10deg', 'the colours beyond two come with the effect')
check(lookOf({ nameColor: '#ff0000', nameEffect: 'made-up' }).kind.id === 'solid' && lookOf({ nameColor: 'red', nameColor2: '<b>' }).plain, 'an effect this app does not know, or a colour that is not one, is drawn plainly')
check(effectCss(lookOf({ nameEffect: 'aurora' })).layered && !effectCss(neon).layered && !effectCss(lookOf({ nameEffect: 'gummy' })).layered, 'the one that draws a second copy behind says so')
const jelly = effectCss(lookOf({ nameColor: '#111111', nameColor2: '#222222', nameEffect: 'gummy;;#333333' }))
check(same(jelly.letters, ['#111111', '#222222', '#333333', '#a9e3a6', '#f7c59f']) && effectCss(neon).letters === null && effectCss(lookOf(null)).letters === null, 'the one drawn a letter at a time gives the colours the letters take in turn')

console.log('Choosing in the editor')
check(same(chooseEffect('neon', { nameColor: '#00ff00' }), { nameColor: '#00ff00', nameColor2: '#a855f7', nameEffect: 'neon' }), 'a colour they have stays; the rest are the effect\'s')
check(same(chooseEffect('outline', { nameColor: '#00ff00', nameColor2: '#0000ff', nameEffect: 'neon' }), { nameColor: '#00ff00', nameColor2: null, nameEffect: 'outline' }), 'a second colour the effect has no use for is let go')
check(same(chooseEffect('solid', { nameColor: '#00ff00', nameColor2: '#0000ff', nameEffect: 'prism;10;#333333' }), { nameColor: '#00ff00', nameColor2: null, nameEffect: null }), 'solid: one colour, no effect')
check(same(chooseEffect('solid', {}), { nameColor: null, nameColor2: null, nameEffect: null }), 'solid with no colour is the plain name')
check(chooseEffect('prism', {}).nameEffect === 'prism;;#eab308,#ec4899,#6366f1' && chooseEffect('gradient', {}).nameEffect === 'gradient', 'the usual colours and the usual angle to begin with')
check(same(withLook(neon, { color: [1, '#FF0000'] }), { nameColor: '#ffffff', nameColor2: '#ff0000', nameEffect: 'neon' }), 'one colour changed')
check(withLook(prism, { color: [3, '#abcdef'] }).nameEffect === 'prism;10;#333333,#abcdef,#6366f1', 'a later colour changed: the ones before it are written out too')
check(withLook(old, { angle: 200 }).nameEffect === 'gradient;200' && withLook(lookOf({ nameEffect: 'gradient;200' }), { angle: 90 }).nameEffect === 'gradient', 'the angle turned, and turned back to the usual')
check(same(withLook(prism, { colors: ['#ef4444', '#f97316', '#eab308', '#f97316', '#ef4444'] }), { nameColor: '#ef4444', nameColor2: '#f97316', nameEffect: 'prism;10;#eab308,#f97316,#ef4444' }), 'a ready-made set of colours, keeping the angle')

console.log(failures === 0 ? 'nameEffects: all passed' : `nameEffects: ${failures} FAILED`)
if (failures > 0) throw new Error(`${failures} nameEffects checks failed`)
