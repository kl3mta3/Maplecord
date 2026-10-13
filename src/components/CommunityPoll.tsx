import { useState } from 'react'
import { PICK_ONE, RATE, answered, complete, fromAnswers, pick, rate, share, toAnswers, totalWords, type Filled } from '../communityPoll'
import type { CommunityPollAnswerDto, CommunityPollDto } from '../types'
import { Dialog } from './Dialogs'

/**
 * A community poll (see communityPoll.ts): filled in and sent, or put off with "not now"; or, once it has been
 * answered or is over, shown as it stands, with what the person answered and the totals where those are shown.
 */
export function CommunityPollDialog({ poll, onAnswer, onDecline, onClose }: {
  poll: CommunityPollDto
  onAnswer: (answers: CommunityPollAnswerDto[]) => Promise<void>
  onDecline: () => Promise<void>
  onClose: () => void
}) {
  const [filled, setFilled] = useState<Filled>(() => fromAnswers(poll.myAnswers))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const open = poll.mayAnswer && poll.mine !== 'answered'
  const mine = poll.mine === 'answered' ? fromAnswers(poll.myAnswers) : filled
  const send = async () => {
    setBusy(true); setProblem(null)
    try { await onAnswer(toAnswers(poll, filled)) }
    catch (e) { setProblem(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const when = poll.ended ? 'This poll has ended.' : poll.endsAt ? `Open until ${new Date(poll.endsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.` : null

  return (
    <Dialog title={poll.title} onClose={onClose} scrolls>
      {poll.intro && <div className="pollintro">{poll.intro}</div>}
      {(when || poll.answered != null) && (
        <div className="muted">{when}{when && poll.answered != null ? ' ' : ''}{poll.answered != null ? `${poll.answered.toLocaleString()} ${poll.answered === 1 ? 'person has' : 'people have'} answered.` : ''}</div>
      )}
      {!open && poll.mine === 'answered' && <div className="muted">You have answered this poll. An answer cannot be changed.</div>}
      {!open && poll.mine !== 'answered' && poll.whyNot && <div className="muted">{poll.whyNot}</div>}

      {poll.questions.map(q => (
        <fieldset key={q.id} className="pollq" disabled={!open || busy}>
          <legend>{q.text} {open && !answered(q, filled) && <span className="muted">{q.kind === PICK_ONE ? '· pick one' : q.kind === RATE ? '· 1 is low, 10 is high' : '· pick any'}</span>}</legend>
          {q.options.map(o => {
            const width = share(poll, q, o), words = totalWords(poll, q, o)
            const chosen = mine[o.id] !== undefined
            return (
              <div key={o.id} className={'pollopt' + (q.kind === RATE ? ' rated' : '') + (chosen ? ' chosen' : '')}>
                {width !== null && <i style={{ width: width + '%' }} />}
                {q.kind === RATE ? (
                  <>
                    <span className="grow">{o.text}</span>
                    {open
                      ? <span className="pollrate" role="radiogroup" aria-label={o.text}>
                          {Array.from({ length: 10 }, (_, n) => n + 1).map(n => (
                            <button type="button" key={n} role="radio" aria-checked={filled[o.id] === n} className={filled[o.id] === n ? 'sel' : ''} onClick={() => setFilled(f => rate(f, o.id, n))}>{n}</button>
                          ))}
                        </span>
                      : chosen && <span className="muted">you: {mine[o.id]}</span>}
                  </>
                ) : (
                  <label className="grow">
                    <input type={q.kind === PICK_ONE ? 'radio' : 'checkbox'} name={q.id} checked={chosen} onChange={() => setFilled(f => pick(f, q, o.id))} />
                    <span>{o.text}</span>
                  </label>
                )}
                {words && <b>{words}</b>}
              </div>
            )
          })}
        </fieldset>
      ))}

      {poll.answered == null && !poll.ended && <div className="muted">The totals are shown when this poll ends.</div>}
      {problem && <div className="error">{problem}</div>}
      <div className="row">
        {poll.page && <a className="muted" href={poll.page} target="_blank" rel="noreferrer">All polls</a>}
        <span className="grow" />
        {open && poll.mine === 'none' && <button disabled={busy} onClick={() => { setBusy(true); void onDecline().finally(() => setBusy(false)) }}>Not now</button>}
        {!open || poll.mine !== 'none' ? <button disabled={busy} onClick={onClose}>Close</button> : null}
        {open && <button className="accent" disabled={busy || !complete(poll, filled)} title={complete(poll, filled) ? 'An answer is final' : 'Answer every question first'} onClick={() => void send()}>Send my answers</button>}
      </div>
    </Dialog>
  )
}
