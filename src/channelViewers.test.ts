// Run with: node src/channelViewers.test.ts
import { canSeeChannel, channelMembers } from './channelViewers.ts'
import { Permission, type ChannelDto, type ChannelOverrideDto, type GuildSummaryDto, type MemberDto, type RoleDto } from './types.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++ }

const role = (id: string, permissions: number, isEveryone = false): RoleDto => ({ id, guildId: 'g', name: id, color: null, position: isEveryone ? 0 : 1, permissions, isEveryone })
const member = (userId: string, roleIds: string[] = [], more: Partial<MemberDto> = {}): MemberDto =>
  ({ userId, username: userId, avatarUrl: null, nickname: null, role: 0, online: true, roleIds, ...more })
const override = (who: { roleId?: string; userId?: string }, allow: number, deny: number): ChannelOverrideDto =>
  ({ id: 'o' + Math.random(), channelId: 'c', roleId: who.roleId ?? null, userId: who.userId ?? null, allow, deny })
const channel = (overrides: ChannelOverrideDto[] = [], more: Partial<ChannelDto> = {}): ChannelDto =>
  ({ id: 'c', guildId: 'g', parentId: null, name: 'c', type: 0 as ChannelDto['type'], position: 0, overrides, ...more })

const View = Permission.ViewChannels
const everyone = role('everyone', View | Permission.SendMessages, true)
const staff = role('staff', Permission.ManageMessages)
const admin = role('admin', Permission.Administrator)
const owner = member('owner')
const ann = member('ann'), sam = member('sam', ['staff']), ada = member('ada', ['admin'])
const ordinaryBot = member('helper', [], { isBot: true })
const keeper = member('keeper', ['staff'], { isBot: true, directBot: true })
const all = [owner, ann, sam, ada, ordinaryBot, keeper]
const guild = (roles: RoleDto[] | null = [everyone, staff, admin]): GuildSummaryDto =>
  ({ guild: { id: 'g', name: 'g', iconUrl: null, ownerId: 'owner', createdAt: '' }, channels: [], members: all, roles, myPermissions: 0 }) as GuildSummaryDto
const who = (g: GuildSummaryDto, c: ChannelDto) => channelMembers(g, c).map(m => m.userId).join(' ')

console.log('Who the member list shows for a channel')
check(who(guild(), channel()) === 'owner ann sam ada helper', 'an open channel: everyone, and no P2P bot');
check(who(guild(), channel([override({ roleId: 'everyone' }, 0, View)])) === 'owner ada', 'hidden from everyone: its owner and administrators still see it');
check(who(guild(), channel([override({ roleId: 'everyone' }, 0, View), override({ roleId: 'staff' }, View, 0)])) === 'owner sam ada', 'hidden from everyone, shown to a role: the people with that role as well');
check(who(guild(), channel([override({ roleId: 'everyone' }, 0, View), override({ userId: 'ann' }, View, 0)])) === 'owner ann ada', 'or shown to one person by name');
check(who(guild(), channel([override({ roleId: 'staff' }, 0, View)])) === 'owner ann ada helper', 'hidden from a role: the people with it are left out');
check(who(guild(), channel([override({ roleId: 'staff' }, 0, View), override({ userId: 'sam' }, View, 0)])) === 'owner ann sam ada helper', 'unless one of them is let in by name');
check(who(guild([role('everyone', 0, true), staff, admin]), channel()) === 'owner ada', 'a server where everyone starts with nothing: only its owner and administrators');
check(who(guild([role('everyone', 0, true), role('staff', View), admin]), channel()) === 'owner sam ada', 'and whoever a role lets see channels');
check(who(guild(), channel([], { directSince: '2026-10-09T00:00:00Z', bots: ['keeper'] })) === 'owner ann sam ada helper keeper', 'a P2P bot shows in the P2P channel it was let into');
check(who(guild(), channel([], { directSince: '2026-10-09T00:00:00Z', bots: [] })) === 'owner ann sam ada helper', 'not in a P2P channel it was not let into');
check(who(guild(), channel([], { bots: ['keeper'] })) === 'owner ann sam ada helper', 'and never in an ordinary channel, whatever roles it was given');
check(who(guild(null), channel([override({ roleId: 'everyone' }, 0, View)])) === 'owner ann sam ada helper', 'an app that was not told the roles leaves nobody out');
check(canSeeChannel(guild(), ann, channel()) && !canSeeChannel(guild(), keeper, channel()), 'one person at a time says the same');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
// This file is checked with the app's own (browser) types, which have no `process`: failing loudly does the same job.
if (failures > 0) throw new Error(`${failures} member list checks failed`)
