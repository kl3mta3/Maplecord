import type {
  AccountDeletionDto, MemberPageDto, ConnectionTestDto, ConnectionTestPassDto, TestRelayDto, CommunityPollDto, CommunityPollAnswerDto, CalendarEventDto, ApplicationDto, CommandRuleDto, CommandRulesDto, QrDto, AttachmentDto, ChannelBotDto, ChannelOverrideDto, DiscoverGuildDto, NewServerKinds, SupportReportDto, InvitePreviewDto, WebhookDto, UploadSettingsDto, MarkedFileDto, TransferSettingsDto, StreamSettingsDto, PrivacyDto, PreferencesDto, ItemIconDto, ChannelDto, ServerMetaDto, MemberDto, DecorationDto, UpdateProfileRequest, UserProfileDto, CommandDto, DmChannelDto, FriendDto, FriendsDto, GuildDto, GuildSummaryDto, IceServerDto, InviteDto, MessageDto, RoleDto, TokenResponse, UserDto, TagCardDto, RollStatsDto, SearchResultDto, MediaItemDto, SignInMethodsDto, ContactEmailDto, ConnectionDto, ConnectionServiceDto, FriendLinkDto, FriendLinkOwnerDto, UsableExpressionsDto, GuildExpressionsDto, ExpressionLibraryDto, ExpressionDto, ExpressionGroupDto, PushChoices } from './types'

/**
 * Asks the terms dialog (see TermsGate) to look again whether there are terms to agree to: sent when the server
 * refuses something until they are agreed to, and when the live connection drops (as it does when the server is
 * updated, which is when new terms come).
 */
export const TERMS_CHECK_EVENT = 'maplecord:terms-check'
export function askAboutTerms() { try { window.dispatchEvent(new Event(TERMS_CHECK_EVENT)) } catch { /* no window */ } }

export class ApiError extends Error {
  status: number
  /** The server's own label for the failure, when it gives one (e.g. "suspended"). */
  code: string | null
  constructor(message: string, status: number, code: string | null = null) { super(message); this.status = status; this.code = code }
  /** The server no longer accepts this sign-in: the token ran out, or the account was suspended. */
  get unauthorized() { return this.status === 401 || this.code === 'suspended' }
}

/** Thin wrapper over the server's REST API; every call carries the bearer token. */
export class Api {
  private serverUrl: () => string
  private token: () => string | null
  constructor(serverUrl: () => string, token: () => string | null) { this.serverUrl = serverUrl; this.token = token }
  /** The Maplecord server this talks to. */
  get server() { return this.serverUrl() }

  private async request<T>(method: string, path: string, body?: unknown, raw?: BodyInit): Promise<T> {
    const headers: Record<string, string> = {}
    const token = this.token()
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetch(this.serverUrl().replace(/\/$/, '') + path, {
      method,
      headers,
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    })
    if (!res.ok) {
      let message = res.statusText || `HTTP ${res.status}`
      let code: string | null = null
      try {
        const data = await res.json()
        message = data.error ?? data.title ?? message
        code = typeof data.code === 'string' ? data.code : null
      } catch { /* non-JSON */ }
      // A demo account whose details ran out is told so, with what to do about it (see the server's DemoSignIn).
      if (res.status === 401 && code !== 'demo-expired') message = 'Your session has expired. Please sign in again.'
      if (code === 'terms') askAboutTerms()
      throw new ApiError(message, res.status, code)
    }
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  /** Null when the server is unreachable or too old to say. */
  /** What the support window shows. Only there while the support button is switched on. */
  support() { return this.request<SupportReportDto>('GET', '/api/support') }
  /** The terms of service in force, and which version this account agreed to (0: none). */
  terms() { return this.request<{ current: number; accepted: number; acceptedAt: string | null; updated: string }>('GET', '/api/me/terms') }
  agreeToTerms(version: number) { return this.request<void>('POST', '/api/me/terms', { version }) }
  /** Reporting a picture the server keeps, or a person, to whoever runs this Maplecord. */
  /** `picture`: for a picture a webhook or bot put in a message ("embed"), its address here; `id` is then the message. */
  reportPicture(kind: string, id: string, category: string, note: string, picture?: string) { return this.request<void>('POST', '/api/reports/picture', { kind, id, category, note, picture }) }
  reportPerson(userId: string, category: string, note: string, messageId?: string) { return this.request<void>('POST', '/api/reports/person', { userId, category, note, messageId }) }
  meta(serverUrl: string) {
    return fetch(serverUrl.replace(/\/$/, '') + '/api/meta').then(r => (r.ok ? (r.json() as Promise<ServerMetaDto>) : null)).catch(() => null)
  }

  // ---- auth ----
  providers(serverUrl: string) {
    return fetch(serverUrl.replace(/\/$/, '') + '/auth/providers').then(r => { if (!r.ok) throw new ApiError('Server unreachable', r.status); return r.json() as Promise<string[]> })
  }
  /** The ways of signing in whoever runs the server switched off for now. Empty from a server too old to say. */
  providersOff(serverUrl: string) {
    return fetch(serverUrl.replace(/\/$/, '') + '/auth/providers/off').then(r => (r.ok ? (r.json() as Promise<string[]>) : [])).catch(() => [] as string[])
  }
  devLogin(serverUrl: string, username: string) {
    return fetch(serverUrl.replace(/\/$/, '') + '/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) })
      .then(async r => { if (!r.ok) throw new ApiError('Dev login failed', r.status); return (await r.json()) as TokenResponse })
  }
  /** A demo account's ID and password, set by whoever runs the server (for App Store review and the like). */
  demoLogin(serverUrl: string, demoId: string, password: string) {
    return fetch(serverUrl.replace(/\/$/, '') + '/auth/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ demoId, password }) })
      .then(async r => {
        if (r.ok) return (await r.json()) as TokenResponse
        let said: { error?: string; code?: string } = {}
        try { said = await r.json() } catch { /* no body */ }
        throw new ApiError(said.error ?? (r.status === 429 ? 'Too many tries. Wait a minute and try again.' : 'Demo sign-in failed.'), r.status, said.code ?? null)
      })
  }
  /**
   * A new person whose email has to be confirmed first holds a ticket: this asks whether the link has been opened yet.
   * The sign-in once it has; 'waiting' until then.
   */
  pendingSignIn(serverUrl: string, ticket: string): Promise<TokenResponse | 'waiting'> {
    return fetch(serverUrl.replace(/\/$/, '') + '/auth/pending', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }) })
      .then(async r => {
        if (r.status === 202) return 'waiting' as const
        if (!r.ok) throw new ApiError(r.status === 410 ? 'That sign-in has run out. Start again.' : 'Sign-in failed', r.status)
        return (await r.json()) as TokenResponse
      })
  }
  exchangeCode(serverUrl: string, code: string) {
    return fetch(serverUrl.replace(/\/$/, '') + '/auth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      .then(async r => { if (!r.ok) throw new ApiError('Sign-in failed', r.status); return (await r.json()) as TokenResponse })
  }

  // ---- me / guilds ----
  me() { return this.request<UserDto>('GET', '/api/me') }
  guilds() { return this.request<GuildSummaryDto[]>('GET', '/api/guilds') }
  guild(id: string) { return this.request<GuildSummaryDto>('GET', `/api/guilds/${id}`) }
  /** A server's members in order of username, after the one given; with q, only those whose name starts with it. */
  members(guildId: string, opts: { after?: string; q?: string; limit?: number } = {}) {
    const query = new URLSearchParams()
    if (opts.after) query.set('after', opts.after)
    if (opts.q) query.set('q', opts.q)
    if (opts.limit) query.set('limit', String(opts.limit))
    return this.request<MemberPageDto>('GET', `/api/guilds/${guildId}/members?${query}`)
  }
  /** Particular members by id, at most a hundred at once. Ids that are not members are left out. */
  lookupMembers(guildId: string, userIds: string[]) { return this.request<MemberDto[]>('POST', `/api/guilds/${guildId}/members/lookup`, { userIds }) }
  createGuild(name: string, isPublic = false, kind: 'standard' | 'hybrid' | 'p2p' = 'standard') { return this.request<GuildSummaryDto>('POST', '/api/guilds', { name, isPublic, kind }) }
  deleteGuild(id: string) { return this.request<void>('DELETE', `/api/guilds/${id}`) }
  leaveGuild(id: string) { return this.request<void>('POST', `/api/guilds/${id}/leave`) }
  createInvite(guildId: string, expiresInMinutes: number | null = null, maxUses: number | null = null) { return this.request<InviteDto>('POST', `/api/guilds/${guildId}/invites`, { expiresInMinutes, maxUses }) }
  invites(guildId: string) { return this.request<InviteDto[]>('GET', `/api/guilds/${guildId}/invites`) }
  revokeInvite(code: string) { return this.request<void>('DELETE', `/api/invites/${encodeURIComponent(code)}`) }
  updateGuildListing(id: string, patch: { isPublic: boolean; description: string; topics: string[]; featurable: boolean }) { return this.request<GuildDto>('PATCH', `/api/guilds/${id}`, patch) }
  /** Whether rolls in a server's P2P channels add to people's roll totals. */
  /** A server's welcome channel (null for none), and whether a line is posted there when someone joins. */
  setGuildWelcome(id: string, channelId: string | null, messages: boolean) { return this.request<GuildDto>('PUT', `/api/guilds/${id}/welcome`, { channelId, messages }) }
  /** Which kinds of server can be made right now. An older server has no such list: then every kind is offered, and it says no itself. */
  newServerKinds() { return this.request<NewServerKinds>('GET', '/api/guilds/kinds') }
  setGuildHideOwner(id: string, hideOwnerRole: boolean) { return this.request<GuildDto>('PATCH', `/api/guilds/${id}`, { hideOwnerRole }) }
  setGuildCountRolls(id: string, countRolls: boolean) { return this.request<GuildDto>('PATCH', `/api/guilds/${id}`, { countRolls }) }
  /** One's own roll totals. */
  rollStats() { return this.request<RollStatsDto>('GET', '/api/me/roll-stats') }
  /** Public servers, by name and/or exact topic. */
  discover(q: string, topic: string) { return this.request<DiscoverGuildDto[]>('GET', `/api/discover?q=${encodeURIComponent(q)}&topic=${encodeURIComponent(topic)}`) }
  discoverTopics() { return this.request<string[]>('GET', '/api/discover/topics') }
  /** One public server, as the list shows it (404 if it is not public). */
  discoverOne(id: string) { return this.request<DiscoverGuildDto>('GET', `/api/discover/${id}`) }
  /** The symbols a server tag can carry. */
  tagSymbols() { return this.request<string[]>('GET', '/api/tags/symbols') }
  setGuildTag(guildId: string, text: string, symbol: string | null, look: string | null = null) { return this.request<GuildDto>('PUT', `/api/guilds/${guildId}/tag`, { text, symbol, look }) }
  removeGuildTag(guildId: string) { return this.request<GuildDto>('DELETE', `/api/guilds/${guildId}/tag`) }
  /** Wears the tag of one of our servers beside our name, or with null none. */
  wearTag(guildId: string | null) { return this.request<UserDto>('PUT', '/api/me/tag', { guildId }) }
  /** Whose tag is that? */
  tagCard(guildId: string) { return this.request<TagCardDto>('GET', `/api/tags/${guildId}`) }
  joinPublic(guildId: string) { return this.request<GuildSummaryDto>('POST', `/api/discover/${guildId}/join`) }
  /** What one role or one person is allowed and denied in one channel, beyond what their roles say. */
  setChannelOverride(channelId: string, kind: 'role' | 'user', id: string, allow: number, deny: number) { return this.request<ChannelOverrideDto>('PUT', `/api/channels/${channelId}/overrides/${kind}/${id}`, { allow, deny }) }
  deleteChannelOverride(channelId: string, overrideId: string) { return this.request<void>('DELETE', `/api/channels/${channelId}/overrides/${overrideId}`) }
  /** Gives a channel the access of the group it is in, in place of its own. */
  matchGroupAccess(channelId: string) { return this.request<void>('POST', `/api/channels/${channelId}/overrides/match-group`) }
  /** Puts a channel (or a group of channels) at a place in the order, and optionally into another group. */
  moveChannel(id: string, parentId: string | null, position: number) { return this.request<ChannelDto>('PATCH', `/api/channels/${id}`, parentId ? { parentId, position } : { position }) }
  /** An invite's link as a QR code. */
  inviteQr(code: string) { return this.request<QrDto>('GET', `/api/invites/${encodeURIComponent(code)}/qr`) }
  invitePreview(code: string) { return this.request<InvitePreviewDto>('GET', `/api/invites/${encodeURIComponent(code)}`) }
  joinInvite(code: string) { return this.request<GuildSummaryDto>('POST', `/api/invites/${encodeURIComponent(code.trim())}/join`) }
  createChannel(guildId: string, name: string, type: number, parentId: string | null, direct = false) {
    return this.request<ChannelDto>('POST', `/api/guilds/${guildId}/channels`, { name, type, parentId, direct })
  }
  /** Make a voice channel P2P or relayed again. Either way everyone in its call is dropped from it. */
  setChannelDirect(id: string, direct: boolean) { return this.request<ChannelDto>('PATCH', `/api/channels/${id}`, { direct }) }
  webhooks(guildId: string) { return this.request<WebhookDto[]>('GET', `/api/guilds/${guildId}/webhooks`) }
  createWebhook(channelId: string, name: string) { return this.request<WebhookDto>('POST', `/api/channels/${channelId}/webhooks`, { name }) }
  updateWebhook(id: string, patch: { name?: string; channelId?: string }) { return this.request<WebhookDto>('PATCH', `/api/webhooks/${id}`, patch) }
  /** Gives it a new address; the old one stops working. */
  regenerateWebhook(id: string) { return this.request<WebhookDto>('POST', `/api/webhooks/${id}/regenerate`) }
  deleteWebhook(id: string) { return this.request<void>('DELETE', `/api/webhooks/${id}`) }

  /** The bots this person has made. */
  applications() { return this.request<ApplicationDto[]>('GET', '/api/applications') }
  createApplication(name: string, direct = false, voice = false) { return this.request<ApplicationDto>('POST', '/api/applications', { name, direct, voice }) }
  /** The P2P bots in a P2P channel; for someone who may decide that, also the ones that could be let in. */
  channelBots(channelId: string) { return this.request<ChannelBotDto[]>('GET', `/api/channels/${channelId}/p2p-bots`) }
  letBotIn(channelId: string, applicationId: string, on: boolean) { return this.request<void>(on ? 'PUT' : 'DELETE', `/api/channels/${channelId}/p2p-bots/${applicationId}`) }
  updateApplication(id: string, patch: { name?: string; description?: string; interactionsUrl?: string; voice?: boolean }) { return this.request<ApplicationDto>('PATCH', `/api/applications/${id}`, patch) }
  /** Gives it a new token; the old one stops working. */
  regenerateApplication(id: string) { return this.request<ApplicationDto>('POST', `/api/applications/${id}/regenerate`) }
  deleteApplication(id: string) { return this.request<void>('DELETE', `/api/applications/${id}`) }
  guildApplications(guildId: string) { return this.request<ApplicationDto[]>('GET', `/api/guilds/${guildId}/applications`) }
  addGuildApplication(guildId: string, appId: string) { return this.request<ApplicationDto>('POST', `/api/guilds/${guildId}/applications/${encodeURIComponent(appId)}`) }
  removeGuildApplication(guildId: string, appId: string) { return this.request<void>('DELETE', `/api/guilds/${guildId}/applications/${appId}`) }
  /** Who may use a bot's slash commands in a server, and where. Needs Manage Server. */
  commandRules(guildId: string, appId: string) { return this.request<CommandRulesDto>('GET', `/api/guilds/${guildId}/applications/${appId}/command-rules`) }
  /** Sets the rule for the bot as a whole (no command) or for one command; no rule takes it away. Answers with all of them. */
  setCommandRule(guildId: string, appId: string, command: string | null, rule: CommandRuleDto | null) { return this.request<CommandRulesDto>('PUT', `/api/guilds/${guildId}/applications/${appId}/command-rules`, { command, rule }) }

  /** What deleting the account would take with it (the servers it owns, its bots). */
  deletionPreview() { return this.request<AccountDeletionDto>('GET', '/api/me/deletion') }
  /** Deletes the signed-in account. Refused (code "reauth") unless this sign-in is only a few minutes old. */
  deleteAccount(username: string) { return this.request<void>('POST', '/api/me/delete', { username }) }
  /** Every other sign-in of this account stops working; this one gets a fresh token. Refused (code "reauth") unless this sign-in is a few minutes old. */
  signOutEverywhere() { return this.request<TokenResponse>('POST', '/api/me/sign-out-everywhere') }

  privacy() { return this.request<PrivacyDto>('GET', '/api/me/privacy') }
  preferences() { return this.request<PreferencesDto>('GET', '/api/me/preferences') }
  /** The phone this app runs on, to be told of messages while the app is closed (the iPhone or Android app; see native/app.ts). */
  pushDevice(body: { platform: 'ios' | 'android'; token: string; voipToken?: string | null; sandbox: boolean; choices: PushChoices }) { return this.request<void>('PUT', '/api/me/push-devices', body) }
  forgetPushDevice(token: string) { return this.request<void>('DELETE', `/api/me/push-devices/${encodeURIComponent(token)}`) }
  setPreferences(p: PreferencesDto) { return this.request<PreferencesDto>('PUT', '/api/me/preferences', p) }
  blocks() { return this.request<UserDto[]>('GET', '/api/blocks') }
  block(userId: string) { return this.request<UserDto>('PUT', `/api/blocks/${userId}`) }
  unblock(userId: string) { return this.request<void>('DELETE', `/api/blocks/${userId}`) }
  /** Turning P2P on is refused (code "reauth") unless this sign-in is only a few minutes old. */
  setPrivacy(allowDirect: boolean) { return this.request<PrivacyDto>('PUT', '/api/me/privacy', { allowDirect }) }
  deleteChannel(id: string) { return this.request<void>('DELETE', `/api/channels/${id}`) }
  /** Deletes a group of channels and every channel in it. Only called after the person has been asked, twice. */
  deleteGroup(id: string) { return this.request<void>('DELETE', `/api/channels/${id}?withChannels=true`) }
  /** A calendar's background: one of calendarLooks.ts, or '' for none. */
  setCalendarBackground(id: string, background: string) { return this.request<ChannelDto>('PATCH', `/api/channels/${id}`, { background }) }
  renameChannel(id: string, name: string) { return this.request<ChannelDto>('PATCH', `/api/channels/${id}`, { name }) }
  kick(guildId: string, userId: string) { return this.request<void>('DELETE', `/api/guilds/${guildId}/members/${userId}`) }
  /** deleteDays: also delete what they wrote in the server in the last 1, 3 or 7 days, or (0) all of it. Null deletes nothing. */
  ban(guildId: string, userId: string, deleteDays: number | null = null) { return this.request<void>('POST', `/api/guilds/${guildId}/bans/${userId}`, { reason: null, deleteDays }) }

  // ---- roles ----
  roles(guildId: string) { return this.request<RoleDto[]>('GET', `/api/guilds/${guildId}/roles`) }
  createRole(guildId: string, name: string, color: string | null, permissions: number) {
    return this.request<RoleDto>('POST', `/api/guilds/${guildId}/roles`, { name, color, permissions })
  }
  updateRole(roleId: string, patch: { name?: string; color?: string | null; permissions?: number; position?: number }) {
    return this.request<RoleDto>('PATCH', `/api/roles/${roleId}`, patch)
  }
  deleteRole(roleId: string) { return this.request<void>('DELETE', `/api/roles/${roleId}`) }
  /** Mutes someone in a server's voice channels, or undoes it. For people who may mute members there. */
  setVoiceMuted(guildId: string, userId: string, muted: boolean) { return this.request<MemberDto>('PUT', `/api/guilds/${guildId}/members/${userId}/voice-mute`, { muted }) }
  setMemberRoles(guildId: string, userId: string, roleIds: string[]) {
    return this.request<unknown>('PUT', `/api/guilds/${guildId}/members/${userId}/roles`, { roleIds })
  }

  // ---- messages ----
  /** A channel's own messages, newest first; with `thread` the ones in that message's thread; with `around` the page that message is in. */
  messages(channelId: string, before?: string, limit = 50, more: { thread?: string | null; around?: string; after?: string } = {}) {
    return this.request<MessageDto[]>('GET', `/api/channels/${channelId}/messages?limit=${limit}${before ? `&before=${before}` : ''}${more.thread ? `&thread=${more.thread}` : ''}${more.around ? `&around=${more.around}` : ''}${more.after ? `&after=${more.after}` : ''}`)
  }
  message(channelId: string, messageId: string) { return this.request<MessageDto>('GET', `/api/channels/${channelId}/messages/${messageId}`) }
  /** A forum's or gallery's posts, newest first; `before` is the moment the last one of the page before was at. */
  posts(channelId: string, before?: string, limit = 30) {
    return this.request<MessageDto[]>('GET', `/api/channels/${channelId}/posts?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`)
  }
  pins(channelId: string) { return this.request<MessageDto[]>('GET', `/api/channels/${channelId}/pins`) }
  /** Just the pictures and videos of a channel, newest first; `before` is the moment on the last one of the page before. */
  /** A new address for a file whose old one has run out, if this person can still see its channel. */
  attachmentLink(attachmentId: string) { return this.request<{ url: string }>('GET', `/api/attachments/${attachmentId}/link`) }
  media(channelId: string, before?: string | null, limit = 60) {
    return this.request<MediaItemDto[]>('GET', `/api/channels/${channelId}/media?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`)
  }
  search(channelId: string, q: string, before?: string | null) {
    return this.request<SearchResultDto>('GET', `/api/channels/${channelId}/search?q=${encodeURIComponent(q)}${before ? `&before=${encodeURIComponent(before)}` : ''}`)
  }
  transferSettings() { return this.request<TransferSettingsDto>('GET', '/api/transfers/settings') }
  /** Connection details for one transfer: `requester` is the connection id of the app that asked for the file. */
  transferIce(offerId: string, requester: string) { return this.request<IceServerDto[]>('GET', `/api/transfers/ice?offerId=${offerId}&requester=${encodeURIComponent(requester)}`) }
  /** The server's upload rules. Older servers do not have this. */
  uploadSettings() { return this.request<UploadSettingsDto>('GET', '/api/uploads/settings') }
  async upload(channelId: string, file: File) {
    const form = new FormData()
    form.append('file', file, file.name)
    // A large file is sent in pieces, each small enough for Cloudflare and the server's proxy (see the server's ChunkedUploads).
    if (file.size > 20 * 1048576) {
      const rules = await this.uploadSettings().catch(() => null)
      if (rules?.chunkAbove != null && file.size > rules.chunkAbove) return this.uploadInPieces(channelId, file)
    }
    return this.request<AttachmentDto>('POST', `/api/channels/${channelId}/attachments`, undefined, form)
  }
  private async uploadInPieces(channelId: string, file: File) {
    const started = await this.request<{ id: string; pieceBytes: number }>('POST', `/api/channels/${channelId}/attachments/chunked`, { fileName: file.name, size: file.size, contentType: file.type || null })
    const address = `${this.serverUrl().replace(/\/$/, '')}/api/uploads/chunked/${started.id}`
    let offset = 0
    let failures = 0
    try {
      for (;;) {
        let res: Response | null = null
        try {
          const token = this.token()
          res = await fetch(`${address}?offset=${offset}`, { method: 'PUT', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: file.slice(offset, offset + started.pieceBytes) })
        } catch { /* the connection dropped: the piece is sent again */ }
        const data = res ? await res.json().catch(() => null) : null
        if (res?.status === 201) return data as AttachmentDto
        if (res?.ok || res?.status === 409) {
          // Taken, or out of order (an answer was lost): go on from what the server has.
          if (typeof data?.received === 'number') { offset = data.received; if (res.ok) failures = 0 }
          if (res.ok) continue
        }
        if (res && res.status !== 409 && res.status < 500) throw new ApiError(data?.error ?? res.statusText ?? `HTTP ${res.status}`, res.status)
        if (++failures > 4) throw new ApiError('The upload kept failing. Check your connection and try again.', res?.status ?? 0)
        await new Promise(resolve => setTimeout(resolve, 1000 * failures))
      }
    } catch (e) {
      // Given up: what arrived of it is let go of on the server.
      void this.request('DELETE', `/api/uploads/chunked/${started.id}`).catch(() => { /* cleared within a day anyway */ })
      throw e
    }
  }
  /** Files of mine marked to be removed for going unopened (see the server's FileRules). Empty from a server too old to say. */
  markedFiles() { return this.request<{ noticeDays: number; files: MarkedFileDto[] }>('GET', '/api/uploads/marked').then(r => r.files).catch(() => [] as MarkedFileDto[]) }

  // ---- server settings ----
  updateGuild(guildId: string, name: string) { return this.request<GuildDto>('PATCH', `/api/guilds/${guildId}`, { name }) }
  async uploadGuildIcon(guildId: string, file: File) {
    const form = new FormData()
    form.append('file', file, file.name)
    return this.request<GuildDto>('POST', `/api/guilds/${guildId}/icon`, undefined, form)
  }
  deleteGuildIcon(guildId: string) { return this.request<void>('DELETE', `/api/guilds/${guildId}/icon`) }
  async uploadGuildBanner(guildId: string, file: File) {
    const form = new FormData()
    form.append('file', file, file.name)
    return this.request<GuildDto>('POST', `/api/guilds/${guildId}/banner`, undefined, form)
  }
  deleteGuildBanner(guildId: string) { return this.request<void>('DELETE', `/api/guilds/${guildId}/banner`) }
  // ---- custom emojis, stickers and sounds
  /** Every soundboard sound one can reach (own library, and the servers one is in), for choosing the app's own sounds. */
  reachableSounds() { return this.request<ExpressionGroupDto[]>('GET', '/api/expressions/sounds') }
  /** What one may pick from in a channel. */
  usableExpressions(channelId: string) { return this.request<UsableExpressionsDto>('GET', `/api/expressions/usable?channelId=${channelId}`) }
  guildExpressions(guildId: string) { return this.request<GuildExpressionsDto>('GET', `/api/guilds/${guildId}/expressions`) }
  myExpressions() { return this.request<ExpressionLibraryDto>('GET', '/api/expressions/mine') }
  uploadExpression(guildId: string, kind: 'emoji' | 'sticker' | 'sound', name: string, file: Blob, fileName: string) {
    const form = new FormData()
    form.append('file', file, fileName)
    form.append('kind', kind)
    form.append('name', name)
    return this.request<ExpressionDto>('POST', `/api/guilds/${guildId}/expressions`, undefined, form)
  }
  addGuildExpression(guildId: string, id: string) { return this.request<void>('PUT', `/api/guilds/${guildId}/expressions/${id}`) }
  removeGuildExpression(guildId: string, id: string) { return this.request<void>('DELETE', `/api/guilds/${guildId}/expressions/${id}`) }
  deleteExpression(id: string) { return this.request<void>('DELETE', `/api/expressions/${id}`) }
  renameExpression(id: string, name: string) { return this.request<void>('PATCH', `/api/expressions/${id}`, { name }) }
  setGuildOutside(guildId: string, outsideExpressions: boolean) { return this.request<GuildDto>('PATCH', `/api/guilds/${guildId}`, { outsideExpressions }) }

  setNickname(guildId: string, userId: string, nickname: string | null, hideRoleColor?: boolean) {
    return this.request<MemberDto>('PUT', `/api/guilds/${guildId}/members/${userId}/nickname`, { nickname, hideRoleColor })
  }

  // ---- profiles ----
  profile(userId: string) { return this.request<UserProfileDto>('GET', `/api/users/${userId}/profile`) }
  updateProfile(patch: UpdateProfileRequest) { return this.request<UserProfileDto>('PATCH', '/api/me/profile', patch) }
  private picture(kind: 'avatar' | 'banner', file: File) {
    const form = new FormData()
    form.append('file', file, file.name)
    return this.request<UserProfileDto>('POST', `/api/me/${kind}`, undefined, form)
  }
  uploadAvatar(file: File) { return this.picture('avatar', file) }
  uploadBanner(file: File) { return this.picture('banner', file) }
  deleteAvatar() { return this.request<UserProfileDto>('DELETE', '/api/me/avatar') }
  deleteBanner() { return this.request<UserProfileDto>('DELETE', '/api/me/banner') }
  /** A nameplate picture of one's own: stored and worn at once. */
  uploadNameplate(file: File) { const form = new FormData(); form.append('file', file, file.name); return this.request<UserProfileDto>('POST', '/api/me/nameplate', undefined, form) }
  deleteNameplate() { return this.request<UserProfileDto>('DELETE', '/api/me/nameplate') }
  decorations() { return this.request<DecorationDto[]>('GET', '/api/decorations') }
  /** An animation of your own: 'avatar' goes around your picture, 'effect' plays over your profile card. It is worn as soon as it is stored. */
  /** crop: a profile effect that is not the shape of a profile card is taken anyway, to fill the card with the overhang cut off. */
  uploadAnimation(kind: 'avatar' | 'effect', file: File, crop = false) {
    const form = new FormData()
    form.append('file', file, file.name)
    if (crop) form.append('crop', 'true')
    return this.request<UserProfileDto>('POST', `/api/me/animations/${kind}`, undefined, form)
  }
  deleteAnimation(kind: 'avatar' | 'effect') { return this.request<UserProfileDto>('DELETE', `/api/me/animations/${kind}`) }

  // ---- friends / DMs ----
  searchUsers(q: string) { return this.request<UserDto[]>('GET', `/api/users/search?q=${encodeURIComponent(q)}`) }
  friends() { return this.request<FriendsDto>('GET', '/api/friends') }
  addFriend(userId: string) { return this.request<FriendDto>('POST', `/api/friends/${userId}`) }
  signInMethods() { return this.request<SignInMethodsDto>('GET', '/api/me/logins') }
  startSignInMethod(service: string) { return this.request<{ url: string }>('POST', `/api/me/logins/${encodeURIComponent(service)}/start`) }
  removeSignInMethod(id: number) { return this.request<void>('DELETE', `/api/me/logins/${id}`) }
  contactEmail() { return this.request<ContactEmailDto>('GET', '/api/me/email') }
  setContactEmail(email: string) { return this.request<ContactEmailDto>('PUT', '/api/me/email', { email }) }
  clearContactEmail() { return this.request<ContactEmailDto>('DELETE', '/api/me/email') }
  connectionServices() { return this.request<ConnectionServiceDto[]>('GET', '/api/connections/services') }
  connections() { return this.request<ConnectionDto[]>('GET', '/api/me/connections') }
  startConnection(service: string) { return this.request<{ url: string }>('POST', `/api/me/connections/${encodeURIComponent(service)}/start`) }
  setConnectionShown(id: string, shown: boolean) { return this.request<ConnectionDto>('PUT', `/api/me/connections/${id}`, { shown }) }
  removeConnection(id: string) { return this.request<void>('DELETE', `/api/me/connections/${id}`) }
  friendLink() { return this.request<FriendLinkDto>('GET', '/api/me/friend-link') }
  resetFriendLink() { return this.request<FriendLinkDto>('POST', '/api/me/friend-link/reset') }
  friendLinkOwner(code: string) { return this.request<FriendLinkOwnerDto>('GET', `/api/friend-links/${encodeURIComponent(code)}`) }
  useFriendLink(code: string) { return this.request<FriendDto>('POST', `/api/friend-links/${encodeURIComponent(code)}`) }
  removeFriend(userId: string) { return this.request<void>('DELETE', `/api/friends/${userId}`) }
  dms() { return this.request<DmChannelDto[]>('GET', '/api/dms') }
  /** A calendar channel's events from one day to another (year-month-day, 100 days at most). */
  events(channelId: string, from: string, to: string) { return this.request<CalendarEventDto[]>('GET', `/api/channels/${channelId}/events?from=${from}&to=${to}`) }
  postEvent(channelId: string, event: { title: string; note: string | null; day: string; at: string | null; color: string | null; noteMarkdown: boolean }) { return this.request<CalendarEventDto>('POST', `/api/channels/${channelId}/events`, event) }
  editEvent(eventId: string, event: { title: string; note: string | null; day: string; at: string | null; color: string | null; noteMarkdown: boolean }) { return this.request<CalendarEventDto>('PATCH', `/api/events/${eventId}`, event) }
  deleteEvent(eventId: string) { return this.request<void>('DELETE', `/api/events/${eventId}`) }
  /** One event, if we can see its calendar. */
  event(eventId: string) { return this.request<CalendarEventDto>('GET', `/api/events/${eventId}`) }
  /** Our own answer to an event; null takes it back. */
  answerEvent(eventId: string, answer: number | null) { return this.request<CalendarEventDto>('PUT', `/api/events/${eventId}/answer`, { answer }) }
  inviteToEvent(eventId: string, userIds: string[]) { return this.request<CalendarEventDto>('POST', `/api/events/${eventId}/invited`, { userIds }) }
  /** Who an event is for: open to all or invite only, and the roles added to it. */
  setEventAudience(eventId: string, inviteOnly: boolean, roleIds: string[]) { return this.request<CalendarEventDto>('PUT', `/api/events/${eventId}/audience`, { inviteOnly, roleIds }) }
  uninviteFromEvent(eventId: string, userId: string) { return this.request<CalendarEventDto>('DELETE', `/api/events/${eventId}/invited/${userId}`) }
  /** Posts the event into text channels and forums: a message in each. */
  postEventTo(eventId: string, channelIds: string[]) { return this.request<MessageDto[]>('POST', `/api/events/${eventId}/post`, { channelIds }) }
  /** What we have been asked along to and have not answered. */
  invitations() { return this.request<CalendarEventDto[]>('GET', '/api/me/invitations') }
  openDm(userId: string) { return this.request<DmChannelDto>('POST', `/api/dms/${userId}`) }

  /** Raw PNG body; returns the server path to put on a roll's item so the whole party sees the icon. */
  uploadItemIcon(png: Blob) { return this.request<ItemIconDto>('POST', '/api/item-icons', undefined, png) }

  // ---- bots / voice ----
  commands(guildId: string) { return this.request<CommandDto[]>('GET', `/api/guilds/${guildId}/commands`) }
  /** STUN servers plus the relay for this voice channel (everyone in a channel is given the same one). */
  /** The rules for sharing video; with the voice channel we are in, also whether it has a stream server. */
  /** The newest community poll there is to see, or null. */
  latestPoll() { return this.request<{ poll: CommunityPollDto | null }>('GET', '/api/polls/latest').then(r => r.poll) }
  /** Our answers to a poll: once, and for good. */
  answerPoll(id: string, answers: CommunityPollAnswerDto[]) { return this.request<CommunityPollDto>('POST', `/api/polls/${id}/answers`, { answers }) }
  /** "Not now": the app does not bring this poll up by itself again. */
  declinePoll(id: string) { return this.request<CommunityPollDto>('POST', `/api/polls/${id}/decline`) }
  /** The relays a connection test can ping, and how long until this account may run a speed test again. */
  voiceTest() { return this.request<ConnectionTestDto>('GET', '/api/voice/test') }
  /** The relays to measure how far away they are (see relayPings.ts). */
  voiceRelays() { return this.request<TestRelayDto[]>('GET', '/api/voice/relays') }
  reportRelayPings(pings: { name: string; ms: number }[]) { return this.request<void>('POST', '/api/voice/pings', { pings }) }
  /** A pass for one speed test, on the least used of the relays near us by these pings. */
  voiceTestPass(pings: { name: string; ms: number }[]) { return this.request<ConnectionTestPassDto>('POST', '/api/voice/test/pass', { pings }) }
  streamSettings(channelId?: string | null) { return this.request<StreamSettingsDto>('GET', '/api/voice/streams/settings' + (channelId ? `?channelId=${channelId}` : '')) }
  /** How the server wants voice sent (see the admin panel's voice quality). Older servers do not have this. */
  voiceSettings() { return this.request<{ audioKbps: number }>('GET', '/api/voice/settings') }
  /** Registers this app's public signing key (for P2P text) and gives back the id the server knows it by. */
  registerKey(publicKey: string) { return this.request<{ id: string; userId: string; publicKey: string }>('POST', '/api/me/keys', { publicKey }) }
  /** Whose signing key this is, as the server vouches. Null when the server does not know the key (any more). */
  async keyOwner(keyId: string) {
    // The id comes out of a message someone else handed over. It is used as an id or not at all, and the answer
    // only counts if it is about that very key.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(keyId)) return null
    try {
      const key = await this.request<{ id: string; userId: string; publicKey: string }>('GET', `/api/keys/${encodeURIComponent(keyId)}`)
      return key && typeof key.id === 'string' && key.id.toLowerCase() === keyId.toLowerCase() && typeof key.userId === 'string' && typeof key.publicKey === 'string' ? key : null
    }
    catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e }
  }
  iceServers(channelId: string) { return this.request<IceServerDto[]>('GET', `/api/voice/ice?channelId=${channelId}`) }
}
