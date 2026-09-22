/* ==========================================================================
   model.js: what a "date" is, and how two copies of it are merged.

   An entry looks like:
     id, title, date "YYYY-MM-DD", time "HH:MM", place, note, kind, status,
     by ("a" or "b": who proposed it), deleted, createdAt, coreAt,
     resp: { a: { v, t }, b: { v, t } }                  each person's answer
     memo: { a: { rating, text, t }, b: { ... } }        each person's memory

   Merge rules (this is what lets both of you edit without a server):
   - Core fields (title, date, status ...) use "last edit wins" by coreAt.
   - resp and memo are stored per person, and each person only writes their own,
     so they never overwrite each other.
   - Deleting keeps a tombstone (deleted: true) so the delete travels too.
   Merging is safe to repeat and safe in any order.
   ========================================================================== */
(function (DP) {
  "use strict";

  const SCHEMA = 2;
  const KINDS = { us: "Just us", family: "With family", friends: "With friends" };
  const KIND_ORDER = Object.keys(KINDS);
  const MEMBERS = ["a", "b"];
  const ANSWER_CODES = ["in", "maybe", "no"];
  const STATUSES = ["idea", "planned", "cancelled"];

  const str = (value, max = 400) => (typeof value === "string" ? value.slice(0, max) : "");
  const other = (id) => (id === "a" ? "b" : "a");

  function cleanResp(raw) {
    const out = {};
    for (const m of MEMBERS) {
      const r = raw && raw[m];
      if (r && (ANSWER_CODES.includes(r.v) || r.v === "")) out[m] = { v: r.v, t: Number(r.t) || 0 };
    }
    return out;
  }

  function cleanMemo(raw) {
    const out = {};
    for (const m of MEMBERS) {
      const r = raw && raw[m];
      if (r && typeof r === "object") {
        out[m] = {
          rating: Math.min(5, Math.max(0, Math.round(Number(r.rating) || 0))),
          text: str(r.text, 500),
          t: Number(r.t) || 0
        };
      }
    }
    return out;
  }

  /** Turns anything (saved data, a decrypted link) into a safe, complete entry. */
  function normalizeEntry(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) return null;
    return {
      id: str(raw.id, 40),
      title: str(raw.title, 80),
      date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : "",
      time: /^\d{2}:\d{2}$/.test(raw.time) ? raw.time : "",
      place: str(raw.place, 100),
      note: str(raw.note, 400),
      kind: KIND_ORDER.includes(raw.kind) ? raw.kind : "us",
      status: STATUSES.includes(raw.status) ? raw.status : "idea",
      by: MEMBERS.includes(raw.by) ? raw.by : "a",
      deleted: raw.deleted === true,
      createdAt: Number(raw.createdAt) || 0,
      coreAt: Number(raw.coreAt) || 0,
      resp: cleanResp(raw.resp),
      memo: cleanMemo(raw.memo)
    };
  }

  const coreKey = (e) => [e.title, e.date, e.time, e.place, e.note, e.kind, e.status, e.deleted].join("\u0001");

  /** The last time anything on this entry changed (used to pick what to send). */
  function touched(e) {
    const stamps = [e.coreAt];
    for (const m of MEMBERS) stamps.push(e.resp[m]?.t || 0, e.memo[m]?.t || 0);
    return Math.max(...stamps);
  }

  /** A comparable fingerprint, used to count what really changed in a merge. */
  function signature(e) {
    const parts = [coreKey(e)];
    for (const m of MEMBERS) parts.push(e.resp[m]?.v, e.resp[m]?.t, e.memo[m]?.rating, e.memo[m]?.text, e.memo[m]?.t);
    return parts.join("\u0002");
  }

  function mergeStamped(a = {}, b = {}) {
    const out = { ...a };
    for (const key of Object.keys(b)) {
      if (!out[key] || b[key].t > out[key].t) out[key] = b[key];
    }
    return out;
  }

  function mergeEntry(local, incoming) {
    if (!local) return incoming;
    const takeIncoming =
      incoming.coreAt > local.coreAt ||
      (incoming.coreAt === local.coreAt && coreKey(incoming) > coreKey(local));
    const core = takeIncoming ? incoming : local;
    return { ...core, resp: mergeStamped(local.resp, incoming.resp), memo: mergeStamped(local.memo, incoming.memo) };
  }

  /* Where an entry belongs: still ahead of us, or already history. */
  function outcome(e, today) {
    if (e.status === "cancelled") return "cancelled";
    if (e.date && e.date < today) return e.status === "planned" ? "happened" : "passed";
    return "upcoming";
  }
  const isHistory = (e, today) => outcome(e, today) !== "upcoming";

  const byWhen = (a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);

  /** Average of the ratings the two of you gave (0 when nobody rated). */
  function avgRating(e) {
    const ratings = MEMBERS.map((m) => e.memo[m]?.rating || 0).filter((r) => r > 0);
    return ratings.length ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : 0;
  }

  DP.model = {
    SCHEMA, KINDS, KIND_ORDER, MEMBERS, other,
    normalizeEntry, mergeEntry, touched, signature, outcome, isHistory, byWhen, avgRating
  };
})(window.DP = window.DP || {});
