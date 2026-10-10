import { useEffect, useMemo, useRef, useState } from 'react'
import type { Store } from '../store'
import type { FriendDto, FriendLinkDto, QrDto } from '../types'
import { leafPath, leafQr, qrPath, LEAF_CODE, LEAF_DOT, LEAF_EDGE, LEAF_PAPER, type LeafStyle } from '../leafQr'
import { CARDS, CARD_SCALE, cardFonts, cardSize, drawCard, type CardKind, type CardWho, type QrLook, type RealCard } from '../friendCard'
import { shownName } from '../profile'
import { ConfirmDialog } from './Dialogs'

/** The empty margin a QR code needs around it to be read, in squares. */
const MARGIN = 3

/** A QR code as a picture: dark squares on white, with the margin it needs. */
export function QrCode({ qr, size = 200, innerRef, what = 'your friend link' }: { qr: QrDto; size?: number; innerRef?: React.Ref<SVGSVGElement>; what?: string }) {
  const across = qr.size + MARGIN * 2
  return (
    <svg ref={innerRef} xmlns="http://www.w3.org/2000/svg" className="qrcode" width={size} height={size} viewBox={`0 0 ${across} ${across}`} shapeRendering="crispEdges" role="img" aria-label={`QR code of ${what}`}>
      <rect width={across} height={across} rx={1.5} fill="#ffffff" />
      <path d={qrPath(qr, MARGIN)} fill="#14141c" />
    </svg>
  )
}

/**
 * The same QR code in the shape of the app's maple leaf (see leafQr.ts): the real code in the middle, and the rest of
 * the leaf filled with dots in the logo's colours. Nothing is drawn outside the leaf, so it sits on any background.
 * `style`: how the code is set into the leaf. Boxed, it is black with a margin; thin or blended, it is in the leaf's
 * colours with one empty square round it or none, so that it reads as one leaf.
 */
export function LeafQrCode({ qr, seed, style = 'boxed', size = 300, innerRef, what = 'your friend link' }: { qr: QrDto; seed: string; style?: LeafStyle; size?: number; innerRef?: React.Ref<SVGSVGElement>; what?: string }) {
  const leaf = useMemo(() => leafQr(qr, seed, style), [qr, seed, style])
  const paths = useMemo(() => ({
    paper: leafPath(leaf, LEAF_PAPER + LEAF_DOT + LEAF_CODE + LEAF_EDGE),
    dots: leafPath(leaf, LEAF_DOT + LEAF_EDGE),
    code: leafPath(leaf, LEAF_CODE),
  }), [leaf])
  return (
    <svg ref={innerRef} xmlns="http://www.w3.org/2000/svg" className="qrcode leaf" width={size} height={size} viewBox={`-1 -1 ${leaf.size + 2} ${leaf.size + 2}`} shapeRendering="crispEdges" role="img" aria-label={`QR code of ${what}, in the shape of a maple leaf`}>
      <defs>
        <linearGradient id="leafqr-ink" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={leaf.size} y2="0">
          <stop offset="0" stopColor="#2f6bff" /><stop offset="1" stopColor="#a020f0" />
        </linearGradient>
      </defs>
      <path d={paths.paper} fill="#ffffff" />
      <path d={paths.dots} fill="url(#leafqr-ink)" />
      <path d={paths.code} fill={style === 'boxed' ? '#14141c' : 'url(#leafqr-ink)'} />
    </svg>
  )
}

/** The ways the QR code of a link can be drawn, the one shown first at the top. All of them are the same link. */
const QR_LOOKS = [
  { key: 'thin', name: 'Leaf, thin border' },
  { key: 'blended', name: 'Leaf, no border' },
  { key: 'boxed', name: 'Leaf with a square' },
  { key: 'square', name: 'Plain square' },
] as const satisfies readonly { key: QrLook; name: string }[]

/**
 * The code on a card (see friendCard.ts), with who or which server it belongs to. It is a canvas, and what is on it
 * is the picture that gets saved. Drawn again whenever anything on it changes, once the fonts it is written in are ready.
 */
function FriendCard({ kind, look, qr, seed, who, what, innerRef }: { kind: RealCard; look: QrLook; qr: QrDto; seed: string; who: CardWho; what: string; innerRef: React.RefObject<HTMLCanvasElement | null> }) {
  const { w, h } = cardSize(kind)
  useEffect(() => {
    let alive = true
    void Promise.all(cardFonts(who).map(font => document.fonts.load(font).catch(() => null))).then(() => {
      const ctx = alive ? innerRef.current?.getContext('2d') : null
      if (ctx) drawCard(ctx, kind, look, qr, seed, who)
    })
    return () => { alive = false }
  }, [kind, look, qr, seed, who, innerRef])
  return <canvas ref={innerRef} className="qrcard" width={w * CARD_SCALE} height={h * CARD_SCALE} style={{ width: w > h ? 380 : 300 }} role="img"
    aria-label={who.server ? `A card with the QR code of ${what} and the server's name, ${who.name}` : `A card with the QR code of ${what}, your name ${who.name} and @${who.username}`} />
}

/** Saves something made in the app as a file, the way a download is saved. */
export function saveAs(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** The friends list as a file a spreadsheet opens: one friend a line, username and the name they show. */
export function friendsCsv(friends: FriendDto[]): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) || /^[=+\-@]/.test(v) ? `"${(/^[=+\-@]/.test(v) ? "'" + v : v).replace(/"/g, '""')}"` : v)
  const rows = [...friends].sort((a, b) => a.user.username.localeCompare(b.user.username)).map(f => [f.user.username, f.user.displayName ?? ''].map(cell).join(','))
  return ['username,display name', ...rows].join('\r\n') + '\r\n'
}

/**
 * A link's QR code as it is handed out: the code, or the code on a card, with the two things that can be chosen
 * about it and a way to save it as a picture. What was chosen is remembered on this device, for every link alike.
 */
export function QrPanel({ store, qr, seed, who, what, file, children }: {
  store: Store; qr: QrDto
  /** What the leaf's dots are scattered by: the same link always looks the same. */
  seed: string
  /** Who or which server a card is for. Without it only the bare code is offered. */
  who: CardWho | null
  /** What the code is of, as it is read out: "your friend link". */
  what: string
  /** What a saved picture is called, without its ending. */
  file: string
  /** More buttons, under "Save as a picture". */
  children?: React.ReactNode
}) {
  // The one picked last on this device; until one is picked, the first. The plain square is there for anything that has trouble reading a leaf.
  const look: QrLook = QR_LOOKS.find(l => l.key === store.settings.qrLook)?.key ?? QR_LOOKS[0].key
  const setLook = (qrLook: QrLook) => store.updateSettings({ qrLook })
  // The card it is put on, if any: also the one picked last on this device.
  const card: CardKind = CARDS.find(c => c.key === store.settings.qrCard)?.key ?? 'none'
  const setCard = (qrCard: CardKind) => store.updateSettings({ qrCard })
  const cardCanvas = useRef<HTMLCanvasElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  // The picture is drawn large, so that it is still sharp printed or shown on a stream.
  const savePicture = () => {
    // A card is already the picture, at the size it is saved.
    if (card !== 'none' && who) { cardCanvas.current?.toBlob(blob => { if (blob) saveAs(blob, file + '-card.png') }, 'image/png'); return }
    const el = svg.current
    if (!el) return
    const side = 1024
    const source = new XMLSerializer().serializeToString(el)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = side; canvas.height = side
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0, side, side)
      canvas.toBlob(blob => { if (blob) saveAs(blob, look === 'square' ? file + '.png' : file + '-leaf.png') }, 'image/png')
    }
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source)
  }
  return (
    <div className="qrpanel">
      {card !== 'none' && who ? <FriendCard kind={card} look={look} qr={qr} seed={seed} who={who} what={what} innerRef={cardCanvas} />
        : look === 'square' ? <QrCode qr={qr} size={300} innerRef={svg} what={what} /> : <LeafQrCode qr={qr} seed={seed} style={look} innerRef={svg} what={what} />}
      <div className="actions">
        <label>QR
          <select value={look} onChange={e => setLook(e.target.value as QrLook)} title="How the code itself is drawn. It is the same link each way. If something has trouble reading a leaf, use the plain square.">
            {QR_LOOKS.map(l => <option key={l.key} value={l.key}>{l.name}</option>)}
          </select>
        </label>
        {who && (
          <label>Card
            <select value={card} onChange={e => setCard(e.target.value as CardKind)}
              title={who.server ? 'A card to put the code on, with the server\'s name and where it leads. None is the code by itself.' : 'A card to put the code on, with your name and where it leads. None is the code by itself.'}>
              {CARDS.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select>
          </label>
        )}
        <button onClick={savePicture}>Save as a picture</button>
        {children}
      </div>
    </div>
  )
}

/**
 * One's own friend link, on the Friends screen: the address to hand out, the same thing as a QR code, and a way to
 * take it back by making a new one.
 */
export function FriendLinkPanel({ store }: { store: Store }) {
  const [link, setLink] = useState<FriendLinkDto | null>(null)
  const [showQr, setShowQr] = useState(false)
  const me = store.settings.user
  const url = link?.url
  // Who the card is for, and where the link leads as people would say it: the server's name without a leading "api.".
  const who = useMemo<CardWho | null>(() => {
    if (!me || !url) return null
    let site = 'Maplecord'
    try { site = new URL(url).host.replace(/^api\./, '') } catch { /* not an address: the name will do */ }
    return { name: shownName(me), username: me.username, look: { nameFont: me.nameFont ?? null, nameColor: me.nameColor ?? null, nameColor2: me.nameColor2 ?? null }, site }
  }, [me, url])
  const [copied, setCopied] = useState(false)
  const [asking, setAsking] = useState(false)
  const { loadFriendLink, resetFriendLink } = store
  useEffect(() => { let alive = true; void loadFriendLink().then(l => { if (alive) setLink(l) }); return () => { alive = false } }, [loadFriendLink])
  if (!link) return null

  const copy = () => { void navigator.clipboard.writeText(link.url).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }, () => store.setError('Could not copy. Select the link and copy it yourself.')) }

  return (
    <div className="friendlink">
      <h4>Your friend link</h4>
      <div className="muted">Anyone who opens it can ask to be your friend. You still say yes or no.</div>
      <div className="row">
        <input readOnly value={link.url} onFocus={e => e.target.select()} aria-label="Your friend link" />
        <button className="accent" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <button onClick={() => setShowQr(on => !on)} aria-expanded={showQr}>{showQr ? 'Hide QR code' : 'QR code'}</button>
      </div>
      {showQr && (
        <QrPanel store={store} qr={link.qr} seed={link.code} who={who} what="your friend link" file="maplecord-friend-link">
          <button className="subtle" onClick={() => setAsking(true)} title="The link you have handed out so far stops working">Make a new link</button>
        </QrPanel>
      )}
      {!showQr && <button className="subtle" style={{ alignSelf: 'flex-start' }} onClick={() => setAsking(true)} title="The link you have handed out so far stops working">Make a new link</button>}
      {asking && (
        <ConfirmDialog title="Make a new friend link?" message="The link and QR code you have handed out so far stop working. Friends you already have stay."
          onConfirm={() => void resetFriendLink().then(l => { if (l) setLink(l) })} onClose={() => setAsking(false)} />
      )}
    </div>
  )
}
