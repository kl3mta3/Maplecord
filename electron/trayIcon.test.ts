// Run with: node electron/trayIcon.test.ts
import { dotPlace, TRAY_SIZES, withDot } from './trayIcon.ts'

let failures = 0
function check(ok: boolean, what: string) {
  console.log((ok ? '  ok   ' : '  FAIL ') + what)
  if (!ok) failures++
}

const pixel = (picture: Uint8Array, size: number, x: number, y: number) => [...picture.slice((y * size + x) * 4, (y * size + x) * 4 + 4)]
for (const { size } of TRAY_SIZES) {
  // A see-through picture with one solid green pixel in the top left corner.
  const plain = new Uint8Array(size * size * 4)
  plain.set([0, 255, 0, 255], 0)
  const dotted = withDot(plain, size)
  const middle = Math.floor(dotPlace(size).centre)
  const [b, g, r, a] = pixel(dotted, size, middle, middle)
  check(r === 0xff && g === 0x3b && b === 0x3b && a === 255, `${size}: the middle of the dot is solid red, blue first`)
  check(pixel(dotted, size, 0, 0).join() === '0,255,0,255' && pixel(dotted, size, Math.floor(size / 3), Math.floor(size / 3)).join() === '0,0,0,0', `${size}: the rest of the picture is as it was`)
  check(dotPlace(size).ring * 2 <= size / 2, `${size}: the dot and its ring take up no more than half the picture's width`)
  check(pixel(plain, size, middle, middle).join() === '0,0,0,0', `${size}: the picture handed in is not written on`)
  const [, , , ringSolid] = pixel(dotted, size, size - 1, middle)
  const [rb, rg, rr] = pixel(dotted, size, size - 1, middle)
  check(ringSolid! > 0 && rr! < 0x80 && rg! < 0x80 && rb! < 0x80, `${size}: a dark ring is round the dot`)
}
let refused = false
try { withDot(new Uint8Array(10), 16) } catch { refused = true }
check(refused, 'a picture that is not the size it is said to be is refused')

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
