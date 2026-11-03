/* Learning the Rules: result charts, drawn as plain SVG from data/results.json.
   Mount points: <div data-lr-chart="heldout|tiers|proposers|tiles" data-base=".../data/">.
   Every chart has a hover/focus tooltip and a table view underneath. */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) {
      if (attrs[k] == null) continue;
      if (k === "text") e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (Array.isArray(kids) ? kids : kids == null ? [] : [kids]).forEach(function (c) {
      if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return e;
  }
  function s(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs || {}) {
      if (attrs[k] == null) continue;
      if (k === "text") e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(e);
    return e;
  }
  function clear(e) {
    while (e.firstChild) e.removeChild(e.firstChild);
  }

  var GROUP = {
    search: { name: "Hypothesis search", color: "var(--lr-s1)" },
    llm: { name: "LLM acts directly", color: "var(--lr-s2)" },
    none: { name: "No model", color: "var(--lr-none)" },
  };
  function groupOf(id) {
    if (id.indexOf("search") === 0) return "search";
    if (id === "explore_ctx") return "none";
    return "llm";
  }
  var LABELS = {
    search_eig_learned: "Search + fine-tuned 8B scorer",
    search_eig: "Search, no scorer",
    search_map: "Search, follow best model",
    search_random: "Search, random experiments",
    policy_opus: "Choice-only, Claude Opus 5.5",
    policy_haiku: "Choice-only, Claude Haiku 5.5",
    reflection_haiku: "Reflection, Claude Haiku 5.5",
    reflection: "Reflection, Qwen3-8B",
    explore_ctx: "Explorer, no model",
    oracle: "Oracle",
  };
  function label(d, id) {
    return LABELS[id] || (d.labels && d.labels[id]) || id;
  }
  function f1(x) {
    return x.toFixed(1);
  }
  function usd(x) {
    return x >= 0.095 ? "$" + x.toFixed(2) : "$" + x.toFixed(3);
  }

  // ---- tooltip ----
  function Tip(container) {
    this.c = container;
    this.el = h("div", { class: "lr-tip", role: "tooltip" });
    container.appendChild(this.el);
  }
  Tip.prototype.show = function (target, build) {
    clear(this.el);
    build(this.el);
    var cr = this.c.getBoundingClientRect();
    var tr = target.getBoundingClientRect();
    this.el.classList.add("lr-on");
    var tw = this.el.offsetWidth,
      th = this.el.offsetHeight;
    var x = tr.left - cr.left + tr.width / 2 - tw / 2;
    x = Math.max(0, Math.min(x, cr.width - tw));
    var y = tr.top - cr.top - th - 8;
    if (y < -20) y = tr.bottom - cr.top + 8;
    this.el.style.left = x + "px";
    this.el.style.top = y + "px";
  };
  Tip.prototype.hide = function () {
    this.el.classList.remove("lr-on");
  };
  function tipRow(parent, color, value, key) {
    parent.appendChild(h("div", { class: "lr-tip-row" }, [
      color ? h("span", { class: "lr-tip-key", style: "background:" + color }) : null,
      h("b", { text: value }),
      h("span", { class: "lr-tip-k", text: key }),
    ]));
  }
  function bindHit(el, tip, build) {
    el.setAttribute("tabindex", "0");
    el.setAttribute("class", "lr-hit");
    var show = function () { tip.show(el, build); };
    el.addEventListener("pointerenter", show);
    el.addEventListener("focus", show);
    el.addEventListener("pointerleave", function () { tip.hide(); });
    el.addEventListener("blur", function () { tip.hide(); });
  }

  // ---- responsive render: redraw at the container's real width ----
  function responsive(container, draw) {
    var last = -1;
    function go() {
      var w = Math.floor(container.clientWidth);
      if (w && w !== last) {
        last = w;
        draw(w);
      }
    }
    if ("ResizeObserver" in window) new ResizeObserver(go).observe(container);
    else window.addEventListener("resize", go);
    go();
  }

  function legend(items, square) {
    return h("div", { class: "lr-clegend" }, items.map(function (it) {
      return h("span", {}, [h("i", { class: square ? "lr-sq" : null, style: "background:" + it[1] }), it[0]]);
    }));
  }
  function tableView(caption, head, rows) {
    var tb = h("tbody", {}, rows.map(function (r) {
      return h("tr", {}, r.map(function (c, i) { return h(i ? "td" : "th", { text: c, scope: i ? null : "row" }); }));
    }));
    return h("details", { class: "lr-table" }, [
      h("summary", { text: "Show as a table" }),
      h("div", { class: "lr-table-scroll" }, h("table", {}, [h("caption", { class: "sr-only", text: caption }), h("thead", {}, h("tr", {}, head.map(function (c) { return h("th", { text: c, scope: "col" }); }))), tb])),
    ]);
  }
  function xAxis(g, x, y0, y1, ticks, fmt) {
    ticks.forEach(function (t) {
      s("line", { x1: x(t), x2: x(t), y1: y0, y2: y1, stroke: "var(--lr-grid)", "stroke-width": 1 }, g);
      s("text", { x: x(t), y: y1 + 16, "text-anchor": "middle", "font-size": 11, fill: "var(--lr-muted)", text: fmt ? fmt(t) : String(t) }, g);
    });
    s("line", { x1: x(ticks[0]), x2: x(ticks[ticks.length - 1]), y1: y1, y2: y1, stroke: "var(--lr-axis)", "stroke-width": 1 }, g);
  }

  // ======== 1. held-out, 15 paired episodes: dot + CI ========
  function chartHeldout(root, d) {
    var data = d.paired_heldout_15;
    var oracle = data.oracle;
    var ids = Object.keys(data).filter(function (k) { return k !== "oracle"; }).sort(function (a, b) { return data[a].mean - data[b].mean; });
    var used = {};
    ids.forEach(function (id) { used[groupOf(id)] = 1; });
    root.appendChild(legend(["search", "llm", "none"].filter(function (g) { return used[g]; }).map(function (g) { return [GROUP[g].name, GROUP[g].color]; })));
    var box = h("div", { class: "lr-chart" });
    root.appendChild(box);
    var tip = new Tip(box);
    var svgHost = h("div");
    box.appendChild(svgHost);

    responsive(svgHost, function (W) {
      clear(svgHost);
      var narrow = W < 560;
      var left = narrow ? 8 : 206,
        right = narrow ? 12 : 118,
        rowH = narrow ? 46 : 34,
        top = 6;
      var H = top + ids.length * rowH + 34;
      var svg = s("svg", { width: W, height: H, role: "img", "aria-label": "Mean steps to solve on 15 paired held-out episodes, with 95% confidence intervals" });
      svgHost.appendChild(svg);
      var x0 = left,
        x1 = W - right;
      var x = function (v) { return x0 + (v / 100) * (x1 - x0); };
      var g = s("g", {}, svg);
      xAxis(g, x, top, top + ids.length * rowH + 4, [0, 20, 40, 60, 80, 100]);
      // oracle reference
      s("line", { x1: x(oracle.mean), x2: x(oracle.mean), y1: top, y2: top + ids.length * rowH + 4, stroke: "var(--lr-muted)", "stroke-width": 1 }, g);
      s("text", { x: x(oracle.mean) + 4, y: top + ids.length * rowH - 2, "font-size": 10.5, fill: "var(--lr-muted)", text: "oracle " + f1(oracle.mean) }, g);

      ids.forEach(function (id, i) {
        var r = data[id];
        var cy = top + i * rowH + (narrow ? 30 : rowH / 2);
        var col = GROUP[groupOf(id)].color;
        var key = id === "search_eig_learned" || id === "policy_opus";
        var hit = s("rect", { x: 0, y: top + i * rowH, width: W, height: rowH, rx: 4 }, g);
        bindHit(hit, tip, function (t) {
          t.appendChild(h("div", { class: "lr-tip-v", text: f1(r.mean) + " steps" }));
          t.appendChild(h("div", { class: "lr-tip-k", text: label(d, id) }));
          tipRow(t, null, f1(r.ci[0]) + "–" + f1(r.ci[1]), "95% CI");
          tipRow(t, null, r.solved + "/" + r.n, "solved");
          if (r.usd_per_episode > 0) tipRow(t, null, usd(r.usd_per_episode), "API cost per episode");
        });
        s("text", {
          x: narrow ? x0 : left - 12,
          y: narrow ? cy - 14 : cy + 4,
          "text-anchor": narrow ? "start" : "end",
          "font-size": 12.5,
          "font-weight": key ? 600 : 400,
          fill: "var(--lr-ink)",
          text: label(d, id),
          stroke: narrow ? "var(--lr-surface)" : null,
          "stroke-width": narrow ? 4 : null,
          "paint-order": "stroke",
          "pointer-events": "none",
        }, g);
        s("line", { x1: x(r.ci[0]), x2: x(r.ci[1]), y1: cy, y2: cy, stroke: col, "stroke-width": 2, "stroke-linecap": "round", "pointer-events": "none" }, g);
        s("circle", { cx: x(r.mean), cy: cy, r: 5, fill: col, stroke: "var(--lr-surface)", "stroke-width": 2, "pointer-events": "none" }, g);
        var txt = f1(r.mean) + "  ·  " + r.solved + "/" + r.n + " solved";
        var tx = x(r.ci[1]) + 8;
        var anchor = "start";
        if (narrow) {
          s("text", { x: W - right, y: cy - 14, "text-anchor": "end", "font-size": 11.5, fill: "var(--lr-ink-2)", text: txt, "pointer-events": "none" }, g);
          return;
        }
        if (tx + txt.length * 6.2 > W) {
          tx = x(r.ci[0]) - 8;
          anchor = "end";
        }
        s("text", { x: tx, y: cy + 4, "text-anchor": anchor, "font-size": 11.5, fill: "var(--lr-ink-2)", text: txt, "pointer-events": "none" }, g);
      });
      s("text", { x: (x0 + x1) / 2, y: H - 2, "text-anchor": "middle", "font-size": 11, fill: "var(--lr-muted)", text: "Steps to solve (failure = 100). Mean and 95% bootstrap CI." }, g);
    });

    root.appendChild(tableView("Held-out, 15 paired episodes",
      ["Agent", "Mean steps", "95% CI", "Solved", "$ / episode"],
      ["oracle"].concat(ids).map(function (id) {
        var r = data[id];
        return [label(d, id), f1(r.mean), f1(r.ci[0]) + "–" + f1(r.ci[1]), r.solved + "/" + r.n, r.usd_per_episode > 0 ? usd(r.usd_per_episode) : "0 (local)"];
      })));
  }

  // ======== 2. tier breakdown: grouped columns ========
  function chartTiers(root, d) {
    var groups = [["tier 1", "Tier 1"], ["tiers 2-3", "Tiers 2–3"], ["tier 4", "Tier 4"], ["held-out", "Held-out (tier 5)"]];
    // Fixed categorical order (slots 1-4), so colour follows the agent everywhere on the page.
    var series = [
      ["search_eig_learned", "var(--lr-s1)"],
      ["reflection", "var(--lr-s2)"],
      ["search_eig", "var(--lr-s3)"],
      ["reflection_haiku", "var(--lr-s4)"],
    ].filter(function (p) { return d.summary[p[0]]; });
    root.appendChild(legend(series.map(function (p) { return [label(d, p[0]), p[1]]; }), true));
    var box = h("div", { class: "lr-chart" });
    root.appendChild(box);
    var tip = new Tip(box);
    var svgHost = h("div");
    box.appendChild(svgHost);

    responsive(svgHost, function (W) {
      clear(svgHost);
      var left = 34,
        right = 8,
        top = 18,
        plotH = 230,
        bottom = 40;
      var H = top + plotH + bottom;
      var svg = s("svg", { width: W, height: H, role: "img", "aria-label": "Mean steps by tier group for four agents, with 95% confidence intervals" });
      svgHost.appendChild(svg);
      var g = s("g", {}, svg);
      var y = function (v) { return top + plotH - (v / 100) * plotH; };
      [0, 20, 40, 60, 80, 100].forEach(function (t) {
        s("line", { x1: left, x2: W - right, y1: y(t), y2: y(t), stroke: t ? "var(--lr-grid)" : "var(--lr-axis)", "stroke-width": 1 }, g);
        s("text", { x: left - 6, y: y(t) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--lr-muted)", text: String(t) }, g);
      });
      var band = (W - left - right) / groups.length;
      var bw = Math.min(24, (band * 0.72) / series.length - 4);
      var gap = 4;
      groups.forEach(function (gr, gi) {
        var cx = left + band * gi + band / 2;
        var totalW = series.length * bw + (series.length - 1) * gap;
        var n = 0;
        series.forEach(function (p, si) {
          var r = d.summary[p[0]][gr[0]];
          if (!r) return;
          n = r.n;
          var bx = cx - totalW / 2 + si * (bw + gap);
          var by = y(r.mean),
            b0 = y(0);
          var rr = Math.min(4, bw / 2, b0 - by);
          s("path", {
            d: "M" + bx + " " + b0 + "V" + (by + rr) + "Q" + bx + " " + by + " " + (bx + rr) + " " + by + "H" + (bx + bw - rr) + "Q" + (bx + bw) + " " + by + " " + (bx + bw) + " " + (by + rr) + "V" + b0 + "Z",
            fill: p[1],
            "pointer-events": "none",
          }, g);
          var wx = bx + bw / 2;
          s("path", {
            d: "M" + wx + " " + y(r.ci[0]) + "V" + y(r.ci[1]) + "M" + (wx - 3) + " " + y(r.ci[0]) + "h6M" + (wx - 3) + " " + y(r.ci[1]) + "h6",
            stroke: "var(--lr-ink-2)",
            "stroke-width": 1.25,
            fill: "none",
            "pointer-events": "none",
          }, g);
          // direct labels only on the held-out group, where the story is
          if (gr[0] === "held-out" && bw >= 20)
            s("text", { x: wx, y: y(r.ci[1]) - 5, "text-anchor": "middle", "font-size": 10.5, fill: "var(--lr-ink-2)", text: f1(r.mean), "pointer-events": "none" }, g);
          var hit = s("rect", { x: bx - gap / 2, y: top, width: bw + gap, height: plotH, rx: 3 }, g);
          bindHit(hit, tip, function (t) {
            t.appendChild(h("div", { class: "lr-tip-v", text: f1(r.mean) + " steps" }));
            t.appendChild(h("div", { class: "lr-tip-k", text: label(d, p[0]) + " · " + gr[1] }));
            tipRow(t, null, f1(r.ci[0]) + "–" + f1(r.ci[1]), "95% CI");
            tipRow(t, null, r.solved + "/" + r.n, "solved");
          });
        });
        s("text", { x: cx, y: top + plotH + 17, "text-anchor": "middle", "font-size": 12, fill: "var(--lr-ink)", text: gr[1] }, g);
        s("text", { x: cx, y: top + plotH + 32, "text-anchor": "middle", "font-size": 10.5, fill: "var(--lr-muted)", text: n + " episodes" }, g);
      });
    });

    var rows = [];
    series.concat([["oracle"]]).forEach(function (p) {
      var sm = d.summary[p[0]];
      if (!sm) return;
      rows.push([label(d, p[0])].concat(groups.map(function (gr) {
        var r = sm[gr[0]];
        return r ? f1(r.mean) + " [" + f1(r.ci[0]) + ", " + f1(r.ci[1]) + "] " + r.solved + "/" + r.n : "–";
      })));
    });
    root.appendChild(tableView("Mean steps by tier group", ["Agent"].concat(groups.map(function (g) { return g[1]; })), rows));
  }

  // ======== 3. proposers: consistent vs correct (dumbbells, two panels) ========
  var PROPOSERS = [
    ["qwen8b_zeroshot", "Qwen3-8B, zero-shot"],
    ["qwen8b_sft_families", "SFT on the 12 families"],
    ["qwen8b_grpo_families_step100", "  + GRPO, step 100"],
    ["qwen8b_sft_mixed", "SFT on random mechanisms + families"],
    ["qwen8b_grpo_mixed_step125", "  + GRPO, step 125"],
    ["claude_haiku_5_5", "Claude Haiku 5.5, zero-shot"],
    ["claude_opus_5_5", "Claude Opus 5.5, zero-shot"],
  ];
  function chartProposers(root, d) {
    var P = d.proposers;
    var rows = PROPOSERS.filter(function (p) { return P[p[0]]; });
    var panels = [["tiers 1-4", "Training families (tiers 1–4)"], ["held-out (tier 5)", "Held-out families (tier 5)"]];
    var C_OK = "var(--lr-s1)",
      C_CONS = "var(--lr-s3)";
    root.appendChild(legend([["Correct: equivalent to the true door rules", C_OK], ["Consistent: reproduces the history", C_CONS]]));
    var box = h("div", { class: "lr-chart" });
    root.appendChild(box);
    var tip = new Tip(box);
    var svgHost = h("div");
    box.appendChild(svgHost);

    responsive(svgHost, function (W) {
      clear(svgHost);
      var side = W >= 700;
      var labelW = side ? 232 : 0;
      var rowH = side ? 30 : 40;
      var panelGap = side ? 28 : 0;
      var panelW = side ? (W - labelW - panelGap) / 2 : W;
      var head = 22;
      var panelH = head + rows.length * rowH + 26;
      var H = side ? panelH : panelH * 2 + 14;
      var svg = s("svg", { width: W, height: H, role: "img", "aria-label": "Share of rules written directly that are consistent with the history versus correct, on training and held-out families" });
      svgHost.appendChild(svg);
      panels.forEach(function (pn, pi) {
        var ox = side ? labelW + pi * (panelW + panelGap) : 0;
        var oy = side ? 0 : pi * (panelH + 14);
        var g = s("g", {}, svg);
        var x0 = ox + (side ? 6 : 8),
          x1 = ox + panelW - 14;
        var x = function (v) { return x0 + v * (x1 - x0); };
        s("text", { x: x0, y: oy + 13, "font-size": 12, "font-weight": 600, fill: "var(--lr-ink)", text: pn[1] }, g);
        xAxis(g, x, oy + head, oy + head + rows.length * rowH, [0, 0.25, 0.5, 0.75, 1], function (t) { return Math.round(t * 100) + "%"; });
        rows.forEach(function (p, i) {
          var r = P[p[0]][pn[0]];
          if (!r) return;
          var cy = oy + head + i * rowH + (side ? rowH / 2 : 28);
          if (!side || pi === 0) {
            s("text", {
              x: side ? labelW - 10 : x0,
              y: side ? cy + 4 : cy - 13,
              "text-anchor": side ? "end" : "start",
              "font-size": 12,
              fill: "var(--lr-ink)",
              text: p[1].trim(),
              "font-style": p[1].indexOf("  +") === 0 ? "italic" : null,
              "pointer-events": "none",
            }, g);
          }
          var hit = s("rect", { x: ox, y: cy - rowH / 2 - (side ? 0 : 8), width: panelW, height: rowH, rx: 4 }, g);
          bindHit(hit, tip, function (t) {
            t.appendChild(h("div", { class: "lr-tip-v", text: Math.round(r.correct * 100) + "% correct" }));
            t.appendChild(h("div", { class: "lr-tip-k", text: p[1].trim() + " · " + pn[1] }));
            tipRow(t, C_CONS, Math.round(r.consistent * 100) + "%", "consistent with the history");
            tipRow(t, null, Math.round(r.parsed * 100) + "%", "parsed");
            if (r.correct_at_k != null) tipRow(t, null, Math.round(r.correct_at_k * 100) + "%", "correct in any of 8 samples");
            tipRow(t, null, String(r.n), "test snapshots");
          });
          if (r.parsed === 0) {
            s("text", { x: x(0) + 10, y: cy + 4, "font-size": 11, fill: "var(--lr-muted)", text: "no output parses", "pointer-events": "none" }, g);
            s("circle", { cx: x(0), cy: cy, r: 4, fill: "none", stroke: "var(--lr-muted)", "stroke-width": 1.5, "pointer-events": "none" }, g);
            return;
          }
          s("line", { x1: x(r.correct), x2: x(r.consistent), y1: cy, y2: cy, stroke: "var(--lr-axis)", "stroke-width": 2, "pointer-events": "none" }, g);
          s("circle", { cx: x(r.consistent), cy: cy, r: 5, fill: C_CONS, stroke: "var(--lr-surface)", "stroke-width": 2, "pointer-events": "none" }, g);
          s("circle", { cx: x(r.correct), cy: cy, r: 5, fill: C_OK, stroke: "var(--lr-surface)", "stroke-width": 2, "pointer-events": "none" }, g);
          var lab = Math.round(r.correct * 100) + "%";
          var lx = x(r.correct) - 9,
            anc = "end";
          if (lx - 26 < x0) {
            lx = x(r.correct) + 9;
            anc = "start";
            if (x(r.consistent) - x(r.correct) < 40 && x(r.consistent) > x(r.correct)) lx = x(r.consistent) + 9;
          }
          s("text", { x: lx, y: cy + 4, "text-anchor": anc, "font-size": 11, "font-weight": 600, fill: "var(--lr-ink-2)", text: lab, "pointer-events": "none" }, g);
        });
      });
    });

    var trows = [];
    rows.forEach(function (p) {
      panels.forEach(function (pn) {
        var r = P[p[0]][pn[0]];
        if (!r) return;
        trows.push([p[1].trim(), pn[1], String(r.n), Math.round(r.parsed * 100) + "%", Math.round(r.consistent * 100) + "%", Math.round(r.correct * 100) + "%", r.correct_at_k != null ? Math.round(r.correct_at_k * 100) + "%" : "–"]);
      });
    });
    root.appendChild(tableView("Writing door rules directly", ["Proposer", "Test set", "n", "Parsed", "Consistent", "Correct", "Correct, any of 8"], trows));
  }

  // ======== 4. cost tiles ========
  function tiles(root, d) {
    var opus = d.paired_heldout_15.policy_opus;
    var wrap = h("div", { class: "lr-tiles" });
    [
      ["Total Claude API spend", "$" + d.api_spend.total_usd.toFixed(2), "every Claude run in the project, including refusal probes"],
      ["Claude Opus 5.5, per episode", usd(opus.usd_per_episode), "acting directly, 15 held-out episodes"],
      ["Fine-tuned 8B scorer, per episode", "no API cost", "runs on one local A100 (LoRA on Qwen3-8B)"],
    ].forEach(function (t) {
      wrap.appendChild(h("div", { class: "lr-tile" }, [h("div", { class: "lr-tile-label", text: t[0] }), h("div", { class: "lr-tile-value", text: t[1] }), h("div", { class: "lr-tile-note", text: t[2] })]));
    });
    root.appendChild(wrap);
  }

  var CHARTS = { heldout: chartHeldout, tiers: chartTiers, proposers: chartProposers, tiles: tiles };

  function init() {
    var nodes = document.querySelectorAll("[data-lr-chart]");
    Array.prototype.forEach.call(nodes, function (el) {
      var base = el.getAttribute("data-base");
      fetch(base + "results.json")
        .then(function (r) {
          if (!r.ok) throw new Error(r.status);
          return r.json();
        })
        .then(function (d) {
          clear(el);
          CHARTS[el.getAttribute("data-lr-chart")](el, d);
        })
        .catch(function (e) {
          el.textContent = "Could not load the chart data (" + e.message + ").";
        });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
