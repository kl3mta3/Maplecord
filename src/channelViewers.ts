import { Permission, type ChannelDto, type GuildSummaryDto, type MemberDto } from './types.ts'

/**
 * Who can see a channel, worked out from what the app already holds about a server (its roles, who has which, and
 * the channel's own overrides), so the member list can show the people of the channel being read without asking
 * the server. It follows the server's own rule step by step. It only decides what a list shows: what anyone may
 * actually see or do is always the server's decision.
 */
export function canSeeChannel(guild: GuildSummaryDto, member: MemberDto, channel: ChannelDto): boolean {
  // A P2P bot is in the P2P channels it was let into, and in nothing else.
  if (member.directBot) return !!channel.directSince && (channel.bots ?? []).includes(member.userId)
  const has = permissionsIn(guild, member, channel)
  // An app that was not told the roles cannot say who is left out, so nobody is.
  return has === null || (has & Permission.ViewChannels) !== 0
}

/**
 * Whether the app takes someone to be allowed to manage messages in a channel. In a P2P channel nothing goes through
 * the server, so this is how each app decides whose pins count; someone the app knows nothing about is not.
 */
export function mayManageMessagesIn(guild: GuildSummaryDto, userId: string, channel: ChannelDto): boolean {
  const member = guild.members.find(m => m.userId === userId)
  if (!member || member.directBot) return false
  const has = permissionsIn(guild, member, channel)
  return has !== null && (has & Permission.ManageMessages) !== 0
}

/** Everything a member may do in a channel (every permission for the owner and for an administrator), or null if the app was not told the roles. */
export function permissionsIn(guild: GuildSummaryDto, member: MemberDto, channel: ChannelDto): number | null {
  if (member.userId === guild.guild.ownerId) return -1
  const roles = guild.roles
  if (!roles) return null
  const everyone = roles.find(r => r.isEveryone)
  const held = new Set(member.roleIds ?? [])
  let has = everyone?.permissions ?? 0
  for (const role of roles) if (held.has(role.id)) has |= role.permissions
  if (has & Permission.Administrator) return -1

  const overrides = channel.overrides ?? []
  if (overrides.length > 0) {
    // First what the channel says about everyone, then about the roles this person has, then about them by name.
    const forAll = everyone && overrides.find(o => o.roleId === everyone.id)
    if (forAll) has = (has & ~forAll.deny) | forAll.allow
    let allow = 0, deny = 0
    for (const o of overrides) if (o.roleId && o.roleId !== everyone?.id && held.has(o.roleId)) { allow |= o.allow; deny |= o.deny }
    has = (has & ~deny) | allow
    const own = overrides.find(o => o.userId === member.userId)
    if (own) has = (has & ~own.deny) | own.allow
  }
  return has
}

/** The members of a server who can see a channel, in the order they came. */
export const channelMembers = (guild: GuildSummaryDto, channel: ChannelDto): MemberDto[] => guild.members.filter(m => canSeeChannel(guild, m, channel))
