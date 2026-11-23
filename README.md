# Spotify Polyglot Companion

**Read any song in your own alphabet.** A Chrome extension that adds a lyrics panel to the Spotify Web Player, showing each line in its original script, its transliteration (how to pronounce it) and its translation, in sync with the music.

Project page: **https://charlesmontluc.github.io/spotify-polyglot-companion/**

## What it does

- Detects the track playing in the [Spotify Web Player](https://open.spotify.com) (title, artist, playback position)
- Fetches time-synced lyrics from [LRCLIB](https://lrclib.net), and spreads the lines over the song when only plain lyrics exist
- Adds a translation (English, French, Spanish, German or Portuguese) and a romanization of each line
- Highlights the current line and follows the song, with a ±8 s sync offset if the timing is off
- Four display modes: both, translation only, transliteration only, original only
- The panel can be dragged, resized and minimized; settings are remembered

It works for Greek, Russian, Japanese, Korean, Arabic, Hindi, Hebrew and any other language with lyrics on LRCLIB.

## How it works

```
Spotify Web Player ──► content script ──► background worker ──► overlay panel
  (page + Media Session)   track, position     LRCLIB lyrics        sync, highlight,
                                               translation +        display modes
                                               romanization
```

- **Track detection** reads the player from the page and from the browser's Media Session metadata (`media-session.js` runs in the page context and passes it on). No Spotify login is needed, so it works without Premium.
- **Lyrics** come from LRCLIB's API, matched on title, artist and duration.
- **Translation and romanization** use Google Translate's public endpoint. For Arabic and Hebrew, where that romanization is often missing, the extension falls back to its own rule-based transliteration (handling vowel marks, shadda and the lam-alif ligature).

## Install (developer mode)

1. Download or clone this repository.
2. Open `chrome://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.
4. Open [open.spotify.com](https://open.spotify.com) and play a song. The panel appears on the right.

## Repository

```
extension/    the Chrome extension (Manifest V3)
prototype/    first version: a web app using the Spotify Web API (needs Premium)
docs/         the project website (GitHub Pages)
```

## Limits

- If Spotify changes the Web Player's HTML, track detection may need new selectors.
- Lyric coverage and translation quality depend on LRCLIB and Google Translate.
- Romanization without vowel marks (Arabic, Hebrew) is approximate.
- Not published on the Chrome Web Store yet.

## Author

[Charles Montluc-Giannopoulou](https://charlesmontluc.github.io)
