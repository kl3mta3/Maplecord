// Run with: node src/p2pPosts.test.ts
import { foldP2p, foldP2pChat, isP2pNote, isP2pNoteText, p2pShape, packP2p, searchP2pChat, searchP2pGallery, unpackP2p, MOST_P2P_PINS, MOST_P2P_REACTIONS, P2P_META_ROOM, P2P_REACTIONS, P2P_TITLE } from './p2pPosts.ts'
/** The most a P2P message's text may be (MAX_P2P_TEXT in p2pText.ts, which cannot be loaded outside the app). */
const MAX_P2P_TEXT = 4000
import type { MessageDto } from './types.ts'

let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`); if (!ok) failures++ }

// ---- What a message's text says it is ----
const post = packP2p({ t: '  First clear  ' }, '  what a night ')
check(unpackP2p(post).meta.t === 'First clear' && unpackP2p(post).text === 'what a night', 'a post carries its title in front of its text, and both come back')
check(packP2p({}, 'hello') === 'hello' && unpackP2p('hello').text === 'hello' && Object.keys(unpackP2p('hello').meta).length === 0, 'a plain message is left exactly as it was typed')
const about = unpackP2p(packP2p({ th: 'u1:post' }, 'gz!'))
check(about.meta.th === 'u1:post' && about.text === 'gz!' && about.meta.t === undefined, 'something said about a post names the post')
const like = unpackP2p(packP2p({ rx: { id: 'u1:post', e: '❤️', on: true } }, ''))
check(like.meta.rx?.id === 'u1:post' && like.meta.rx.e === '❤️' && like.meta.rx.on === true && like.text === '', 'a reaction names the message, the reaction, and whether it was put there or taken back')
check(packP2p({ rx: { id: 'u1:post', e: '❤️', on: false } }, '').trim().length > 0, 'a reaction is never an empty message, which could not be sent')
check(packP2p({ t: 'x'.repeat(500) }, '').length <= P2P_META_ROOM && unpackP2p(packP2p({ t: 'x'.repeat(500) }, '')).meta.t?.length === P2P_TITLE, 'a title is cut to its limit, so what is written in front always fits its room')
check(unpackP2p(packP2p({ t: 'a\u0001"\\'.repeat(50) }, 'hi')).meta.t?.length === P2P_TITLE, 'a title of characters that are written out longer than they are still fits')
check(packP2p({ th: 'a'.repeat(73), rx: { id: 'b'.repeat(73), e: '✌️', on: false } }, '').length <= P2P_META_ROOM, 'and so does the longest of anything else written there')

const odd = (content: string) => { const r = unpackP2p(content); return Object.keys(r.meta).length === 0 && r.text === content }
check(odd('\u0002{"t":"x"') && odd('\u0002not json\u0003hi') && odd('\u0002[1]\u0003hi') && odd('\u0002"t"\u0003hi') && odd('\u0002' + ' '.repeat(3000) + '{}\u0003hi'),
  'text that only looks like it is plain text: nothing is read out of it')
const strange = unpackP2p('\u0002{"t":7,"th":"","rx":{"id":"u1:post","e":"<b>","on":true},"more":1}\u0003hi')
check(Object.keys(strange.meta).length === 0 && strange.text === 'hi', 'a title that is not text, an empty post id, and a reaction that is not one of the choices are all ignored')
check(unpackP2p('\u0002{"rx":{"id":"u1:post","e":"❤️","on":"yes"}}\u0003').meta.rx === undefined && unpackP2p('\u0002{"th":"' + 'a'.repeat(200) + '"}\u0003x').meta.th === undefined,
  'so is a reaction that does not say on or off, and a post id too long to be one')
check(P2P_REACTIONS.length === 64 && new Set(P2P_REACTIONS).size === 64, 'there are 64 different reactions to choose from')

// ---- A channel's messages as posts, comments and reactions ----
let n = 0
const at = () => new Date(Date.UTC(2026, 0, 1, 0, 0, n++)).toISOString()
const picture = { name: 'a.png', size: 10, type: 'image/png', hash: 'h' }
const message = (id: string, authorId: string, more: Partial<MessageDto> = {}): MessageDto =>
  ({ id, channelId: 'c', authorId, authorName: authorId, kind: 0 as MessageDto['kind'], content: '', createdAt: at(), editedAt: null, attachments: [], roll: null, ...more })
const rx = (id: string, authorId: string, target: string, e: string, on: boolean) => message(id, authorId, { p2pReaction: { id: target, e, on } })

const held: MessageDto[] = [
  message('p1', 'ann', { title: 'Group photo', p2pFiles: [picture, picture] }),
  message('p2', 'ben', { title: 'First clear', p2pFiles: [picture] }),
  message('c1', 'ben', { threadId: 'p1', content: 'nice' }),
  message('c2', 'cat', { threadId: 'p1', content: 'gz' }),
  rx('r1', 'ben', 'p1', '❤️', true),
  rx('r2', 'cat', 'p1', '❤️', true),
  rx('r3', 'cat', 'p1', '🔥', true),
  rx('r4', 'ann', 'c1', '👍', true),
  rx('r5', 'ben', 'p1', '❤️', false),
  message('t1', 'ann', { content: 'just text' }),
  message('t2', 'ann', { title: 'No picture', p2pFiles: [{ ...picture, type: 'application/pdf' }] }),
  message('c3', 'ann', { threadId: 'gone', content: 'about a post this device does not hold' }),
]
const asCat = foldP2p(held, 'cat')
const first = asCat.posts[0]!
check(asCat.posts.map(p => p.id).join() === 'p1,p2', 'a post is a message with a title and a picture: plain text, a title with no picture, comments and reactions are not posts')
check(first.threadCount === 2 && asCat.said.get('p1')!.map(m => m.content).join() === 'nice,gz' && asCat.posts[1]!.threadCount === 0, 'what is said about a post is counted on it and listed under it, oldest first')
check(JSON.stringify(first.reactions) === JSON.stringify([{ emoji: '❤️', count: 1, mine: true }, { emoji: '🔥', count: 1, mine: true }]),
  'a like that was taken back no longer counts; the ones left say whether one of them is mine')
check(foldP2p(held, 'ben').posts[0]!.reactions![0]!.mine === false && foldP2p(held, undefined).posts[0]!.reactions![0]!.count === 1, 'and it is not mine for someone who took theirs back, or for nobody')
check(asCat.said.get('p1')![0]!.reactions?.[0]?.emoji === '👍' && asCat.said.get('p1')![1]!.reactions === null, 'what is said about a post can be reacted to as well')
check(!asCat.said.has('gone') && asCat.posts[1]!.reactions === null, 'something said about a post this device does not hold waits unseen, and a post nobody reacted to has no reactions')

// The last word counts, whatever order the messages are held in.
const late = [...held, rx('r6', 'ben', 'p1', '❤️', true)]
check(foldP2p(late.slice().reverse(), 'cat').posts[0]!.reactions![0]!.count === 2 && foldP2p([...late, late.at(-1)!], 'cat').posts[0]!.reactions![0]!.count === 2,
  'the last thing someone said about a reaction is what counts, in whatever order it arrived, and the same message twice counts once')
const everything = [...held, ...P2P_REACTIONS.map((e, i) => rx('m' + i, 'dan', 'p2', e, true))]
check(foldP2p(everything, 'cat').posts[1]!.reactions!.length === MOST_P2P_REACTIONS, `one message shows at most ${MOST_P2P_REACTIONS} different reactions`)

// ---- A text channel: answers, threads and reactions ----
const answer = unpackP2p(packP2p({ th: 'u1:root', re: 'u2:said' }, 'yes'))
check(answer.meta.th === 'u1:root' && answer.meta.re === 'u2:said' && answer.text === 'yes', 'a message can be in a thread and answer another message at once')
check(packP2p({ th: 'a'.repeat(73), re: 'b'.repeat(73) }, '').length <= P2P_META_ROOM && unpackP2p('\u0002{"re":""}\u0003x').meta.re === undefined, 'both ids fit in front of the text, and an empty one is ignored')

const talk: MessageDto[] = [
  message('m1', 'ann', { content: 'who is on tonight?' }),
  message('m2', 'ben', { content: '  me,\n  after nine  ', p2pReplyTo: 'm1' }),
  message('m3', 'cat', { content: 'bring potions', threadId: 'm1' }),
  message('m4', 'ann', { content: 'how many?', threadId: 'm1', p2pReplyTo: 'm3' }),
  rx('x1', 'ben', 'm1', '👍', true),
  rx('x2', 'cat', 'm3', '🔥', true),
  message('m5', 'ben', { content: '', p2pFiles: [picture] }),
  message('m6', 'cat', { content: 'nice one', p2pReplyTo: 'm5' }),
  message('m7', 'cat', { content: 'about something else', p2pReplyTo: 'never-held' }),
  message('m8', 'ann', { content: 'said in a thread this device has no start of', threadId: 'never-held' }),
  message('m9', 'ben', { content: 'a thread off a thread message', threadId: 'm3' }),
  message('m10', 'ben', { content: 'its own thread', threadId: 'm10' }),
]
const chat = foldP2pChat(talk, 'ben')
const inMain = (id: string) => chat.main.find(m => m.id === id)!
check(chat.main.map(m => m.id).join() === 'm1,m2,m5,m6,m7,m8,m9,m10', 'the channel shows what was said in it, in the order it was held; reactions and what is in a thread do not show there')
check(chat.threads.get('m1')!.map(m => m.id).join() === 'm3,m4' && inMain('m1').threadCount === 2 && inMain('m1').threadLastAt === talk[3]!.createdAt && inMain('m2').threadCount === undefined,
  'a thread hangs off its first message, which says how much is in it and when it was last spoken in')
check(inMain('m2').replyTo?.authorId === 'ann' && inMain('m2').replyTo?.snippet === 'who is on tonight?' && !inMain('m2').replyTo?.gone && chat.threads.get('m1')![1]!.replyTo?.snippet === 'bring potions',
  'an answer shows who and what it answers, in the channel and inside a thread')
check(inMain('m6').replyTo?.snippet === 'A picture' && inMain('m7').replyTo?.gone === true && inMain('m1').replyTo === null, 'answering a picture says so, and answering a message this device does not hold says that')
check(JSON.stringify(inMain('m1').reactions) === JSON.stringify([{ emoji: '👍', count: 1, mine: true }]) && chat.threads.get('m1')![0]!.reactions?.[0]?.emoji === '🔥' && inMain('m2').reactions === null,
  'reactions are counted on messages of the channel and of a thread alike')
check(!!inMain('m8') && !!inMain('m9') && !!inMain('m10') && !chat.threads.has('never-held') && !chat.threads.has('m3') && !chat.threads.has('m10'),
  'a message in a thread whose start is not held, or is itself in a thread, or is itself, shows in the channel rather than nowhere')
check(foldP2pChat([...talk].reverse(), 'ben').threads.get('m1')!.length === 2 && foldP2pChat([], 'ben').main.length === 0, 'the order the messages are held in does not change what is in a thread')

// ---- Edits, pins, polls and search in a text channel ----
const longest = packP2p({ pl: { o: Array.from({ length: 10 }, (_, i) => String(i) + '"\\'.repeat(60)), m: true, h: 336 } }, 'q'.repeat(300))
check(longest.length <= MAX_P2P_TEXT && unpackP2p(longest).meta.pl?.o.length === 10 && unpackP2p(longest).text.length === 300, 'the longest poll there can be, of characters written out longer than they are, still fits in one message')
const asked = unpackP2p(packP2p({ pl: { o: [' Fri ', 'Sat'], m: false, h: null } }, 'When?'))
check(JSON.stringify(asked.meta.pl) === JSON.stringify({ o: ['Fri', 'Sat'], m: false, h: null }) && asked.text === 'When?', 'a poll carries its choices in front of its question')
const badPoll = (pl: unknown) => unpackP2p('\u0002' + JSON.stringify({ pl }) + '\u0003q').meta.pl === undefined
check(badPoll({ o: ['only one'], m: false }) && badPoll({ o: ['Yes', 'yes'], m: false }) && badPoll({ o: ['a', ''], m: false }) && badPoll({ o: ['a', 'x'.repeat(81)], m: false })
  && badPoll({ o: Array.from({ length: 11 }, (_, i) => 'c' + i), m: false }) && badPoll({ o: ['a', 'b'], h: 0 }) && badPoll({ o: ['a', 'b'], h: 337 }) && badPoll({ o: ['a', 7] }),
  'a poll needs two to ten different choices of a sensible length, and a sensible time if it has one')
const note = unpackP2p('\u0002{"ed":"m1","th":"m2","t":"x","pin":{"id":"m1","on":true}}\u0003new text')
check(JSON.stringify(note.meta) === '{"ed":"m1","t":"x"}' && note.text === 'new text' && JSON.stringify(unpackP2p('\u0002{"ed":"m1","t":7}\u0003y').meta) === '{"ed":"m1"}' && isP2pNoteText(packP2p({ pin: { id: 'm1', on: true } }, '')) && isP2pNoteText(packP2p({ v: { id: 'm1', o: [] } }, ''))
  && isP2pNoteText(packP2p({ pc: 'm1' }, '')) && !isP2pNoteText(packP2p({ th: 'm1' }, 'hi')) && !isP2pNoteText('hi'), 'a note about another message is that one thing and nothing else (an edit may bring a new title), and is told apart from something said')
check(unpackP2p('\u0002{"v":{"id":"m1","o":[0,0]}}\u0003').meta.v === undefined && unpackP2p('\u0002{"v":{"id":"m1","o":[10]}}\u0003').meta.v === undefined && unpackP2p('\u0002{"v":{"id":"m1","o":[1.5]}}\u0003').meta.v === undefined
  && unpackP2p('\u0002{"pin":{"id":"m1","on":1}}\u0003').meta.pin === undefined, 'a vote for the same choice twice, a choice there cannot be, or a pin that does not say on or off is ignored')
check(isP2pNote({ ...message('n', 'ann'), ...p2pShape(packP2p({ ed: 'm1' }, 'x')) }) && p2pShape(packP2p({ ed: 'm1' }, 'x')).content === 'x' && p2pShape('plain').content === 'plain' && Object.keys(p2pShape('plain')).length === 1,
  'a message is given its shape from its text alone')

const day = (h: number, min = 0) => new Date(Date.UTC(2026, 5, 1, h, min)).toISOString()
const timed = (id: string, authorId: string, when: string, more: Partial<MessageDto> = {}): MessageDto => ({ ...message(id, authorId, more), createdAt: when })
const room: MessageDto[] = [
  timed('a1', 'ann', day(1), { content: 'meet at eigth' }),
  timed('a2', 'ben', day(1, 5), { content: 'ok', p2pReplyTo: 'a1' }),
  timed('e1', 'ann', day(1, 10), { p2pEdit: 'a1', content: 'meet at eight' }),
  timed('e2', 'ben', day(1, 11), { p2pEdit: 'a1', content: 'meet never' }),
  timed('e3', 'ann', day(1, 12), { p2pEdit: 'a1', content: 'meet at eight sharp' }),
  timed('e4', 'ann', day(0), { p2pEdit: 'a1', content: 'from before it was said' }),
  timed('e5', 'ben', day(1, 13), { p2pEdit: 'a2', content: '   ' }),
  timed('f1', 'cat', day(2), { content: 'look', p2pFiles: [picture] }),
  timed('e6', 'cat', day(2, 1), { p2pEdit: 'f1', content: '' }),
  timed('q1', 'ann', day(3), { content: 'Which day?', p2pPoll: { o: ['Fri', 'Sat', 'Sun'], m: false, h: 2 } }),
  timed('e7', 'ann', day(3, 1), { p2pEdit: 'q1', content: 'Which night?' }),
  timed('v1', 'ben', day(3, 10), { p2pVote: { id: 'q1', o: [0] } }),
  timed('v2', 'cat', day(3, 11), { p2pVote: { id: 'q1', o: [1] } }),
  timed('v3', 'ben', day(3, 20), { p2pVote: { id: 'q1', o: [1] } }),
  timed('v4', 'dan', day(3, 21), { p2pVote: { id: 'q1', o: [0, 2] } }),
  timed('v5', 'eve', day(3, 22), { p2pVote: { id: 'q1', o: [3] } }),
  timed('v6', 'fay', day(5, 30), { p2pVote: { id: 'q1', o: [2] } }),
  timed('v7', 'gus', day(3, 30), { p2pVote: { id: 'q1', o: [2] } }),
  timed('v8', 'gus', day(3, 40), { p2pVote: { id: 'q1', o: [] } }),
  timed('q2', 'ben', day(6), { content: 'Which days?', p2pPoll: { o: ['Fri', 'Sat'], m: true, h: null } }),
  timed('w1', 'ann', day(6, 1), { p2pVote: { id: 'q2', o: [0, 1] } }),
  timed('k1', 'cat', day(6, 2), { p2pPollClose: 'q2' }),
  timed('w2', 'cat', day(6, 3), { p2pVote: { id: 'q2', o: [0] } }),
  timed('k2', 'mod', day(6, 10), { p2pPollClose: 'q2' }),
  timed('w3', 'dan', day(6, 20), { p2pVote: { id: 'q2', o: [1] } }),
  timed('p1', 'mod', day(7), { p2pPin: { id: 'a1', on: true } }),
  timed('p2', 'cat', day(7, 1), { p2pPin: { id: 'a2', on: true } }),
  timed('p3', 'mod', day(7, 2), { p2pPin: { id: 'f1', on: true } }),
  timed('p4', 'mod', day(7, 3), { p2pPin: { id: 'f1', on: false } }),
  timed('t1', 'ben', day(7, 4), { content: 'in a thread', threadId: 'a1' }),
  timed('p5', 'mod', day(7, 5), { p2pPin: { id: 't1', on: true } }),
  timed('p6', 'mod', day(7, 6), { p2pPin: { id: 'q1', on: true } }),
]
const mods = (id: string) => id === 'mod'
const seen = foldP2pChat(room, 'ben', mods, day(4))
const one = (id: string) => [...seen.main, ...[...seen.threads.values()].flat()].find(m => m.id === id)!
check(seen.main.map(m => m.id).join() === 'a1,a2,f1,q1,q2' && seen.threads.get('a1')!.map(m => m.id).join() === 't1', 'edits, pins, votes and polls being closed never show as messages of their own')
check(one('a1').content === 'meet at eight sharp' && one('a1').editedAt === day(1, 12) && one('a2').replyTo?.snippet === 'meet at eight sharp',
  'a message reads as its author last edited it, and so does a quote of it; an edit by someone else, or dated before the message, changes nothing')
check(one('a2').content === 'ok' && one('a2').editedAt === null && one('f1').content === '' && one('f1').editedAt === day(2, 1) && one('q1').content === 'Which day?',
  'an edit cannot empty a message that is only text, can take the words off a picture, and cannot change a poll')
const q1 = one('q1').poll!
check(q1.options.map(o => o.votes).join() === '0,2,0' && q1.voters === 2 && q1.options[1]!.mine === true && q1.options[0]!.mine === false && q1.closed === false && q1.closesAt === day(5),
  'a poll counts each person\'s last choice: a vote can be changed or taken back; two choices where one is allowed, a choice that is not there, and a vote after its time are not counted')
check(foldP2pChat(room, 'ben', mods, day(5, 1)).main.find(m => m.id === 'q1')!.poll!.closed === true, 'and it is open until its time is up, then closed')
const q2 = one('q2').poll!
check(q2.options.map(o => o.votes).join() === '2,1' && q2.voters === 2 && q2.closed === true && q2.closesAt === null && foldP2pChat(room, 'ben', () => false, day(4)).main.find(m => m.id === 'q2')!.poll!.closed === false,
  'a poll is closed by whoever asked it or someone who manages messages, not by anyone else, and takes no vote after that')
check(seen.pins.map(m => m.id).join() === 'q1,a1' && !!one('a1').pinnedAt && !one('a2').pinnedAt && !one('f1').pinnedAt && !one('t1').pinnedAt && foldP2pChat(room, 'ben').pins.length === 0,
  'pins count only from people who manage messages; an unpin takes one away, a message in a thread is not pinned, and the latest pin is listed first')
const many = Array.from({ length: 60 }, (_, i) => timed('z' + i, 'ann', day(8, i), { content: 'n' + i }))
check(foldP2pChat([...many, ...many.map((m, i) => timed('zp' + i, 'mod', day(9, i), { p2pPin: { id: m.id, on: true } }))], 'ben', mods).pins.length === MOST_P2P_PINS, `a channel shows at most ${MOST_P2P_PINS} pins`)
check(searchP2pChat(seen, 'EIGHT').map(m => m.id).join() === 'a1' && searchP2pChat(seen, 'eigth').length === 0 && searchP2pChat(seen, 'thread').map(m => m.id).join() === 't1'
  && searchP2pChat(seen, 'sat').map(m => m.id).join() === 'q2,q1' && searchP2pChat(seen, '  ').length === 0,
  'search finds a message by what it now reads, in the channel and in threads, and a poll by its choices, newest first')

// ---- The same in a gallery: posts and what is said wallPoll them ----
const wall: MessageDto[] = [
  timed('g1', 'ann', day(1), { title: 'Frist clear', content: 'what a nihgt', p2pFiles: [picture] }),
  timed('g2', 'ben', day(1, 1), { title: 'Group photo', content: '', p2pFiles: [picture] }),
  timed('h1', 'cat', day(1, 2), { threadId: 'g1', content: 'gz evreyone' }),
  timed('h2', 'ben', day(1, 3), { threadId: 'g1', content: 'Same again next week?', p2pPoll: { o: ['Yes', 'No'], m: false, h: null } }),
  timed('n1', 'ann', day(2), { p2pEdit: 'g1', title: 'First clear', content: 'what a night' }),
  timed('n2', 'ben', day(2, 1), { p2pEdit: 'g1', title: 'Mine now', content: 'not yours to change' }),
  timed('n3', 'cat', day(2, 2), { p2pEdit: 'h1', title: 'A comment has no title', content: 'gz everyone' }),
  timed('n4', 'ben', day(2, 3), { p2pEdit: 'g2', content: 'all of us' }),
  timed('n5', 'ann', day(2, 4), { p2pVote: { id: 'h2', o: [0] } }),
  timed('n6', 'cat', day(2, 5), { p2pVote: { id: 'h2', o: [1] } }),
  timed('n7', 'mod', day(3), { p2pPin: { id: 'g2', on: true } }),
  timed('n8', 'mod', day(3, 1), { p2pPin: { id: 'h1', on: true } }),
  timed('n9', 'cat', day(3, 2), { p2pPin: { id: 'g1', on: true } }),
  timed('x1', 'cat', day(3, 3), { content: 'typed straight into the gallery' }),
]
const wall2 = foldP2p(wall, 'ann', mods, day(4))
const wallPost = (id: string) => wall2.posts.find(m => m.id === id)!
check(wall2.posts.map(m => m.id).join() === 'g1,g2' && wallPost('g1').title === 'First clear' && wallPost('g1').content === 'what a night' && wallPost('g1').editedAt === day(2) && wallPost('g1').threadCount === 2,
  'a post\'s title and words read as its author last edited them; someone else\'s edit changes neither, and nothing else shows as a post')
check(wallPost('g2').title === 'Group photo' && wallPost('g2').content === 'all of us' && wall2.said.get('g1')![0]!.content === 'gz everyone' && wall2.said.get('g1')![0]!.title == null,
  'an edit that sends no title leaves the title alone, and what is said about a post can be edited but never gains a title')
const wallPoll = wall2.said.get('g1')![1]!.poll!
check(wallPoll.options.map(o => o.votes).join() === '1,1' && wallPoll.options[0]!.mine === true && wallPoll.voters === 2 && wallPoll.closed === false, 'a poll can be asked about a post, and is counted like any other')
check(wall2.pins.map(m => m.id).join() === 'g2' && !!wallPost('g2').pinnedAt && !wallPost('g1').pinnedAt && foldP2p(wall, 'ann').pins.length === 0, 'a post is pinned by someone who manages messages; what is said about one is not pinned')
check(searchP2pGallery(wall2, 'first').map(m => m.id).join() === 'g1' && searchP2pGallery(wall2, 'FRIST').length === 0 && searchP2pGallery(wall2, 'everyone').map(m => m.id).join() === 'h1'
  && searchP2pGallery(wall2, 'yes').map(m => m.id).join() === 'h2' && searchP2pGallery(wall2, 'straight').length === 0 && searchP2pGallery(wall2, '').length === 0,
  'search finds a post by its title or words as they now read, and what is said about one, and nothing that is not shown')

if (failures > 0) throw new Error(`${failures} failed`)
console.log('p2pPosts: all passed')
