const storageKeys = {
  targetLanguage: "spotify_polyglot_target_language",
  displayMode: "spotify_polyglot_display_mode",
  collapsed: "spotify_polyglot_collapsed",
  syncOffsetMs: "spotify_polyglot_sync_offset_ms",
  followEnabled: "spotify_polyglot_follow_enabled",
  panelPosition: "spotify_polyglot_panel_position",
  panelSize: "spotify_polyglot_panel_size",
};

const state = {
  currentTrackKey: null,
  currentTrack: null,
  mediaSessionTrack: null,
  baseLyrics: [],
  translatedLyrics: [],
  activeTimeMs: 0,
  targetLanguage: "en",
  displayMode: "both",
  collapsed: false,
  syncOffsetMs: 0,
  timingMode: "synced",
  autoFollow: false,
  panelPosition: null,
  panelSize: null,
};

const dom = createOverlay();
window.addEventListener("spotify-polyglot:media-session", (event) => {
  try {
    const track = JSON.parse(event.detail);
    if (track?.title && track?.artist) {
      state.mediaSessionTrack = track;
    }
  } catch {
    state.mediaSessionTrack = null;
  }
});
void init().catch(reportUnhandledError);

async function init() {
  const saved = await safeStorageGet(Object.values(storageKeys));
  state.targetLanguage = saved[storageKeys.targetLanguage] || "en";
  state.displayMode = saved[storageKeys.displayMode] || "both";
  state.collapsed = Boolean(saved[storageKeys.collapsed]);
  state.syncOffsetMs = Number(saved[storageKeys.syncOffsetMs] || 0);
  state.autoFollow = Boolean(saved[storageKeys.followEnabled]);
  state.panelPosition = saved[storageKeys.panelPosition] || null;
  state.panelSize = saved[storageKeys.panelSize] || null;

  dom.targetLanguage.value = state.targetLanguage;
  dom.displayMode.value = state.displayMode;
  dom.syncOffset.value = String(state.syncOffsetMs);
  dom.syncOffsetValue.textContent = formatOffset(state.syncOffsetMs);
  dom.followToggle.checked = state.autoFollow;
  dom.panel.classList.toggle("polyglot-collapsed", state.collapsed);
  dom.root.classList.toggle("polyglot-root-collapsed", state.collapsed);
  dom.toggle.textContent = state.collapsed ? "Open" : "Minimize";
  applyPanelPosition(state.panelPosition);
  applyPanelSize(state.panelSize, state.collapsed);

  bindEvents();
  renderIdle("Open a track page or start a song in Spotify Web Player.");
  observeSpotifyPage();
  void pollTrack().catch(reportUnhandledError);
  window.setInterval(() => {
    void pollTrack().catch(reportUnhandledError);
  }, 2500);
  window.setInterval(updateProgressFromPlayer, 1000);
}

function bindEvents() {
  dom.targetLanguage.addEventListener("change", async () => {
    state.targetLanguage = dom.targetLanguage.value;
    await safeStorageSet({ [storageKeys.targetLanguage]: state.targetLanguage });
    await refreshTranslations();
  });

  dom.displayMode.addEventListener("change", async () => {
    state.displayMode = dom.displayMode.value;
    await safeStorageSet({ [storageKeys.displayMode]: state.displayMode });
    renderLyrics();
  });

  dom.syncOffset.addEventListener("input", async () => {
    state.syncOffsetMs = Number(dom.syncOffset.value);
    dom.syncOffsetValue.textContent = formatOffset(state.syncOffsetMs);
    await safeStorageSet({ [storageKeys.syncOffsetMs]: state.syncOffsetMs });
    highlightActiveLine();
  });

  dom.followToggle.addEventListener("change", async () => {
    state.autoFollow = dom.followToggle.checked;
    await safeStorageSet({ [storageKeys.followEnabled]: state.autoFollow });
    if (state.autoFollow) {
      scrollToActiveLine();
    }
  });

  dom.jumpButton.addEventListener("click", () => {
    scrollToActiveLine(true);
  });

  dom.toggle.addEventListener("click", async () => {
    state.collapsed = !state.collapsed;
    dom.panel.classList.toggle("polyglot-collapsed", state.collapsed);
    dom.root.classList.toggle("polyglot-root-collapsed", state.collapsed);
    dom.toggle.textContent = state.collapsed ? "Open" : "Minimize";
    applyPanelSize(state.panelSize, state.collapsed);
    await safeStorageSet({ [storageKeys.collapsed]: state.collapsed });
  });

  dom.compact.addEventListener("click", async () => {
    if (!state.collapsed) {
      return;
    }
    state.collapsed = false;
    dom.panel.classList.remove("polyglot-collapsed");
    dom.root.classList.remove("polyglot-root-collapsed");
    dom.toggle.textContent = "Minimize";
    applyPanelSize(state.panelSize, false);
    await safeStorageSet({ [storageKeys.collapsed]: false });
  });

  bindDrag();
  bindResize();

  // Prevent scrolling the Spotify page when the user's cursor is over our panel.
  dom.body.addEventListener(
    "wheel",
    (event) => {
      event.stopPropagation();
    },
    { passive: true },
  );
}

function observeSpotifyPage() {
  const observer = new MutationObserver(() => {
    updateProgressFromPlayer();
    void pollTrack().catch(reportUnhandledError);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

async function pollTrack() {
  const track = readTrackFromPage();
  if (!track) {
    if (!state.currentTrackKey) {
      renderIdle("Start a song in Spotify Web Player.");
    }
    return;
  }

  state.currentTrack = track;
  renderTrackSummary(track);

  if (track.key === state.currentTrackKey) {
    highlightActiveLine();
    return;
  }

  state.currentTrackKey = track.key;
  state.baseLyrics = [];
  state.translatedLyrics = [];
  renderIdle(`Looking up lyrics for ${track.title}...`);
  setStatus("Fetching lyrics...");

  const response = await safeSendMessage({
    type: "polyglot:lookup-track",
    payload: track,
  });

  if (!response?.ok) {
    setStatus(response?.error || "Lyrics lookup failed.");
    renderIdle("Lyrics request failed.");
    return;
  }

  state.baseLyrics = response.payload.lyrics || [];
  state.timingMode = state.baseLyrics[0]?.timingMode || "synced";
  if (!state.baseLyrics.length) {
    setStatus("No lyrics found");
    renderIdle("Lyrics were not found for this song.");
    return;
  }

  await refreshTranslations();
}

async function refreshTranslations() {
  if (!state.baseLyrics.length) {
    return;
  }

  setStatus("Translating lyrics...");
  const response = await safeSendMessage({
    type: "polyglot:translate-lines",
    payload: {
      lines: state.baseLyrics,
      targetLanguage: state.targetLanguage,
    },
  });

  if (!response?.ok) {
    setStatus(response?.error || "Translation failed.");
    return;
  }

  state.translatedLyrics = response.payload.lines || [];
  renderLyrics();
  setStatus(state.timingMode === "synced" ? "Lyrics ready" : "Lyrics ready, timing estimated");
}

function readTrackFromPage() {
  const mediaTrack = state.mediaSessionTrack;
  if (mediaTrack?.title && mediaTrack?.artist) {
    return {
      title: cleanText(mediaTrack.title),
      artist: cleanText(mediaTrack.artist),
      durationMs: readPlaybackDuration(),
      key: `${mediaTrack.title}__${mediaTrack.artist}`.toLowerCase(),
    };
  }

  const bottomPlayerText = findBottomPlayerTextPair();
  const titleNode = findBottomPlayerLink("/track/");
  const artistNode = findBottomPlayerLink("/artist/", titleNode);

  // Only use the physical playback strip. Spotify's recommendation cards reuse
  // similar metadata attributes and can otherwise be mistaken for the song.
  const title = bottomPlayerText?.title || cleanText(titleNode?.textContent) || "";
  const artist = bottomPlayerText?.artist || cleanText(artistNode?.textContent) || "";

  if (!title || !artist) {
    return null;
  }

  return {
    title,
    artist,
    durationMs: readPlaybackDuration(),
    key: `${title}__${artist}`.toLowerCase(),
  };
}

function readPlaybackDuration() {
  const durationNode = findVisibleTextNode([
    "[data-testid='playback-duration']",
    ".playback-bar__progress-time:last-child",
  ]);
  return parseClock(durationNode?.textContent);
}

function findVisibleTextNode(selectors) {
  for (const selector of selectors) {
    const candidate = [...document.querySelectorAll(selector)]
      .find((node) => cleanText(node.textContent) && isVisible(node));
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function findBottomPlayerLink(path, relatedNode = null) {
  const candidates = [...document.querySelectorAll(`a[href*='${path}']`)]
    .filter((node) => cleanText(node.textContent) && isVisible(node));

  if (!candidates.length) {
    return null;
  }

  const relatedRect = relatedNode?.getBoundingClientRect();
  return candidates
    .map((node) => {
      const rect = node.getBoundingClientRect();
      const inBottomPlayer = rect.top > window.innerHeight * 0.84;
      const distanceFromTrack = relatedRect ? Math.abs(rect.top - relatedRect.top) : 0;
      const score = (inBottomPlayer ? 100000 : 0) + rect.top - distanceFromTrack;
      return { node, score };
    })
    .sort((left, right) => right.score - left.score)[0]?.node || null;
}

function findBottomPlayerTextPair() {
  const maxLeft = Math.min(window.innerWidth * 0.35, 520);
  const candidates = [...document.querySelectorAll("a, span, p, div")]
    .map((node) => ({
      node,
      rect: node.getBoundingClientRect(),
      text: getDirectText(node),
    }))
    .filter(({ node, rect, text }) => isVisible(node)
      && text
      && !isClockText(text)
      && rect.left < maxLeft
      && rect.top > window.innerHeight * 0.84
      && rect.height < 70);

  let bestPair = null;
  for (const titleCandidate of candidates) {
    for (const artistCandidate of candidates) {
      const verticalGap = artistCandidate.rect.top - titleCandidate.rect.top;
      const horizontalGap = Math.abs(artistCandidate.rect.left - titleCandidate.rect.left);
      if (verticalGap < 0 || verticalGap > 55 || horizontalGap > 100) {
        continue;
      }

      const score = titleCandidate.rect.top + artistCandidate.rect.top - horizontalGap;
      if (!bestPair || score > bestPair.score) {
        bestPair = {
          title: titleCandidate.text,
          artist: artistCandidate.text,
          score,
        };
      }
    }
  }

  return bestPair;
}

function getDirectText(node) {
  return cleanText([...node.childNodes]
    .filter((child) => child.nodeType === Node.TEXT_NODE)
    .map((child) => child.textContent)
    .join(" "));
}

function isClockText(text) {
  return /^\d{1,2}:\d{2}$/.test(text);
}

function isVisible(node) {
  const rect = node.getBoundingClientRect();
  const style = window.getComputedStyle(node);
  return rect.width > 0
    && rect.height > 0
    && rect.bottom >= 0
    && rect.top <= window.innerHeight
    && style.visibility !== "hidden"
    && style.display !== "none";
}

function updateProgressFromPlayer() {
  const elapsedNode = queryFirst([
    "[data-testid='playback-position']",
    ".playback-bar__progress-time:first-child",
  ]);

  state.activeTimeMs = parseClock(elapsedNode?.textContent);
  highlightActiveLine();
}

function renderTrackSummary(track) {
  dom.trackTitle.textContent = track.title;
  dom.trackMeta.textContent = track.artist;
  dom.compact.textContent = `${track.title} · ${track.artist}`;
}

function renderIdle(message) {
  dom.body.textContent = "";
  const empty = document.createElement("div");
  empty.className = "polyglot-empty";
  empty.textContent = message;
  dom.body.append(empty);
  if (!state.currentTrack) {
    dom.compact.textContent = "Spotify Polyglot";
  }
}

function renderLyrics() {
  if (!state.translatedLyrics.length) {
    renderIdle("No translated lyrics available.");
    return;
  }

  dom.body.textContent = "";
  for (const line of state.translatedLyrics) {
    const lineEl = document.createElement("article");
    lineEl.className = "polyglot-line";
    lineEl.dataset.timeMs = String(line.timeMs);

    const original = document.createElement("p");
    original.className = "polyglot-line-original";
    original.textContent = line.original;
    lineEl.append(original);

    if (state.displayMode !== "original" && state.displayMode !== "translation") {
      const translit = document.createElement("p");
      translit.className = "polyglot-line-translit";
      translit.textContent = line.transliteration || "Transliteration unavailable";
      lineEl.append(translit);
    }

    if (state.displayMode !== "original" && state.displayMode !== "transliteration") {
      const translation = document.createElement("p");
      translation.className = "polyglot-line-translation";
      translation.textContent = line.translation || "Translation unavailable";
      lineEl.append(translation);
    }

    dom.body.append(lineEl);
  }

  highlightActiveLine();
}

function highlightActiveLine() {
  const lines = [...dom.body.querySelectorAll(".polyglot-line")];
  if (!lines.length) {
    return;
  }

  const effectiveTimeMs = Math.max(state.activeTimeMs + state.syncOffsetMs, 0);
  const firstStart = Number(lines[0]?.dataset.timeMs || 0);
  if (effectiveTimeMs < firstStart) {
    lines.forEach((line, index) => {
      line.classList.toggle("active", index === 0);
    });
    if (state.autoFollow) {
      scrollToActiveLine();
    }
    return;
  }

  let activeIndex = lines.findIndex((line, index) => {
    const start = Number(line.dataset.timeMs || 0);
    const next = Number(lines[index + 1]?.dataset.timeMs || Infinity);
    return effectiveTimeMs >= start && effectiveTimeMs < next;
  });

  if (activeIndex === -1) {
    // If we're past the last timestamp, keep the last line active.
    activeIndex = Math.max(lines.length - 1, 0);
  }

  lines.forEach((line, index) => {
    line.classList.toggle("active", index === activeIndex);
  });

  if (state.autoFollow) {
    scrollToActiveLine();
  }
}

function scrollToActiveLine(force = false) {
  const active = dom.body.querySelector(".polyglot-line.active");
  if (!active) {
    return;
  }

  active.scrollIntoView({
    block: "nearest",
    inline: "nearest",
    behavior: force ? "smooth" : "smooth",
  });
}

function setStatus(message) {
  dom.status.textContent = message;
  dom.note.textContent = state.timingMode === "synced"
    ? "Transliteration is machine-generated and can be approximate."
    : "Timing is estimated because synced lyrics were unavailable. Transliteration is machine-generated.";
}

function queryFirst(selectors) {
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    if (node) {
      return node;
    }
  }
  return null;
}

function cleanText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function parseClock(text) {
  const value = cleanText(text);
  if (!value) {
    return 0;
  }

  const parts = value.split(":").map(Number);
  if (parts.some(Number.isNaN)) {
    return 0;
  }

  if (parts.length === 2) {
    return (parts[0] * 60 + parts[1]) * 1000;
  }

  if (parts.length === 3) {
    return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  }

  return 0;
}

function formatOffset(offsetMs) {
  const sign = offsetMs > 0 ? "+" : "";
  return `${sign}${(offsetMs / 1000).toFixed(1)}s`;
}

function createOverlay() {
  const root = document.createElement("aside");
  root.id = "spotify-polyglot-root";
  root.innerHTML = `
    <section class="polyglot-panel">
      <header class="polyglot-header">
        <div>
          <p class="polyglot-kicker">Spotify Polyglot</p>
          <h2 class="polyglot-title">Understand the song</h2>
          <p class="polyglot-compact" data-role="compact-text">Spotify Polyglot</p>
        </div>
        <button class="polyglot-toggle" type="button" aria-label="Minimize polyglot panel">Minimize</button>
      </header>
      <section class="polyglot-track">
        <p class="polyglot-track-title">No track yet</p>
        <p class="polyglot-track-meta">Waiting for Spotify</p>
        <p class="polyglot-status">Waiting for track</p>
      </section>
      <section class="polyglot-controls">
        <div class="polyglot-controls-row">
          <label class="polyglot-label">
            <span>Translate to</span>
            <select class="polyglot-select" data-role="target-language">
              <option value="en">English</option>
              <option value="fr">French</option>
              <option value="es">Spanish</option>
              <option value="de">German</option>
              <option value="pt">Portuguese</option>
            </select>
          </label>
          <label class="polyglot-label">
            <span>Display</span>
            <select class="polyglot-select" data-role="display-mode">
              <option value="both">Both</option>
              <option value="translation">Translation</option>
              <option value="transliteration">Transliteration</option>
              <option value="original">Original</option>
            </select>
          </label>
        </div>
        <div class="polyglot-actions">
          <label class="polyglot-check">
            <input type="checkbox" data-role="follow-toggle" />
            <span>Follow</span>
          </label>
          <button class="polyglot-jump" type="button" data-role="jump-button">Jump to current</button>
        </div>
        <div class="polyglot-sync">
          <div class="polyglot-sync-row">
            <span>Sync offset</span>
            <span data-role="sync-offset-value">0.0s</span>
          </div>
          <input class="polyglot-range" data-role="sync-offset" type="range" min="-8000" max="8000" step="250" value="0" />
        </div>
        <p class="polyglot-note" data-role="note"></p>
      </section>
      <section class="polyglot-body"></section>
      <div class="polyglot-resizer" data-role="resizer" title="Resize"></div>
    </section>
  `;
  document.documentElement.append(root);

  return {
    root,
    panel: root.querySelector(".polyglot-panel"),
    header: root.querySelector(".polyglot-header"),
    toggle: root.querySelector(".polyglot-toggle"),
    compact: root.querySelector("[data-role='compact-text']"),
    trackTitle: root.querySelector(".polyglot-track-title"),
    trackMeta: root.querySelector(".polyglot-track-meta"),
    status: root.querySelector(".polyglot-status"),
    targetLanguage: root.querySelector("[data-role='target-language']"),
    displayMode: root.querySelector("[data-role='display-mode']"),
    syncOffset: root.querySelector("[data-role='sync-offset']"),
    syncOffsetValue: root.querySelector("[data-role='sync-offset-value']"),
    note: root.querySelector("[data-role='note']"),
    followToggle: root.querySelector("[data-role='follow-toggle']"),
    jumpButton: root.querySelector("[data-role='jump-button']"),
    body: root.querySelector(".polyglot-body"),
    resizer: root.querySelector("[data-role='resizer']"),
  };
}

function applyPanelPosition(position) {
  if (!position || typeof position !== "object") {
    return;
  }

  const left = Number(position.left);
  const top = Number(position.top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return;
  }

  dom.root.style.left = `${left}px`;
  dom.root.style.top = `${top}px`;
  dom.root.style.right = "auto";
  dom.root.style.bottom = "auto";
}

function applyPanelSize(size, collapsed) {
  if (collapsed) {
    dom.root.style.height = "auto";
    return;
  }

  if (!size || typeof size !== "object") {
    dom.root.style.removeProperty("width");
    dom.root.style.removeProperty("height");
    return;
  }

  const width = Number(size.width);
  const height = Number(size.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return;
  }

  dom.root.style.width = `${width}px`;
  dom.root.style.height = `${height}px`;
}

function bindDrag() {
  let dragging = false;
  let grabOffsetX = 0;
  let grabOffsetY = 0;

  dom.header.style.cursor = "grab";

  dom.header.addEventListener("mousedown", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.closest("button, select, input, a")) {
        return;
      }
    }

    const rect = dom.root.getBoundingClientRect();
    dragging = true;
    grabOffsetX = event.clientX - rect.left;
    grabOffsetY = event.clientY - rect.top;
    dom.header.style.cursor = "grabbing";
    event.preventDefault();
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragging) {
      return;
    }

    const margin = 8;
    const rect = dom.root.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);

    const nextLeft = clamp(event.clientX - grabOffsetX, margin, maxLeft);
    const nextTop = clamp(event.clientY - grabOffsetY, margin, maxTop);

    dom.root.style.left = `${nextLeft}px`;
    dom.root.style.top = `${nextTop}px`;
    dom.root.style.right = "auto";
    dom.root.style.bottom = "auto";
  });

  window.addEventListener("mouseup", async () => {
    if (!dragging) {
      return;
    }

    dragging = false;
    dom.header.style.cursor = "grab";

    const rect = dom.root.getBoundingClientRect();
    const nextPosition = {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
    };
    state.panelPosition = nextPosition;
    await safeStorageSet({ [storageKeys.panelPosition]: nextPosition });
  });
}

function bindResize() {
  let resizing = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;

  dom.resizer.addEventListener("mousedown", (event) => {
    if (state.collapsed) {
      return;
    }

    const rect = dom.root.getBoundingClientRect();
    resizing = true;
    startX = event.clientX;
    startY = event.clientY;
    startWidth = rect.width;
    startHeight = rect.height;
    event.preventDefault();
    event.stopPropagation();
  });

  window.addEventListener("mousemove", (event) => {
    if (!resizing) {
      return;
    }

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    const minWidth = 280;
    const maxWidth = Math.max(minWidth, window.innerWidth - 16);
    const minHeight = 220;
    const maxHeight = Math.max(minHeight, window.innerHeight - 16);

    const nextWidth = clamp(startWidth + deltaX, minWidth, maxWidth);
    const nextHeight = clamp(startHeight + deltaY, minHeight, maxHeight);

    dom.root.style.width = `${Math.round(nextWidth)}px`;
    dom.root.style.height = `${Math.round(nextHeight)}px`;
  });

  window.addEventListener("mouseup", async () => {
    if (!resizing) {
      return;
    }

    resizing = false;
    const rect = dom.root.getBoundingClientRect();
    const nextSize = {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    state.panelSize = nextSize;
    await safeStorageSet({ [storageKeys.panelSize]: nextSize });
  });

  dom.resizer.addEventListener("dblclick", async (event) => {
    if (state.collapsed) {
      return;
    }

    // Reset to CSS defaults.
    state.panelSize = null;
    dom.root.style.removeProperty("width");
    dom.root.style.removeProperty("height");
    await safeStorageRemove(storageKeys.panelSize);
    event.preventDefault();
    event.stopPropagation();
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isContextInvalidatedError(error) {
  const message = String(error?.message || error || "");
  return message.includes("Extension context invalidated");
}

function reportUnhandledError(error) {
  if (isContextInvalidatedError(error)) {
    return;
  }
  console.error(error);
}

async function safeStorageGet(keys) {
  try {
    return await chrome.storage.local.get(keys);
  } catch (error) {
    if (isContextInvalidatedError(error)) {
      return {};
    }
    throw error;
  }
}

async function safeStorageSet(payload) {
  try {
    await chrome.storage.local.set(payload);
  } catch (error) {
    if (isContextInvalidatedError(error)) {
      return;
    }
    throw error;
  }
}

async function safeStorageRemove(key) {
  try {
    await chrome.storage.local.remove(key);
  } catch (error) {
    if (isContextInvalidatedError(error)) {
      return;
    }
    throw error;
  }
}

async function safeSendMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    if (isContextInvalidatedError(error)) {
      return null;
    }
    throw error;
  }
}
