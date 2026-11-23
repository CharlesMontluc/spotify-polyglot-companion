# Web-app prototype

First version of the project: a small web page that logs in with Spotify (OAuth PKCE), reads the
currently playing track through the Spotify Web API, and shows lyrics with translation and
transliteration.

It works, but Spotify's playback endpoints require a Premium account for the developer app, which
is why the project moved to a Chrome extension that reads the track straight from the Spotify Web
Player instead. See [`../extension`](../extension).

The client ID in `app.js` is a public OAuth client ID (PKCE flow, no secret).
