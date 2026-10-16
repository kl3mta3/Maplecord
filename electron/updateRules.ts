/** The parts of updating that are decisions, kept apart from the parts that touch the computer (see updater.ts). */

export interface ReleaseFile { url: string; name: string; size: number; sha256: string | null }
/** What a Maplecord server says the newest release is (GET /api/client/latest). */
export interface LatestRelease { version: string | null; repo: string; installer: ReleaseFile | null; portable: ReleaseFile | null }

const parts = (version: string) => version.trim().replace(/^v/i, '').split(/[.+-]/).map(p => (/^\d+$/.test(p) ? Number(p) : NaN))

/** True when `candidate` is a later version than `current`. Anything that is not plain numbers and dots is never "later". */
export function isNewer(candidate: string, current: string): boolean {
  const a = parts(candidate), b = parts(current)
  if (a.length === 0 || a.some(Number.isNaN) || b.some(Number.isNaN)) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/**
 * An update is only ever taken from the releases of the repository this build was made from, over HTTPS, and from
 * the release of the version it says it is (tagged "0.5.7" or "v0.5.7"). The server the app is pointed at says where
 * the newest file is, but it cannot send the app anywhere else, nor to an older release dressed up as a newer one.
 */
export function trustedUrl(url: string, repo: string, version: string): boolean {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !/^v?\d+(\.\d+)*$/.test(version)) return false
  try {
    const parsed = new URL(url)
    const tag = version.replace(/^v/i, '').toLowerCase()
    const path = parsed.pathname.toLowerCase()
    const prefix = `/${repo.toLowerCase()}/releases/download/`
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com' && parsed.username === '' && parsed.port === ''
      && !path.includes('..') && (path.startsWith(`${prefix}${tag}/`) || path.startsWith(`${prefix}v${tag}/`))
  } catch { return false }
}

/**
 * The file this copy of the app updates itself with: the installer (.exe) if it was installed, the portable zip if
 * not, and only one whose SHA-256 the release states, so that what arrives is checked against it before it is run.
 */
export function fileFor(latest: LatestRelease, installed: boolean): ReleaseFile | null {
  const file = installed ? latest.installer : latest.portable
  return file && file.size > 0 && (installed ? /\.exe$/i : /\.zip$/i).test(file.name) && /^[0-9a-f]{64}$/i.test(file.sha256 ?? '') ? file : null
}
