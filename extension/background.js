chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "polyglot:lookup-track") {
    lookupTrack(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "polyglot:translate-lines") {
    translateLines(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function lookupTrack({ title, artist, durationMs }) {
  const lyrics = await fetchLyrics(title, artist, durationMs);
  return { lyrics };
}

async function translateLines({ lines, targetLanguage }) {
  const limitedLines = lines.slice(0, 40);
  const translated = await Promise.all(
    limitedLines.map(async (line) => {
      const details = await translateLine(line.original, targetLanguage);
      return {
        ...line,
        translation: details.translation,
        transliteration: details.transliteration,
      };
    }),
  );

  return { lines: translated };
}

async function fetchLyrics(title, artist, durationMs) {
  const directQuery = new URLSearchParams({
    track_name: title,
    artist_name: artist,
  });
  let directResponse = null;
  try {
    directResponse = await fetch(`https://lrclib.net/api/get?${directQuery.toString()}`);
  } catch (error) {
    console.warn("Direct lyrics lookup failed; trying search.", error);
  }

  if (directResponse?.ok) {
    const payload = await directResponse.json();
    return parseTimedLyrics(payload.syncedLyrics || payload.plainLyrics || "", durationMs);
  }

  const searchQuery = new URLSearchParams({
    q: `${title} ${artist}`.trim(),
  });
  let searchResponse = null;
  try {
    searchResponse = await fetch(`https://lrclib.net/api/search?${searchQuery.toString()}`);
  } catch (error) {
    console.warn("Lyrics search failed.", error);
  }

  if (!searchResponse?.ok) {
    return [];
  }

  const results = await searchResponse.json();
  const bestMatch = results.find((candidate) => {
    const candidateDurationMs = Number(candidate.duration || 0) * 1000;
    return candidateDurationMs && Math.abs(candidateDurationMs - durationMs) < 5000;
  }) || results[0];

  return parseTimedLyrics(bestMatch?.syncedLyrics || bestMatch?.plainLyrics || "", durationMs);
}

function parseTimedLyrics(rawLyrics, durationMs) {
  const normalized = rawLyrics
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const hasSyncedTimestamps = normalized.some((line) => /^\[\d{2}:\d{2}(?:\.\d{2})?\]/.test(line));
  if (hasSyncedTimestamps) {
    return normalized
      .map((line) => {
        const match = line.match(/^\[(\d{2}):(\d{2})(?:\.(\d{2}))?\](.*)$/);
        if (!match) {
          return null;
        }

        return {
          timeMs: Number(match[1]) * 60000 + Number(match[2]) * 1000 + Number(match[3] || 0) * 10,
          original: match[4].trim(),
          timingMode: "synced",
        };
      })
      .filter((line) => line?.original);
  }

  const plainLines = normalized
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
    .filter(Boolean);

  if (!plainLines.length) {
    return [];
  }

  const usableDuration = durationMs > 0 ? durationMs : plainLines.length * 5000;
  const introPadding = Math.min(12000, Math.round(usableDuration * 0.08));
  const outroPadding = Math.min(18000, Math.round(usableDuration * 0.1));
  const lyricalDuration = Math.max(usableDuration - introPadding - outroPadding, plainLines.length * 1500);
  const step = lyricalDuration / Math.max(plainLines.length, 1);

  return plainLines.map((line, index) => ({
    timeMs: Math.round(introPadding + step * index),
    original: line,
    timingMode: "estimated",
  }));
}

async function translateLine(text, targetLang) {
  if (!text.trim()) {
    return { translation: "", transliteration: "" };
  }

  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", targetLang);
  url.searchParams.append("dt", "t");
  url.searchParams.append("dt", "rm");
  url.searchParams.set("q", text);

  const response = await fetch(url);
  if (!response.ok) {
    return { translation: "", transliteration: transliterateByScript(text) };
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
    transliteration: transliteration || transliterateByScript(text),
  };
}

function transliterateByScript(text) {
  if (containsArabic(text)) {
    return transliterateArabic(text);
  }
  if (containsHebrew(text)) {
    return transliterateHebrew(text);
  }
  return "";
}

function containsArabic(text) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);
}

function containsHebrew(text) {
  return /[\u0590-\u05FF]/.test(text);
}

function transliterateArabic(input) {
  // Best-effort romanization. Without harakat (vowel marks) this cannot be exact pronunciation.
  const map = new Map([
    ["ء", "2"], ["أ", "2"], ["إ", "2"], ["ؤ", "2"], ["ئ", "2"], ["ٱ", "a"],
    ["ا", "a"], ["ب", "b"], ["ت", "t"], ["ث", "th"], ["ج", "j"], ["ح", "7"],
    ["خ", "kh"], ["د", "d"], ["ذ", "dh"], ["ر", "r"], ["ز", "z"], ["س", "s"],
    ["ش", "sh"], ["ص", "s"], ["ض", "d"], ["ط", "t"], ["ظ", "z"], ["ع", "3"],
    ["غ", "gh"], ["ف", "f"], ["ق", "q"], ["ك", "k"], ["ل", "l"], ["م", "m"],
    ["ن", "n"], ["ه", "h"], ["و", "w"], ["ي", "y"], ["ة", "a"], ["ى", "a"],
    ["لا", "la"],
  ]);

  const harakat = new Map([
    ["\u064E", "a"], // fatha
    ["\u064F", "u"], // damma
    ["\u0650", "i"], // kasra
    ["\u064B", "an"], // fathatan
    ["\u064C", "un"], // dammatan
    ["\u064D", "in"], // kasratan
    ["\u0652", ""], // sukun
  ]);

  const shadda = "\u0651";
  const tatweel = "\u0640";

  let output = "";
  let lastConsonant = "";
  // Unicode canonical ordering puts a short vowel *before* the shadda (e.g. NFC text),
  // so move the shadda first: the consonant is then doubled before its vowel ("mma", not "mam").
  const text = String(input || "")
    .replace(new RegExp(tatweel, "g"), "")
    .replace(/([ً-ِْ])ّ/g, "ّ$1");

  for (let index = 0; index < text.length; index++) {
    // Handle lam-alif ligature as a pair.
    const pair = text.slice(index, index + 2);
    if (pair === "لا") {
      output += "la";
      lastConsonant = "l";
      index++;
      continue;
    }

    const char = text[index];
    if (char === shadda) {
      if (lastConsonant) {
        output += lastConsonant;
      }
      continue;
    }

    if (harakat.has(char)) {
      output += harakat.get(char);
      continue;
    }

    // Strip common non-spacing marks we don't handle explicitly.
    if (/[\u0610-\u061A\u0640\u0653-\u065F\u0670\u06D6-\u06ED]/.test(char)) {
      continue;
    }

    const mapped = map.get(char);
    if (mapped) {
      output += mapped;
      // Track last consonant for shadda doubling; ignore obvious vowels.
      lastConsonant = /^(a|i|u|an|in|un)$/.test(mapped) ? "" : mapped.slice(-1);
    } else {
      output += char;
      lastConsonant = "";
    }
  }

  return output.replace(/\s+/g, " ").trim();
}

function transliterateHebrew(input) {
  // Best-effort romanization. Without niqqud (vowel points) this cannot be exact pronunciation.
  const map = new Map([
    ["א", "'"], ["ב", "b"], ["ג", "g"], ["ד", "d"], ["ה", "h"], ["ו", "v"],
    ["ז", "z"], ["ח", "kh"], ["ט", "t"], ["י", "y"], ["כ", "kh"], ["ך", "kh"],
    ["ל", "l"], ["מ", "m"], ["ם", "m"], ["נ", "n"], ["ן", "n"], ["ס", "s"],
    ["ע", "'"], ["פ", "p"], ["ף", "p"], ["צ", "ts"], ["ץ", "ts"], ["ק", "k"],
    ["ר", "r"], ["ש", "sh"], ["ת", "t"],
  ]);

  const niqqud = new Map([
    ["\u05B0", "e"], // sheva (approx)
    ["\u05B1", "e"], // hataf segol
    ["\u05B2", "a"], // hataf patah
    ["\u05B3", "o"], // hataf qamats
    ["\u05B4", "i"], // hiriq
    ["\u05B5", "e"], // tsere
    ["\u05B6", "e"], // segol
    ["\u05B7", "a"], // patah
    ["\u05B8", "a"], // qamats
    ["\u05B9", "o"], // holam
    ["\u05BB", "u"], // qubuts
    ["\u05BC", ""], // dagesh/mappiq (ignored)
    ["\u05C1", "sh"], // shin dot
    ["\u05C2", "s"], // sin dot
  ]);

  let output = "";
  let pendingShin = false;
  let pendingSin = false;
  const text = String(input || "");

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    // Skip cantillation marks.
    if (/[\u0591-\u05AF]/.test(char)) {
      continue;
    }

    if (char === "\u05C1") {
      pendingShin = true;
      pendingSin = false;
      continue;
    }

    if (char === "\u05C2") {
      pendingSin = true;
      pendingShin = false;
      continue;
    }

    if (niqqud.has(char)) {
      const mapped = niqqud.get(char);
      if (mapped) {
        output += mapped;
      }
      continue;
    }

    if (char === "ש") {
      if (pendingSin) {
        output += "s";
      } else {
        output += "sh";
      }
      pendingShin = false;
      pendingSin = false;
      continue;
    }

    pendingShin = false;
    pendingSin = false;

    const mapped = map.get(char);
    if (mapped) {
      output += mapped;
    } else {
      output += char;
    }
  }

  return output.replace(/\s+/g, " ").trim();
}
