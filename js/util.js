/* ==========================================================================
   util.js: small helpers shared by every other file.
   DOM builder, dates, local storage, toast, clipboard, file download.
   ========================================================================== */
(function (DP) {
  "use strict";

  const pad = (n) => String(n).padStart(2, "0");
  const uid = () => Math.random().toString(36).slice(2, 10);
  const now = () => Date.now();
  const byId = (id) => document.getElementById(id);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

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

  /* Dates are stored as "YYYY-MM-DD" and "HH:MM" strings, never as time zones. */
  const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayIso = () => toIso(new Date());

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

  function longDate(date, time, withYear = true) {
    const d = parseDate(date, time);
    if (!d) return "";
    const opts = { weekday: "long", month: "long", day: "numeric" };
    if (withYear) opts.year = "numeric";
    return d.toLocaleDateString(undefined, opts) + (time ? ` at ${formatTime(time)}` : "");
  }

  function monthLabel(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  function daysUntil(date) {
    const d = parseDate(date);
    if (!d) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((d - today) / 86400000);
  }

  function untilText(date) {
    const diff = daysUntil(date);
    if (diff === 0) return "today";
    if (diff === 1) return "tomorrow";
    return diff > 1 ? `in ${diff} days` : "";
  }

  function nextSaturdayIso() {
    const d = new Date();
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    return toIso(d);
  }

  function calendarUrl(entry) {
    const start = parseDate(entry.date, entry.time || "19:00");
    if (!start) return null;
    const end = new Date(start.getTime() + 2 * 3600 * 1000);
    const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const params = new URLSearchParams({ action: "TEMPLATE", text: entry.title || "Date", dates: `${stamp(start)}/${stamp(end)}` });
    if (entry.place) params.set("location", entry.place);
    return `https://calendar.google.com/calendar/render?${params}`;
  }

  /* Local storage that never throws (private browsing can block it). */
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
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch { /* storage blocked */ }
    }
  };

  let toastEl = null;
  let toastTimer;
  function toast(text) {
    if (!toastEl) {
      toastEl = el("div", { id: "toast", role: "status", "aria-live": "polite" });
      document.body.append(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3600);
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

  function download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = el("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  DP.util = {
    el, byId, uid, now, pad, plural, toIso, todayIso, parseDate, formatTime, longDate, monthLabel,
    daysUntil, untilText, nextSaturdayIso, calendarUrl, store, toast, copyText, download
  };
})(window.DP = window.DP || {});
