/* ==========================================================================
   app.js: start-up, page routing, and handling links that come in.

   Addresses:
     #/dates  #/new  #/history  #/sync   the pages (the back button works)
     #s=...                              an encrypted link from your partner
   ========================================================================== */
(function (DP) {
  "use strict";

  const U = DP.util;
  const S = DP.state;
  const P = DP.parts;
  const { el } = U;

  const ROUTES = ["dates", "new", "history", "sync"];
  const root = U.byId("root");

  const defaultHistory = () => ({ query: "", kind: "all", outcome: "happened", year: "all", sort: "desc", limit: 25, open: null });

  /** Everything about what's on screen right now (nothing here is saved). */
  const ui = {
    route: "dates",
    editingId: null,
    draft: null,
    incoming: null,        // { cipher, error } while a link waits for a password
    setup: { me: "", partner: "", password: "" },
    pendingFocus: null,
    history: defaultHistory()
  };

  /* ---- drawing ---- */
  function render() {
    let focusKey = ui.pendingFocus || document.activeElement?.dataset?.fk;
    ui.pendingFocus = null;

    let content;
    if (ui.incoming) content = DP.pages.unlock(ctx);
    else if (!S.space) content = DP.pages.onboarding(ctx);
    else content = [P.header(ctx), DP.pages[ui.route === "new" ? "form" : ui.route](ctx)];

    root.replaceChildren(el("main", { class: "wrap" }, content));

    if (ui.incoming) focusKey = focusKey || "pw";
    if (focusKey) root.querySelector(`[data-fk="${focusKey}"]`)?.focus();
  }

  /* ---- moving around ---- */
  function go(route) {
    const target = `#/${route}`;
    if (location.hash === target) render();
    else location.hash = target;
  }

  function startNew() {
    ui.editingId = null;
    ui.draft = null;
    go("new");
  }

  function edit(id) {
    ui.editingId = id;
    ui.draft = null;
    go("new");
  }

  function routeFromHash() {
    const link = /^#s=([\w-]+)$/.exec(location.hash);
    if (link) return handleIncoming(link[1]);

    const match = /^#\/(\w+)$/.exec(location.hash);
    const route = match && ROUTES.includes(match[1]) ? match[1] : "dates";
    const changed = route !== ui.route;
    ui.route = route;
    if (route !== "new") { ui.editingId = null; ui.draft = null; }
    render();
    if (changed) window.scrollTo(0, 0);
  }

  /* ---- links and backups coming in ---- */
  const problems = {
    password: () => "That password didn't work. Check it and try again.",
    space: () => "This link belongs to a different shared space, so it can't be merged here.",
    own: () => "This link was made on this device, so there is nothing new to merge.",
    partial: ({ who }) => `This link only has recent updates. Ask ${who || "your partner"} to send the full link from the Sync page.`,
    unsupported: () => "This browser can't open the link. Use an up-to-date browser over https."
  };

  /** Tries one password on the waiting link. Returns { ok, message } or { ok: false, reason }. */
  async function attempt(cipher, password) {
    if (!DP.crypto.supported()) return { ok: false, reason: "unsupported" };
    let payload;
    try {
      payload = await DP.sync.open(cipher, password);
    } catch {
      return { ok: false, reason: "password" };
    }

    if (S.space) {
      if (payload.space !== S.space.id) return { ok: false, reason: "space" };
      if (payload.from === S.space.me) return { ok: false, reason: "own" };
      const { added, updated } = S.mergeIncoming(payload);
      const from = S.nameOf(payload.from);
      return {
        ok: true,
        message: added + updated === 0
          ? "Already up to date."
          : `Merged from ${from}: ${U.plural(added, "new date")}, ${updated} updated.`
      };
    }

    if (payload.kind !== "full") return { ok: false, reason: "partial", who: payload.names[payload.from] };
    S.join(payload, password.trim());
    return { ok: true, message: `Welcome! Your shared dates from ${payload.names[payload.from]} are here.` };
  }

  function leaveIncoming() {
    ui.incoming = null;
    ui.route = "dates";
    history.replaceState(null, "", `${location.pathname}${location.search}#/dates`);
    window.scrollTo(0, 0);
  }

  function finishIncoming(message) {
    leaveIncoming();
    render();
    U.toast(message);
  }

  function cancelIncoming() {
    leaveIncoming();
    render();
  }

  async function handleIncoming(cipher) {
    ui.incoming = { cipher, error: "" };
    if (S.space) {
      const result = await attempt(cipher, S.space.password);
      if (result.ok) return finishIncoming(result.message);
      if (result.reason === "own") { leaveIncoming(); render(); return U.toast(problems.own()); }
      if (result.reason !== "password") ui.incoming.error = problems[result.reason](result);
    }
    render();
  }

  /** Called by the password screen. Returns an error message, or null when it worked. */
  async function tryIncoming(password) {
    const result = await attempt(ui.incoming.cipher, password);
    if (result.ok) { finishIncoming(result.message); return null; }
    return problems[result.reason](result);
  }

  function importText(text) {
    const cipher = DP.sync.extractCipher(text);
    if (!cipher) return U.toast("That doesn't look like a link or backup from this app.");
    return handleIncoming(cipher);
  }

  async function copyLink(kind) {
    if (!DP.crypto.supported()) return U.toast("Encryption needs https. Open the live site, not a local file.");
    const partner = S.nameOf(S.partnerId());
    try {
      const url = await DP.sync.createLink(kind);
      S.markSent();
      try {
        await U.copyText(url);
        U.toast(`Link copied. Send it to ${partner}.`);
      } catch {
        window.prompt(`Copy this link and send it to ${partner}:`, url);
      }
      render();
    } catch {
      U.toast("Couldn't create the link. Try again.");
    }
  }

  const ctx = {
    ui, render, go, startNew, edit, copyLink, importText, tryIncoming, cancelIncoming,
    resetHistoryFilters: () => Object.assign(ui.history, defaultHistory())
  };

  /* ---- start ---- */
  window.addEventListener("hashchange", routeFromHash);
  S.load();
  routeFromHash();
})(window.DP = window.DP || {});
