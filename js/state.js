/* ==========================================================================
   state.js: the shared space stored on this device, and every way to change it.

   space = {
     schema, id, me ("a" or "b"), names: { a, b }, password,
     entries: { [id]: entry }, pending: [ids not sent yet],
     lastSentAt, lastReceivedAt, partnerSeen
   }
   Every change goes through a function here, so timestamps and the
   "not sent yet" list are always kept correct.
   ========================================================================== */
(function (DP) {
  "use strict";

  const U = DP.util;
  const M = DP.model;
  const KEY = "dp2-space";
  const S = { space: null };

  const str = (value, max = 40) => (typeof value === "string" ? value.trim().slice(0, max) : "");

  /** Cleans saved data. When the format changes in future, upgrade old data here. */
  function migrate(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
    // Example for later: if (raw.schema < 3) { ...reshape raw... }
    const space = {
      schema: M.SCHEMA,
      id: raw.id,
      me: raw.me === "b" ? "b" : "a",
      names: { a: str(raw.names?.a) || "You", b: str(raw.names?.b) || "Partner" },
      password: typeof raw.password === "string" ? raw.password : "",
      entries: {},
      pending: [],
      lastSentAt: Number(raw.lastSentAt) || 0,
      lastReceivedAt: Number(raw.lastReceivedAt) || 0,
      partnerSeen: raw.partnerSeen === true
    };
    for (const e of Object.values(raw.entries || {})) {
      const entry = M.normalizeEntry(e);
      if (entry) space.entries[entry.id] = entry;
    }
    space.pending = (Array.isArray(raw.pending) ? raw.pending : []).filter((id) => space.entries[id]);
    return space;
  }

  S.load = () => { S.space = migrate(U.store.get(KEY, null)); };
  S.save = () => U.store.set(KEY, S.space);

  S.create = ({ id, me, names, password, entries = [] }) => {
    S.space = migrate({ id, me, names, password, entries: Object.fromEntries(entries.map((e) => [e.id, e])) });
    S.save();
  };

  S.reset = () => { U.store.remove(KEY); S.space = null; };

  S.list = () => Object.values(S.space.entries).filter((e) => !e.deleted);
  S.get = (id) => {
    const e = S.space.entries[id];
    return e && !e.deleted ? e : null;
  };
  S.partnerId = () => M.other(S.space.me);
  S.nameOf = (id) => S.space.names[id];
  S.pendingCount = () => S.space.pending.filter((id) => S.space.entries[id]).length;

  /** A timestamp that is always later than what the entry already has, even if clocks differ. */
  const stamp = (entry) => Math.max(U.now(), (entry ? M.touched(entry) : 0) + 1);

  function commit(entry) {
    S.space.entries[entry.id] = entry;
    if (!S.space.pending.includes(entry.id)) S.space.pending.push(entry.id);
    S.save();
    return entry;
  }

  S.addEntry = (fields) => {
    const t = U.now();
    const me = S.space.me;
    return commit(M.normalizeEntry({
      ...fields, id: U.uid() + U.uid().slice(0, 3), by: me, deleted: false,
      createdAt: t, coreAt: t, resp: { [me]: { v: "in", t } }, memo: {}
    }));
  };

  S.updateEntry = (id, patch) => {
    const e = S.space.entries[id];
    return commit(M.normalizeEntry({ ...e, ...patch, coreAt: stamp(e) }));
  };

  S.removeEntry = (id) => S.updateEntry(id, { deleted: true });

  /** value is "in", "maybe", "no", or "" to clear your answer. */
  S.setResponse = (id, value) => {
    const e = S.space.entries[id];
    const me = S.space.me;
    return commit(M.normalizeEntry({ ...e, resp: { ...e.resp, [me]: { v: value, t: stamp(e) } } }));
  };

  /** patch can hold rating (0-5) and/or text. */
  S.setMemo = (id, patch) => {
    const e = S.space.entries[id];
    const me = S.space.me;
    const prev = e.memo[me] || { rating: 0, text: "" };
    return commit(M.normalizeEntry({ ...e, memo: { ...e.memo, [me]: { ...prev, ...patch, t: stamp(e) } } }));
  };

  S.markSent = () => {
    S.space.pending = [];
    S.space.lastSentAt = U.now();
    S.save();
  };

  /** Merges a decrypted payload from your partner. Returns how many dates were added and changed. */
  S.mergeIncoming = (payload) => {
    let added = 0;
    let updated = 0;
    for (const incoming of payload.entries) {
      const local = S.space.entries[incoming.id];
      const merged = M.mergeEntry(local, incoming);
      if (!local) {
        S.space.entries[incoming.id] = merged;
        if (!merged.deleted) added += 1;
      } else if (M.signature(merged) !== M.signature(local)) {
        S.space.entries[incoming.id] = merged;
        updated += 1;
      }
    }
    const theirName = str(payload.names[payload.from]);
    if (theirName) S.space.names[payload.from] = theirName;
    S.space.partnerSeen = true;
    S.space.lastReceivedAt = U.now();
    S.save();
    return { added, updated };
  };

  /** Sets up this device from a full copy your partner sent. */
  S.join = (payload, password) => {
    S.create({ id: payload.space, me: M.other(payload.from), names: payload.names, password, entries: payload.entries });
    S.space.partnerSeen = true;
    S.space.lastReceivedAt = U.now();
    S.save();
  };

  DP.state = S;
})(window.DP = window.DP || {});
