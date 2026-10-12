import type { MemberDto, RoleDto } from './types'

/** One heading of the member list and the people under it. */
export interface MemberGroup { key: string; name: string; color: string | null; members: MemberDto[] }

/**
 * The member list in groups: whoever is online goes under their highest role, the groups in the order of the roles
 * (highest first); someone online with no role of their own goes under "Online"; bots that are online have a group
 * to themselves, "Bots", whatever their roles; everyone offline, bots too, is one group at the bottom. Within a group
 * people are in order of their name.
 */
export function memberGroups(members: MemberDto[], roles: RoleDto[] | null | undefined): MemberGroup[] {
  const named = new Map((roles ?? []).filter(r => !r.isEveryone).map(r => [r.id, r]))
  const highest = (m: MemberDto) => (m.roleIds ?? []).map(id => named.get(id)).filter((r): r is RoleDto => !!r).sort((a, b) => b.position - a.position)[0]
  const byName = (a: MemberDto, b: MemberDto) => a.username.localeCompare(b.username)

  const under = new Map<string, MemberDto[]>()
  const plain: MemberDto[] = [], bots: MemberDto[] = [], offline: MemberDto[] = []
  for (const m of members) {
    if (!m.online) { offline.push(m); continue }
    if (m.isBot) { bots.push(m); continue }
    const role = highest(m)
    if (!role) plain.push(m)
    else under.set(role.id, [...(under.get(role.id) ?? []), m])
  }
  const groups: MemberGroup[] = [...under.entries()]
    .map(([id, list]) => ({ role: named.get(id)!, list }))
    .sort((a, b) => b.role.position - a.role.position || a.role.name.localeCompare(b.role.name))
    .map(({ role, list }) => ({ key: role.id, name: role.name, color: role.color, members: list.sort(byName) }))
  if (plain.length > 0) groups.push({ key: 'online', name: 'Online', color: null, members: plain.sort(byName) })
  if (bots.length > 0) groups.push({ key: 'bots', name: 'Bots', color: null, members: bots.sort(byName) })
  if (offline.length > 0) groups.push({ key: 'offline', name: 'Offline', color: null, members: offline.sort(byName) })
  return groups
}
