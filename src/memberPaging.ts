import type { MemberDto } from './types'

// A server with a great many members is sent the people who are there and not everyone (GuildSummaryDto.membersPartial).
// The rest come when they are wanted: a page at a time, by name, or by id. These are the parts of that with no
// server in them.

/** The members we hold with others added: someone we already hold is replaced where they stand, anyone new goes on the end. */
export function mergeMembers(held: MemberDto[], found: MemberDto[]): MemberDto[] {
  if (found.length === 0) return held
  const byId = new Map(found.map(m => [m.userId, m]))
  const merged = held.map(m => byId.get(m.userId) ?? m)
  const have = new Set(held.map(m => m.userId))
  for (const m of found) if (!have.has(m.userId)) { have.add(m.userId); merged.push(m) }
  return merged
}

/**
 * Whom to ask the server about: the ids that are not among the members we hold and that we have not asked about
 * before. Each id once, and never an empty one. Whoever is returned is marked as asked.
 */
export function membersToAsk(held: MemberDto[], userIds: string[], asked: Set<string>): string[] {
  const have = new Set(held.map(m => m.userId))
  const fresh: string[] = []
  for (const id of userIds) {
    if (!id || have.has(id) || asked.has(id)) continue
    asked.add(id)
    fresh.push(id)
  }
  return fresh
}

/** A member list in pieces of at most `most`, for asking about many at once. */
export function inBatches<T>(all: T[], most: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < all.length; i += most) out.push(all.slice(i, i + most))
  return out
}
