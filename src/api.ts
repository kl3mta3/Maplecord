import type {
  ApplicationDto, AttachmentDto, WebhookDto, UploadSettingsDto, TransferSettingsDto, StreamSettingsDto, PrivacyDto, PreferencesDto, ItemIconDto, ChannelDto, ServerMetaDto, MemberDto, DecorationDto, UpdateProfileRequest, UserProfileDto, CommandDto, DmChannelDto, FriendDto, FriendsDto, GuildDto, GuildSummaryDto, IceServerDto, InviteDto, MessageDto, RoleDto, TokenResponse, UserDto,
} from './types'

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
  exchangeCode(serverUrl: string, code: string) {
    return fetch(serverUrl.replace(/\/$/, '') + '/auth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      .then(async r => { if (!r.ok) throw new ApiError('Sign-in failed', r.status); return (await r.json()) as TokenResponse })
  }

  // ---- me / guilds ----
  me() { return this.request<UserDto>('GET', '/api/me') }
  guilds() { return this.request<GuildSummaryDto[]>('GET', '/api/guilds') }
  guild(id: string) { return this.request<GuildSummaryDto>('GET', `/api/guilds/${id}`) }
  createGuild(name: string) { return this.request<GuildSummaryDto>('POST', '/api/guilds', { name }) }
  deleteGuild(id: string) { return this.request<void>('DELETE', `/api/guilds/${id}`) }
  leaveGuild(id: string) { return this.request<void>('POST', `/api/guilds/${id}/leave`) }
  createInvite(guildId: string) { return this.request<InviteDto>('POST', `/api/guilds/${guildId}/invites`, { expiresInMinutes: null, maxUses: null }) }
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
  createApplication(name: string) { return this.request<ApplicationDto>('POST', '/api/applications', { name }) }
  updateApplication(id: string, patch: { name?: string; description?: string; interactionsUrl?: string }) { return this.request<ApplicationDto>('PATCH', `/api/applications/${id}`, patch) }
  /** Gives it a new token; the old one stops working. */
  regenerateApplication(id: string) { return this.request<ApplicationDto>('POST', `/api/applications/${id}/regenerate`) }
  deleteApplication(id: string) { return this.request<void>('DELETE', `/api/applications/${id}`) }
  guildApplications(guildId: string) { return this.request<ApplicationDto[]>('GET', `/api/guilds/${guildId}/applications`) }
  addGuildApplication(guildId: string, appId: string) { return this.request<ApplicationDto>('POST', `/api/guilds/${guildId}/applications/${encodeURIComponent(appId)}`) }
  removeGuildApplication(guildId: string, appId: string) { return this.request<void>('DELETE', `/api/guilds/${guildId}/applications/${appId}`) }

  privacy() { return this.request<PrivacyDto>('GET', '/api/me/privacy') }
  preferences() { return this.request<PreferencesDto>('GET', '/api/me/preferences') }
  setPreferences(p: PreferencesDto) { return this.request<PreferencesDto>('PUT', '/api/me/preferences', p) }
  blocks() { return this.request<UserDto[]>('GET', '/api/blocks') }
  block(userId: string) { return this.request<UserDto>('PUT', `/api/blocks/${userId}`) }
  unblock(userId: string) { return this.request<void>('DELETE', `/api/blocks/${userId}`) }
  /** Turning P2P on is refused (code "reauth") unless this sign-in is only a few minutes old. */
  setPrivacy(allowDirect: boolean) { return this.request<PrivacyDto>('PUT', '/api/me/privacy', { allowDirect }) }
  deleteChannel(id: string) { return this.request<void>('DELETE', `/api/channels/${id}`) }
  renameChannel(id: string, name: string) { return this.request<ChannelDto>('PATCH', `/api/channels/${id}`, { name }) }
  kick(guildId: string, userId: string) { return this.request<void>('DELETE', `/api/guilds/${guildId}/members/${userId}`) }
  ban(guildId: string, userId: string) { return this.request<void>('POST', `/api/guilds/${guildId}/bans/${userId}`, { reason: null }) }

  // ---- roles ----
  roles(guildId: string) { return this.request<RoleDto[]>('GET', `/api/guilds/${guildId}/roles`) }
  createRole(guildId: string, name: string, color: string | null, permissions: number) {
    return this.request<RoleDto>('POST', `/api/guilds/${guildId}/roles`, { name, color, permissions })
  }
  updateRole(roleId: string, patch: { name?: string; color?: string | null; permissions?: number; position?: number }) {
    return this.request<RoleDto>('PATCH', `/api/roles/${roleId}`, patch)
  }
  deleteRole(roleId: string) { return this.request<void>('DELETE', `/api/roles/${roleId}`) }
  setMemberRoles(guildId: string, userId: string, roleIds: string[]) {
    return this.request<unknown>('PUT', `/api/guilds/${guildId}/members/${userId}/roles`, { roleIds })
  }

  // ---- messages ----
  messages(channelId: string, before?: string, limit = 50) {
    return this.request<MessageDto[]>('GET', `/api/channels/${channelId}/messages?limit=${limit}${before ? `&before=${before}` : ''}`)
  }
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

  // ---- friends / DMs ----
  searchUsers(q: string) { return this.request<UserDto[]>('GET', `/api/users/search?q=${encodeURIComponent(q)}`) }
  friends() { return this.request<FriendsDto>('GET', '/api/friends') }
  addFriend(userId: string) { return this.request<FriendDto>('POST', `/api/friends/${userId}`) }
  removeFriend(userId: string) { return this.request<void>('DELETE', `/api/friends/${userId}`) }
  dms() { return this.request<DmChannelDto[]>('GET', '/api/dms') }
  openDm(userId: string) { return this.request<DmChannelDto>('POST', `/api/dms/${userId}`) }

  /** Raw PNG body; returns the server path to put on a roll's item so the whole party sees the icon. */
  uploadItemIcon(png: Blob) { return this.request<ItemIconDto>('POST', '/api/item-icons', undefined, png) }

  // ---- bots / voice ----
  commands(guildId: string) { return this.request<CommandDto[]>('GET', `/api/guilds/${guildId}/commands`) }
  /** STUN servers plus the relay for this voice channel (everyone in a channel is given the same one). */
  streamSettings() { return this.request<StreamSettingsDto>('GET', '/api/voice/streams/settings') }
  /** How the server wants voice sent (see the admin panel's voice quality). Older servers do not have this. */
  voiceSettings() { return this.request<{ audioKbps: number }>('GET', '/api/voice/settings') }
  iceServers(channelId: string) { return this.request<IceServerDto[]>('GET', `/api/voice/ice?channelId=${channelId}`) }
}
