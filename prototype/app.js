const spotifyConfig = {
  clientId: "4970ef57922c46ed8a7288656522f2c2",
  redirectUri: window.location.origin + window.location.pathname,
  scopes: [
    "user-read-currently-playing",
    "user-read-playback-state",
  ],
};

const storageKeys = {
  verifier: "spotify_polyglot_verifier",
  token: "spotify_polyglot_token",
  expiry: "spotify_polyglot_expiry",
  mode: "spotify_polyglot_mode",
  targetLanguage: "spotify_polyglot_target_language",
};

const state = {
  accessToken: localStorage.getItem(storageKeys.token),
  expiresAt: Number(localStorage.getItem(storageKeys.expiry) || 0),
  currentTrackId: null,
  baseLyrics: [],
  lyrics: [],
  pollingId: null,
};

const loginButton = document.querySelector("#loginButton");
const logoutButton = document.querySelector("#logoutButton");
const connectionBadge = document.querySelector("#connectionBadge");
const trackState = document.querySelector("#trackState");
const lyricsContainer = document.querySelector("#lyricsContainer");
const lyricsStatus = document.querySelector("#lyricsStatus");
const targetLanguage = document.querySelector("#targetLanguage");
const displayMode = document.querySelector("#displayMode");
const trackTemplate = document.querySelector("#trackTemplate");
const lyricLineTemplate = document.querySelector("#lyricLineTemplate");

targetLanguage.value = localStorage.getItem(storageKeys.targetLanguage) || "en";
displayMode.value = localStorage.getItem(storageKeys.mode) || "both";

loginButton.addEventListener("click", handleLogin);
logoutButton.addEventListener("click", handleLogout);
targetLanguage.addEventListener("change", handleLanguageChange);
displayMode.addEventListener("change", rerenderLyrics);

init();

async function init() {
  await maybeHandleRedirect();
  refreshAuthUI();

  if (isTokenValid()) {
    startPolling();
  }
}

async function maybeHandleRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) {
    return;
  }

  if (!spotifyConfig.clientId) {
    setLyricsStatus("Set your Spotify client ID in app.js before logging in.");
    window.history.replaceState({}, "", spotifyConfig.redirectUri);
    return;
  }

  const verifier = localStorage.getItem(storageKeys.verifier);
  if (!verifier) {
    setLyricsStatus("Missing PKCE verifier. Retry login.");
    window.history.replaceState({}, "", spotifyConfig.redirectUri);
    return;
  }

  try {
    const payload = new URLSearchParams({
      client_id: spotifyConfig.clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: spotifyConfig.redirectUri,
      code_verifier: verifier,
    });

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });

    if (!response.ok) {
      throw new Error("Spotify token exchange failed.");
    }

    const tokenData = await response.json();
    state.accessToken = tokenData.access_token;
    state.expiresAt = Date.now() + tokenData.expires_in * 1000;
    localStorage.setItem(storageKeys.token, state.accessToken);
    localStorage.setItem(storageKeys.expiry, String(state.expiresAt));
  } catch (error) {
    console.error(error);
    setLyricsStatus("Spotify login failed.");
  } finally {
    localStorage.removeItem(storageKeys.verifier);
    window.history.replaceState({}, "", spotifyConfig.redirectUri);
  }
}

async function handleLogin() {
  if (!spotifyConfig.clientId) {
    setLyricsStatus("Add your Spotify client ID in app.js first.");
    return;
  }

  const verifier = generateRandomString(64);
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem(storageKeys.verifier, verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: spotifyConfig.clientId,
    scope: spotifyConfig.scopes.join(" "),
    code_challenge_method: "S256",
    code_challenge: challenge,
    redirect_uri: spotifyConfig.redirectUri,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function handleLogout() {
  stopPolling();
  state.accessToken = null;
  state.expiresAt = 0;
  state.currentTrackId = null;
  state.baseLyrics = [];
  state.lyrics = [];
  localStorage.removeItem(storageKeys.token);
  localStorage.removeItem(storageKeys.expiry);
  refreshAuthUI();
  renderTrack(null);
  renderEmptyLyrics("Disconnected.");
}

function refreshAuthUI() {
  const connected = isTokenValid();
  connectionBadge.textContent = connected ? "Connected" : "Disconnected";
  connectionBadge.classList.toggle("connected", connected);
  loginButton.hidden = connected;
  logoutButton.hidden = !connected;
}

function isTokenValid() {
  return Boolean(state.accessToken) && Date.now() < state.expiresAt;
}

function startPolling() {
  stopPolling();
  pollCurrentTrack();
  state.pollingId = window.setInterval(pollCurrentTrack, 5000);
}

function stopPolling() {
  if (state.pollingId) {
    window.clearInterval(state.pollingId);
    state.pollingId = null;
  }
}

async function pollCurrentTrack() {
  if (!isTokenValid()) {
    refreshAuthUI();
    return;
  }

  try {
    const response = await fetch("https://api.spotify.com/v1/me/player", {
      headers: {
        Authorization: `Bearer ${state.accessToken}`,
      },
    });

    if (response.status === 204) {
      renderTrack(null);
      renderEmptyLyrics("Nothing is playing right now.");
      return;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch current track (${response.status}): ${errorText}`);
    }

    const payload = await response.json();
    if (!payload?.item) {
      renderTrack(null);
      renderEmptyLyrics("No active Spotify track found.");
      setLyricsStatus("Open Spotify and start a song");
      return;
    }

    renderTrack(payload);

    const trackId = payload?.item?.id;
    if (trackId && trackId !== state.currentTrackId) {
      state.currentTrackId = trackId;
      await loadLyricsForTrack(payload.item);
    } else if (trackId) {
      highlightActiveLyric(payload.progress_ms);
    }
  } catch (error) {
    console.error(error);
    setLyricsStatus(error.message || "Spotify playback lookup failed.");
  }
}

function renderTrack(payload) {
  if (!payload?.item) {
    trackState.className = "track-empty";
    trackState.textContent = "Start playback in Spotify, then connect this app.";
    return;
  }

  const fragment = trackTemplate.content.cloneNode(true);
  const track = payload.item;
  const image = track.album.images?.[0]?.url || "";
  const progress = Math.min((payload.progress_ms / track.duration_ms) * 100, 100);

  fragment.querySelector(".album-art").src = image;
  fragment.querySelector(".album-art").alt = `${track.name} cover art`;
  fragment.querySelector(".track-title").textContent = track.name;
  fragment.querySelector(".track-artist").textContent = track.artists.map((artist) => artist.name).join(", ");
  fragment.querySelector(".track-album").textContent = track.album.name;
  fragment.querySelector(".progress-current").textContent = formatTime(payload.progress_ms);
  fragment.querySelector(".progress-total").textContent = formatTime(track.duration_ms);
  fragment.querySelector(".progress-fill").style.width = `${progress}%`;

  trackState.className = "";
  trackState.textContent = "";
  trackState.appendChild(fragment);
}

async function loadLyricsForTrack(track) {
  setLyricsStatus("Fetching lyrics...");
  renderEmptyLyrics("Searching for lyrics...");

  const artist = track.artists?.[0]?.name || "";
  const title = track.name || "";

  try {
    const lyrics = await fetchLyrics(title, artist, track.duration_ms);
    if (!lyrics.length) {
      state.baseLyrics = [];
      state.lyrics = [];
      renderEmptyLyrics("Lyrics not found for this track.");
      setLyricsStatus("No lyrics found");
      return;
    }

    state.baseLyrics = lyrics;
    state.lyrics = await enrichLyrics(state.baseLyrics, targetLanguage.value);
    rerenderLyrics();
    setLyricsStatus("Lyrics ready");
  } catch (error) {
    console.error(error);
    state.baseLyrics = [];
    state.lyrics = [];
    renderEmptyLyrics("Lyrics lookup failed.");
    setLyricsStatus("Lyrics request failed");
  }
}

async function fetchLyrics(title, artist, durationMs) {
  const query = new URLSearchParams({
    track_name: title,
    artist_name: artist,
  });
  const response = await fetch(`https://lrclib.net/api/get?${query.toString()}`);

  if (response.ok) {
    const payload = await response.json();
    return parseTimedLyrics(payload.syncedLyrics || payload.plainLyrics || "");
  }

  const searchQuery = new URLSearchParams({
    q: `${title} ${artist}`.trim(),
  });
  const searchResponse = await fetch(`https://lrclib.net/api/search?${searchQuery.toString()}`);
  if (!searchResponse.ok) {
    throw new Error("Lyrics lookup failed.");
  }

  const results = await searchResponse.json();
  const bestMatch = results.find((candidate) => {
    const durationDifference = Math.abs((candidate.duration ?? durationMs / 1000) * 1000 - durationMs);
    return durationDifference < 5000;
  }) || results[0];

  return parseTimedLyrics(bestMatch?.syncedLyrics || bestMatch?.plainLyrics || "");
}

function parseTimedLyrics(rawLyrics) {
  const lines = rawLyrics
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const timedLines = lines
    .map((line, index) => {
      const match = line.match(/^\[(\d{2}):(\d{2})(?:\.(\d{2}))?\](.*)$/);
      if (!match) {
        return {
          timeMs: index * 4000,
          original: line,
        };
      }

      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const hundredths = Number(match[3] || 0);
      return {
        timeMs: minutes * 60000 + seconds * 1000 + hundredths * 10,
        original: match[4].trim(),
      };
    })
    .filter((line) => line.original);

  return timedLines;
}

async function enrichLyrics(lines, targetLang) {
  const limitedLines = lines.slice(0, 40);
  return Promise.all(
    limitedLines.map(async (line) => {
      const details = await translateLine(line.original, targetLang);
      return {
        ...line,
        translation: details.translation,
        transliteration: details.transliteration,
      };
    }),
  );
}

async function translateLine(text, targetLang) {
  if (!text.trim()) {
    return { translation: "", transliteration: "" };
  }

  try {
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", "auto");
    url.searchParams.set("tl", targetLang);
    url.searchParams.append("dt", "t");
    url.searchParams.append("dt", "rm");
    url.searchParams.set("q", text);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Translation endpoint failed.");
    }

    const payload = await response.json();
    const translation = Array.isArray(payload?.[0])
      ? payload[0].map((entry) => entry?.[0] || "").join("")
      : "";
    const transliteration = Array.isArray(payload?.[0])
      ? payload[0].map((entry) => entry?.[3] || "").join(" ").trim()
      : "";

    return {
      translation,
      transliteration: transliteration || "",
    };
  } catch (error) {
    console.error(error);
    return {
      translation: "",
      transliteration: "",
    };
  }
}

function rerenderLyrics() {
  localStorage.setItem(storageKeys.mode, displayMode.value);
  localStorage.setItem(storageKeys.targetLanguage, targetLanguage.value);

  if (!state.lyrics.length) {
    return;
  }

  lyricsContainer.textContent = "";
  lyricsContainer.className = "";
  for (const line of state.lyrics) {
    const fragment = lyricLineTemplate.content.cloneNode(true);
    const article = fragment.querySelector(".lyric-line");
    const original = fragment.querySelector(".line-original");
    const transliteration = fragment.querySelector(".line-transliteration");
    const translation = fragment.querySelector(".line-translation");

    original.textContent = line.original;
    transliteration.textContent = line.transliteration || "Transliteration unavailable";
    translation.textContent = line.translation || "Translation unavailable";

    const mode = displayMode.value;
    transliteration.hidden = mode === "translation" || mode === "original";
    translation.hidden = mode === "transliteration" || mode === "original";
    original.hidden = false;

    article.dataset.timeMs = String(line.timeMs);
    lyricsContainer.appendChild(fragment);
  }
}

async function handleLanguageChange() {
  localStorage.setItem(storageKeys.targetLanguage, targetLanguage.value);

  if (!state.baseLyrics.length) {
    return;
  }

  try {
    setLyricsStatus("Updating translation...");
    state.lyrics = await enrichLyrics(state.baseLyrics, targetLanguage.value);
    rerenderLyrics();
    setLyricsStatus("Lyrics ready");
  } catch (error) {
    console.error(error);
    setLyricsStatus("Translation refresh failed");
  }
}

function renderEmptyLyrics(message) {
  lyricsContainer.className = "lyrics-empty";
  lyricsContainer.textContent = message;
}

function highlightActiveLyric(progressMs) {
  if (!state.lyrics.length) {
    return;
  }

  if (lyricsContainer.classList.contains("lyrics-empty")) {
    rerenderLyrics();
  }

  lyricsContainer.className = "";
  const lines = [...lyricsContainer.querySelectorAll(".lyric-line")];
  let activeIndex = lines.findIndex((line, index) => {
    const start = Number(line.dataset.timeMs || 0);
    const next = Number(lines[index + 1]?.dataset.timeMs || Infinity);
    return progressMs >= start && progressMs < next;
  });

  if (activeIndex === -1) {
    activeIndex = lines.length - 1;
  }

  lines.forEach((line, index) => {
    line.classList.toggle("active", index === activeIndex);
  });

  lines[activeIndex]?.scrollIntoView({
    block: "nearest",
    behavior: "smooth",
  });
}

function setLyricsStatus(message) {
  lyricsStatus.textContent = message;
}

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function generateRandomString(length) {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((value) => possible[value % possible.length])
    .join("");
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
