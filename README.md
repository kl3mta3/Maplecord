# Maplecord

Chat, voice and loot rolling for game groups. This is the client: an Electron app for Windows, macOS and Linux that
also runs in a browser.

## Features

### Chat

- Servers with text and voice channels, roles and permissions, and invite links that open in the app or the browser
- Public servers anyone can find by name or topic and join; private ones are by invite
- Private channels: only the roles and people you let in can see that they exist
- Friends and direct messages
- Files, pictures and videos in chat; pictures and videos show right there
- Voice messages: record up to 15 minutes and post it, and it plays right in the chat (so do other sound files)
- Unread counts, per-channel and per-server mute, and folders to group your servers
- Profiles with display names, avatars, banners, name fonts and animated decorations
- Status (online, do not disturb, invisible), blocking, and a say over who may send you friend requests
- Slash commands, bots and webhooks

### Voice and video

- Voice channels: mute, deafen, a volume for each person, and switching microphone or speakers without leaving
- Your microphone is only sent while you are talking, so the room behind you stays out of the call
- Call a friend from your conversation with them (📞)
- Share an app window, a whole screen or your camera, with the computer's sound if you like. Others click LIVE to
  watch. You pick the quality and see what is going out on your own preview.
- A stream you are watching can fill the screen or pop out into its own window. Right-click it (tap it on a phone)
  for its volume, to mute it, or to ask for a lower quality on a slow connection.

### For game groups

- Rolls: roll, need/greed, rock paper scissors, coin flip, dice. The server does the rolling, and a roll goes to
  whoever is in voice with you.
- In-game overlay with global hotkeys (desktop only)
- Game plugins: item names and icons, optional drop detection from the game's log (desktop only)
- Custom sound packs

### Everywhere

- A desktop app, and the same thing in a browser. On a phone it can be added to the home screen.
- Colour themes
- Sign in with Google or GitHub. There is no password.

### Quality of life, for everyone

The extras other platforms keep for paying members are simply part of Maplecord. There is no subscription and
nothing to unlock.

- Bigger files: up to 32 MB in chat on the public server, larger than many other platforms allow for free
- Files of any size between friends who both allow P2P
- Sharper streams: up to 1080p at 60 frames a second in P2P channels and calls, with sound
- Animated profile pictures, and animated decorations around them
- Profile banners, a colour of your own, a bio and pronouns
- Name fonts and colours, including two-colour names
- Colour themes for the whole app
- Custom sound packs

## P2P

<<<<<<< HEAD
Everything above works by only connecting to the Maplecord server and using a relay to communicate. P2P is extra: it is
kept apart from the rest and is off until you turn it on.
=======
Everything above works by only connecting to the Maplecord server and using a relay to communicate. P2P is extra: it is kept apart from the rest and is off until you turn it on.
>>>>>>> 68ea4eaa86f26793c44173c56a7dcadde15a91b2

In a P2P connection your app connects straight to the others. That allows more, but it means **the people
you connect to that way can, with the know how, find your IP address**.

- **Privacy** a P2P connection is made for users by the server but the connection is direct and private. Nothing passes through the server or relay.
- **Turning it on.** Untick "Do not allow P2P connections" in Voice settings. You are asked to sign in again, to be
  sure it is you. Tick it again whenever you like.
- **P2P voice channels** are their own kind of channel, shown in italics with a P2P tag, and you are warned before
  you join one. They never mix with ordinary channels: a channel is one or the other, and changing which empties
  it first. Making one takes its own permission.
- **P2P calls** are a separate button in a conversation with a friend. It only shows if you allow P2P, it asks
  first, and it only rings if your friend allows P2P too.
- **Files of any size** between friends who both allow P2P, straight from one computer to the other (the ⇄ button).
- **Higher stream quality.** A server can allow more in P2P channels and calls, 1080p at 60 for example.

Whoever runs the server sets the P2P limits (stream quality, file size) and can switch P2P off for everyone.

## Development

Node 22.18 or newer.

```bash
npm install
npm run dev
```

`npm run dev` starts the desktop app. `npm run dev:web` serves just the web UI on http://localhost:5173.

It connects to `http://localhost:5080` unless you set `VITE_SERVER_URL`, or change it under Advanced on the login
screen.

```bash
npm test
npm run typecheck
npm run lint
```

## Building

```bash
npm run dist:win
```

Also `dist:mac` and `dist:linux`. Installers end up in `release/`. Set `VITE_SERVER_URL` to your server before
building.

The Windows build makes two files: the installer (`.exe`) and a portable copy (`.zip`: unzip and run
`Maplecord.exe`, nothing is installed).

### Version and releases

The version is written in one place, `version.txt`. Every build reads it first, so the app, the installer and the
file names all carry it.

To release:

1. Put the new version in `version.txt` (it has to be higher than the last release).
2. `npm run dist:win`.
3. Make a GitHub release whose tag is that version (`0.1.2`, or `v0.1.2`) and attach the `.exe` and the `.zip` from
   `release/`.

A Maplecord server's front page finds the newest release's `.exe` and `.zip` by itself, whatever they are called.

### Updates

The desktop app updates itself on Windows. When it starts it asks the Maplecord server it was built for
(`VITE_SERVER_URL`) whether there is a newer release; the server asks GitHub, the app does not. If there is one, the
app downloads it from that release, checks it against its size and digest, and puts it in place before its window
opens: an installed copy runs the new installer silently, a portable copy unpacks the new zip over its own folder.
Then it starts again.

An update is only ever taken from the releases of the repository named in `package.json` (`repository`). If
anything goes wrong the app opens as it was and says so, and it does not try the same version again for a few hours.
What it did is written to `update.log` in the app's data folder.

## Web version

`npm run build:web` builds the app for a browser into `dist/`. A Maplecord server can serve it itself:
`npm run build:server-web` puts the build straight into the server repo next door
(`../Maplecord/src/Maplecord.Server/webapp`), and the server hands it out on the hostname set in `WebApp__Host`.

## Hotkeys

| | |
|---|---|
| Ctrl+Alt+R | roll / need, or start a roll |
| Ctrl+Alt+G | greed |
| Ctrl+Alt+P | pass |

## Plugins

A plugin is a folder with an item list, icons, and optionally a log file to watch for drops. No code.
Format and an example are in [plugins/](plugins/README.md).

## Sound packs

The built-in sounds are generated by `tools/make-sounds.mjs`.

To add your own, open Overlay settings > Open sounds folder, make a folder for the pack and drop in any of:

```
roll  win  lose  you100  they100  one  sixtyNine  emo  join  leave
```

as `.wav`, `.mp3` or `.ogg`. Missing ones fall back to the default.

## Privacy

- Plugin log watching is off until you turn it on, and only reads the file the plugin names. The log contents stay
  on your machine.
- Images, fonts and animations only ever load from the server you're signed in to.
- The server only keeps uploaded files for a while. The desktop app keeps its own copy of pictures and videos it
  has shown (up to 2 GB, oldest out first) in its data folder, so they still show after that.
- P2P only happens if you allow it, and you are warned each time it matters. See [P2P](#p2p).
- Sign in happens in your browser. The app never sees a password.

## Layout

```
electron/   main process: windows, overlay, hotkeys, plugins, sound packs
src/        UI (React + TypeScript)
plugins/    plugin format + example
tools/      sound generator
```

`src/types.ts` mirrors the server's DTOs. `CLIENT_PROTOCOL` in `src/platform.ts` is the protocol version this build
speaks; the server rejects builds that are too old.

## Credits

Fonts from [Fontsource](https://fontsource.org) (OFL, Permanent Marker is Apache 2.0).
Animations use [lottie-web](https://github.com/airbnb/lottie-web).

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
