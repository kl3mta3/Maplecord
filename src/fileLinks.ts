import { useCallback, useEffect, useRef, useState } from 'react'

// The address of a file the server holds is good for a day or two (it says when it runs out, in "ex"). An app that
// has been open longer than that still shows messages whose addresses have run out, so it asks the server for a new
// one: before using one it can see is out of date, and once more if a file will not load.

let ask: ((attachmentId: string) => Promise<string | null>) | null = null

/** Where new addresses come from. Set once, by the store. */
export function setFileLinkSource(source: ((attachmentId: string) => Promise<string | null>) | null) { ask = source }

/** Whether an address has run out, as far as it says. One that says nothing (an older server's) never has. */
export function linkRanOut(url: string, now = Date.now()): boolean {
  const at = /[?&]ex=(\d+)/.exec(url)
  return at !== null && Number(at[1]) * 1000 <= now + 60_000
}

/**
 * A file's address, kept good. `refresh` asks the server for a new one and gives it (null if there is none to be
 * had: the file is gone, or this person can no longer see its channel). It is asked for once for each address the
 * message came with.
 */
export function useFileLink(file: { id: string; url: string }): { url: string; refresh: () => Promise<string | null> } {
  const [url, setUrl] = useState(file.url)
  const asked = useRef<Promise<string | null> | null>(null)
  const refresh = useCallback(() => {
    asked.current ??= (ask ? ask(file.id).catch(() => null) : Promise.resolve(null)).then(next => { if (next) setUrl(next); return next })
    return asked.current
  }, [file.id])
  useEffect(() => {
    asked.current = null
    setUrl(file.url)
    if (linkRanOut(file.url)) void refresh()
  }, [file.url, refresh])
  return { url, refresh }
}
