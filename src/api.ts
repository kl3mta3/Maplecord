import type {
  AccountDeletionDto, ApplicationDto, AttachmentDto, ChannelBotDto, ChannelOverrideDto, DiscoverGuildDto, InvitePreviewDto, WebhookDto, UploadSettingsDto, TransferSettingsDto, StreamSettingsDto, PrivacyDto, PreferencesDto, ItemIconDto, ChannelDto, ServerMetaDto, MemberDto, DecorationDto, UpdateProfileRequest, UserProfileDto, CommandDto, DmChannelDto, FriendDto, FriendsDto, GuildDto, GuildSummaryDto, IceServerDto, InviteDto, MessageDto, RoleDto, TokenResponse, UserDto, TagCardDto, RollStatsDto, SearchResultDto, MediaItemDto, SignInMethodsDto, ContactEmailDto, ConnectionDto, ConnectionServiceDto, FriendLinkDto, FriendLinkOwnerDto } from './types'

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
      if (res.status === 401) message = 'Your session has expired. Please sign in again.'
      throw new ApiError(message, res.status, code)
    }
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  /** Null when the server is unreachable or too old to say. */
  meta(serverUrl: string) {
    return fetch(serverUrl.replace(/\/$/, '') + '/api/meta').then(r => (r.ok ? (r.json() as Promise<ServerMetaDto>) : null)).catch(() => null)
  }

  // ---- auth ----
  providers(serverUrl: string) {
    return fetch(serverUrl.replace(/\/$/, '') + '/auth/providers').then(r => { if (!r.ok) throw new ApiError('Server unreachable', r.status); return r.json() as Promise<string[]> })
  }
  devLogin(serverUrl: string, username: string) {
    return fetch(serverUrl.replace(/\/$/, '') + '/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) })
      .then(async r => { if (!r.ok) throw new ApiError('Dev login failed', r.status); return (await r.json()) as TokenResponse })
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
  createGuild(name: string, isPublic = false, kind: 'standard' | 'hybrid' | 'p2p' = 'standard') { return this.request<GuildSummaryDto>('POST', '/api/guilds', { name, isPublic, kind }) }
  deleteGuild(id: string) { return this.request<void>('DELETE', `/api/guilds/${id}`) }
  leaveGuild(id: string) { return this.request<void>('POST', `/api/guilds/${id}/leave`) }
  createInvite(guildId: string, expiresInMinutes: number | null = null, maxUses: number | null = null) { return this.request<InviteDto>('POST', `/api/guilds/${guildId}/invites`, { expiresInMinutes, maxUses }) }
  invites(guildId: string) { return this.request<InviteDto[]>('GET', `/api/guilds/${guildId}/invites`) }
  revokeInvite(code: string) { return this.request<void>('DELETE', `/api/invites/${encodeURIComponent(code)}`) }
  updateGuildListing(id: string, patch: { isPublic: boolean; description: string; topics: string[] }) { return this.request<GuildDto>('PATCH', `/api/guilds/${id}`, patch) }
  /** Whether rolls in a server's P2P channels add to people's roll totals. */
  setGuildCountRolls(id: string, countRolls: boolean) { return this.request<GuildDto>('PATCH', `/api/guilds/${id}`, { countRolls }) }
  /** One's own roll totals. */
  rollStats() { return this.request<RollStatsDto>('GET', '/api/me/roll-stats') }
  /** Public servers, by name and/or exact topic. */
  discover(q: string, topic: string) { return this.request<DiscoverGuildDto[]>('GET', `/api/discover?q=${encodeURIComponent(q)}&topic=${encodeURIComponent(topic)}`) }
  discoverTopics() { return this.request<string[]>('GET', '/api/discover/topics') }
  /** The symbols a server tag can carry. */
  tagSymbols() { return this.request<string[]>('GET', '/api/tags/symbols') }
  setGuildTag(guildId: string, text: string, symbol: string | null) { return this.request<GuildDto>('PUT', `/api/guilds/${guildId}/tag`, { text, symbol }) }
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
  createApplication(name: string, direct = false) { return this.request<ApplicationDto>('POST', '/api/applications', { name, direct }) }
  /** The P2P bots in a P2P channel; for someone who may decide that, also the ones that could be let in. */
  channelBots(channelId: string) { return this.request<ChannelBotDto[]>('GET', `/api/channels/${channelId}/p2p-bots`) }
  letBotIn(channelId: string, applicationId: string, on: boolean) { return this.request<void>(on ? 'PUT' : 'DELETE', `/api/channels/${channelId}/p2p-bots/${applicationId}`) }
  updateApplication(id: string, patch: { name?: string; description?: string; interactionsUrl?: string }) { return this.request<ApplicationDto>('PATCH', `/api/applications/${id}`, patch) }
  /** Gives it a new token; the old one stops working. */
  regenerateApplication(id: string) { return this.request<ApplicationDto>('POST', `/api/applications/${id}/regenerate`) }
  deleteApplication(id: string) { return this.request<void>('DELETE', `/api/applications/${id}`) }
  guildApplications(guildId: string) { return this.request<ApplicationDto[]>('GET', `/api/guilds/${guildId}/applications`) }
  addGuildApplication(guildId: string, appId: string) { return this.request<ApplicationDto>('POST', `/api/guilds/${guildId}/applications/${encodeURIComponent(appId)}`) }
  removeGuildApplication(guildId: string, appId: string) { return this.request<void>('DELETE', `/api/guilds/${guildId}/applications/${appId}`) }

  /** What deleting the account would take with it (the servers it owns, its bots). */
  deletionPreview() { return this.request<AccountDeletionDto>('GET', '/api/me/deletion') }
  /** Deletes the signed-in account. Refused (code "reauth") unless this sign-in is only a few minutes old. */
  deleteAccount(username: string) { return this.request<void>('POST', '/api/me/delete', { username }) }

  privacy() { return this.request<PrivacyDto>('GET', '/api/me/privacy') }
  preferences() { return this.request<PreferencesDto>('GET', '/api/me/preferences') }
  setPreferences(p: PreferencesDto) { return this.request<PreferencesDto>('PUT', '/api/me/preferences', p) }
  blocks() { return this.request<UserDto[]>('GET', '/api/blocks') }
  block(userId: string) { return this.request<UserDto>('PUT', `/api/blocks/${userId}`) }
  unblock(userId: string) { return this.request<void>('DELETE', `/api/blocks/${userId}`) }
  /** Turning P2P on is refused (code "reauth") unless this sign-in is only a few minutes old. */
  setPrivacy(allowDirect: boolean) { return this.request<PrivacyDto>('PUT', '/api/me/privacy', { allowDirect }) }
  deleteChannel(id: string) { return this.request<void>('DELETE', `/api/channels/${id}`) }
  /** Deletes a group of channels and every channel in it. Only called after the person has been asked, twice. */
  deleteGroup(id: string) { return this.request<void>('DELETE', `/api/channels/${id}?withChannels=true`) }
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
  media(channelId: string, before?: string | null, limit = 60) {
    return this.request<MediaItemDto[]>('GET', `/api/channels/${channelId}/media?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`)
  }
  search(channelId: string, q: string, before?: string | null) {
    return this.request<SearchResultDto>('GET', `/api/channels/${channelId}/search?q=${encodeURIComponent(q)}${before ? `&before=${encodeURIComponent(before)}` : ''}`)
  }
  /** What a message can be reacted to with. */
  reactions() { return this.request<string[]>('GET', '/api/reactions') }
  transferSettings() { return this.request<TransferSettingsDto>('GET', '/api/transfers/settings') }
  /** Connection details for one transfer: `requester` is the connection id of the app that asked for the file. */
  transferIce(offerId: string, requester: string) { return this.request<IceServerDto[]>('GET', `/api/transfers/ice?offerId=${offerId}&requester=${encodeURIComponent(requester)}`) }
  /** The server's upload rules. Older servers do not have this. */
  uploadSettings() { return this.request<UploadSettingsDto>('GET', '/api/uploads/settings') }
  async upload(channelId: string, file: File) {
    const form = new FormData()
    form.append('file', file, file.name)
    return this.request<AttachmentDto>('POST', `/api/channels/${channelId}/attachments`, undefined, form)
  }

  // ---- server settings ----
  updateGuild(guildId: string, name: string) { return this.request<GuildDto>('PATCH', `/api/guilds/${guildId}`, { name }) }
  async uploadGuildIcon(guildId: string, file: File) {
    const form = new FormData()
    form.append('file', file, file.name)
    return this.request<GuildDto>('POST', `/api/guilds/${guildId}/icon`, undefined, form)
  }
  deleteGuildIcon(guildId: string) { return this.request<void>('DELETE', `/api/guilds/${guildId}/icon`) }

  setNickname(guildId: string, userId: string, nickname: string | null) {
    return this.request<MemberDto>('PUT', `/api/guilds/${guildId}/members/${userId}/nickname`, { nickname })
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
  openDm(userId: string) { return this.request<DmChannelDto>('POST', `/api/dms/${userId}`) }

  /** Raw PNG body; returns the server path to put on a roll's item so the whole party sees the icon. */
  uploadItemIcon(png: Blob) { return this.request<ItemIconDto>('POST', '/api/item-icons', undefined, png) }

  // ---- bots / voice ----
  commands(guildId: string) { return this.request<CommandDto[]>('GET', `/api/guilds/${guildId}/commands`) }
  /** STUN servers plus the relay for this voice channel (everyone in a channel is given the same one). */
  /** The rules for sharing video; with the voice channel we are in, also whether it has a stream server. */
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
