# Decatron — browser extension for Twitch

[Español](README.es.md)

An extension with **modules**: each Decatron feature on Twitch is a module that you turn on and off on its
own, all inside a single panel. It works on Chrome, Edge, Brave and Opera; there is a package for Firefox
(see below). Public page: <https://decatron.net/translate>.

| Module | Status | What it does |
|---|---|---|
| **Translation** | ✅ | Listen to the stream in your language with the dubbing of [Decatron live translation](https://decatron.net/docs/translation). Only you hear it. |
| **Emotes** | ✅ | Draws **7TV, BetterTTV, FrankerFaceZ** and **Decatron's own** emotes (the ones each channel's community uploads) in chat, without installing other extensions. Includes the `:` picker. |
| **Multi-view** | ✅ | Adds the channel you are watching to your [Multi-view](https://decatron.net/docs/multiview) (several Twitch and Kick channels on one screen). If you already have one open, the channel is added there without reloading it, so the videos do not cut. |
| **Lurk mode (Multi-view)** | ✅ | The embedded player in the [Multi-view](https://decatron.net/docs/multiview) does not earn channel points or watch streaks; a regular twitch.tv tab does, even muted and in the background. For each Twitch channel in an open `decatron.net/multi`, opens a regular Twitch tab — muted, lowest quality, in a separate minimized window — that counts. **Off by default.** *Streak only*: once per stream; it reads the watch streak from the channel points menu and closes the tab as soon as it goes up (30 minutes at most), up to 3 at a time. Each lurk tab also checks it is signed in to Twitch and that the video is moving (it resumes it if Twitch pauses it); the Multi-view shows the status and a history of everything that happened. *Full*: open while the channel is live and in the Multi-view (points and, with the channel points module on, chests). Chosen from the Multi-view's top bar, with a per-channel setting on each tile. A tab you close yourself does not reopen during that stream; closing the Multi-view closes them all. Only the channel points module runs in those tabs. |
| **Channel points** | ✅ | Claims the channel points **bonus** (the chest) by itself a few seconds after it appears, with a random 1–5 s delay and a "+50 points" notice. **Off by default**, per-channel switch, only the bonus: it does not redeem rewards or bet points. It also works in the official Twitch chat embedded in the Multi-view (`decatron.net/multi`), with the same switch and the same excluded channels, as long as you are signed in to Twitch inside that chat. Notices when FrankerFaceZ or BetterTTV are detected (they can claim too; the bonus is claimed once). |

## How to use it

- A Decatron button in the player bar opens the **panel** (a modal inside Twitch) with one tab per module and
  a switch to turn each one on or off.
- The browser toolbar icon opens a short popup: the channel status, the module switches and a shortcut to
  the panel.
- Everything is saved in `chrome.storage.sync`; the translation language per channel, in
  `chrome.storage.local`.

### Emotes

- When a channel is opened, its dictionary is built: Decatron's own emotes
  (`decatron.net/api/public/emotes/<channel>`) and those of 7TV, BTTV and FFZ (global and channel)
  **straight from the browser to each service**. Priority for the same name: Decatron own > 7TV > BTTV > FFZ,
  and channel over global (the same one the Decatron chat overlay uses). The Decatron global set has the
  lowest priority.
- Chat words that match an emote become images; native Twitch emotes are not touched. "On top of the
  previous one" (zero-width) emotes, such as hats and effects, are stacked on the emote before.
- It coexists with FrankerFaceZ, BTTV and 7TV: it draws what those extensions leave as text (for example
  7TV emotes if you only have FFZ, or Decatron's own), without duplicating the ones they already replaced.
  FFZ rebuilds chat lines with different HTML (`span.message`); that is supported too. If you prefer, the
  panel can be set to draw only Decatron's own.
- **`:` picker**: type `:` and the first letters in the chat box; arrows, Enter or Tab (or a click) to
  choose. Twitch's box is a Slate editor: the text is inserted with a `beforeinput` event, with a paste
  fallback.
- Other viewers see these emotes in chat only if they also have an extension that draws them; in the stream
  overlay they are always visible.

## Structure

```
src/
  manifest.json
  background.js        service worker: fetch to the backend (CORS), emote dictionaries, badge
  emote-dict.js        emote dictionary (own + 7TV + BTTV + FFZ), shared with the Node tests
  i18n.js              texts in Spanish and English (by browser language)
  core.js              preferences, module registry, events and utilities (window.__decatron)
  kit.js               form pieces for the panels
  shell.js + panel.css player button and panel (Shadow DOM)
  modules/             translation.js · emotes.js · multiview.js · points.js
  points-embed.js      channel points inside the embedded official chat (Multi-view)
  multiview-page.js    runs on decatron.net/multi: passes "add this channel" from the extension to the page, marks the page
                       (extension version, lurk mode) and relays the lurk channels, settings and status
  lurk.js              service worker side of lurk mode: opens, mutes and closes the regular Twitch tabs
  lurk-tab.js          runs first on twitch.tv: in a lurk tab (?dct-lurk=1) asks for the lowest quality, checks the Twitch session and
                       that the video moves, reads the watch streak from the points menu; only the points module runs there
  login-page.js        runs ONLY on decatron.net/extension/login: receives the viewer token from the page and stores it
  emote-picker.js      the ":" picker
  captions-ui.js       captions and audio notice over the video (translation)
  audio.js, dsp.js, signalr-lite.js
  main.js              startup, modules and Twitch SPA navigation
  popup.*              browser toolbar popup
```

**How to add a module:** one file in `src/modules/` that calls
`window.__decatron.register({ id, order, icon, defaults, name, description, start, stop, onChannel(login),
status, renderPanel(body) })`, and list it in the manifest's `content_scripts`. The panel, popup, switch
and settings saving come for free.

## Permissions

Only `storage`, and access to: `twitch.tv` (the page), `decatron.net` (translation, own emotes, the Multi-view page — it only receives "add this channel" — and the `/extension/login` page, which hands over the viewer token: it only identifies you to live translation and gives no dashboard access),
`7tv.io`, `api.betterttv.net` and `api.frankerfacez.com` (their emotes) and `gql.twitch.tv` (the channel
id, which 7TV and BTTV ask for by id, and whether a channel in lurk mode is live). Lurk mode opens, mutes and closes only the tabs it creates itself. No account or login.

## Install in developer mode

1. `chrome://extensions` → turn on "Developer mode".
2. "Load unpacked" → the `src/` folder.

Store listings (Chrome Web Store, Firefox Add-ons and Opera Add-ons) are prepared in `store/`; the
`/translate` page enables each store button when that store publishes the extension.

## Packages

```
npm run pack           # decatron-chrome-<version>.zip
npm run pack:firefox   # decatron-firefox-<version>.zip (manifest with background.scripts and the Firefox id)
```

The Firefox package passes `web-ext lint` with no errors, but it **has not been tested inside Firefox**.

## Tests

```
npm i
npm run test:dict      # emote dictionary against real 7TV, BTTV, FFZ and Twitch (needs network)
npm run test:twitch -- <live-channel>   # button, panel, emote loading and replacement against the REAL Twitch (public chat)
npm run test:picker    # ":" picker against a real Slate editor
npm run test:ffz -- <live-channel>      # next to FrankerFaceZ (loads its script on the real Twitch)
npm run test:login     # sign-in: the login page hands over the viewer token, it is stored, sent to the hub, expired/unrecognized tokens, another decatron.net page cannot store one, sign out (local simulated hub)
npm run test:denied    # translation: the extension explains when the channel refuses the join (listener cap, pause, language not offered, followers/subscribers/sign-in levels with the days or tier asked) — local simulated hub
npm run test:lurk      # lurk mode: page mark, off by default, streak only (muted tab with the mark and lowest quality, separate window, reads the streak from a points-menu replica and closes when it goes up, or at 30 min), tab without a Twitch session, history, once per stream, full, a tab closed by hand is respected, per-channel setting, everything closes with the Multi-view (no network or account needed)
npm run test:points-embed  # same bonus claim inside the embedded official chat iframe (Multi-view): off by default, delay, destructive button, excluded channel
npm run test:points    # channel points module against a replica of the bonus chest: off by default, delay, notice, destructive button, blocked channel, FFZ detection (no network or account needed)
npm run test:multiview # Multi-view module: opens one, adds a second channel without reloading it and checks the duplicate notice (real decatron.net)
npm run test:video && npm run test:e2e   # translation against a replica of the player (with DURATION=3 it only checks the interface)
npm run test:dsp       # voice stretching (WSOLA), caption timings and validation of the server values; no network
npm run test:catchup   # catch-up mode, history, replay and captions-only in a real Chromium with a simulated hub (needs ffmpeg)
```

`test:twitch` injects lines shaped like Twitch chat into the real container to check the replacement; it
cannot write in the chat box because Twitch does not let it be used without a session (that is why the
picker is tested separately, against Slate). A Chromium is needed (`CHROME=/path/to/chrome` or
Playwright's).

## How translation works

```
twitch.tv/<channel> ── content script ──► GET decatron.net/api/live-translation/public/<channel>
                                       ──► wss://decatron.net/hubs/translation  (SignalR, JSON)
                                              Join(channel, language) → Status / SegmentStart / SegmentChunk / SegmentEnd
```

The audio arrives in MP3 chunks, is decoded with Web Audio and queued in order; the `<video>` volume is
controlled directly (inverse ducking with a ramp). Captions reveal the words at the pace of the audio.

### Catch-up mode, history and captions only (0.3.0)

- **Catch-up mode** (`audio.js`, `dsp.js`): according to the seconds of audio still ahead, the voice speeds
  up in steps without raising the pitch (WSOLA, not `playbackRate`). Only if the queue goes over the limit
  are the oldest phrases skipped: a notice is shown over the video and they are marked in the history. The
  server also skips what has already waited too long (`SegmentDropped`, reason `stale`).
- **Captions**: each word lights up according to when the voice plays it (`dsp.wordTimings`). With "captions
  only" nothing plays and the text appears on arrival, at reading pace.
- **History** (`modules/translation.js`): the latest phrases with a button to replay those whose audio is
  still stored (the last 6).
- **Values adjustable from the server**: the public channel query returns `tuning` (catch-up thresholds and
  speeds, queue limit, times). They are edited in `LiveTranslation:ClientTuning` of the bot's
  `appsettings.json` and reload on their own, **without publishing a version to the stores**. They are data
  only: `dsp.sanitizeTuning` validates them and clips them to fixed limits (max speed 1.5x), and if
  something does not fit it uses the factory value. Nothing that comes from the server is executed.

## Backend and manual

The server side lives in the bot repository ([`decatrondev/decatron`](https://github.com/decatrondev/decatron)):
`TranslationHub`, `LiveTranslationController`, `PublicEmotesController` and the emote catalog. User guides:
<https://decatron.net/docs/translation> (viewer extension page) and <https://decatron.net/docs/chat>
(emotes).
