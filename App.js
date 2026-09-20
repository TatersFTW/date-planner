/* ==========================================================================
   Date planner
   How it works: you build a plan, it gets encrypted with your password and
   packed into the link (after the #). Nothing is stored on a server.

   1. Constants   2. Storage   3. Plan data   4. Encryption   5. Helpers
   6. Ticket parts   7. Views   8. Actions   9. Render and start-up
   ========================================================================== */
(() => {
  "use strict";

  /* 1. Constants ----------------------------------------------------------- */
  const DEFAULT_HEADLINE = "Free for a date soon?";
  const MIN_PASSWORD = 6;
  const PBKDF2_ITERATIONS = 250000;

  const KINDS = { us: "Just us", family: "With family", friends: "With friends" };
  const KIND_ORDER = ["us", "family", "friends"];
  const ANSWERS = [["in", "I'm in"], ["maybe", "Maybe"], ["no", "Can't"]];

  const STORE = {
    draft: "dp-draft",       // the plan you are building (this device only)
    password: "dp-password", // the password you chose for links (this device only)
    replies: "dp-replies",   // her answers (this device only)
    unlock: "dp-unlock"      // remembered password on her device
  };

  /* 2. Storage ------------------------------------------------------------- */
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
    }
  };

  /* 3. Plan data ----------------------------------------------------------- */
  const uid = () => Math.random().toString(36).slice(2, 8);
  const str = (value) => (typeof value === "string" ? value : "");
  const blankPlan = () => ({ to: "", headline: DEFAULT_HEADLINE, note: "", confirmed: null, options: [] });

  /** Turns anything (a saved draft, decrypted data) into a safe, complete plan. */
  function normalize(raw) {
    const plan = blankPlan();
    if (!raw || typeof raw !== "object") return plan;
    plan.to = str(raw.to);
    plan.headline = str(raw.headline) || DEFAULT_HEADLINE;
    plan.note = str(raw.note);
    plan.options = (Array.isArray(raw.options) ? raw.options : []).map((o) => ({
      id: str(o?.id) || uid(),
      date: str(o?.date),
      time: str(o?.time),
      title: str(o?.title),
      place: str(o?.place),
      kind: KIND_ORDER.includes(o?.kind) ? o.kind : "us"
    }));
    plan.confirmed = plan.options.some((o) => o.id === raw.confirmed) ? raw.confirmed : null;
    return plan;
  }

  /** Compact array form keeps the link short. */
  const pack = (p) => [
    p.to, p.headline, p.note, p.confirmed || "",
    p.options.map((o) => [o.id, o.date, o.time, o.title, o.place, o.kind])
  ];

  function unpack(data) {
    const [to, headline, note, confirmed, options = []] = data;
    return normalize({
      to, headline, note, confirmed,
      options: options.map(([id, date, time, title, place, kind]) => ({ id, date, time, title, place, kind }))
    });
  }

  /* 4. Encryption (AES-GCM, key derived from the password with PBKDF2) ------ */
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const toBase64Url = (bytes) =>
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  function fromBase64Url(text) {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }

  async function deriveKey(password, salt) {
    const base = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  /** Output layout: 16 bytes salt, 12 bytes iv, then the encrypted plan. */
  async function encrypt(data, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const body = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(data)))
    );
    const out = new Uint8Array(28 + body.length);
    out.set(salt, 0);
    out.set(iv, 16);
    out.set(body, 28);
    return toBase64Url(out);
  }

  /** Throws if the password is wrong or the link was altered. */
  async function decrypt(cipher, password) {
    const bytes = fromBase64Url(cipher);
    const key = await deriveKey(password, bytes.slice(0, 16));
    const body = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(16, 28) }, key, bytes.slice(28));
    return JSON.parse(decoder.decode(body));
  }

  /* App state -------------------------------------------------------------- */
  const root = document.getElementById("root");
  let plan = blankPlan();
  let password = store.get(STORE.password, "");
  let isOwner = false;        // true on the builder (no link in the address bar)
  let mode = "view";          // "edit" = Create Date, "view" = View Dates
  let locked = null;          // { cipher } while she still needs to enter the password
  let kindFilter = "all";
  let pendingFocus = null;
  let busy = false;
  const saved = store.get(STORE.replies, {});
  let replies = saved.r || {};
  let message = saved.m || "";

  /* 5. Helpers ------------------------------------------------------------- */

  /** Tiny DOM builder: el("div", { class: "x", text: "hi", onclick }, [children]) */
  function el(tag, props = {}, kids = []) {
    const node = document.createElement(tag);
    for (const [key, val] of Object.entries(props)) {
      if (val == null || val === false) continue;
      if (key === "class") node.className = val;
      else if (key === "text") node.textContent = val;
      else if (key === "value") node.value = val;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), val);
      else node.setAttribute(key, val === true ? "" : val);
    }
    for (const kid of kids.flat()) {
      if (kid != null && kid !== false) node.append(kid);
    }
    return node;
  }

  const byId = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, "0");
  const toIsoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function parseDate(date, time) {
    if (!date) return null;
    const [y, m, d] = date.split("-").map(Number);
    if (!y || !m || !d) return null;
    const [hh, mm] = (time || "").split(":").map(Number);
    return new Date(y, m - 1, d, hh || 0, mm || 0);
  }

  function formatTime(time) {
    if (!time) return "";
    const [h, m = "00"] = time.split(":");
    return `${Number(h) % 12 || 12}:${m} ${Number(h) >= 12 ? "PM" : "AM"}`;
  }

  const sortedOptions = () =>
    [...plan.options].sort((a, b) =>
      `${a.date || "9999"} ${a.time}`.localeCompare(`${b.date || "9999"} ${b.time}`));

  function nextSaturday() {
    const d = new Date();
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    return d;
  }

  function daysUntilText(option) {
    const date = parseDate(option.date);
    if (!date) return "";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((date - today) / 86400000);
    if (diff === 0) return "today";
    if (diff === 1) return "tomorrow";
    return diff > 1 ? `in ${diff} days` : "";
  }

  function calendarUrl(option) {
    const start = parseDate(option.date, option.time || "19:00");
    if (!start) return null;
    const end = new Date(start.getTime() + 2 * 3600 * 1000);
    const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const params = new URLSearchParams({ action: "TEMPLATE", text: option.title || "Date", dates: `${stamp(start)}/${stamp(end)}` });
    if (option.place) params.set("location", option.place);
    return `https://calendar.google.com/calendar/render?${params}`;
  }

  const findOption = (id) => plan.options.find((o) => o.id === id) || null;

  let toastTimer;
  const toastEl = el("div", { id: "toast", role: "status", "aria-live": "polite" });
  document.body.append(toastEl);
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3400);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const box = el("textarea", { readonly: true });
      box.value = text;
      Object.assign(box.style, { position: "fixed", opacity: "0" });
      document.body.append(box);
      box.select();
      const ok = document.execCommand("copy");
      box.remove();
      if (!ok) throw new Error("copy failed");
    }
  }

  function replyText() {
    const lines = sortedOptions()
      .filter((o) => replies[o.id])
      .map((o) => {
        const date = parseDate(o.date, o.time);
        const when = date
          ? date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) +
            (o.time ? ` at ${formatTime(o.time)}` : "")
          : "";
        const mark = { in: "\u2705 I'm in", maybe: "\uD83E\uDD14 Maybe", no: "\u274C Can't make it" }[replies[o.id]];
        const who = o.kind === "us" ? "" : ` (${KINDS[o.kind].toLowerCase()})`;
        return `${o.title || "Date idea"}${who}${when ? `, ${when}` : ""}: ${mark}`;
      });
    if (!lines.length) return "";
    return `About our date plans \uD83D\uDC8C\n${lines.join("\n")}${message.trim() ? `\n\n${message.trim()}` : ""}`;
  }

  /* 6. Ticket parts -------------------------------------------------------- */
  function stub(option) {
    const date = parseDate(option.date);
    return el("div", { class: "stub" }, [
      el("span", { class: "dow", text: date ? date.toLocaleDateString(undefined, { weekday: "short" }) : "Date" }),
      el("span", { class: "day", text: date ? String(date.getDate()) : "?" }),
      el("span", { class: "mon", text: date ? date.toLocaleDateString(undefined, { month: "short" }) : "not set" })
    ]);
  }

  function answerButtons(option) {
    return el("div", { class: "answers", role: "group", "aria-label": `Your answer for ${option.title || "this idea"}` },
      ANSWERS.map(([code, label]) => {
        const on = replies[option.id] === code;
        return el("button", {
          type: "button",
          class: `answer answer-${code}${on ? " on" : ""}`,
          "aria-pressed": String(on),
          "data-fk": `a-${option.id}-${code}`,
          text: label,
          onclick: () => {
            if (on) delete replies[option.id];
            else replies[option.id] = code;
            store.set(STORE.replies, { r: replies, m: message });
            render();
          }
        });
      }));
  }

  function ticket(option, { big = false } = {}) {
    const time = formatTime(option.time);
    return el("article", { class: `ticket${big ? " big" : ""}` }, [
      stub(option),
      el("div", { class: "ticket-body" }, [
        el("span", { class: "kind", text: KINDS[option.kind] }),
        el("h3", { class: "what", text: option.title || "Date idea" }),
        time && el("p", { class: "meta", text: time }),
        option.place && el("p", { class: "meta", text: option.place }),
        !big && answerButtons(option)
      ])
    ]);
  }

  function editTicket(option) {
    const isLocked = plan.confirmed === option.id;
    const on = (field) => (e) => { option[field] = e.target.value; saveDraft(); };
    const onDate = (field) => (e) => { option[field] = e.target.value; saveDraft(); render(); };

    return el("article", { class: `ticket edit${isLocked ? " locked" : ""}` }, [
      stub(option),
      el("div", { class: "ticket-body" }, [
        field("What are you doing?",
          el("input", { type: "text", value: option.title, maxlength: "80", placeholder: "Dinner and a movie", "data-fk": `f-${option.id}-title`, oninput: on("title") })),
        fieldGroup("Who is it with?",
          el("div", { class: "chips small", role: "group", "aria-label": "Who is this date with?" },
            KIND_ORDER.map((kind) => el("button", {
              type: "button",
              class: "chip",
              "aria-pressed": String(option.kind === kind),
              "data-fk": `k-${option.id}-${kind}`,
              text: KINDS[kind],
              onclick: () => { option.kind = kind; saveDraft(); render(); }
            })))),
        el("div", { class: "row-2" }, [
          field("Date", el("input", { type: "date", value: option.date, "data-fk": `f-${option.id}-date`, onchange: onDate("date") })),
          field("Time", el("input", { type: "time", value: option.time, "data-fk": `f-${option.id}-time`, onchange: onDate("time") }))
        ]),
        field("Where (optional)",
          el("input", { type: "text", value: option.place, maxlength: "100", placeholder: "Our favorite ramen spot", "data-fk": `f-${option.id}-place`, oninput: on("place") })),
        el("div", { class: "ticket-actions" }, [
          el("button", {
            type: "button",
            class: `btn small${isLocked ? " quiet" : ""}`,
            "data-fk": `l-${option.id}`,
            text: isLocked ? "Unlock" : "Lock this one in",
            onclick: () => { plan.confirmed = isLocked ? null : option.id; saveDraft(); render(); }
          }),
          el("button", {
            type: "button",
            class: "btn small quiet",
            "data-fk": `r-${option.id}`,
            text: "Remove",
            onclick: () => {
              plan.options = plan.options.filter((o) => o.id !== option.id);
              if (plan.confirmed === option.id) plan.confirmed = null;
              saveDraft();
              render();
            }
          })
        ])
      ])
    ]);
  }

  function field(label, control, hint) {
    return el("label", { class: "field" }, [el("span", { text: label }), control, hint && el("p", { class: "field-hint", text: hint })]);
  }

  /** Same look as field(), but for a group of buttons (a <label> would forward clicks to the first one). */
  function fieldGroup(label, control) {
    return el("div", { class: "field" }, [el("span", { text: label }), control]);
  }

  /* 7. Views --------------------------------------------------------------- */
  function greeting() {
    return plan.to && el("p", { class: "hi", text: `Hi ${plan.to},` });
  }

  function hero() {
    return el("header", { class: "hero" }, [
      greeting(),
      el("h1", { text: plan.headline || DEFAULT_HEADLINE }),
      plan.note && el("p", { class: "note", text: plan.note })
    ]);
  }

  function topbar() {
    const tab = (value, label) => el("button", {
      type: "button",
      "aria-pressed": String(mode === value),
      "data-fk": `tab-${value}`,
      text: label,
      onclick: () => { mode = value; render(); window.scrollTo(0, 0); }
    });
    return el("div", { class: "top" }, [
      el("div", { class: "segmented", role: "group", "aria-label": "Page view" }, [tab("edit", "Create Date"), tab("view", "View Dates")]),
    ]);
  }

  /** Password screen shown to her when she opens the link. */
  function viewLocked() {
    const input = el("input", { type: "password", autocomplete: "current-password", placeholder: "Password", "data-fk": "pw" });
    const remember = el("input", { type: "checkbox", checked: true });
    const error = el("p", { class: "error", role: "alert" });
    const button = el("button", { type: "submit", class: "btn primary", text: "Unlock" });

    const form = el("form", {
      class: "lock-form",
      onsubmit: async (e) => {
        e.preventDefault();
        const attempt = input.value.trim();
        if (!attempt) return;
        if (!window.crypto?.subtle) {
          error.textContent = "This browser can't unlock the link. Open it over https in an up-to-date browser.";
          return;
        }
        button.disabled = true;
        button.textContent = "Unlocking\u2026";
        error.textContent = "";
        if (!(await tryUnlock(locked.cipher, attempt, remember.checked))) {
          error.textContent = "That password didn't work. Check it and try again.";
          button.disabled = false;
          button.textContent = "Unlock";
          input.select();
        }
      }
    }, [
      field("Password", input),
      el("label", { class: "check" }, [remember, el("span", { text: "Keep me unlocked on this device" })]),
      error,
      button
    ]);

    return [
      el("header", { class: "hero" }, [
        el("h1", { text: "This plan is private." }),
        el("p", { class: "note", text: "Enter the password to see the dates." })
      ]),
      form
    ];
  }

  function replyPanel() {
    const extra = el("textarea", {
      rows: "2",
      placeholder: "Anything else you want to say? (optional)",
      "aria-label": "Extra message",
      oninput: (e) => {
        message = e.target.value;
        store.set(STORE.replies, { r: replies, m: message });
        updateReply();
      }
    });
    extra.value = message;

    const copy = async () => {
      try {
        await copyText(replyText());
        toast("Copied. Paste it into your chat.");
      } catch {
        toast("Couldn't copy. Select the text and copy it.");
      }
    };

    const buttons = [el("button", { type: "button", id: "copy-reply", class: "btn primary", text: "Copy my reply", onclick: copy })];
    if (navigator.share) {
      buttons.push(el("button", {
        type: "button",
        id: "share-reply",
        class: "btn",
        text: "Share\u2026",
        onclick: () => navigator.share({ text: replyText() }).catch((e) => { if (e?.name !== "AbortError") copy(); })
      }));
    }

    return el("section", { class: "reply" }, [
      el("h2", { text: "Send your answers back" }),
      el("p", { class: "help", text: "Tap an answer on each idea above, then copy your reply and send it in your chat." }),
      extra,
      el("div", { class: "preview empty", id: "reply-preview", "aria-live": "polite" }),
      el("div", { class: "btn-row" }, buttons)
    ]);
  }

  function kindFilters() {
    const used = KIND_ORDER.filter((k) => plan.options.some((o) => o.kind === k));
    if (used.length < 2) { kindFilter = "all"; return null; }
    if (kindFilter !== "all" && !used.includes(kindFilter)) kindFilter = "all";
    const chip = (value, label) => el("button", {
      type: "button",
      class: "chip",
      "aria-pressed": String(kindFilter === value),
      "data-fk": `filter-${value}`,
      text: label,
      onclick: () => { kindFilter = value; render(); }
    });
    return el("div", { class: "chips", role: "group", "aria-label": "Filter dates" },
      [chip("all", "All"), ...used.map((k) => chip(k, KINDS[k]))]);
  }

  /** What she sees: the confirmed date, or the list of ideas with answer buttons. */
  function viewDates() {
    const confirmed = findOption(plan.confirmed);
    if (confirmed) {
      const date = parseDate(confirmed.date, confirmed.time);
      const when = date
        ? date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) +
          (confirmed.time ? ` at ${formatTime(confirmed.time)}` : "")
        : "";
      const until = daysUntilText(confirmed);
      const calendar = calendarUrl(confirmed);
      return [
        el("header", { class: "hero" }, [
          greeting(),
          el("h1", { text: "It's a date." }),
          el("p", { class: "note", text: `${when}${until ? ` (${until})` : ""}` })
        ]),
        ticket(confirmed, { big: true }),
        calendar && el("p", { class: "cta" }, [
          el("a", { class: "btn primary", href: calendar, target: "_blank", rel: "noopener noreferrer", text: "Add to Google Calendar" })
        ])
      ];
    }

    const visible = sortedOptions().filter((o) => kindFilter === "all" || o.kind === kindFilter);
    const filters = kindFilters();
    if (!plan.options.length) {
      return [hero(), el("div", { class: "empty-card", text: "No date ideas here yet. Check back soon." })];
    }
    return [
      hero(),
      filters,
      el("ul", { class: "list" }, visible.map((o) => el("li", {}, [ticket(o)]))),
      replyPanel()
    ];
  }

  /** What you see: the builder. */
  function viewCreate() {
    const note = el("textarea", {
      rows: "3",
      maxlength: "400",
      placeholder: "Pick what works and I'll book it.",
      "data-fk": "f-note",
      oninput: (e) => { plan.note = e.target.value; saveDraft(); }
    });
    note.value = plan.note;

    const confirmed = findOption(plan.confirmed);
    const options = sortedOptions();

    return [
      el("section", { class: "setup" }, [
        field("Name (optional)",
          el("input", { type: "text", value: plan.to, maxlength: "40", placeholder: "Go", "data-fk": "f-to", oninput: (e) => { plan.to = e.target.value; saveDraft(); } })),
        field("Headline",
          el("input", { type: "text", value: plan.headline, maxlength: "80", placeholder: DEFAULT_HEADLINE, "data-fk": "f-headline", oninput: (e) => { plan.headline = e.target.value; saveDraft(); } })),
        field("Message to her (optional)", note),
        field("Password for her link",
          el("input", {
            type: "text",
            value: password,
            autocomplete: "off",
            placeholder: "A phrase only you two know",
            "data-fk": "f-password",
            oninput: (e) => { password = e.target.value; store.set(STORE.password, password); }
          }),
          `At least ${MIN_PASSWORD} characters. The plan is encrypted with it, so tell her the password in person or in a separate message.`)
      ]),
      el("h2", { text: "Date ideas" }),
      el("p", { class: "help", text: "Add a few dates and places. She taps an answer on each one." }),
      confirmed && el("div", { class: "locked-note" }, [
        el("p", { text: `Locked in: ${confirmed.title || "Date idea"}. She now sees a confirmation instead of the options.` })
      ]),
      options.length
        ? el("ul", { class: "list" }, options.map((o) => el("li", {}, [editTicket(o)])))
        : el("div", { class: "empty-card", text: "No ideas yet. Add your first one below." }),
      el("button", { type: "button", class: "btn add", "data-fk": "add", text: "Add a date idea", onclick: addOption }),
      el("button", { type: "button", id: "share-link", class: "btn primary share", "data-fk": "share", text: "Copy link for her", onclick: shareLink }),
      el("p", { class: "draft-note", text: "Your draft saves on this device." })
    ];
  }

  /* 8. Actions ------------------------------------------------------------- */
  function saveDraft() {
    store.set(STORE.draft, plan);
    updateShareButton();
  }

  function addOption() {
    const option = { id: uid(), date: toIsoDate(nextSaturday()), time: "19:00", title: "", place: "", kind: "us" };
    plan.options.push(option);
    saveDraft();
    pendingFocus = `f-${option.id}-title`;
    render();
  }

  /** Checks every idea has a title and date. Returns false (and points at the problem) if not. */
  function validate() {
    for (const option of plan.options) {
      option.title = option.title.trim();
      option.place = option.place.trim();
      if (!option.title || !option.date) {
        toast("Every idea needs a title and a date.");
        pendingFocus = `f-${option.id}-${option.title ? "date" : "title"}`;
        mode = "edit";
        render();
        return false;
      }
    }
    plan.to = plan.to.trim();
    plan.headline = plan.headline.trim() || DEFAULT_HEADLINE;
    plan.note = plan.note.trim();
    store.set(STORE.draft, plan);
    return true;
  }

  async function shareLink() {
    if (busy) return;
    if (!plan.options.length) return toast("Add at least one date idea first.");
    if (!validate()) return;

    const secret = password.trim();
    if (secret.length < MIN_PASSWORD) {
      pendingFocus = "f-password";
      render();
      return toast(`Set a password of at least ${MIN_PASSWORD} characters.`);
    }
    if (!window.crypto?.subtle) return toast("Encryption needs https. Open the live site, not a local file.");

    busy = true;
    updateShareButton();
    try {
      const cipher = await encrypt(pack(plan), secret);
      const url = `${location.href.split("#")[0]}#e=${cipher}`;
      try {
        await copyText(url);
        toast("Link copied. Send it to her and tell her the password separately.");
      } catch {
        window.prompt("Copy this link and send it to her:", url);
      }
    } catch {
      toast("Couldn't create the link. Try again.");
    } finally {
      busy = false;
      updateShareButton();
    }
  }

  /** Tries a password on the link. On success shows the plan and returns true. */
  async function tryUnlock(cipher, attempt, remember = false) {
    try {
      plan = unpack(await decrypt(cipher, attempt));
    } catch {
      return false;
    }
    locked = null;
    if (remember) store.set(STORE.unlock, attempt);
    render();
    return true;
  }

  function updateShareButton() {
    const button = byId("share-link");
    if (button) button.disabled = busy || !plan.options.length;
  }

  function updateReply() {
    const text = replyText();
    const preview = byId("reply-preview");
    if (preview) {
      preview.textContent = text || "Your reply will show up here once you answer at least one idea.";
      preview.classList.toggle("empty", !text);
    }
    for (const id of ["copy-reply", "share-reply"]) {
      const button = byId(id);
      if (button) button.disabled = !text;
    }
  }

  /* 9. Render and start-up ------------------------------------------------- */
  function render() {
    let focusKey = pendingFocus || document.activeElement?.dataset?.fk;
    pendingFocus = null;

    let content;
    if (locked) content = viewLocked();
    else if (isOwner && mode === "edit") content = viewCreate();
    else content = viewDates();

    root.replaceChildren(el("main", { class: "wrap" }, [isOwner && topbar(), content]));
    updateShareButton();
    updateReply();

    // keep keyboard focus on the same control after a re-render
    if (locked) focusKey = focusKey || "pw";
    if (focusKey) root.querySelector(`[data-fk="${focusKey}"]`)?.focus();
  }

  function startBuilder() {
    plan = normalize(store.get(STORE.draft, null));
    isOwner = true;
    mode = "edit";
    locked = null;
    render();
  }

  async function start() {
    const match = /^#e=([\w-]+)$/.exec(location.hash);
    if (!match) return startBuilder();

    isOwner = false;
    mode = "view";
    plan = blankPlan();
    locked = { cipher: match[1] };

    // try passwords already remembered on this device before asking
    const remembered = [store.get(STORE.unlock, ""), password].filter(Boolean);
    for (const attempt of remembered) {
      if (await tryUnlock(match[1], attempt.trim())) return;
    }
    render();
  }

  window.addEventListener("hashchange", start);
  start();
})();