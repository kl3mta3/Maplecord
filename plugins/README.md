# Plugins

A plugin tells Maplecord about a game: item names, icons, and optionally how to spot a drop in the game's log.
It's a folder of data. No code runs.

```
my-game/
  manifest.json
  items.json
  icons/
```

Install from the app: Game plugins > Install from folder. They end up in `%APPDATA%\Maplecord\plugins`.

## manifest.json

```json
{
  "id": "com.example.demo-game",
  "name": "Demo Game Items",
  "version": "1.1.0",
  "author": "You",
  "description": "Shown in the plugin list.",
  "gameName": "Demo Game",
  "itemsFile": "items.json",
  "apiVersion": 1
}
```

`id` has to be unique, 2-100 chars, letters/digits/dots/dashes/underscores. It's sent with rolls so other people
with the same plugin see the same item.

## items.json

```json
[
  { "id": "1002357", "name": "Zakum Helmet", "iconPath": "icons/1002357.png", "rarity": "unique", "category": "hat" }
]
```

Only `id` and `name` are required. `rarity` colors the name if it's one of `uncommon`, `rare`, `epic`, `unique`,
`legendary`. Icons can be png, jpg, gif, webp or svg.

Once a plugin is installed the roll dialog (right-click Roll) searches its items as you type.

## Drop detection

Add a `logWatcher` to the manifest:

```json
"logWatcher": {
  "path": "%LOCALAPPDATA%/MyGame/Logs/chat-*.log",
  "encoding": "utf8",
  "cooldownSeconds": 2,
  "patterns": [
    { "regex": "^\\[loot\\] (?<itemId>\\d+)(?: x(?<quantity>\\d+))?" },
    { "regex": "You have gained an item: (?<itemName>.+?)$", "flags": "i" },
    { "regex": "The ancient seal breaks", "itemId": "1122000" }
  ]
}
```

- `path` can use `%VAR%`, `$VAR` or `~`. A `*` in the file name picks the newest match. Users can override the path
  in the app.
- `encoding`: `utf8`, `utf16le` or `latin1`
- Patterns are JavaScript regexes run against each new line. First match wins. Use named groups `itemId` or
  `itemName`, plus optional `quantity` and `context`. Or hard-code `"itemId"` on the pattern.
- Items that aren't in `items.json` are ignored.
- `cooldownSeconds` (default 2) stops one drop from firing twice.

Detection is off until the user enables it for that plugin. Then a drop either shows a prompt (app and overlay) or
starts the roll straight away if they turned on auto-roll. Ctrl+Alt+R accepts the prompt, Ctrl+Alt+P dismisses it.

The watcher starts at the end of the log, so old lines don't replay. Only "item X dropped" leaves the machine.

Limits: 50 patterns, 500 chars each, 2000 chars per line, 200k items. A pattern that takes too long gets disabled.

## Try it

`example-game/` works out of the box. Install it, enable detection, then:

```
echo [loot] 1002357 >> %TEMP%\maplecord-demo-game.log
```
