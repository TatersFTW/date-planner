/* ==========================================================================
   pages-dates.js: "View Dates" (what is coming up) and "Create Date" (the form).
   ========================================================================== */
(function (DP) {
  "use strict";

  const U = DP.util;
  const M = DP.model;
  const S = DP.state;
  const P = DP.parts;
  const { el } = U;
  DP.pages = DP.pages || {};

  const ANSWERS = [["in", "I'm in"], ["maybe", "Maybe"], ["no", "Can't"]];

  function partnerLine(entry) {
    const other = S.partnerId();
    const name = S.nameOf(other);
    const mine = entry.resp[S.space.me]?.v;
    const theirs = entry.resp[other]?.v;
    if (mine === "in" && theirs === "in") return "You both said yes. Ready to plan it?";
    if (theirs === "in") return `${name} is in.`;
    if (theirs === "maybe") return `${name} said maybe.`;
    if (theirs === "no") return `${name} can't make it.`;
    return `Waiting for ${name}'s answer.`;
  }

  function answerBlock(entry, ctx) {
    const mine = entry.resp[S.space.me]?.v || "";
    return el("div", { class: "answer-block" }, [
      el("div", { class: "answers", role: "group", "aria-label": `Your answer for ${entry.title}` },
        ANSWERS.map(([code, label]) => el("button", {
          type: "button",
          class: `answer answer-${code}${mine === code ? " on" : ""}`,
          "aria-pressed": String(mine === code),
          "data-fk": `a-${entry.id}-${code}`,
          text: label,
          onclick: () => { S.setResponse(entry.id, mine === code ? "" : code); ctx.render(); }
        }))),
      el("p", { class: "meta", text: partnerLine(entry) })
    ]);
  }

  function upcomingTicket(entry, ctx) {
    const planned = entry.status === "planned";
    const proposer = entry.by === S.space.me ? "you" : S.nameOf(entry.by);
    const time = U.formatTime(entry.time);
    const until = planned ? U.untilText(entry.date) : "";
    const calendar = planned ? U.calendarUrl(entry) : null;

    const actions = [];
    if (!planned) {
      actions.push(P.button("Plan it", "btn small primary", () => {
        S.updateEntry(entry.id, { status: "planned" });
        ctx.render();
        U.toast("Planned. It stays here until the day.");
      }, `plan-${entry.id}`));
    }
    if (calendar) actions.push(el("a", { class: "btn small", href: calendar, target: "_blank", rel: "noopener noreferrer", text: "Add to calendar" }));
    actions.push(P.button("Edit", "btn small quiet", () => ctx.edit(entry.id), `edit-${entry.id}`));
    if (planned) {
      actions.push(P.button("Cancel date", "btn small quiet", () => {
        if (!window.confirm("Cancel this date? It moves to History as not happened.")) return;
        S.updateEntry(entry.id, { status: "cancelled" });
        ctx.render();
      }, `cancel-${entry.id}`));
    }

    return el("article", { class: `ticket${planned ? " planned" : ""}` }, [
      P.stub(entry),
      el("div", { class: "ticket-body" }, [
        el("div", { class: "pills" }, [P.pill(M.KINDS[entry.kind]), planned && P.pill("Planned", "accent"), until && P.pill(until)]),
        el("h3", { class: "what", text: entry.title || "Date idea" }),
        time && el("p", { class: "meta", text: time }),
        entry.place && el("p", { class: "meta", text: entry.place }),
        el("p", { class: "meta", text: `Proposed by ${proposer}` }),
        entry.note && el("p", { class: "detail", text: entry.note }),
        !planned && answerBlock(entry, ctx),
        el("div", { class: "ticket-actions" }, actions)
      ])
    ]);
  }

  function inviteCard(ctx) {
    const partner = S.nameOf(S.partnerId());
    return el("section", { class: "card invite" }, [
      el("h2", { text: `Invite ${partner}` }),
      el("p", { text: `Send ${partner} this link so they get their own copy. Tell them the shared password in person or in a separate message, never in the same one.` }),
      P.button("Copy invite link", "btn primary", () => ctx.copyLink("full"), "invite")
    ]);
  }

  /* ---- View Dates ---- */
  DP.pages.dates = function (ctx) {
    const today = U.todayIso();
    const me = S.space.me;
    const upcoming = S.list().filter((e) => M.outcome(e, today) === "upcoming").sort(M.byWhen);
    const planned = upcoming.filter((e) => e.status === "planned");
    const ideas = upcoming.filter((e) => e.status === "idea");
    const waiting = ideas.filter((e) => !e.resp[me]?.v).length;

    const bits = [];
    if (planned.length) bits.push(`${planned.length} planned`);
    if (ideas.length) bits.push(U.plural(ideas.length, "idea"));
    if (waiting) bits.push(`${waiting} waiting for your answer`);

    const group = (title, list) => el("section", { class: "group" }, [
      el("h2", { text: title }),
      el("ul", { class: "list" }, list.map((e) => el("li", {}, [upcomingTicket(e, ctx)])))
    ]);

    return [
      P.hero("Coming up", bits.length ? `${bits.join(", ")}.` : "Nothing coming up yet."),
      !S.space.partnerSeen ? inviteCard(ctx) : null,
      planned.length > 0 ? group("Planned", planned) : null,
      ideas.length > 0 ? group("Ideas", ideas) : null,
      upcoming.length === 0
        ? el("div", { class: "empty-card" }, [
            el("p", { text: "Add a date idea and send it over. Either of you can start one." }),
            P.button("Create a date", "btn small primary", () => ctx.startNew(), "empty-create")
          ])
        : null
    ];
  };

  /* ---- Create Date (also used to edit) ---- */
  const blankDraft = () => ({ title: "", kind: "us", date: U.nextSaturdayIso(), time: "19:00", place: "", note: "", decided: false });
  const draftFrom = (e) => ({ title: e.title, kind: e.kind, date: e.date, time: e.time, place: e.place, note: e.note, decided: e.status === "planned" });

  DP.pages.form = function (ctx) {
    let editing = ctx.ui.editingId ? S.get(ctx.ui.editingId) : null;
    if (ctx.ui.editingId && !editing) ctx.ui.editingId = null;
    const d = (ctx.ui.draft = ctx.ui.draft || (editing ? draftFrom(editing) : blankDraft()));
    const partner = S.nameOf(S.partnerId());
    const isPast = !!d.date && d.date < U.todayIso();
    const bind = (key) => (e) => { d[key] = e.target.value; };

    function save() {
      const title = d.title.trim();
      if (!title || !d.date) {
        U.toast("Add a title and a date first.");
        ctx.ui.pendingFocus = title ? "f-date" : "f-title";
        return ctx.render();
      }
      let status = d.decided ? "planned" : editing && editing.status === "cancelled" ? "cancelled" : "idea";
      if (d.date < U.todayIso() && status !== "cancelled") status = "planned"; // a past date is something that happened
      const fields = { title, kind: d.kind, date: d.date, time: d.time, place: d.place.trim(), note: d.note.trim(), status };
      if (editing) S.updateEntry(editing.id, fields);
      else S.addEntry(fields);
      const past = d.date < U.todayIso();
      ctx.ui.editingId = null;
      ctx.ui.draft = null;
      U.toast(past ? "Saved to History." : `Saved. Send an update so ${partner} sees it.`);
      ctx.go(past ? "history" : "dates");
    }

    function remove() {
      if (!window.confirm("Delete this date for both of you? This can't be undone.")) return;
      S.removeEntry(editing.id);
      ctx.ui.editingId = null;
      ctx.ui.draft = null;
      U.toast("Deleted.");
      ctx.go("dates");
    }

    const note = el("textarea", { rows: "3", maxlength: "400", placeholder: "Anything to remember: dress code, tickets, who is driving", "data-fk": "f-note", oninput: bind("note") });
    note.value = d.note;

    return [
      P.hero(editing ? "Edit date" : "Plan a date", editing ? "Changes reach " + partner + " the next time you send an update." : `Add it here, then send an update so ${partner} can answer.`),
      el("section", { class: "card form" }, [
        P.field("What are you doing?", el("input", { type: "text", value: d.title, maxlength: "80", placeholder: "Dinner and a movie", "data-fk": "f-title", oninput: bind("title") })),
        P.fieldGroup("Who is it with?", el("div", { class: "chips small", role: "group", "aria-label": "Who is this date with?" },
          M.KIND_ORDER.map((k) => P.chip(M.KINDS[k], d.kind === k, () => { d.kind = k; ctx.render(); }, `f-kind-${k}`)))),
        el("div", { class: "row-2" }, [
          P.field("Date", el("input", { type: "date", value: d.date, "data-fk": "f-date", onchange: (e) => { d.date = e.target.value; ctx.render(); } })),
          P.field("Time", el("input", { type: "time", value: d.time, "data-fk": "f-time", onchange: bind("time") }))
        ]),
        isPast ? el("p", { class: "field-hint", text: "This date has passed, so it goes straight to History." }) : null,
        P.field("Where (optional)", el("input", { type: "text", value: d.place, maxlength: "100", placeholder: "Our favorite ramen spot", "data-fk": "f-place", oninput: bind("place") })),
        P.field("Notes (optional)", note),
        !isPast
          ? el("label", { class: "check" }, [
              el("input", { type: "checkbox", checked: d.decided, "data-fk": "f-decided", onchange: (e) => { d.decided = e.target.checked; } }),
              el("span", { text: "We've already decided on this one" })
            ])
          : null,
        el("div", { class: "btn-row" }, [
          P.button("Save date", "btn primary", save, "f-save"),
          P.button("Cancel", "btn quiet", () => { ctx.ui.editingId = null; ctx.ui.draft = null; ctx.go("dates"); }, "f-cancel")
        ]),
        editing ? P.button("Delete this date", "btn small danger", remove, "f-delete") : null
      ])
    ];
  };
})(window.DP = window.DP || {});
