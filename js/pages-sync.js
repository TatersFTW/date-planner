/* ==========================================================================
   pages-sync.js: Sync and backup, first-time setup, and the password screen.
   ========================================================================== */
(function (DP) {
  "use strict";

  const U = DP.util;
  const S = DP.state;
  const P = DP.parts;
  const { el } = U;
  DP.pages = DP.pages || {};

  const MIN_PASSWORD = 6;

  /* ---- Sync ---- */
  DP.pages.sync = function (ctx) {
    const space = S.space;
    const partner = S.nameOf(S.partnerId());
    const pending = S.pendingCount();
    const when = (t) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");

    const paste = el("textarea", { rows: "3", placeholder: "Paste a link or backup text here", "aria-label": "Link or backup text", "data-fk": "paste" });
    const file = el("input", {
      type: "file", accept: ".txt,text/plain", class: "visually-hidden",
      onchange: async (e) => {
        const chosen = e.target.files[0];
        if (chosen) ctx.importText(await chosen.text());
      }
    });

    const myName = el("input", {
      type: "text", value: space.names[space.me], maxlength: "40", "data-fk": "my-name",
      onchange: (e) => {
        const value = e.target.value.trim();
        if (value) { space.names[space.me] = value; S.save(); }
        ctx.render();
      }
    });

    return [
      P.hero("Sync and backup", `Your dates live on your devices. Swap private links with ${partner} to keep both copies the same.`),

      el("section", { class: "card" }, [
        el("h2", { text: `Send updates to ${partner}` }),
        el("p", { text: pending ? `${U.plural(pending, "change")} not sent yet.` : "Everything you changed has been sent." }),
        el("p", { class: "meta", text: `Last sent: ${when(space.lastSentAt)}. Last received: ${when(space.lastReceivedAt)}.` }),
        el("div", { class: "btn-row" }, [
          P.button("Copy update link", "btn primary", () => ctx.copyLink("delta"), "copy-delta"),
          P.button("Copy full link", "btn quiet", () => ctx.copyLink("full"), "copy-full")
        ]),
        el("p", { class: "field-hint", text: `The update link has your recent changes. Use the full link if ${partner} got a new phone or hasn't synced in a couple of months. Only someone with the shared password can open either.` })
      ]),

      el("section", { class: "card" }, [
        el("h2", { text: "Got a link or a backup?" }),
        el("p", { text: `Opening a link from ${partner} merges it automatically. If it opened in another app's browser, copy the link and paste it here instead.` }),
        paste,
        el("div", { class: "btn-row" }, [
          P.button("Merge", "btn primary", () => ctx.importText(paste.value), "merge"),
          el("label", { class: "btn quiet file-label" }, ["Choose backup file", file])
        ])
      ]),

      el("section", { class: "card" }, [
        el("h2", { text: "Backup" }),
        el("p", { text: "An encrypted copy of every date. Restoring only adds and updates, it never deletes anything." }),
        el("div", { class: "btn-row" }, [
          P.button("Download backup", "btn", async () => {
            if (!DP.crypto.supported()) return U.toast("Encryption needs https.");
            U.download(`our-dates-backup-${U.todayIso()}.txt`, await DP.sync.createCipher("full"));
          }, "backup-download"),
          P.button("Copy backup text", "btn quiet", async () => {
            if (!DP.crypto.supported()) return U.toast("Encryption needs https.");
            await U.copyText(await DP.sync.createCipher("full"));
            U.toast("Backup copied.");
          }, "backup-copy")
        ])
      ]),

      el("section", { class: "card" }, [
        el("h2", { text: "You" }),
        P.field("Your name", myName, `${partner} sees this name after your next update.`),
        el("p", { class: "meta", text: `Partner: ${partner}. They can change their own name.` }),
        P.button("Reset this device", "btn small danger", () => {
          if (!window.confirm("Remove all dates from this device? Your partner keeps their copy, and you can restore from a link or backup.")) return;
          S.reset();
          ctx.ui.route = "dates";
          ctx.go("dates");
          ctx.render();
        }, "reset")
      ])
    ];
  };

  /* ---- First-time setup ---- */
  DP.pages.onboarding = function (ctx) {
    const d = ctx.ui.setup;
    const bind = (key) => (e) => { d[key] = e.target.value; };
    const paste = el("textarea", { rows: "3", placeholder: "Paste the invite link here", "aria-label": "Invite link", "data-fk": "join-paste" });

    function create() {
      const me = d.me.trim();
      const partner = d.partner.trim();
      const password = d.password.trim();
      if (!me || !partner) { U.toast("Add both names first."); return; }
      if (password.length < MIN_PASSWORD) { U.toast(`Use a password of at least ${MIN_PASSWORD} characters.`); return; }
      S.create({ id: U.uid() + U.uid(), me: "a", names: { a: me, b: partner }, password });
      ctx.ui.setup = { me: "", partner: "", password: "" };
      ctx.go("dates");
      U.toast(`Ready. Invite ${partner} from View Dates.`);
    }

    return [
      P.hero("Plan dates together.", "Either of you can suggest a date, the other answers, and everything you do together collects in your history. It lives on your two devices, not on a server."),
      el("section", { class: "card form" }, [
        el("h2", { text: "Start your shared space" }),
        P.field("Your name", el("input", { type: "text", value: d.me, maxlength: "40", placeholder: "Alex", "data-fk": "setup-me", oninput: bind("me") })),
        P.field("Their name", el("input", { type: "text", value: d.partner, maxlength: "40", placeholder: "Maya", "data-fk": "setup-partner", oninput: bind("partner") })),
        P.field("Shared password", el("input", { type: "text", value: d.password, autocomplete: "off", placeholder: "A phrase only you two know", "data-fk": "setup-password", oninput: bind("password") }),
          `At least ${MIN_PASSWORD} characters. It encrypts everything you send each other. Share it in person, never in the same message as a link.`),
        P.button("Start our space", "btn primary", create, "setup-create")
      ]),
      el("section", { class: "card" }, [
        el("h2", { text: "Were you invited?" }),
        el("p", { text: "Open the invite link you were sent. If it opened in another app, copy it and paste it here." }),
        paste,
        P.button("Join", "btn", () => ctx.importText(paste.value), "join")
      ])
    ];
  };

  /* ---- Password screen for an incoming link ---- */
  DP.pages.unlock = function (ctx) {
    const joining = !S.space;
    const input = el("input", { type: "password", autocomplete: "current-password", placeholder: "Password", "data-fk": "pw" });
    const error = el("p", { class: "error", role: "alert", text: ctx.ui.incoming.error || "" });
    const button = el("button", { type: "submit", class: "btn primary", text: "Unlock" });

    const form = el("form", {
      class: "lock-form",
      onsubmit: async (e) => {
        e.preventDefault();
        if (!input.value.trim()) return;
        button.disabled = true;
        button.textContent = "Unlocking\u2026";
        error.textContent = "";
        const message = await ctx.tryIncoming(input.value);
        if (message) {
          error.textContent = message;
          button.disabled = false;
          button.textContent = "Unlock";
          input.select();
        }
      }
    }, [
      P.field("Password", input),
      error,
      el("div", { class: "btn-row" }, [button, P.button("Cancel", "btn quiet", () => ctx.cancelIncoming(), "unlock-cancel")])
    ]);

    return [
      P.hero(joining ? "Join your shared dates" : "This link is private", joining ? "Enter the shared password to open the invite." : "Enter the shared password to open it."),
      form
    ];
  };
})(window.DP = window.DP || {});
