/* ==========================================================================
   parts.js: small reusable pieces of interface (ticket stub, chips, hearts,
   form fields) and the app header with its tabs.
   ========================================================================== */
(function (DP) {
  "use strict";

  const U = DP.util;
  const S = DP.state;
  const { el } = U;

  /** The torn-off date on the left of a ticket. compact = month / day / year. */
  function stub(entry, { compact = false } = {}) {
    const d = U.parseDate(entry.date);
    const fmt = (opts) => (d ? d.toLocaleDateString(undefined, opts) : "");
    return el("div", { class: `stub${compact ? " compact" : ""}` }, [
      el("span", { class: "dow", text: compact ? fmt({ month: "short" }) : fmt({ weekday: "short" }) || "Date" }),
      el("span", { class: "day", text: d ? String(d.getDate()) : "?" }),
      el("span", { class: "mon", text: compact ? fmt({ year: "numeric" }) : fmt({ month: "short" }) || "not set" })
    ]);
  }

  const pill = (text, extra = "") => el("span", { class: `pill ${extra}`.trim(), text });

  const button = (text, cls, onclick, fk) => el("button", { type: "button", class: cls, "data-fk": fk, text, onclick });

  const chip = (label, pressed, onclick, fk) =>
    el("button", { type: "button", class: "chip", "aria-pressed": String(pressed), "data-fk": fk, text: label, onclick });

  const hero = (title, text) =>
    el("header", { class: "hero" }, [el("h1", { text: title }), text && el("p", { class: "note", text })]);

  function field(label, control, hint) {
    return el("label", { class: "field" }, [el("span", { text: label }), control, hint && el("p", { class: "field-hint", text: hint })]);
  }

  /** Like field(), but for a group of buttons (a <label> would forward clicks to the first one). */
  const fieldGroup = (label, control) => el("div", { class: "field" }, [el("span", { text: label }), control]);

  /** Five tappable hearts. Tapping the current rating clears it. */
  function ratingInput(value, onChange, fkPrefix) {
    return el("div", { class: "hearts", role: "group", "aria-label": "Your rating" },
      [1, 2, 3, 4, 5].map((n) => el("button", {
        type: "button",
        class: `heart${n <= value ? " on" : ""}`,
        "aria-label": `${n} out of 5`,
        "aria-pressed": String(value === n),
        "data-fk": `${fkPrefix}-${n}`,
        text: n <= value ? "\u2665" : "\u2661",
        onclick: () => onChange(value === n ? 0 : n)
      })));
  }

  const heartsText = (n) => "\u2665".repeat(n) + "\u2661".repeat(5 - n);
  const ratingText = (avg) => (avg ? `\u2665 ${Number(avg.toFixed(1))}` : "");

  /** Keeps the "Sync (2)" badge right without redrawing the whole page. */
  function updateBadge() {
    const btn = document.querySelector(".syncbtn");
    if (!btn) return;
    const n = S.pendingCount();
    btn.classList.toggle("has", n > 0);
    let badge = btn.querySelector(".badge");
    if (n > 0) {
      if (!badge) { badge = el("span", { class: "badge" }); btn.append(badge); }
      badge.textContent = String(n);
    } else if (badge) {
      badge.remove();
    }
  }

  function header(ctx) {
    const n = S.pendingCount();
    const route = ctx.ui.route;
    const tab = (name, label, onclick) => el("button", {
      type: "button",
      "aria-current": route === name ? "page" : null,
      "data-fk": `tab-${name}`,
      text: label,
      onclick
    });
    return el("header", { class: "appbar" }, [
      el("div", { class: "appbar-row" }, [
        el("div", {}, [
          el("p", { class: "brand", text: "Our dates" }),
          el("p", { class: "pair", text: `${S.nameOf(S.space.me)} and ${S.nameOf(S.partnerId())}` })
        ]),
        el("button", {
          type: "button",
          class: `syncbtn${n ? " has" : ""}`,
          "aria-current": route === "sync" ? "page" : null,
          "aria-label": n ? `Sync, ${U.plural(n, "change")} to send` : "Sync",
          "data-fk": "tab-sync",
          onclick: () => ctx.go("sync")
        }, ["Sync", n > 0 && el("span", { class: "badge", text: String(n) })])
      ]),
      el("nav", { class: "tabs", "aria-label": "Sections" }, [
        tab("dates", "View Dates", () => ctx.go("dates")),
        tab("new", "Create Date", () => ctx.startNew()),
        tab("history", "History", () => ctx.go("history"))
      ])
    ]);
  }

  DP.parts = { stub, pill, button, chip, hero, field, fieldGroup, ratingInput, heartsText, ratingText, updateBadge, header };
})(window.DP = window.DP || {});
