(function () {
  "use strict";

  /* -------------------------------------------------------
     Demo songs. These lines were written for this page
     (no real lyrics); the extension shows the real lyrics
     of whatever is playing on Spotify.
     ------------------------------------------------------- */
  var SONGS = [
    {
      id: "el", name: "Greek", glyph: "Ελ", title: "Λιμάνι", meta: "Demo · Greek",
      lines: [
        ["Το καλοκαίρι φεύγει αργά", "To kalokéri févgi argá", "Summer is leaving slowly"],
        ["κι εγώ μετράω τα κύματα", "ki egó metráo ta kímata", "and I count the waves"],
        ["Θα σε βρω στο ίδιο λιμάνι", "Tha se vro sto ídio limáni", "I'll find you at the same harbour"],
        ["και το φεγγάρι μένει εδώ", "ke to fengári méni edó", "and the moon stays here"]
      ]
    },
    {
      id: "ru", name: "Russian", glyph: "Ру", title: "Огни", meta: "Demo · Russian",
      lines: [
        ["Над рекой горят огни", "Nad rekoy goryat ogni", "Lights are burning over the river"],
        ["Я иду домой пешком", "Ya idu domoy peshkom", "I'm walking home"],
        ["Ночь длинна, но я не сплю", "Noch' dlinna, no ya ne splyu", "The night is long, but I'm not asleep"],
        ["И город тихо спит со мной", "I gorod tikho spit so mnoy", "And the city sleeps quietly with me"]
      ]
    },
    {
      id: "ja", name: "Japanese", glyph: "日", title: "夜の駅", meta: "Demo · Japanese",
      lines: [
        ["夜の駅で君を待つ", "Yoru no eki de kimi o matsu", "I wait for you at the station at night"],
        ["雨はまだ止まない", "Ame wa mada yamanai", "The rain still hasn't stopped"],
        ["星が少しだけ見える", "Hoshi ga sukoshi dake mieru", "I can see just a few stars"],
        ["明日また会えるかな", "Ashita mata aeru kana", "I wonder if we'll meet again tomorrow"]
      ]
    },
    {
      id: "ko", name: "Korean", glyph: "한", title: "창밖에", meta: "Demo · Korean",
      lines: [
        ["창밖에 별이 떠 있어", "Changbakke byeori tteo isseo", "There are stars outside the window"],
        ["오늘 밤은 조용해", "Oneul bameun joyonghae", "Tonight is quiet"],
        ["너의 노래를 듣고 있어", "Neoui noraereul deutgo isseo", "I'm listening to your song"],
        ["내일도 같이 걷자", "Naeildo gachi geotja", "Let's walk together tomorrow too"]
      ]
    },
    {
      id: "ar", name: "Arabic", glyph: "ع", title: "القمر", meta: "Demo · Arabic", rtl: true,
      lines: [
        ["في الليل نغني للقمر", "Fil-layl nughanni lil-qamar", "At night we sing to the moon"],
        ["والبحر يسمع صوتنا", "Wal-bahr yasma' sawtana", "And the sea hears our voice"],
        ["لا تنسَ طريق البيت", "La tansa tariq al-bayt", "Don't forget the way home"],
        ["وغداً نلتقي من جديد", "Wa ghadan naltaqi min jadid", "And tomorrow we meet again"]
      ]
    },
    {
      id: "hi", name: "Hindi", glyph: "हि", title: "बारिश", meta: "Demo · Hindi",
      lines: [
        ["बारिश की बूँदें गिर रही हैं", "Baarish ki boondein gir rahi hain", "Raindrops are falling"],
        ["चलो साथ में घर चलें", "Chalo saath mein ghar chalein", "Come, let's go home together"],
        ["ये रात कभी ख़त्म न हो", "Ye raat kabhi khatm na ho", "May this night never end"],
        ["दिल में एक नया गीत है", "Dil mein ek naya geet hai", "There's a new song in my heart"]
      ]
    }
  ];

  /* -------------------------------------------------------
     Screenshots of the extension on real songs.
     Put the images in docs/examples/ and list them here;
     the "In action" section appears once one of them loads.
     ------------------------------------------------------- */
  var GALLERY = [
    { src: "examples/1.png", caption: "" },
    { src: "examples/2.png", caption: "" },
    { src: "examples/3.png", caption: "" },
    { src: "examples/4.png", caption: "" }
  ];

  var LINE_MS = 3200;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var chipsEl = document.querySelector("[data-chips]");
  var panel = document.querySelector(".panel");
  var linesEl = document.querySelector("[data-lines]");
  var titleEl = document.querySelector("[data-track-title]");
  var metaEl = document.querySelector("[data-track-meta]");
  var modeEl = document.querySelector("[data-mode]");
  var playBtn = document.querySelector("[data-play]");
  var barEl = document.querySelector("[data-bar]");
  var timeEl = document.querySelector("[data-time]");
  var durEl = document.querySelector("[data-duration]");

  var song = SONGS[0];
  var elapsed = 0;          // ms into the current song
  var playing = !reduceMotion;
  var last = null;
  var activeIdx = -1;

  var fmt = function (ms) {
    var s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };
  var total = function () { return song.lines.length * LINE_MS; };

  var el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // language chips
  SONGS.forEach(function (s, i) {
    var b = el("button", "chip");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", i === 0 ? "true" : "false");
    var g = el("span", "glyph", s.glyph);
    g.setAttribute("aria-hidden", "true");
    b.appendChild(g);
    b.appendChild(document.createTextNode(s.name));
    b.addEventListener("click", function () { load(i); });
    chipsEl.appendChild(b);
  });

  function load(i) {
    song = SONGS[i];
    Array.prototype.forEach.call(chipsEl.children, function (c, k) {
      c.setAttribute("aria-selected", k === i ? "true" : "false");
    });
    titleEl.textContent = song.title;
    metaEl.textContent = song.meta;
    durEl.textContent = fmt(total());
    linesEl.innerHTML = "";
    song.lines.forEach(function (l, k) {
      var li = el("li", "line");
      if (song.rtl) li.setAttribute("dir", "rtl");
      var o = el("p", "l-orig", l[0]);
      var tl = el("p", "l-translit", l[1]);
      var tr = el("p", "l-trans", l[2]);
      tl.setAttribute("dir", "ltr");
      tr.setAttribute("dir", "ltr");
      li.appendChild(o); li.appendChild(tl); li.appendChild(tr);
      li.addEventListener("click", function () { seek(k * LINE_MS); });
      linesEl.appendChild(li);
    });
    activeIdx = -1;
    seek(0);
    if (!reduceMotion) setPlaying(true);
  }

  function seek(ms) {
    elapsed = ms;
    render();
  }

  function render() {
    var idx = Math.min(Math.floor(elapsed / LINE_MS), song.lines.length - 1);
    barEl.style.width = (elapsed / total() * 100) + "%";
    timeEl.textContent = fmt(elapsed);
    if (idx !== activeIdx) {
      activeIdx = idx;
      Array.prototype.forEach.call(linesEl.children, function (li, k) {
        li.classList.toggle("active", k === idx);
      });
      var active = linesEl.children[idx];
      if (active) {
        // scroll inside the panel only, never the page
        linesEl.scrollTop = Math.max(0, active.offsetTop - linesEl.offsetTop - 40);
      }
    }
  }

  function setPlaying(p) {
    playing = p;
    playBtn.classList.toggle("paused", !p);
    playBtn.setAttribute("aria-label", p ? "Pause" : "Play");
    last = null;
  }

  function tick(ts) {
    if (playing && !document.hidden) {
      if (last !== null) {
        elapsed += ts - last;
        if (elapsed >= total()) elapsed = 0; // loop the song
        render();
      }
      last = ts;
    } else {
      last = null;
    }
    requestAnimationFrame(tick);
  }

  playBtn.addEventListener("click", function () { setPlaying(!playing); });
  modeEl.addEventListener("change", function () { panel.setAttribute("data-mode", modeEl.value); });

  load(0);
  setPlaying(playing);
  requestAnimationFrame(tick);

  // gallery: build from GALLERY, reveal the section once an image loads
  var gallerySection = document.querySelector("#examples");
  var galleryEl = document.querySelector("[data-gallery]");
  if (gallerySection && galleryEl) {
    GALLERY.forEach(function (item) {
      var fig = el("figure");
      var img = new Image();
      img.alt = item.caption || "Spotify Polyglot panel on a song";
      img.loading = "lazy";
      img.onload = function () { gallerySection.hidden = false; };
      img.onerror = function () { fig.remove(); };
      img.src = item.src;
      fig.appendChild(img);
      if (item.caption) fig.appendChild(el("figcaption", null, item.caption));
      galleryEl.appendChild(fig);
    });
  }
})();
