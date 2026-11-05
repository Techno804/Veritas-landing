// Veritas — sito v2. Nessuna dipendenza esterna.
(() => {
  "use strict";

  // ================================================================ Config
  const base = window.VERITAS_CONFIG || {};
  const params = new URLSearchParams(window.location.search);
  const config = {
    apiBaseUrl: resolveApiBaseUrl(params.get("api"), base.apiBaseUrl),
    requestTimeoutMs: base.requestTimeoutMs || 60000,
    defaultK: base.defaultK || 3,
    maxClaimChars: base.maxClaimChars || 300,
    newsletterAction: base.newsletterAction || "",
    contactEmail: base.contactEmail || "",
    linkedinUrl: base.linkedinUrl || "",
  };
  const isLive = config.apiBaseUrl !== "";
  const mocks = Array.isArray(window.VERITAS_MOCKS) ? window.VERITAS_MOCKS : [];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ?api= è accettato solo verso localhost: un link condiviso non deve poter
  // far mostrare verdetti di un server qualsiasi con il marchio Veritas.
  function resolveApiBaseUrl(fromUrl, fromConfig) {
    const clean = (value) => (value || "").trim().replace(/\/+$/, "");
    if (fromUrl) {
      try {
        if (["localhost", "127.0.0.1"].includes(new URL(fromUrl).hostname)) return clean(fromUrl);
      } catch (_) {
        /* URL non valido */
      }
      console.warn("[Veritas] Parametro ?api= ignorato: ammesso solo localhost.");
    }
    return clean(fromConfig);
  }

  // ================================================================ Utilità
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "text") el.textContent = value;
      else if (key === "icon") el.innerHTML = value; // solo icone statiche definite qui sotto
      else if (key === "style") {
        for (const [prop, val] of Object.entries(value)) {
          if (prop.startsWith("--")) el.style.setProperty(prop, val);
          else el.style[prop] = val;
        }
      } else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) {
      if (child !== null && child !== undefined && child !== false) el.append(child);
    }
    return el;
  }

  const ICONS = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
    question: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.2 9a3 3 0 1 1 4.3 2.7c-.9.4-1.5 1.2-1.5 2.2v.4"/><path d="M12 18h.01"/></svg>',
    lens: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
    external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    bubble: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18.5V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8.5z"/></svg>',
  };

  const LABEL_NEI = "NOT ENOUGH INFO";
  // Stesse parole in tutto il sito: Verificato / Smentito / Non verificato.
  const VERDICTS = {
    SUPPORTS: { css: "supports", post: "Verificato", claim: "Verificata", icon: ICONS.check },
    REFUTES: { css: "refutes", post: "Smentito", claim: "Smentita", icon: ICONS.cross },
    [LABEL_NEI]: { css: "nei", post: "Non verificato", claim: "Non verificata", icon: ICONS.question },
  };
  // Le motivazioni arrivano in inglese da fact_checker.py.
  const REASONS = {
    "Self-referential personal claims are not reliably verifiable in the corpus":
      "Le affermazioni personali (come «My name is…») non si possono verificare con le fonti.",
    "No evidence was retrieved": "Non abbiamo trovato nessuna frase pertinente nelle fonti.",
    "Retrieved passages did not contain enough relevant context for the claim":
      "Le frasi trovate non parlano abbastanza da vicino di questo argomento.",
    "Strong evidence supports both labels": "Ci sono prove forti sia a favore sia contro: serve una verifica umana.",
    "No sentence provided sufficiently strong directional evidence":
      "Nessuna frase trovata è abbastanza netta da confermare o smentire.",
  };

  const percent = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 0 });
  const fmtPct = (value) => percent.format(Math.min(1, Math.max(0, Number(value) || 0)));

  // Il corpus FEVER è tokenizzato: "-LRB-" al posto di "(", spazi prima della punteggiatura…
  function cleanFeverText(text) {
    return String(text)
      .replace(/-LRB-/g, "(").replace(/-RRB-/g, ")")
      .replace(/-LSB-/g, "[").replace(/-RSB-/g, "]")
      .replace(/-LCB-/g, "{").replace(/-RCB-/g, "}")
      .replace(/-COLON-/g, ":")
      .replace(/``\s*/g, "“").replace(/\s*''/g, "”")
      .replace(/([(\[{])\s+/g, "$1").replace(/\s+([)\]}])/g, "$1")
      .replace(/\s+([,.;:!?%])/g, "$1")
      .replace(/\s+('s|'re|'ve|'ll|'d|'m|n't)\b/gi, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // Ogni frase inizia con il titolo della pagina Wikipedia: "[Paris] Paris is…"
  function parseEvidence(raw) {
    const match = /^\[([^\]]+)\]\s*/.exec(String(raw));
    const title = match ? cleanFeverText(match[1]) : null;
    const body = cleanFeverText(match ? String(raw).slice(match[0].length) : raw);
    const url = title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}` : null;
    return { title, body, url };
  }

  const normalizeClaim = (text) => String(text).toLowerCase().replace(/\s+/g, " ").replace(/[.!?\s]+$/, "").trim();

  const NON_ENGLISH = /\b(il|lo|gli|della|delle|dello|degli|dei|che|non|sono|nel|nella|una|perché|anche|più|questo|questa|el|los|las|del|por|está|es)\b/gi;
  const looksNonEnglish = (text) => (text.match(NON_ENGLISH) || []).length + (/[àèéìòù]/i.test(text) ? 1 : 0) >= 2;

  function isValidResult(data) {
    return (
      data && typeof data === "object" && typeof data.claim === "string" &&
      Object.prototype.hasOwnProperty.call(VERDICTS, data.predicted_label) &&
      typeof data.confidence === "number" && Array.isArray(data.evidence_used) && Array.isArray(data.evidence_scores)
    );
  }

  class CheckError extends Error {
    constructor(kind, message, detail) {
      super(message || kind);
      this.kind = kind; // network | timeout | invalid | server | demo
      this.userMessage = message || null;
      this.detail = detail;
    }
  }

  let toastTimer = null;
  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2400);
  }

  // ================================================================ Dati (API o demo)
  async function fetchCheck(claim) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    let response;
    try {
      response = await fetch(`${config.apiBaseUrl}/api/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim, k: config.defaultK }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new CheckError(error.name === "AbortError" ? "timeout" : "network", null, error);
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      /* risposta non JSON */
    }
    if (!response.ok) {
      const kind = response.status >= 500 ? "server" : "invalid";
      throw new CheckError(kind, kind === "invalid" ? data?.error?.message : null, data);
    }
    if (!isValidResult(data)) throw new CheckError("server", null, data);
    return data;
  }

  // ================================================================ Navbar
  function initNav() {
    const nav = $("#nav");
    const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    // Evidenzia la sezione visibile
    const links = $$(".nav-links a");
    const byId = new Map(links.map((link) => [link.getAttribute("href").slice(1), link]));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link) => link.classList.remove("is-active"));
          byId.get(entry.target.id)?.classList.add("is-active");
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    byId.forEach((_, id) => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });

    // Menu mobile
    const button = $("#menu-btn");
    const menu = $("#mobile-menu");
    const setOpen = (open) => {
      button.setAttribute("aria-expanded", String(open));
      $(".menu-btn-label", button).textContent = open ? "Chiudi" : "Menu";
      menu.hidden = !open;
      document.body.style.overflow = open ? "hidden" : "";
      if (open) $("a", menu)?.focus();
    };
    button.addEventListener("click", () => setOpen(menu.hidden));
    menu.addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !menu.hidden) {
        setOpen(false);
        button.focus();
      }
    });
    window.matchMedia("(min-width: 961px)").addEventListener("change", (event) => {
      if (event.matches) setOpen(false);
    });
  }

  // ================================================================ Hero: verifica dal vivo
  const HERO_EXAMPLES = [
    { before: "La Torre Eiffel si trova a ", target: "Berlino", after: ".", verdict: "REFUTES", fix: "Parigi", source: "Wikipedia: Eiffel Tower" },
    { before: "La Terra gira ", target: "intorno al Sole", after: ".", verdict: "SUPPORTS", source: "Wikipedia: Earth's orbit" },
    { before: "Einstein, in segreto, ", target: "odiava il caffè", after: ".", verdict: LABEL_NEI, source: null },
  ];

  function initHero() {
    if (reduceMotion) return; // resta l'esempio statico già presente nell'HTML
    const claim = $("#live-claim");
    const verdictRow = $("#live-verdict");
    const hero = $("#top");
    let heroVisible = true;
    let wake = null;
    const isActive = () => heroVisible && !document.hidden;
    const whenActive = () => (isActive() ? Promise.resolve() : new Promise((resolve) => (wake = resolve)));
    const poke = () => {
      if (isActive() && wake) {
        wake();
        wake = null;
      }
    };
    new IntersectionObserver(([entry]) => {
      heroVisible = entry.isIntersecting;
      poke();
    }).observe(hero);
    document.addEventListener("visibilitychange", poke);

    async function type(span, text) {
      for (const char of text) {
        span.textContent += char;
        await sleep(char === " " ? 20 : 34);
      }
    }

    async function play(example) {
      const verdict = VERDICTS[example.verdict];
      const parts = {
        before: h("span", { class: "lc-before" }),
        target: h("span", { class: "lc-target" }),
        fix: h("span", { class: "lc-fix" }),
        after: h("span", { class: "lc-after" }),
        ref: h("sup", { class: "lc-ref" }),
      };
      const caret = h("span", { class: "caret" });
      claim.classList.remove("is-fading");
      claim.replaceChildren(parts.before, parts.target, parts.fix, parts.after, parts.ref, caret);
      verdictRow.classList.remove("is-visible");

      await type(parts.before, example.before);
      await type(parts.target, example.target);
      await type(parts.after, example.after);
      await sleep(450);
      caret.remove();
      parts.target.classList.add("is-marked");
      await sleep(800);
      parts.target.classList.add(`is-${verdict.css}`);
      if (example.fix) {
        await sleep(350);
        parts.fix.textContent = example.fix;
        parts.fix.classList.add("is-visible");
      }
      if (example.source) {
        parts.ref.textContent = "1";
        parts.ref.classList.add("is-visible");
      }
      verdictRow.replaceChildren(
        h("span", { class: `chip chip-${verdict.css}` }, h("span", { icon: verdict.icon, "aria-hidden": "true" }), verdict.claim),
        example.source
          ? h("span", { class: "live-source" }, h("sup", { text: "1" }), ` ${example.source}`)
          : h("span", { class: "live-source", text: "Nessuna fonte abbastanza netta." })
      );
      $$("svg", verdictRow).forEach((svg) => svg.parentElement.replaceWith(svg));
      await sleep(200);
      verdictRow.classList.add("is-visible");
      await sleep(3400);
      claim.classList.add("is-fading");
      verdictRow.classList.remove("is-visible");
      await sleep(500);
    }

    (async () => {
      await sleep(600);
      let index = 0;
      for (;;) {
        await whenActive();
        await play(HERO_EXAMPLES[index]);
        index = (index + 1) % HERO_EXAMPLES.length;
      }
    })();
  }

  // ================================================================ Numeri che contano
  function initCounters() {
    const items = $$("[data-count]");
    if (reduceMotion || !("IntersectionObserver" in window)) return;
    const format = (el, value) => {
      const decimals = Number(el.dataset.decimals || 0);
      const number = new Intl.NumberFormat("it-IT", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
      el.textContent = `${number}${el.dataset.suffix || ""}`;
    };
    items.forEach((el) => format(el, 0));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          const el = entry.target;
          const target = Number(el.dataset.count);
          const start = performance.now();
          const duration = 1400;
          const step = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            format(el, target * eased);
            if (t < 1) requestAnimationFrame(step);
            else format(el, target);
          };
          requestAnimationFrame(step);
        });
      },
      { threshold: 0.6 }
    );
    items.forEach((el) => observer.observe(el));
  }

  // ================================================================ Telefono
  // Post del feed. In modalità demo compaiono solo quelli con una risposta registrata in
  // mock-data.js; con il modello collegato compaiono tutti e vengono verificati dal vivo.
  // Per registrare risposte vere per tutti: backend/genera_demo.py
  const POSTS = [
    {
      id: "earth", name: "Elena Ferri", handle: "@elena.astro", time: "2 h", initials: "EF", color: "#2dd4bf",
      text: "Ripasso per i miei studenti: è la Terra a girare intorno al Sole, non il contrario.",
      paper: { meta: "Articolo divulgativo, astronomia", title: "Il modello eliocentrico, spiegato semplice" },
      comments: "41", claim: "The Earth revolves around the Sun.",
    },
    {
      id: "sun", name: "Il Bar della Scienza", handle: "@barscienza", time: "3 h", initials: "BS", color: "#fca5a5",
      text: "Svegliatevi: è il Sole che gira intorno alla Terra. Ce lo nascondono da secoli!",
      comments: "1,8k", claim: "The Sun revolves around the Earth.",
    },
    {
      id: "penicillin", name: "Storia della Medicina", handle: "@storia.medicina", time: "6 h", initials: "SM", color: "#93c5fd",
      text: "1928, Londra: Alexander Fleming scopre la penicillina. Da qui nascono gli antibiotici.",
      paper: { meta: "Articolo divulgativo, medicina", title: "Come una muffa ha cambiato la medicina" },
      comments: "126", claim: "Penicillin was discovered by Alexander Fleming.",
    },
    {
      id: "einstein", name: "Curiosità Geniali", handle: "@curiosita.geniali", time: "8 h", initials: "CG", color: "#c4b5fd",
      text: "Lo sapevi? Einstein in segreto odiava il caffè. Ecco perché lavorava solo di notte…",
      comments: "1,2k", claim: "Albert Einstein secretly disliked the taste of coffee.",
    },
    {
      id: "curie", name: "Donne nella Scienza", handle: "@donnenellascienza", time: "1 g", initials: "DS", color: "#f6d39a",
      text: "Marie Curie ha vinto due premi Nobel: per la fisica nel 1903 e per la chimica nel 1911.",
      comments: "402", claim: "Marie Curie won two Nobel Prizes.",
    },
    {
      id: "eiffel", name: "Quiz Lampo", handle: "@quizlampo", time: "2 g", initials: "QL", color: "#a7f3d0",
      text: "Domanda lampo: la Torre Eiffel si trova a Berlino. Vero o falso? 👇",
      comments: "207", claim: "The Eiffel Tower is located in Berlin.",
    },
  ];

  const DOC_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>';

  // Affidabilità = quanto la frase più forte trovata SOSTIENE il post (probabilità SUPPORTS del modello).
  // Verificato → alta, smentito → bassa. Se il modello non dà un verdetto non la mostriamo.
  // Non è una probabilità calibrata: è il punteggio del modello.
  function reliability(result) {
    if (result.predicted_label === LABEL_NEI) return null;
    if (result.predicted_label === "SUPPORTS") return Math.min(1, Math.max(0, result.confidence));
    const supports = result.evidence_scores.map((row) => Number(row.SUPPORTS) || 0);
    return supports.length ? Math.max(...supports) : Math.max(0, 1 - result.confidence);
  }

  function initPhone() {
    const feed = $("#feed");
    const sheet = $("#sheet");
    const sheetBody = $("#sheet-body");
    const scrim = $("#sheet-scrim");
    const screen = $("#phone-screen");
    const stage = $("#phone-stage");
    const results = new Map(); // claim normalizzato -> risultato
    const mockClaims = new Set(mocks.map((mock) => normalizeClaim(mock.claim)));
    const posts = isLive ? POSTS : POSTS.filter((post) => mockClaims.has(normalizeClaim(post.claim)));
    let lastTrigger = null;
    let requestId = 0;
    let loadingTimer = null;

    // ---------------------------------------------------------- Modalità
    $("#app-mode").textContent = isLive ? "Live" : "Demo";
    $("#app-mode").classList.toggle("is-live", isLive);
    $("#own-demo").hidden = isLive;
    $("#phone-caption").textContent = isLive
      ? "Collegato al modello di Veritas."
      : "Modalità demo: verdetti registrati dal nostro modello.";

    const clock = $("#phone-clock");
    const tick = () => (clock.textContent = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }));
    tick();
    setInterval(tick, 20000);

    // ---------------------------------------------------------- Feed
    const badges = new Map(); // post.id -> pulsante del bollino
    feed.replaceChildren(...posts.map(renderPost));

    function renderPost(post) {
      const badge = h("button", { class: "badge is-pending", type: "button", disabled: true }, h("span", { class: "badge-spin", "aria-hidden": "true" }), "Verifica…");
      const score = h("span", { class: "rel" }, h("span", { class: "rel-label", text: "Affidabilità" }), h("strong", { class: "rel-value", text: "…" }));
      badges.set(post.id, { badge, score });
      badge.addEventListener("click", () => openPost(post));
      return h(
        "li",
        { class: "post", "data-post": post.id },
        h(
          "div",
          { class: "post-head" },
          h("span", { class: "avatar", style: { "--avatar": post.color }, "aria-hidden": "true", text: post.initials }),
          h("div", { class: "post-who" }, h("strong", { text: post.name }), h("span", { text: `${post.handle}, ${post.time}` }))
        ),
        h("p", { class: "post-text", text: post.text }),
        post.paper
          ? h(
              "div",
              { class: "paper" },
              h("span", { class: "paper-icon", icon: DOC_ICON }),
              h("span", { class: "paper-body" }, h("span", { class: "paper-meta", text: post.paper.meta }), h("strong", { text: post.paper.title }))
            )
          : null,
        h(
          "div",
          { class: "post-foot" },
          h("span", { class: "meta" }, h("span", { icon: ICONS.bubble, style: { display: "contents" } }), h("span", { class: "sr-only", text: "Commenti:" }), post.comments),
          score,
          badge
        )
      );
    }

    function showPostResult(post, result) {
      const { badge, score } = badges.get(post.id);
      const verdict = VERDICTS[result.predicted_label];
      const value = reliability(result);
      const hinted = badge.classList.contains("is-hinted");
      badge.disabled = false;
      badge.className = `badge badge-${verdict.css}${hinted ? " is-hinted" : ""}`;
      badge.setAttribute("aria-label", `${verdict.post}: apri fonte e affidabilità del post di ${post.name}`);
      badge.replaceChildren(h("span", { icon: verdict.icon, style: { display: "contents" } }), verdict.post);
      $(".rel-value", score).textContent = value === null ? "n.d." : fmtPct(value);
      score.className = `rel rel-${verdict.css}`;
      score.title = value === null ? "Nessuna fonte abbastanza netta per calcolarla" : "Quanto la fonte più forte sostiene il post";
    }

    function showPostError(post) {
      const { badge, score } = badges.get(post.id);
      const hinted = badge.classList.contains("is-hinted");
      badge.disabled = false;
      badge.className = `badge badge-error${hinted ? " is-hinted" : ""}`;
      badge.textContent = "Riprova";
      badge.setAttribute("aria-label", `Verifica non riuscita: riprova il post di ${post.name}`);
      $(".rel-value", score).textContent = "n.d.";
    }

    async function verifyFeed() {
      for (const post of posts) {
        try {
          const result = await getResult(post.claim, isLive ? 0 : 350);
          showPostResult(post, result);
        } catch (error) {
          console.error("[Veritas] Verifica del post non riuscita:", post.id, error.kind || error);
          showPostError(post);
        }
      }
      placeGuide();
    }

    async function getResult(claim, demoDelay = 1100) {
      const key = normalizeClaim(claim);
      if (results.has(key)) return results.get(key);
      let result;
      if (isLive) result = await fetchCheck(claim);
      else {
        if (!reduceMotion) await sleep(demoDelay);
        const found = mocks.find((mock) => normalizeClaim(mock.claim) === key);
        if (!found) throw new CheckError("demo");
        result = JSON.parse(JSON.stringify(found));
      }
      results.set(key, result);
      return result;
    }

    // I post si verificano quando il telefono entra in vista (si vede il "Verifica…").
    new IntersectionObserver((entries, observer) => {
      if (!entries[0].isIntersecting) return;
      observer.disconnect();
      verifyFeed();
    }, { threshold: 0.25 }).observe(screen);

    // ---------------------------------------------------------- Schede
    const tabs = $$(".tab");
    function selectTab(tab) {
      tabs.forEach((other) => {
        const selected = other === tab;
        other.setAttribute("aria-selected", String(selected));
        other.tabIndex = selected ? 0 : -1;
        document.getElementById(other.getAttribute("aria-controls")).hidden = !selected;
      });
      $("#app-title").textContent = tab.dataset.view === "feed" ? "Feed" : "Verifica tu";
      if (tab.dataset.view === "check") setGuide(3);
      placeGuide();
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => selectTab(tab));
      tab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        selectTab(next);
        next.focus();
      });
    });

    // ---------------------------------------------------------- Verifica tu
    const ownForm = $("#own-check");
    const ownInput = $("#own-claim");
    const ownHint = $("#own-hint");
    ownInput.maxLength = config.maxClaimChars;
    ownInput.addEventListener("input", () => (ownHint.hidden = !looksNonEnglish(ownInput.value)));
    ownInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        ownForm.requestSubmit();
      }
    });
    ownForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const claim = ownInput.value.trim();
      if (!claim) return ownInput.focus();
      verifyOwn(claim, $("button[type=submit]", ownForm));
    });
    const examples = mocks.filter((mock) => !posts.some((post) => normalizeClaim(post.claim) === normalizeClaim(mock.claim)));
    $("#own-examples").replaceChildren(
      ...(examples.length ? examples : mocks).slice(0, 3).map((mock) =>
        h("button", {
          type: "button",
          text: mock.claim,
          onclick: (event) => {
            ownInput.value = mock.claim;
            ownHint.hidden = true;
            verifyOwn(mock.claim, event.currentTarget);
          },
        })
      )
    );

    // ---------------------------------------------------------- Pannello del risultato
    function openSheet(trigger) {
      lastTrigger = trigger;
      sheet.hidden = false;
      scrim.hidden = false;
      requestAnimationFrame(() => {
        sheet.classList.add("is-open");
        scrim.classList.add("is-open");
      });
    }
    function closeSheet() {
      requestId++;
      clearInterval(loadingTimer);
      sheet.classList.remove("is-open");
      scrim.classList.remove("is-open");
      setTimeout(() => {
        if (!sheet.classList.contains("is-open")) {
          sheet.hidden = true;
          scrim.hidden = true;
        }
      }, 400);
      lastTrigger?.focus({ preventScroll: true });
    }
    scrim.addEventListener("click", closeSheet);
    screen.addEventListener("keydown", (event) => {
      if (sheet.hidden) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        closeSheet();
      }
      if (event.key === "Tab") {
        const focusable = $$("button, a[href], summary", sheet).filter((el) => el.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    const closeRow = () =>
      h("div", { class: "sheet-actions" }, h("button", { class: "btn btn-ghost", type: "button", text: "Chiudi", onclick: closeSheet }));

    function sourceLink(evidence) {
      if (!evidence.url) return null;
      return h(
        "a",
        { class: "src", href: evidence.url, target: "_blank", rel: "noopener noreferrer", title: "Apri la pagina su Wikipedia" },
        `Wikipedia: ${evidence.title}`,
        h("span", { icon: ICONS.external, style: { display: "contents" } })
      );
    }

    function renderLoading() {
      const steps = ["Cerco le frasi più vicine…", "Le confronto con la tua frase…", "Decido con prudenza…"];
      let i = 0;
      const label = h("span", { text: steps[0] });
      sheetBody.replaceChildren(
        h("h3", { class: "sr-only", id: "sheet-title", text: "Verifica in corso" }),
        h("div", { class: "sheet-loading" }, h("span", { class: "scan", "aria-hidden": "true" }), label)
      );
      clearInterval(loadingTimer);
      loadingTimer = setInterval(() => (label.textContent = steps[++i % steps.length]), 900);
    }

    // Risultato compatto: verdetto, affidabilità, fonte. Il "come" è in una sezione apribile.
    function renderResult(result, { isPost }) {
      const verdict = VERDICTS[result.predicted_label];
      const value = reliability(result);
      const used = new Set(result.evidence_used);
      const reason = result.abstention_reason ? REASONS[result.abstention_reason] || result.abstention_reason : null;

      const sources = result.evidence_used.length
        ? result.evidence_used.map((raw) => {
            const parsed = parseEvidence(raw);
            return h("div", { class: "evidence" }, h("p", { text: parsed.body }), sourceLink(parsed));
          })
        : [h("p", { class: "sv-empty", text: "Nessuna fonte abbastanza netta per confermare o smentire." })];

      const how = h(
        "details",
        { class: "sv-details" },
        h("summary", { text: "Come ha valutato il modello" }),
        h("p", {
          class: "sv-how",
          text: `Ha confrontato la frase con le ${result.evidence_scores.length || "poche"} frasi più vicine trovate su Wikipedia. Per un verdetto serve una frase sopra l'80%.`,
        }),
        reason ? h("p", { class: "sv-how", text: reason }) : null,
        result.evidence_scores.map((row) => {
          const parsed = parseEvidence(row.text);
          const s = Number(row.SUPPORTS) || 0;
          const r = Number(row.REFUTES) || 0;
          const n = Number(row[LABEL_NEI]) || 0;
          return h(
            "div",
            { class: "how-row" },
            h("p", {}, parsed.body, used.has(row.text) ? h("span", { class: "used-tag", text: "fonte" }) : null),
            h(
              "div",
              { class: "stack", role: "img", "aria-label": `Conferma ${fmtPct(s)}, smentisce ${fmtPct(r)}, neutra ${fmtPct(n)}` },
              h("span", { class: "s", style: { width: `${s * 100}%` } }),
              h("span", { class: "r", style: { width: `${r * 100}%` } }),
              h("span", { class: "n", style: { width: `${n * 100}%` } })
            ),
            h(
              "div",
              { class: "stack-values", "aria-hidden": "true" },
              h("span", { text: `Conferma ${fmtPct(s)}` }),
              h("span", { text: `Smentisce ${fmtPct(r)}` }),
              h("span", { text: `Neutra ${fmtPct(n)}` })
            )
          );
        }),
        h("p", { class: "sv-note", text: "L'affidabilità è il punteggio del modello, non una probabilità che sia vero." })
      );

      sheetBody.replaceChildren(
        h(
          "div",
          { class: `sv sv-${verdict.css}` },
          h(
            "div",
            { class: "sv-head" },
            h("div", { class: "sv-icon", icon: verdict.icon, "aria-hidden": "true" }),
            h("h3", { class: "sv-title", id: "sheet-title", tabindex: "-1", text: isPost ? verdict.post : verdict.claim })
          ),
          h(
            "div",
            { class: "sv-score" },
            h("div", { class: "sv-score-row" }, h("span", { text: "Affidabilità" }), h("strong", { text: value === null ? "n.d." : fmtPct(value) })),
            h(
              "div",
              { class: "meter", role: "img", "aria-label": value === null ? "Affidabilità non disponibile" : `Affidabilità ${fmtPct(value)}` },
              h("div", { class: "meter-fill" })
            )
          ),
          h("p", { class: "sv-label", text: result.evidence_used.length > 1 ? "Fonti" : "Fonte" }),
          sources,
          how,
          closeRow()
        )
      );
      const fill = $(".meter-fill", sheetBody);
      if (value !== null) requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = `${value * 100}%`)));
      $("#sheet-title").focus({ preventScroll: true });
    }

    function renderError(error, retry) {
      const messages = {
        network: "Il servizio di verifica non risponde. Riprova tra qualche istante.",
        timeout: "La verifica sta impiegando troppo. Riprova tra poco.",
        server: "La verifica non è andata a buon fine. Riprova.",
        invalid: "Questa frase non si può verificare. Controlla il testo e riprova.",
        demo: "Questa è una demo senza modello collegato: qui puoi verificare solo le frasi di esempio. Con il modello collegato funziona con qualsiasi frase in inglese.",
      };
      if (error.kind !== "demo") console.error("[Veritas] Errore di verifica:", error.kind, error.detail || error);
      const canRetry = ["network", "timeout", "server"].includes(error.kind);
      sheetBody.replaceChildren(
        h("h3", { class: "sr-only", id: "sheet-title", tabindex: "-1", text: error.kind === "demo" ? "Modello non collegato" : "Verifica non riuscita" }),
        h("p", { class: error.kind === "demo" ? "sv-demo" : "sv-error", role: "alert", text: error.userMessage || messages[error.kind] || messages.server }),
        h(
          "div",
          { class: "sheet-actions" },
          canRetry ? h("button", { class: "btn", type: "button", text: "Riprova", onclick: retry }) : null,
          h("button", { class: "btn btn-ghost", type: "button", text: "Chiudi", onclick: closeSheet })
        )
      );
      $("#sheet-title").focus({ preventScroll: true });
    }

    async function openPost(post) {
      const { badge } = badges.get(post.id);
      if (guideStep === 1) setGuide(2);
      const id = ++requestId;
      openSheet(badge);
      if (!results.has(normalizeClaim(post.claim))) renderLoading();
      try {
        const result = await getResult(post.claim, 0);
        if (id !== requestId) return;
        clearInterval(loadingTimer);
        showPostResult(post, result);
        renderResult(result, { isPost: true });
      } catch (error) {
        if (id !== requestId) return;
        clearInterval(loadingTimer);
        renderError(error instanceof CheckError ? error : new CheckError("server", null, error), () => openPost(post));
      }
    }

    async function verifyOwn(claim, trigger) {
      const id = ++requestId;
      openSheet(trigger);
      if (!results.has(normalizeClaim(claim))) renderLoading();
      try {
        const result = await getResult(claim);
        if (id !== requestId) return;
        clearInterval(loadingTimer);
        renderResult(result, { isPost: false });
      } catch (error) {
        if (id !== requestId) return;
        clearInterval(loadingTimer);
        renderError(error instanceof CheckError ? error : new CheckError("server", null, error), () => verifyOwn(claim, trigger));
      }
    }

    // ---------------------------------------------------------- Guida: cosa si può toccare
    // Passo 1: evidenzia il primo bollino. Passo 2: evidenzia "Verifica tu". Passo 3: fatto.
    let guideStep = 1;
    const guideItems = $$(".guide-item");
    const guideFor = (name) => guideItems.find((item) => item.dataset.guide === name);

    function setGuide(step) {
      guideStep = Math.max(guideStep, step);
      $$(".is-hinted", screen).forEach((el) => el.classList.remove("is-hinted"));
      const firstBadge = posts.length ? badges.get(posts[0].id).badge : null;
      if (guideStep === 1 && firstBadge) firstBadge.classList.add("is-hinted");
      if (guideStep === 2) $("#tab-check").classList.add("is-hinted");
      guideFor("post").classList.toggle("is-active", guideStep === 1);
      guideFor("post").classList.toggle("is-done", guideStep > 1);
      guideFor("own").classList.toggle("is-active", guideStep === 2);
      guideFor("own").classList.toggle("is-done", guideStep > 2);
    }

    guideFor("post").addEventListener("click", () => {
      selectTab($("#tab-feed"));
      $("#view-feed").scrollTo({ top: 0 });
      if (posts.length) openPost(posts[0]);
    });
    guideFor("own").addEventListener("click", () => {
      if (!sheet.hidden) closeSheet();
      selectTab($("#tab-check"));
      ownInput.focus({ preventScroll: true });
    });

    // Su schermi larghi le indicazioni stanno accanto al telefono, all'altezza di ciò che indicano.
    const wide = window.matchMedia("(min-width: 701px)");
    function placeGuide() {
      if (!wide.matches) {
        guideItems.forEach((item) => item.style.removeProperty("top"));
        return;
      }
      const stageBox = stage.getBoundingClientRect();
      const phoneBox = $(".phone", stage).getBoundingClientRect();
      const targets = {
        post: posts.length ? badges.get(posts[0].id).badge : null,
        own: $("#tab-check"),
      };
      guideItems.forEach((item) => {
        const target = targets[item.dataset.guide];
        const box = target?.getBoundingClientRect();
        // Se il bersaglio è nascosto o fuori dal telefono, resta all'ultima posizione utile.
        if (!box || !box.height || box.bottom < phoneBox.top || box.top > phoneBox.bottom) return;
        const top = box.top + box.height / 2 - stageBox.top - item.offsetHeight / 2;
        item.style.top = `${Math.max(0, top)}px`;
        item.style.setProperty("--reach", `${Math.max(16, phoneBox.left - item.getBoundingClientRect().right)}px`);
      });
    }
    window.addEventListener("resize", placeGuide);
    wide.addEventListener("change", placeGuide);
    $("#view-feed").addEventListener("scroll", placeGuide, { passive: true });
    document.fonts?.ready.then(placeGuide);
    setGuide(1);
    requestAnimationFrame(placeGuide);
  }

  // ================================================================ Newsletter
  function initNewsletter() {
    const form = $("#nl-form");
    const email = $("#nl-email");
    const consent = $("#nl-consent");
    const honeypot = $("#nl-hp");
    const message = $("#nl-msg");
    const submit = $("#nl-submit");
    const say = (text, kind) => {
      message.textContent = text;
      message.className = `form-msg ${kind ? `is-${kind}` : ""}`;
    };

    email.addEventListener("input", () => email.removeAttribute("aria-invalid"));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const value = email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
        email.setAttribute("aria-invalid", "true");
        email.focus();
        return say("Scrivi un indirizzo email valido, per esempio nome@esempio.it.", "error");
      }
      if (!consent.checked) {
        consent.focus();
        return say("Per iscriverti serve il consenso a ricevere gli aggiornamenti.", "error");
      }
      if (honeypot.value) return say("Quasi fatto: controlla la tua email e conferma l'iscrizione.", "ok"); // bot

      submit.disabled = true;
      submit.textContent = "Invio…";
      say("");
      const data = new FormData();
      data.append("EMAIL", value);
      data.append("OPT_IN", "1");
      data.append("email_address_check", "");
      data.append("locale", "en");
      try {
        // Brevo non espone una risposta leggibile da altri siti: la richiesta parte in modalità
        // "no-cors" e la conferma vera arriva con la mail di doppio opt-in.
        await fetch(config.newsletterAction, { method: "POST", mode: "no-cors", body: data });
        form.reset();
        say("Quasi fatto: controlla la tua email e conferma l'iscrizione.", "ok");
      } catch (error) {
        console.error("[Veritas] Iscrizione newsletter non inviata:", error);
        say(`Iscrizione non inviata. Controlla la connessione e riprova, oppure scrivici a ${config.contactEmail}.`, "error");
      } finally {
        submit.disabled = false;
        submit.textContent = "Iscriviti";
      }
    });
  }

  // ================================================================ Sostienici, contatti, privacy
  function initSupport() {
    const pageUrl = window.location.href.split(/[?#]/)[0];

    $("#copy-link").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(pageUrl);
        toast("Link copiato");
      } catch (_) {
        toast(`Copia questo link: ${pageUrl}`);
      }
    });

    const share = $("#native-share");
    if (navigator.share) {
      share.hidden = false;
      share.addEventListener("click", () =>
        navigator.share({ title: "Veritas", text: "Fatti, non follower. Il social della scienza verificata.", url: pageUrl }).catch(() => {})
      );
    }

    if (config.linkedinUrl) {
      $("#support-linkedin").hidden = false;
      $("#linkedin-link").href = config.linkedinUrl;
      $("#footer-linkedin").hidden = false;
      $("#footer-linkedin").href = config.linkedinUrl;
    }

    if (config.contactEmail) {
      $$(".contact-email").forEach((link) => {
        link.href = `mailto:${config.contactEmail}`;
        link.textContent = config.contactEmail;
      });
      $$(".contact-mailto").forEach((link) => (link.href = `mailto:${config.contactEmail}?subject=${encodeURIComponent("Collaborazione con Veritas")}`));
    }

    const dialog = $("#privacy-dialog");
    $$("[data-open-privacy]").forEach((button) =>
      button.addEventListener("click", () => (dialog.showModal ? dialog.showModal() : dialog.setAttribute("open", "")))
    );
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  // ================================================================ Avvio
  initNav();
  initHero();
  initCounters();
  initPhone();
  initNewsletter();
  initSupport();
})();
