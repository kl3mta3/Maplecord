// Run with: node electron/updateRules.test.ts
import { fileFor, isNewer, trustedUrl, type LatestRelease } from './updateRules.ts'

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
check(trustedUrl('https://github.com/kl3mta3/Maplecord/releases/download/0.1.1/Maplecord-Setup-0.1.1.exe', repo), 'a file of the app\'s own releases is trusted');
check(trustedUrl('https://github.com/KL3MTA3/maplecord/releases/download/0.1.1/x.zip', repo), 'whatever the capitals');
check(!trustedUrl('https://github.com/someone-else/Maplecord/releases/download/0.1.1/x.exe', repo), 'another repository\'s file is not');
check(!trustedUrl('http://github.com/kl3mta3/Maplecord/releases/download/0.1.1/x.exe', repo), 'nor one without HTTPS');
check(!trustedUrl('https://github.com.evil.example/kl3mta3/Maplecord/releases/download/0.1.1/x.exe', repo)
  && !trustedUrl('https://evil.example/github.com/kl3mta3/Maplecord/releases/download/x.exe', repo)
  && !trustedUrl('https://user@github.com/kl3mta3/Maplecord/releases/download/x.exe', repo), 'nor a look-alike address');
check(!trustedUrl('https://github.com/kl3mta3/Maplecord/releases/download/../../../other/repo/x.exe', repo), 'nor one that climbs out of the releases');
check(!trustedUrl('https://github.com/kl3mta3/Maplecord/releases/download/0.1.1/x.exe', 'not a repo'), 'and nothing is trusted without a repository to hold it to');

const latest: LatestRelease = {
  version: '0.1.1', repo,
  installer: { url: 'https://github.com/kl3mta3/Maplecord/releases/download/0.1.1/Setup.exe', name: 'Setup.exe', size: 100, sha256: null },
  portable: { url: 'https://github.com/kl3mta3/Maplecord/releases/download/0.1.1/Portable.zip', name: 'Portable.zip', size: 100, sha256: null },
}
check(fileFor(latest, true)?.name === 'Setup.exe' && fileFor(latest, false)?.name === 'Portable.zip', 'an installed copy takes the installer, a portable one the zip');
check(fileFor({ ...latest, portable: null }, false) === null && fileFor({ ...latest, installer: { ...latest.installer!, size: 0 } }, true) === null, 'a release without the right file offers nothing');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
