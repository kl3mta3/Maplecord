// Run with: node src/memberGroups.test.ts
import { memberGroups } from './memberGroups.ts'
import type { MemberDto, RoleDto } from './types.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++ }

const role = (id: string, position: number, isEveryone = false): RoleDto => ({ id, guildId: 'g', name: id, color: null, position, permissions: 0, isEveryone })
const member = (userId: string, roleIds: string[] = [], online = true, isBot = false): MemberDto => ({ userId, username: userId, avatarUrl: null, nickname: null, role: 0, online, roleIds, isBot })
const shape = (groups: ReturnType<typeof memberGroups>) => groups.map(g => `${g.name}: ${g.members.map(m => m.userId).join(' ')}`).join(' | ')

const roles = [role('everyone', 0, true), role('Member', 1), role('Moderator', 2), role('Admin', 3)]

console.log('The member list in groups')
check(shape(memberGroups([member('zed', ['Member']), member('amy', ['Admin']), member('bob', ['Moderator', 'Member']), member('cat', ['Member'])], roles))
  === 'Admin: amy | Moderator: bob | Member: cat zed', 'online people go under their highest role, the groups highest first, names in order')
check(shape(memberGroups([member('amy', ['Admin']), member('dan'), member('eve', ['everyone'])], roles)) === 'Admin: amy | Online: dan eve',
  'someone online with no role of their own goes under Online')
check(shape(memberGroups([member('amy', ['Admin']), member('bob', ['Admin'], false), member('cat', ['Member'], false), member('dan', [], false)], roles))
  === 'Admin: amy | Offline: bob cat dan', 'everyone offline is one group at the bottom, whatever their roles')
check(shape(memberGroups([member('bob', ['Moderator'], false)], roles)) === 'Offline: bob', 'a role with nobody online has no heading')
check(shape(memberGroups([member('amy', ['gone']), member('bob', ['Member'])], roles)) === 'Member: bob | Online: amy', 'a role that no longer exists counts for nothing')
check(shape(memberGroups([member('amy', ['Admin']), member('dan'), member('songs', ['Admin'], true, true), member('archive', [], true, true), member('sleepy', ['Member'], false, true), member('zed', [], false)], roles))
  === 'Admin: amy | Online: dan | Bots: archive songs | Offline: sleepy zed', 'bots that are online have a group of their own after the people, whatever their roles; an offline bot is with everyone offline')
check(shape(memberGroups([member('amy', ['Admin'])], null)) === 'Online: amy' && memberGroups([], roles).length === 0, 'with no roles known everyone online is under Online; nobody, no groups')

console.log(failures === 0 ? 'memberGroups: all passed' : `memberGroups: ${failures} FAILED`)
// This file is checked with the app's own (browser) types, which have no `process`: failing loudly does the same job.
if (failures > 0) throw new Error(`${failures} member group checks failed`)
