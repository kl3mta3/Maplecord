/**
 * Ordinary (Unicode) emojis, drawn as Twemoji pictures (github.com/jdecked/twemoji, by Twitter, Inc. and other
 * contributors, CC-BY 4.0) so that they look the same on every device, flags included. The pictures are this app's own
 * files (public/emoji, made by scripts/emoji-data.mjs): nothing is fetched from anyone else to draw them. An emoji
 * with no picture is written as text.
 *
 * The list the pickers offer (names, the words each is found by, groups, skin tones) is in emojiData.ts, fetched only
 * when a picker is opened. Which emojis are, is the browser's own knowledge of Unicode (\p{RGI_Emoji}).
 */
import { useState } from 'react'
import { emojiUrl } from './emojiMatch'

/** An emoji, drawn. */
export function Twemoji({ emoji, big }: { emoji: string; big?: boolean }) {
  const [broken, setBroken] = useState(false)
  if (broken) return <>{emoji}</>
  return <img className={'emoji' + (big ? ' big' : '')} src={emojiUrl(emoji)} alt={emoji} draggable={false} loading="lazy" onError={() => setBroken(true)} />
}
