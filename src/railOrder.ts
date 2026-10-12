import type { GuildFolder } from './settings'

// The list of servers down the left: the order they stand in, and the folders some of them are grouped into. Both
// are this person's own arrangement, kept on this device.

/** One thing standing in the list: a server by itself, or a folder with the servers in it. */
export type RailEntry = { kind: 'server'; id: string } | { kind: 'folder'; id: string; folder: GuildFolder; members: string[] }

/** What was picked up, and what it was let go on. */
export type RailThing = { server: string } | { folder: string }
/** Let go on the upper edge of something, on its lower edge, or on the middle of it. */
export type RailWhere = 'before' | 'after' | 'onto'

/**
 * The list as it is drawn. Servers stand in the order the person gave them; one they have not placed (a server just
 * joined) comes after those, in the order the Maplecord server lists them. A folder stands where the first of its
 * servers would, with its servers in that same order. A folder left with fewer than two servers is not a folder.
 */
export function railEntries(guildIds: string[], order: string[] | null | undefined, folders: GuildFolder[]): RailEntry[] {
  const place = new Map((order ?? []).map((id, i) => [id, i]))
  const ordered = guildIds.map((id, i) => ({ id, at: place.get(id) ?? (order?.length ?? 0) + i })).sort((a, b) => a.at - b.at).map(x => x.id)
  const real = folders.map(f => ({ folder: f, members: ordered.filter(id => f.guildIds.includes(id)) })).filter(f => f.members.length >= 2)
  const entries: RailEntry[] = []
  const drawn = new Set<string>()
  for (const id of ordered) {
    const f = real.find(x => x.members.includes(id))
    if (!f) entries.push({ kind: 'server', id })
    else if (!drawn.has(f.folder.id)) { drawn.add(f.folder.id); entries.push({ kind: 'folder', id: f.folder.id, folder: f.folder, members: f.members }) }
  }
  return entries
}

/**
 * The list after something was dragged and let go, as the order of the servers and the folders to keep; or null when
 * nothing changes.
 *
 * A server let go on the edge of another goes before or after it: into the same folder if that one is in a folder,
 * out of any folder otherwise. Let go on the middle of a server it joins that server's folder, or the two make a new
 * one. On the edge of a folder it goes before or after the whole folder; on the middle, into it.
 * A folder is moved whole, before or after what it was let go on, and never into another folder.
 */
export function dropInRail(entries: RailEntry[], dragged: RailThing, target: RailThing, where: RailWhere, newFolderId: () => string): { order: string[]; folders: GuildFolder[] } | null {
  const list: RailEntry[] = entries.map(e => (e.kind === 'folder' ? { ...e, members: [...e.members] } : { ...e }))
  const folderWith = (id: string) => list.find((e): e is Extract<RailEntry, { kind: 'folder' }> => e.kind === 'folder' && e.members.includes(id))
  const topIndex = (thing: RailThing) => list.findIndex(e => ('folder' in thing ? e.kind === 'folder' && e.id === thing.folder : e.kind === 'server' ? e.id === thing.server : e.members.includes(thing.server)))

  if ('folder' in dragged) {
    const moving = list.find(e => e.kind === 'folder' && e.id === dragged.folder)
    if (!moving) return null
    // Onto itself, or onto one of its own servers: it stays where it is.
    if ('folder' in target ? target.folder === dragged.folder : moving.kind === 'folder' && moving.members.includes(target.server)) return null
    list.splice(list.indexOf(moving), 1)
    const at = topIndex(target)
    if (at < 0) return null
    list.splice(where === 'before' ? at : at + 1, 0, moving)
  } else {
    const id = dragged.server
    if ('server' in target && target.server === id) return null
    // Taken from where it stands. A folder it leaves is kept for now, even with one server in it: it may be about to
    // get this one back in another place.
    const from = folderWith(id)
    if (from) from.members.splice(from.members.indexOf(id), 1)
    else {
      const at = list.findIndex(e => e.kind === 'server' && e.id === id)
      if (at < 0) return null
      list.splice(at, 1)
    }
    if ('folder' in target) {
      const at = topIndex(target)
      const into = list[at]
      if (at < 0 || !into || into.kind !== 'folder') return null
      if (where === 'onto') into.members.push(id)
      else list.splice(where === 'before' ? at : at + 1, 0, { kind: 'server', id })
    } else {
      const inFolder = folderWith(target.server)
      if (inFolder) {
        const at = inFolder.members.indexOf(target.server)
        if (where === 'onto') inFolder.members.push(id)
        else inFolder.members.splice(where === 'before' ? at : at + 1, 0, id)
      } else {
        const at = list.findIndex(e => e.kind === 'server' && e.id === target.server)
        if (at < 0) return null
        if (where === 'onto') list.splice(at, 1, { kind: 'folder', id: newFolderId(), folder: { id: '', name: 'Folder', guildIds: [], open: true }, members: [target.server, id] })
        else list.splice(where === 'before' ? at : at + 1, 0, { kind: 'server', id })
      }
    }
  }

  const order = list.flatMap(e => (e.kind === 'server' ? [e.id] : e.members))
  const folders = list.filter((e): e is Extract<RailEntry, { kind: 'folder' }> => e.kind === 'folder' && e.members.length >= 2).map(e => ({ ...e.folder, id: e.id, guildIds: e.members }))
  return { order, folders }
}
