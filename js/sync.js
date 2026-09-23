/* ==========================================================================
   sync.js: moving dates between your two devices.

   There is no server. A "payload" is your dates, encrypted with the shared
   password, that travels as a link (or a backup file):
     delta: only entries changed in the last 60 days (small; for everyday use)
     full : every entry (for a new phone, or after a long gap)
   Because merging is safe to repeat, sending a bit too much is harmless.

   To add automatic cloud sync later, replace createLink()/open() with calls
   to a database and keep everything else the same.
   ========================================================================== */
(function (DP) {
  "use strict";

  const U = DP.util;
  const M = DP.model;
  const S = DP.state;
  const C = DP.crypto;
  const WINDOW_DAYS = 60;

  function buildPayload(kind) {
    const space = S.space;
    // "full" (a partner invite) and "device" (adding your own second device) both need everything;
    // only "delta" (an everyday manual update) is trimmed to the recent window.
    const since = kind === "delta" ? U.now() - WINDOW_DAYS * 86400000 : -1;
    return {
      v: M.SCHEMA,
      kind,
      space: space.id,
      from: space.me,
      names: space.names,
      sentAt: U.now(),
      entries: Object.values(space.entries).filter((e) => M.touched(e) > since)
    };
  }

  /** The encrypted text only (used for backups). */
  const createCipher = (kind) => C.encrypt(buildPayload(kind), S.space.password);

  async function createLink(kind) {
    return `${location.href.split("#")[0]}#s=${await createCipher(kind)}`;
  }

  /** Finds the encrypted part in a pasted link, a "#s=..." fragment, or a raw backup. */
  function extractCipher(text) {
    const value = (text || "").trim();
    const fromLink = /#s=([\w-]+)/.exec(value);
    if (fromLink) return fromLink[1];
    return /^[\w-]{40,}$/.test(value) ? value : null;
  }

  /** Decrypts and checks a payload. Throws if the password is wrong or the data is invalid. */
  async function open(cipher, password) {
    const raw = await C.decrypt(cipher, password.trim());
    if (!raw || typeof raw.space !== "string" || !M.MEMBERS.includes(raw.from) || !Array.isArray(raw.entries)) {
      throw new Error("not a date planner payload");
    }
    const KNOWN_KINDS = ["full", "delta", "device"];
    return {
      kind: KNOWN_KINDS.includes(raw.kind) ? raw.kind : "delta",
      space: raw.space,
      from: raw.from,
      names: { a: String(raw.names?.a || ""), b: String(raw.names?.b || "") },
      entries: raw.entries.map(M.normalizeEntry).filter(Boolean)
    };
  }

  DP.sync = { WINDOW_DAYS, createCipher, createLink, extractCipher, open };
})(window.DP = window.DP || {});
