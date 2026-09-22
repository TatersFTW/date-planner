/* ==========================================================================
   pages-history.js: the History page.
   Built to stay easy to move around in as it grows: search, filters that show
   live counts, year buttons, dates grouped by month, "show more" paging,
   and a memory (hearts and a note) each of you can add to a date that happened.
   ========================================================================== */
(function (DP) {
  "use strict";

  const U = DP.util;
  const M = DP.model;
  const S = DP.state;
  const P = DP.parts;
  const { el } = U;
  DP.pages = DP.pages || {};

  const PAGE_SIZE = 25;

  const OUTCOMES = [["happened", "Happened"], ["missed", "Didn't happen"], ["all", "All"]];
  const OUTCOME_LABEL = { cancelled: "Cancelled", passed: "Not planned" };

  DP.pages.history = function (ctx) {
    const f = ctx.ui.history;
    const today = U.todayIso();
    const base = S.list().filter((e) => M.isHistory(e, today));
    const happened = base.filter((e) => M.outcome(e, today) === "happened");

    /* ---- filtering ---- */
    const haystack = (e) =>
      [e.title, e.place, e.note, ...M.MEMBERS.map((m) => e.memo[m]?.text || "")].join(" ").toLowerCase();

    const outcomeMatches = (value, e) =>
      value === "all" || (value === "happened") === (M.outcome(e, today) === "happened");

    const tests = {
      outcome: (e) => outcomeMatches(f.outcome, e),
      kind: (e) => f.kind === "all" || e.kind === f.kind,
      year: (e) => f.year === "all" || e.date.slice(0, 4) === f.year,
      query: (e) => !f.query.trim() || haystack(e).includes(f.query.trim().toLowerCase())
    };

    /** Everything that passes every filter except `skip` (used for the counts on each filter). */
    const filtered = (skip) => base.filter((e) => Object.keys(tests).every((key) => key === skip || tests[key](e)));

    function resultList() {
      const list = filtered().sort(M.byWhen);
      if (f.sort === "desc") list.reverse();
      return list;
    }

    /* ---- small helpers ---- */
    const keepFocus = (fn) => {
      const key = document.activeElement?.dataset?.fk;
      fn();
      if (key) document.querySelector(`[data-fk="${key}"]`)?.focus();
    };
    const setFilter = (patch) => keepFocus(() => { Object.assign(f, patch, { limit: PAGE_SIZE }); paint(); });

    /* ---- the summary sentence at the top ---- */
    function summary() {
      const year = String(new Date().getFullYear());
      const thisYear = happened.filter((e) => e.date.startsWith(year)).length;
      const rated = happened.filter((e) => M.avgRating(e) > 0).sort((a, b) => M.avgRating(b) - M.avgRating(a) || b.date.localeCompare(a.date));
      if (!happened.length) return [el("p", { class: "note", text: "Dates collect here once their day has passed." })];
      return [
        el("p", { class: "note" }, [el("strong", { text: U.plural(happened.length, "date") }), ` so far, ${thisYear} of them this year.`]),
        rated.length
          ? el("p", { class: "meta", text: `Best rated: ${rated[0].title} (${P.ratingText(M.avgRating(rated[0]))})` })
          : null
      ];
    }

    /* ---- filter controls ---- */
    function filterNodes() {
      if (!base.length) return [];
      const years = [...new Set(base.map((e) => e.date.slice(0, 4)))].sort().reverse();
      const kinds = M.KIND_ORDER.filter((k) => base.some((e) => e.kind === k));
      const nodes = [];

      const outcomePool = filtered("outcome");
      nodes.push(el("div", { class: "chips", role: "group", "aria-label": "Show" },
        OUTCOMES.map(([value, label]) => {
          const n = outcomePool.filter((e) => outcomeMatches(value, e)).length;
          return P.chip(`${label} (${n})`, f.outcome === value, () => setFilter({ outcome: value }), `hf-outcome-${value}`);
        })));

      if (kinds.length > 1) {
        const pool = filtered("kind");
        nodes.push(el("div", { class: "chips", role: "group", "aria-label": "Who it was with" }, [
          P.chip(`Everyone (${pool.length})`, f.kind === "all", () => setFilter({ kind: "all" }), "hf-kind-all"),
          ...kinds.map((k) => P.chip(`${M.KINDS[k]} (${pool.filter((e) => e.kind === k).length})`, f.kind === k, () => setFilter({ kind: k }), `hf-kind-${k}`))
        ]));
      }

      if (years.length > 1) {
        const pool = filtered("year");
        nodes.push(el("div", { class: "chips", role: "group", "aria-label": "Year" }, [
          P.chip(`All years (${pool.length})`, f.year === "all", () => setFilter({ year: "all" }), "hf-year-all"),
          ...years.map((y) => P.chip(`${y} (${pool.filter((e) => e.date.startsWith(y)).length})`, f.year === y, () => setFilter({ year: y }), `hf-year-${y}`))
        ]));
      }
      return nodes;
    }

    /* ---- one date in the list ---- */
    function memoryBlock(entry, member) {
      const mine = member === S.space.me;
      const memo = entry.memo[member] || { rating: 0, text: "" };
      const title = mine ? "Your memory" : `${S.nameOf(member)}'s memory`;

      if (!mine) {
        return el("div", { class: "memory" }, [
          el("h4", { text: title }),
          el("p", { class: "hearts-static", text: memo.rating ? P.heartsText(memo.rating) : "No rating yet" }),
          el("p", { class: "detail", text: memo.text || "Nothing written yet." })
        ]);
      }

      const text = el("textarea", {
        rows: "2", maxlength: "500", placeholder: "What do you want to remember about this one?",
        "aria-label": "Your memory", "data-fk": `m-${entry.id}`,
        onchange: (e) => { S.setMemo(entry.id, { text: e.target.value.trim() }); P.updateBadge(); }
      });
      text.value = memo.text;
      return el("div", { class: "memory" }, [
        el("h4", { text: title }),
        P.ratingInput(memo.rating, (n) => { S.setMemo(entry.id, { rating: n }); ctx.render(); }, `hr-${entry.id}`),
        text
      ]);
    }

    function detail(entry) {
      const happenedIt = M.outcome(entry, today) === "happened";
      return el("div", { class: "hdetail" }, [
        el("p", { class: "meta", text: U.longDate(entry.date, entry.time) }),
        entry.place && el("p", { class: "meta", text: entry.place }),
        el("p", { class: "meta", text: `Proposed by ${entry.by === S.space.me ? "you" : S.nameOf(entry.by)}` }),
        entry.note && el("p", { class: "detail", text: entry.note }),
        happenedIt ? [memoryBlock(entry, S.space.me), memoryBlock(entry, S.partnerId())] : null,
        el("div", { class: "ticket-actions" }, [
          P.button("Edit", "btn small quiet", () => ctx.edit(entry.id), `he-${entry.id}`),
          P.button("Delete", "btn small quiet", () => {
            if (!window.confirm("Delete this date for both of you? This can't be undone.")) return;
            S.removeEntry(entry.id);
            f.open = null;
            ctx.render();
          }, `hd-${entry.id}`)
        ])
      ]);
    }

    function row(entry) {
      const open = f.open === entry.id;
      const result = M.outcome(entry, today);
      const rating = P.ratingText(M.avgRating(entry));
      return el("li", { class: `hrow${open ? " open" : ""}` }, [
        el("button", {
          type: "button", class: "hrow-head", "aria-expanded": String(open), "data-fk": `h-${entry.id}`,
          onclick: () => keepFocus(() => { f.open = open ? null : entry.id; paint(); })
        }, [
          P.stub(entry, { compact: true }),
          el("span", { class: "hrow-main" }, [
            el("span", { class: "what", text: entry.title || "Date idea" }),
            el("span", { class: "meta", text: [M.KINDS[entry.kind], entry.place].filter(Boolean).join(", ") }),
            OUTCOME_LABEL[result] ? P.pill(OUTCOME_LABEL[result]) : null
          ]),
          rating ? el("span", { class: "rating", "aria-label": `Average rating ${rating.slice(2)} out of 5`, text: rating }) : null
        ]),
        open ? detail(entry) : null
      ]);
    }

    function listNodes() {
      if (!base.length) {
        return [el("div", { class: "empty-card" }, [
          el("p", { text: "Nothing here yet. A date moves to History the day after it happens. You can also log one from the past with Create Date." }),
          P.button("Log a past date", "btn small primary", () => ctx.startNew(), "hist-create")
        ])];
      }
      const list = resultList();
      if (!list.length) {
        return [el("div", { class: "empty-card" }, [
          el("p", { text: "No dates match these filters." }),
          P.button("Clear filters", "btn small", () => { ctx.resetHistoryFilters(); ctx.render(); }, "hist-clear")
        ])];
      }

      const shown = list.slice(0, f.limit);
      const groups = [];
      for (const entry of shown) {
        const key = entry.date.slice(0, 7);
        let group = groups[groups.length - 1];
        if (!group || group.key !== key) { group = { key, items: [] }; groups.push(group); }
        group.items.push(entry);
      }

      const nodes = [el("p", { class: "count", text: U.plural(list.length, "date") })];
      for (const group of groups) {
        nodes.push(el("section", { class: "month" }, [
          el("h3", { class: "month-title", text: U.monthLabel(group.key) }),
          el("ul", { class: "list compact" }, group.items.map(row))
        ]));
      }
      if (list.length > shown.length) {
        nodes.push(P.button(`Show ${Math.min(PAGE_SIZE, list.length - shown.length)} more`, "btn add", () => { f.limit += PAGE_SIZE; paint(); }, "hist-more"));
      }
      return nodes;
    }

    /* ---- put it on the page ---- */
    const filterBox = el("div", { class: "filters" });
    const listBox = el("div", { class: "results" });
    const paint = () => {
      filterBox.replaceChildren(...filterNodes());
      listBox.replaceChildren(...listNodes());
      sortBtn.textContent = f.sort === "desc" ? "Newest first" : "Oldest first";
    };

    const search = el("input", {
      type: "search", value: f.query, placeholder: "Search titles, places and memories", "aria-label": "Search history",
      "data-fk": "hist-search",
      oninput: (e) => { f.query = e.target.value; f.limit = PAGE_SIZE; paint(); }
    });
    const sortBtn = el("button", {
      type: "button", class: "btn small quiet", "data-fk": "hist-sort",
      onclick: () => keepFocus(() => { f.sort = f.sort === "desc" ? "asc" : "desc"; paint(); })
    });

    const page = [
      el("header", { class: "hero" }, [el("h1", { text: "Our history" }), ...summary()]),
      base.length > 0 ? el("div", { class: "toolbar" }, [search, sortBtn]) : null,
      filterBox,
      listBox
    ];
    paint();
    return page;
  };
})(window.DP = window.DP || {});
