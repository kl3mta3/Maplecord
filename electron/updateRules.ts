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
 * An update is only ever taken from the releases of the repository this build was made from, over HTTPS. The server
 * the app is pointed at says where the newest file is, but it cannot send the app anywhere else.
 */
export function trustedUrl(url: string, repo: string): boolean {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com' && parsed.username === '' && parsed.port === ''
      && parsed.pathname.toLowerCase().startsWith(`/${repo.toLowerCase()}/releases/download/`) && !parsed.pathname.includes('..')
  } catch { return false }
}

/** The file this copy of the app updates itself with: the installer if it was installed, the portable zip if not. */
export function fileFor(latest: LatestRelease, installed: boolean): ReleaseFile | null {
  const file = installed ? latest.installer : latest.portable
  return file && file.size > 0 && /\.(exe|zip)$/i.test(file.name) ? file : null
}
