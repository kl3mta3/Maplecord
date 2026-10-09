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
  if (member.userId === guild.guild.ownerId) return true
  const roles = guild.roles
  // An app that was not told the roles cannot say who is left out, so nobody is.
  if (!roles) return true
  const everyone = roles.find(r => r.isEveryone)
  const held = new Set(member.roleIds ?? [])
  let has = everyone?.permissions ?? 0
  for (const role of roles) if (held.has(role.id)) has |= role.permissions
  if (has & Permission.Administrator) return true

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
  return (has & Permission.ViewChannels) !== 0
}

/** The members of a server who can see a channel, in the order they came. */
export const channelMembers = (guild: GuildSummaryDto, channel: ChannelDto): MemberDto[] => guild.members.filter(m => canSeeChannel(guild, m, channel))
