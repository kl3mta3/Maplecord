// Run with: node src/railOrder.test.ts
import { dropInRail, railEntries, type RailThing, type RailWhere } from './railOrder.ts'
import type { GuildFolder } from './settings.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++ }

const folder = (id: string, ...guildIds: string[]): GuildFolder => ({ id, name: id, guildIds, open: true })
const shape = (ids: string[], order: string[] | undefined, folders: GuildFolder[]) =>
  railEntries(ids, order, folders).map(e => (e.kind === 'server' ? e.id : `[${e.id}: ${e.members.join(' ')}]`)).join(' ')
/** The list after one drag, drawn again from what was saved. */
const after = (ids: string[], order: string[] | undefined, folders: GuildFolder[], dragged: RailThing, target: RailThing, where: RailWhere) => {
  const saved = dropInRail(railEntries(ids, order, folders), dragged, target, where, () => 'new')
  return saved ? shape(ids, saved.order, saved.folders) : 'unchanged'
}

const ids = ['a', 'b', 'c', 'd', 'e']
const F = [folder('F', 'b', 'c')]

console.log('The server list as drawn')
check(shape(ids, undefined, []) === 'a b c d e', 'with nothing arranged the servers stand as the Maplecord server lists them')
check(shape(ids, ['d', 'a'], []) === 'd a b c e', 'the ones placed come first in their order; the rest follow as listed')
check(shape(ids, ['e', 'c', 'a', 'b', 'd'], F) === 'e [F: c b] a d', 'a folder stands where its first server would, its servers in the same order')
check(shape(ids, ['gone', 'b', 'a'], [folder('F', 'a', 'gone'), folder('G', 'c')]) === 'b a c d e', 'a folder with fewer than two servers left is not a folder; a server we are no longer in is nowhere')

console.log('Dragging to reorder')
check(after(ids, undefined, [], { server: 'd' }, { server: 'b' }, 'before') === 'a d b c e', 'a server let go on the upper edge of another goes before it')
check(after(ids, undefined, [], { server: 'a' }, { server: 'd' }, 'after') === 'b c d a e', 'and on the lower edge, after it')
check(after(ids, undefined, [], { server: 'e' }, { server: 'a' }, 'before') === 'e a b c d' && after(ids, undefined, [], { server: 'a' }, { server: 'e' }, 'after') === 'b c d e a', 'to the very top, and to the very bottom')
check(after(ids, undefined, [], { server: 'c' }, { server: 'c' }, 'before') === 'unchanged', 'let go on itself, nothing changes')

console.log('Dragging and folders')
check(after(ids, undefined, [], { server: 'd' }, { server: 'b' }, 'onto') === 'a [new: b d] c e', 'let go on the middle of a server, the two make a folder where that server stood')
check(after(ids, undefined, F, { server: 'e' }, { server: 'c' }, 'onto') === 'a [F: b c e] d', 'on the middle of a server in a folder, it joins that folder')
check(after(ids, undefined, F, { server: 'e' }, { server: 'c' }, 'before') === 'a [F: b e c] d', 'on the edge of a server in a folder, it goes into the folder at that place')
check(after(ids, undefined, F, { server: 'c' }, { server: 'b' }, 'before') === 'a [F: c b] d e', 'servers in a folder are reordered the same way')
check(after(ids, undefined, F, { server: 'b' }, { server: 'e' }, 'after') === 'a c d e b', 'dragged out past another server it leaves its folder, and a folder of one is no folder')
check(after(ids, undefined, F, { server: 'e' }, { folder: 'F' }, 'before') === 'a e [F: b c] d' && after(ids, undefined, F, { server: 'a' }, { folder: 'F' }, 'after') === '[F: b c] a d e', 'on the edge of a folder it goes before or after the whole folder')
check(after(ids, undefined, F, { server: 'e' }, { folder: 'F' }, 'onto') === 'a [F: b c e] d', 'on the middle of a folder it goes into it')
check(after(ids, undefined, [folder('F', 'a', 'b', 'c')], { server: 'b' }, { folder: 'F' }, 'before') === 'b [F: a c] d e', 'a server can be dragged out of its own folder to stand before it')

console.log('Dragging a whole folder')
check(after(ids, undefined, F, { folder: 'F' }, { server: 'e' }, 'after') === 'a d e [F: b c]' && after(ids, undefined, F, { folder: 'F' }, { server: 'a' }, 'before') === '[F: b c] a d e', 'a folder moves whole, before or after a server')
check(after(ids, undefined, [folder('F', 'a', 'b'), folder('G', 'd', 'e')], { folder: 'G' }, { folder: 'F' }, 'before') === '[G: d e] [F: a b] c', 'or before or after another folder')
check(after(ids, undefined, [folder('F', 'a', 'b'), folder('G', 'd', 'e')], { folder: 'G' }, { server: 'b' }, 'after') === '[F: a b] [G: d e] c', 'let go on a server inside another folder, it goes beside that folder, never into it')
check(after(ids, undefined, F, { folder: 'F' }, { server: 'c' }, 'after') === 'unchanged' && after(ids, undefined, F, { folder: 'F' }, { folder: 'F' }, 'before') === 'unchanged', 'let go on itself or one of its own servers, nothing changes')

console.log(failures === 0 ? 'railOrder: all passed' : `railOrder: ${failures} FAILED`)
// This file is checked with the app's own (browser) types, which have no `process`: failing loudly does the same job.
if (failures > 0) throw new Error(`${failures} server list checks failed`)
