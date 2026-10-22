import type { Store } from '../store'
import { Dialog } from './Dialogs'

const size = (bytes: number) => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1048576).toFixed(1)} MB`

/**
 * Files of mine the server marked to be removed for going unopened (see the server's FileRules). Opening one, or
 * a picture shown in its message, keeps it.
 */
export default function MarkedFiles({ store, onClose }: { store: Store; onClose: () => void }) {
  const files = store.markedFiles
  return (
    <Dialog title="Files to be removed" onClose={onClose} scrolls>
      <div className="muted">Nobody has opened these in a long while. Each is removed on the day shown unless someone opens it first. Open one to keep it, or save a copy. A picture or video shown in its message counts as opened too.</div>
      {files.length === 0 && <div>Nothing left to look at: they are kept.</div>}
      {files.map(f => (
        <div key={f.attachment.id} className="row" style={{ alignItems: 'center', gap: 8 }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.attachment.fileName}</div>
            <div className="muted small">{size(f.attachment.size)} · removed {new Date(f.removeAt).toLocaleDateString()}</div>
          </div>
          <button className="accent" onClick={() => { store.dropMarkedFile(f.attachment.id); window.open(f.attachment.url, '_blank', 'noopener') }}>Open</button>
          <button onClick={() => { onClose(); void store.jumpTo({ id: f.messageId, channelId: f.channelId }) }}>Go to message</button>
        </div>
      ))}
      <div className="buttons"><button onClick={onClose}>Close</button></div>
    </Dialog>
  )
}
