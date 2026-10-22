// Run with: node electron/updateRules.test.ts
import { appImageFor, fileFor, isNewer, trustedUrl, type LatestRelease } from './updateRules.ts'

let failures = 0
function check(ok: boolean, what: string) {
  console.log((ok ? '  ok   ' : '  FAIL ') + what)
  if (!ok) failures++
}

check(isNewer('0.1.1', '0.1.0') && isNewer('0.2.0', '0.1.9') && isNewer('1.0.0', '0.9.9') && isNewer('0.1.10', '0.1.9'), 'a later version is newer, number by number');
check(!isNewer('0.1.0', '0.1.0') && !isNewer('0.1.0', '0.1.1') && !isNewer('0.9', '1.0.0'), 'the same or an earlier version is not');
check(isNewer('v0.1.1', '0.1.0') && isNewer('0.1.1', '0.1') && !isNewer('0.1', '0.1.0'), 'a leading v and missing parts are understood');
check(!isNewer('latest', '0.1.0') && !isNewer('', '0.1.0') && !isNewer('0.1.x', '0.1.0'), 'something that is not a version number is never newer');

const repo = 'kl3mta3/Maplecord'
check(trustedUrl('https://github.com/kl3mta3/Maplecord/releases/download/0.1.1/Maplecord-Setup-0.1.1.exe', repo, '0.1.1'), 'a file of the app\'s own releases is trusted');
check(trustedUrl('https://github.com/KL3MTA3/maplecord/releases/download/0.1.1/x.zip', repo, '0.1.1') && trustedUrl('https://github.com/kl3mta3/Maplecord/releases/download/v0.1.1/x.zip', repo, '0.1.1'), 'whatever the capitals, and with a v on the tag or not');
check(!trustedUrl('https://github.com/kl3mta3/Maplecord/releases/download/0.1.0/x.exe', repo, '0.1.1') && !trustedUrl('https://github.com/kl3mta3/Maplecord/releases/download/0.1.10/x.exe', repo, '0.1.1'),
  'a file of another release is not, so an older one cannot be passed off as the newest');
check(!trustedUrl('https://github.com/someone-else/Maplecord/releases/download/0.1.1/x.exe', repo, '0.1.1'), 'another repository\'s file is not');
check(!trustedUrl('http://github.com/kl3mta3/Maplecord/releases/download/0.1.1/x.exe', repo, '0.1.1'), 'nor one without HTTPS');
check(!trustedUrl('https://github.com.evil.example/kl3mta3/Maplecord/releases/download/0.1.1/x.exe', repo, '0.1.1')
  && !trustedUrl('https://evil.example/github.com/kl3mta3/Maplecord/releases/download/0.1.1/x.exe', repo, '0.1.1')
  && !trustedUrl('https://user@github.com/kl3mta3/Maplecord/releases/download/0.1.1/x.exe', repo, '0.1.1'), 'nor a look-alike address');
check(!trustedUrl('https://github.com/kl3mta3/Maplecord/releases/download/0.1.1/../../../other/repo/x.exe', repo, '0.1.1'), 'nor one that climbs out of the releases');
check(!trustedUrl('https://github.com/kl3mta3/Maplecord/releases/download/0.1.1/x.exe', 'not a repo', '0.1.1') && !trustedUrl('https://github.com/kl3mta3/Maplecord/releases/download/latest/x.exe', repo, 'latest'),
  'and nothing is trusted without a repository and a version to hold it to');

const digest = 'ab'.repeat(32)
const latest: LatestRelease = {
  version: '0.1.1', repo,
  installer: { url: 'https://github.com/kl3mta3/Maplecord/releases/download/0.1.1/Setup.exe', name: 'Setup.exe', size: 100, sha256: digest },
  portable: { url: 'https://github.com/kl3mta3/Maplecord/releases/download/0.1.1/Portable.zip', name: 'Portable.zip', size: 100, sha256: digest },
}
check(fileFor(latest, true)?.name === 'Setup.exe' && fileFor(latest, false)?.name === 'Portable.zip', 'an installed copy takes the installer, a portable one the zip');
check(fileFor({ ...latest, portable: null }, false) === null && fileFor({ ...latest, installer: { ...latest.installer!, size: 0 } }, true) === null, 'a release without the right file offers nothing');
check(fileFor({ ...latest, installer: { ...latest.installer!, name: 'Setup.zip' } }, true) === null && fileFor({ ...latest, portable: { ...latest.portable!, name: 'Portable.exe' } }, false) === null,
  'an installed copy is never handed a zip to run, nor a portable one a program');
check(fileFor({ ...latest, installer: { ...latest.installer!, sha256: null } }, true) === null && fileFor({ ...latest, installer: { ...latest.installer!, sha256: 'not a digest' } }, true) === null,
  'nor a file whose SHA-256 the release does not state');

// A Linux AppImage takes the release's .AppImage, only with its digest stated, and nothing else.
{
  const image = { url: 'https://github.com/a/b/releases/download/0.6.0/Maplecord-0.6.0.AppImage', name: 'Maplecord-0.6.0.AppImage', size: 10, sha256: 'a'.repeat(64) }
  check(appImageFor({ ...latest, appImage: image })?.name === image.name, 'an AppImage takes the release\'s AppImage')
  check(appImageFor({ ...latest, appImage: null }) === null && appImageFor(latest) === null && appImageFor({ ...latest, appImage: { ...image, sha256: null } }) === null
    && appImageFor({ ...latest, appImage: { ...image, name: 'Maplecord.deb' } }) === null, 'without a stated digest, or not an AppImage, there is nothing to take')
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
