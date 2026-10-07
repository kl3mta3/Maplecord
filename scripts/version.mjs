// The app's version lives in one place: version.txt at the top of this repository. Every build starts by running
// this, which copies that version into package.json (the packager, the installer's name and the app itself read it
// from there) and package-lock.json. To release a new version, change version.txt and build.
import fs from 'node:fs'

const root = new URL('../', import.meta.url)
const version = fs.readFileSync(new URL('version.txt', root), 'utf8').trim()
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`version.txt must hold a version like 1.2.3, not "${version}"`)
  process.exit(1)
}

function set(file, change) {
  const url = new URL(file, root)
  if (!fs.existsSync(url)) return
  const before = fs.readFileSync(url, 'utf8')
  const data = JSON.parse(before)
  change(data)
  const after = JSON.stringify(data, null, 2) + (before.endsWith('\n') ? '\n' : '')
  if (after !== before) fs.writeFileSync(url, after)
}
set('package.json', p => { p.version = version })
set('package-lock.json', p => { p.version = version; if (p.packages?.['']) p.packages[''].version = version })
console.log(`Maplecord ${version}`)
