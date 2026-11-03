/* Learning the Rules: replay viewer.
   Plain JS, no build step, no dependencies. Reads the frozen bundle exported by
   hypo/scripts/export_web.py (format: hypo/web/SCHEMA.md).

   Usage (see _projects/learning-the-rules.md):
     <div class="lr-viewer" data-base=".../data/"></div>          full viewer
     <div data-lr-hero data-base=".../data/" data-episode="lamp_gate-0"
          data-agents="search_eig_learned,reflection"></div>        autoplaying hero
*/
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var CELL = 40;
  var BASE_FPS = 4;

  var SHORT = {
    oracle: "Oracle (knows the rules)",
    search_eig_learned: "Search + fine-tuned 8B scorer",
    search_eig: "Search, no scorer",
    reflection: "Reflection, Qwen3-8B",
    policy_opus: "Claude Opus 5.5 (choice only)",
  };
  var AGENT_ORDER = ["search_eig_learned", "search_eig", "reflection", "policy_opus", "oracle"];

  // Which pair to open each showcase episode with (matches the episode blurbs).
  var DEFAULT_PAIR = {
    "lamp_gate-0": ["search_eig_learned", "reflection"],
    "second_press-0": ["search_eig_learned", "policy_opus"],
    "box_and_switch-1": ["search_eig_learned", "policy_opus"],
    "momentary_plate-5": ["search_eig_learned", "reflection"],
    "leave_plate-0": ["search_eig_learned", "search_eig"],
  };

  // ---------- small DOM helpers (text always via textContent) ----------
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    setAttrs(e, attrs);
    append(e, kids);
    return e;
  }
  function s(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    setAttrs(e, attrs);
    if (parent) parent.appendChild(e);
    return e;
  }
  function setAttrs(e, attrs) {
    if (!attrs) return;
    for (var k in attrs) {
      if (attrs[k] == null || attrs[k] === false) continue;
      if (k === "text") e.textContent = attrs[k];
      else if (k === "on") for (var ev in attrs.on) e.addEventListener(ev, attrs.on[ev]);
      else e.setAttribute(k, attrs[k]);
    }
  }
  function append(e, kids) {
    if (kids == null) return;
    if (!Array.isArray(kids)) kids = [kids];
    kids.forEach(function (k) {
      if (k == null || k === false) return;
      e.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
    });
  }
  function clear(e) {
    while (e.firstChild) e.removeChild(e.firstChild);
  }

  var cache = {};
  function getJSON(url) {
    if (!cache[url])
      cache[url] = fetch(url).then(function (r) {
        if (!r.ok) throw new Error(r.status + " " + url);
        return r.json();
      });
    return cache[url];
  }

  function prettyFamily(f) {
    var t = f.replace(/_/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  function pct(p) {
    if (p == null) return "–";
    if (p > 0 && p < 0.01) return "<1%";
    return Math.round(p * 100) + "%";
  }
  function parseOption(name) {
    var m = /^goal plan of a model \((.*)\)$/.exec(name || "");
    if (m) return { goal: true, rule: m[1] };
    return { goal: false, label: name };
  }
  function optionText(name) {
    var o = parseOption(name);
    return o.goal ? "Go for the goal, assuming: " + o.rule : o.label;
  }

  // ---------- world drawing ----------
  function drawObject(g, type, x, y, st, pressed) {
    var X = x * CELL,
      Y = y * CELL,
      cx = X + CELL / 2,
      cy = Y + CELL / 2;
    if (type === "plate") {
      s("rect", { x: X + 7, y: Y + 7, width: CELL - 14, height: CELL - 14, rx: 4, fill: pressed ? "var(--lr-plate-on)" : "var(--lr-plate)" }, g);
      s("rect", {
        x: X + 11,
        y: Y + 11,
        width: CELL - 22,
        height: CELL - 22,
        rx: 2,
        fill: "none",
        stroke: pressed ? "var(--lr-plate)" : "var(--lr-plate-on)",
        "stroke-width": 1,
        opacity: 0.6,
      }, g);
    } else if (type === "switch") {
      var on = !!st.on;
      s("rect", { x: cx - 12, y: cy - 7, width: 24, height: 14, rx: 7, fill: on ? "var(--lr-switch-on)" : "var(--lr-switch-track)" }, g);
      s("circle", { cx: on ? cx + 5 : cx - 5, cy: cy, r: 5, fill: "var(--lr-knob)" }, g);
    } else if (type === "lamp") {
      if (st.on) s("circle", { cx: cx, cy: cy, r: 16, fill: "var(--lr-lamp-on)", opacity: 0.25 }, g);
      s("circle", { cx: cx, cy: cy - 2, r: 9, fill: st.on ? "var(--lr-lamp-on)" : "var(--lr-lamp-off)", stroke: "var(--lr-plate-on)", "stroke-width": st.on ? 0 : 1 }, g);
      s("rect", { x: cx - 4, y: cy + 7, width: 8, height: 4, rx: 1, fill: "var(--lr-plate-on)" }, g);
    } else if (type === "door") {
      if (st.open) {
        s("rect", { x: X + 3, y: Y + 3, width: CELL - 6, height: CELL - 6, rx: 3, fill: "var(--lr-door-open)" }, g);
        s("rect", { x: X + 3, y: Y + 3, width: 6, height: CELL - 6, rx: 2, fill: "var(--lr-door)" }, g);
      } else {
        s("rect", { x: X + 3, y: Y + 3, width: CELL - 6, height: CELL - 6, rx: 3, fill: "var(--lr-door)" }, g);
        s("line", { x1: cx, y1: Y + 7, x2: cx, y2: Y + CELL - 7, stroke: "var(--lr-floor)", "stroke-width": 1.5, opacity: 0.5 }, g);
        s("circle", { cx: cx + 7, cy: cy, r: 2.2, fill: "var(--lr-floor)" }, g);
      }
    } else if (type === "box") {
      s("rect", { x: X + 6, y: Y + 6, width: CELL - 12, height: CELL - 12, rx: 3, fill: "var(--lr-box)" }, g);
      s("path", { d: "M" + (X + 9) + " " + (Y + 9) + "L" + (X + CELL - 9) + " " + (Y + CELL - 9) + "M" + (X + CELL - 9) + " " + (Y + 9) + "L" + (X + 9) + " " + (Y + CELL - 9), stroke: "var(--lr-box-line)", "stroke-width": 2, "stroke-linecap": "round" }, g);
    } else if (type === "key") {
      s("circle", { cx: cx - 6, cy: cy, r: 6, fill: "none", stroke: "var(--lr-key)", "stroke-width": 3 }, g);
      s("path", { d: "M" + cx + " " + cy + "H" + (cx + 12) + "M" + (cx + 8) + " " + cy + "v5M" + (cx + 12) + " " + cy + "v4", stroke: "var(--lr-key)", "stroke-width": 3, "stroke-linecap": "round", fill: "none" }, g);
    }
  }
  function drawGoal(g, x, y) {
    var X = x * CELL,
      Y = y * CELL;
    s("rect", { x: X + 2, y: Y + 2, width: CELL - 4, height: CELL - 4, rx: 5, fill: "var(--lr-goal)", opacity: 0.16 }, g);
    s("line", { x1: X + 14, y1: Y + 9, x2: X + 14, y2: Y + 32, stroke: "var(--lr-goal)", "stroke-width": 2.5, "stroke-linecap": "round" }, g);
    s("path", { d: "M" + (X + 15) + " " + (Y + 9) + "L" + (X + 29) + " " + (Y + 14) + "L" + (X + 15) + " " + (Y + 20) + "Z", fill: "var(--lr-goal)" }, g);
  }
  function drawWall(g, x, y) {
    s("rect", { x: x * CELL, y: y * CELL, width: CELL, height: CELL, fill: "var(--lr-wall)" }, g);
  }
  function drawAgent(g, x, y, done) {
    var cx = x * CELL + CELL / 2,
      cy = y * CELL + CELL / 2;
    s("circle", { cx: cx, cy: cy, r: 11, fill: "var(--lr-agent)", stroke: "var(--lr-agent-ring)", "stroke-width": 2 }, g);
    if (done) s("path", { d: "M" + (cx - 5) + " " + cy + "l3.5 3.5l6.5 -7", stroke: "#fff", "stroke-width": 2.2, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
    else {
      s("circle", { cx: cx - 3.5, cy: cy - 2, r: 1.6, fill: "#fff" }, g);
      s("circle", { cx: cx + 3.5, cy: cy - 2, r: 1.6, fill: "#fff" }, g);
    }
  }

  function samePos(a, b) {
    return a && b && a[0] === b[0] && a[1] === b[1];
  }

  function renderBoard(svg, world, frames, k, prev) {
    clear(svg);
    var W = world.width,
      H = world.height;
    svg.setAttribute("viewBox", "0 0 " + W * CELL + " " + H * CELL);
    var types = {};
    world.objects.forEach(function (o) {
      types[o.id] = o.type;
    });
    var fr = frames[k];

    // grid lines
    var grid = s("g", { stroke: "var(--lr-gridline)", "stroke-width": 1 }, svg);
    for (var i = 1; i < W; i++) s("line", { x1: i * CELL, y1: 0, x2: i * CELL, y2: H * CELL }, grid);
    for (var j = 1; j < H; j++) s("line", { x1: 0, y1: j * CELL, x2: W * CELL, y2: j * CELL }, grid);

    // footprint: how often the agent has stood on each cell so far
    var visits = {};
    for (var t = 0; t <= k; t++) {
      var key = frames[t].agent.join(",");
      visits[key] = (visits[key] || 0) + 1;
    }
    var vg = s("g", {}, svg);
    Object.keys(visits).forEach(function (kk) {
      var p = kk.split(",").map(Number);
      s("rect", { x: p[0] * CELL + 1, y: p[1] * CELL + 1, width: CELL - 2, height: CELL - 2, rx: 3, fill: "var(--lr-visit)", opacity: Math.min(0.05 + 0.035 * visits[kk], 0.32) }, vg);
    });

    var wg = s("g", {}, svg);
    world.walls.forEach(function (p) {
      drawWall(wg, p[0], p[1]);
    });
    drawGoal(s("g", {}, svg), world.goal[0], world.goal[1]);

    var boxPos = [];
    Object.keys(fr.objects).forEach(function (id) {
      if (types[id] === "box" && fr.objects[id].pos) boxPos.push(fr.objects[id].pos);
    });
    var og = s("g", {}, svg);
    var order = { plate: 0, switch: 1, lamp: 1, key: 1, door: 2, box: 3 };
    var ids = Object.keys(fr.objects).sort(function (a, b) {
      return (order[types[a]] || 0) - (order[types[b]] || 0);
    });
    ids.forEach(function (id) {
      var st = fr.objects[id];
      if (!st.pos) return;
      var pressed = false;
      if (types[id] === "plate") {
        pressed = samePos(fr.agent, st.pos) || boxPos.some(function (b) { return samePos(b, st.pos); });
      }
      drawObject(og, types[id], st.pos[0], st.pos[1], st, pressed);
    });

    // object ids (the rules refer to them)
    var lg = s("g", { "font-size": 8.5, fill: "var(--lr-cell-label)", "font-weight": 600, stroke: "var(--lr-floor)", "stroke-width": 2.5, "paint-order": "stroke", "stroke-linejoin": "round" }, svg);
    ids.forEach(function (id) {
      var st = fr.objects[id];
      if (!st.pos) return;
      s("text", { x: st.pos[0] * CELL + 3, y: st.pos[1] * CELL + 10, text: id }, lg);
    });

    // pulse on objects whose state changed this step
    if (prev) {
      ids.forEach(function (id) {
        var a = fr.objects[id],
          b = prev.objects[id];
        if (!a || !b || !a.pos) return;
        if (a.on !== b.on || a.open !== b.open)
          s("circle", { class: "lr-pulse", cx: a.pos[0] * CELL + CELL / 2, cy: a.pos[1] * CELL + CELL / 2, r: 17, fill: "none", stroke: "var(--lr-pulse)", "stroke-width": 2.5 }, svg);
      });
    }
    drawAgent(s("g", {}, svg), fr.agent[0], fr.agent[1], fr.done);
  }

  function describeChanges(fr, prev) {
    var out = [];
    if (!prev) return out;
    Object.keys(fr.objects).forEach(function (id) {
      var a = fr.objects[id],
        b = prev.objects[id];
      if (!b) return;
      if (a.on !== undefined && a.on !== b.on) out.push(id + (a.on ? " turned on" : " turned off"));
      if (a.open !== undefined && a.open !== b.open) out.push(id + (a.open ? " opened" : " closed"));
      if (b.pos && !a.pos) out.push(id + " picked up");
    });
    return out;
  }

  function boardLabel(world, fr) {
    var d = fr.objects.D1;
    return "Step " + fr.t + ". Agent at column " + fr.agent[0] + ", row " + fr.agent[1] + ". Door " + (d && d.open ? "open" : "closed") + "." + (fr.done ? " Goal reached." : "");
  }

  function decisionAt(decisions, t) {
    var d = null;
    for (var i = 0; i < decisions.length; i++) {
      if (decisions[i].t <= t) d = decisions[i];
      else break;
    }
    return d;
  }

  // ---------- decision panel ----------
  function renderPanel(box, agentId, agent, fr, lastFlashT) {
    clear(box);
    var d = decisionAt(agent.decisions, fr.t);
    var finished = fr.t >= agent.frames.length - 1;

    if (agentId === "oracle") {
      append(box, [
        h("h6", { text: "Oracle" }),
        h("div", { text: "Knows the true rules and walks the shortest plan. It sets the floor: " + agent.steps + " steps on this puzzle." }),
      ]);
      return lastFlashT;
    }
    if (!d) {
      append(box, h("div", { class: "lr-note", text: "No decision yet." }));
      return lastFlashT;
    }

    if (agentId === "search_eig_learned" || agentId === "search_eig") {
      var chosen = (d.options || []).filter(function (o) { return o.chosen; })[0];
      append(box, h("h6", { text: finished ? "Last experiment (from step " + d.t + ")" : "Current experiment (chosen at step " + d.t + ")" }));
      append(box, h("div", { class: "lr-choice", text: chosen ? optionText(chosen.name) : d.text }));
      if (chosen)
        append(box, h("div", {
          class: "lr-meta",
          text: chosen.cost + " steps · " + chosen.gain.toFixed(2) + " bits expected · P(goal) " + pct(chosen.p_goal),
        }));

      var elim = fr.eliminated;
      var hot = elim != null && elim > 0;
      var pill = h("div", {
        class: "lr-elim" + (hot ? " lr-hot" : "") + (hot && lastFlashT !== fr.t ? " lr-flash" : ""),
        text: fr.t === 0 ? "No observations yet" : hot ? "−" + elim + " hypotheses ruled out by step " + fr.t : "Step " + fr.t + " ruled nothing out",
      });
      append(box, pill);
      if (hot) lastFlashT = fr.t;

      append(box, h("h6", { text: "Most probable door rules" + (d.n_hypotheses ? " (top 5 of " + d.n_hypotheses + " still consistent)" : "") }));
      var ul = h("ul", { class: "lr-hyps" });
      (d.hypotheses || []).forEach(function (hy) {
        var bar = h("div", { class: "lr-pbar", title: (hy.p * 100).toFixed(1) + "%" }, h("i", { style: "width:" + Math.max(hy.p * 100, 0.8).toFixed(1) + "%" }));
        append(ul, h("li", {}, [h("div", {}, [bar, h("div", { class: "lr-pval", text: pct(hy.p) })]), h("div", { class: "lr-rule", text: hy.rule })]));
      });
      append(box, ul);

      if (d.options && d.options.length) {
        append(box, h("h6", { text: "Experiments it weighed (top 5)" }));
        var tb = h("tbody");
        d.options.forEach(function (o) {
          append(tb, h("tr", { class: o.chosen ? "lr-chosen" : null }, [
            h("td", { text: optionText(o.name) }),
            h("td", { text: String(o.cost) }),
            h("td", { text: o.gain.toFixed(2) }),
            h("td", { text: pct(o.p_goal) }),
          ]));
        });
        append(box, h("table", { class: "lr-opts" }, [
          h("thead", {}, h("tr", {}, [h("th", { text: "Option" }), h("th", { text: "Steps" }), h("th", { text: "Bits" }), h("th", { text: "P(goal)" })])),
          tb,
        ]));
        append(box, h("div", {
          class: "lr-note",
          text: "Score = (information gain + 2 × P(goal)) ÷ steps. Once a plan reaches the goal with P ≥ 0.5, the agent follows it." +
            (agentId === "search_eig_learned" ? " Probabilities: a simplicity prior adjusted by the fine-tuned Qwen3-8B scorer." : " Probabilities: a simplicity prior only."),
        }));
      }
      return lastFlashT;
    }

    // LLM agents
    append(box, h("h6", { text: "Choice at step " + d.t }));
    append(box, h("div", { class: "lr-choice", text: optionText(d.text) }));
    if (d.error) append(box, h("div", { class: "lr-note", text: "The model failed on this step; a heuristic explorer acted instead." }));
    if (agentId === "reflection") {
      if (d.reflection) {
        append(box, h("h6", { text: "Its reflection" }));
        append(box, h("div", { class: "lr-quote", text: d.reflection }));
      }
      if (d.notes) {
        append(box, h("details", {}, [h("summary", { text: "Its notes (rewritten every step)" }), h("div", { class: "lr-quote", text: d.notes })]));
      }
      append(box, h("div", { class: "lr-note", text: "Same Qwen3-8B model, same menu of experiments, but it decides from its own written notes instead of a hypothesis pool." }));
    } else if (agentId === "policy_opus") {
      append(box, h("div", {
        class: "lr-note",
        text: "Claude Opus 5.5 sees the same world, history and menu, thinks internally, and outputs only its choice. (Prompts asking it to write out its reasoning were refused, so it ran choice-only.)",
      }));
    }
    return lastFlashT;
  }

  // ---------- one pane: header, board, changes ----------
  function Pane(parent, opts) {
    this.opts = opts || {};
    this.root = h("div", { class: "lr-pane" });
    this.head = h("div", { class: "lr-pane-head" });
    this.status = h("div", { class: "lr-status", "aria-live": "off" });
    this.board = s("svg", { class: "lr-board", role: "img", preserveAspectRatio: "xMidYMid meet" });
    this.changes = h("div", { class: "lr-changes" });
    append(this.root, [this.head, this.board, this.changes]);
    if (!this.opts.compact) {
      this.panel = h("div", { class: "lr-panel", "aria-live": "polite" });
      append(this.root, this.panel);
    }
    parent.appendChild(this.root);
    this.lastFlashT = -1;
  }
  Pane.prototype.set = function (ep, agentId) {
    this.ep = ep;
    this.agentId = agentId;
    this.agent = agentId ? ep.agents[agentId] : null;
    this.lastK = null;
    this.lastFlashT = -1;
    this.root.style.display = agentId ? "" : "none";
  };
  Pane.prototype.length = function () {
    return this.agent ? this.agent.frames.length : 0;
  };
  Pane.prototype.show = function (T) {
    if (!this.agent) return;
    var frames = this.agent.frames;
    var k = Math.min(T, frames.length - 1);
    if (k === this.lastK) return;
    var prev = k > 0 ? frames[k - 1] : null;
    var fr = frames[k];
    renderBoard(this.board, this.ep.world, frames, k, this.lastK === k - 1 ? prev : null);
    this.board.setAttribute("aria-label", (SHORT[this.agentId] || this.agentId) + ". " + boardLabel(this.ep.world, fr));

    clear(this.status);
    var end = k === frames.length - 1;
    append(this.status, "step " + fr.t + (end ? "" : " / " + this.agent.steps));
    if (end)
      append(this.status, this.agent.solved
        ? h("span", { class: "lr-badge lr-ok", text: "solved in " + this.agent.steps })
        : h("span", { class: "lr-badge lr-fail", text: "out of budget" }));

    clear(this.changes);
    var ch = describeChanges(fr, prev);
    if (fr.action) append(this.changes, h("span", { text: fr.action }));
    ch.forEach(function (c) {
      append(this.changes, h("span", { text: c }));
    }, this);
    if (fr.inventory && fr.inventory.length) append(this.changes, h("span", { text: "carrying " + fr.inventory.join(", ") }));

    if (this.panel) this.lastFlashT = renderPanel(this.panel, this.agentId, this.agent, fr, this.lastFlashT);
    this.lastK = k;
  };

  // ---------- shared clock ----------
  function Clock(onTick) {
    this.T = 0;
    this.max = 0;
    this.playing = false;
    this.speed = 1;
    this.loop = false;
    this.onTick = onTick;
    this.onState = function () {};
    this._timer = null;
  }
  Clock.prototype.set = function (T) {
    this.T = Math.max(0, Math.min(T, this.max));
    this.onTick(this.T);
  };
  Clock.prototype.play = function () {
    if (this.T >= this.max) this.set(0);
    this.playing = true;
    this._schedule(1000 / (BASE_FPS * this.speed));
    this.onState();
  };
  Clock.prototype.pause = function () {
    this.playing = false;
    clearTimeout(this._timer);
    this.onState();
  };
  Clock.prototype.toggle = function () {
    this.playing ? this.pause() : this.play();
  };
  Clock.prototype._schedule = function (ms) {
    var self = this;
    clearTimeout(this._timer);
    this._timer = setTimeout(function () {
      if (!self.playing) return;
      if (self.T >= self.max) {
        if (self.loop) {
          self.set(0);
          self._schedule(900);
        } else self.pause();
        return;
      }
      self.set(self.T + 1);
      self._schedule(self.T >= self.max && self.loop ? 2500 : 1000 / (BASE_FPS * self.speed));
    }, ms);
  };

  // ---------- grid legend ----------
  function legendIcon(fn) {
    var svg = s("svg", { viewBox: "0 0 " + CELL + " " + CELL, "aria-hidden": "true" });
    fn(svg);
    return svg;
  }
  function gridLegend() {
    var items = [
      ["agent", function (g) { drawAgent(g, 0, 0, false); }],
      ["goal", function (g) { drawGoal(g, 0, 0); }],
      ["wall", function (g) { drawWall(g, 0, 0); }],
      ["door closed / open", function (g) { drawObject(g, "door", 0, 0, { open: false }); }, function (g) { drawObject(g, "door", 0, 0, { open: true }); }],
      ["switch off / on", function (g) { drawObject(g, "switch", 0, 0, { on: false }); }, function (g) { drawObject(g, "switch", 0, 0, { on: true }); }],
      ["lamp off / on", function (g) { drawObject(g, "lamp", 0, 0, { on: false }); }, function (g) { drawObject(g, "lamp", 0, 0, { on: true }); }],
      ["plate (pressed while occupied)", function (g) { drawObject(g, "plate", 0, 0, {}, false); }],
      ["box (pushable)", function (g) { drawObject(g, "box", 0, 0, {}); }],
      ["shading: cells visited", function (g) { s("rect", { x: 1, y: 1, width: CELL - 2, height: CELL - 2, rx: 3, fill: "var(--lr-visit)", opacity: 0.25 }, g); }],
    ];
    var row = h("div", { class: "lr-legend-grid", "aria-label": "Legend" });
    items.forEach(function (it) {
      var span = h("span");
      for (var i = 1; i < it.length; i++) append(span, legendIcon(it[i]));
      append(span, it[0]);
      append(row, span);
    });
    return row;
  }

  // ---------- full viewer ----------
  function Viewer(root) {
    this.root = root;
    this.base = root.getAttribute("data-base");
    var self = this;
    getJSON(this.base + "episodes/index.json").then(function (index) {
      self.index = index;
      self.build();
      self.load(root.getAttribute("data-episode") || index[0].id);
    }).catch(function (e) {
      root.textContent = "Could not load the replay data (" + e.message + ").";
    });
  }
  Viewer.prototype.build = function () {
    var self = this;
    var root = this.root;
    clear(root);
    this.picker = h("div", { class: "lr-picker", role: "group", "aria-label": "Puzzle" });
    this.index.forEach(function (ep) {
      var b = h("button", { class: "lr-chip", type: "button", "aria-pressed": "false", "data-id": ep.id, on: { click: function () { self.load(ep.id); } } }, [
        prettyFamily(ep.family) + " #" + ep.seed,
        h("span", { class: "lr-chip-tag", text: ep.held_out ? "held-out" : "training" }),
      ]);
      append(self.picker, b);
    });
    this.blurb = h("div", { class: "lr-blurb" });
    this.scoreline = h("div", { class: "lr-scoreline" });
    this.panesEl = h("div", { class: "lr-panes" });

    this.clock = new Clock(function (T) { self.tick(T); });
    this.panes = [new Pane(this.panesEl), new Pane(this.panesEl)];
    this.selects = this.panes.map(function (p, i) {
      var sel = h("select", { "aria-label": i === 0 ? "Left agent" : "Right agent", on: { change: function () { self.choose(i, sel.value); } } });
      append(p.head, [sel, p.status]);
      return sel;
    });

    this.playBtn = h("button", { class: "lr-btn", type: "button", "aria-label": "Play", text: "▶", on: { click: function () { self.clock.toggle(); } } });
    var back = h("button", { class: "lr-btn", type: "button", "aria-label": "Step back", text: "◀︎|", on: { click: function () { self.clock.pause(); self.clock.set(self.clock.T - 1); } } });
    var fwd = h("button", { class: "lr-btn", type: "button", "aria-label": "Step forward", text: "|▶︎", on: { click: function () { self.clock.pause(); self.clock.set(self.clock.T + 1); } } });
    var restart = h("button", { class: "lr-btn", type: "button", "aria-label": "Back to start", text: "⏮", on: { click: function () { self.clock.pause(); self.clock.set(0); } } });
    this.range = h("input", { class: "lr-range", type: "range", min: 0, max: 0, value: 0, step: 1, "aria-label": "Step", on: { input: function () { self.clock.pause(); self.clock.set(+self.range.value); } } });
    this.tcount = h("span", { class: "lr-tcount" });
    var speed = h("select", { class: "lr-speed", "aria-label": "Speed", on: { change: function () { self.clock.speed = +speed.value; } } });
    [["0.5", "0.5×"], ["1", "1×"], ["2", "2×"], ["4", "4×"]].forEach(function (o) {
      append(speed, h("option", { value: o[0], text: o[1], selected: o[0] === "1" ? "selected" : null }));
    });
    var controls = h("div", { class: "lr-controls" }, [restart, back, this.playBtn, fwd, this.range, this.tcount, speed]);
    this.clock.onState = function () {
      self.playBtn.textContent = self.clock.playing ? "❚❚" : "▶";
      self.playBtn.setAttribute("aria-label", self.clock.playing ? "Pause" : "Play");
    };

    this.revealBtn = h("button", { class: "lr-btn", type: "button", "aria-expanded": "false", text: "Reveal the true rule", on: { click: function () { self.toggleReveal(); } } });
    this.truth = h("div", { class: "lr-truth", hidden: "hidden" });

    root.addEventListener("keydown", function (e) {
      var tag = (e.target.tagName || "").toLowerCase();
      if (tag === "select" || tag === "input") return;
      if (e.key === " " || e.key === "k") { e.preventDefault(); self.clock.toggle(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); self.clock.pause(); self.clock.set(self.clock.T + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); self.clock.pause(); self.clock.set(self.clock.T - 1); }
    });

    append(root, [this.picker, this.blurb, this.scoreline, controls, this.panesEl, h("div", { class: "lr-reveal" }, [this.revealBtn, this.truth]), gridLegend()]);
  };
  Viewer.prototype.load = function (id) {
    var self = this;
    this.clock.pause();
    Array.prototype.forEach.call(this.picker.children, function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-id") === id ? "true" : "false");
    });
    getJSON(this.base + "episodes/" + id + ".json").then(function (ep) {
      self.ep = ep;
      self.blurb.textContent = ep.blurb;
      var meta = self.index.filter(function (e) { return e.id === id; })[0];
      clear(self.scoreline);
      append(self.scoreline, "Steps on this puzzle (budget 100): ");
      ["oracle"].concat(AGENT_ORDER.slice(0, 4)).forEach(function (a, i) {
        var r = meta && meta.agents[a];
        if (!r) return;
        if (i) append(self.scoreline, " · ");
        append(self.scoreline, [SHORT[a] + " ", h("b", { text: r.solved ? String(r.steps) : "failed" })]);
      });
      if (!ep.agents.policy_opus) append(self.scoreline, " · Opus was run on seeds 0–2 only");

      var pair = DEFAULT_PAIR[id] || ["search_eig_learned", "reflection"];
      self.selects.forEach(function (sel, i) {
        clear(sel);
        if (i === 1) append(sel, h("option", { value: "", text: "— none —" }));
        AGENT_ORDER.forEach(function (a) {
          if (ep.agents[a]) append(sel, h("option", { value: a, text: SHORT[a] }));
        });
        sel.value = ep.agents[pair[i]] ? pair[i] : i === 0 ? "search_eig_learned" : "reflection";
        self.panes[i].set(ep, sel.value);
      });
      self.renderTruth();
      self.layout();
      self.clock.set(0);
    }).catch(function (e) {
      self.blurb.textContent = "Could not load " + id + " (" + e.message + ").";
    });
  };
  Viewer.prototype.choose = function (i, agentId) {
    this.panes[i].set(this.ep, agentId || null);
    this.layout();
    var T = this.clock.T;
    this.clock.set(Math.min(T, this.clock.max));
    this.panes[i].show(this.clock.T);
  };
  Viewer.prototype.layout = function () {
    var single = !this.panes[1].agentId;
    this.panesEl.classList.toggle("lr-single", single);
    this.clock.max = Math.max(this.panes[0].length(), this.panes[1].length()) - 1;
    this.range.max = this.clock.max;
  };
  Viewer.prototype.tick = function (T) {
    this.panes.forEach(function (p) { p.show(T); });
    this.range.value = T;
    this.tcount.textContent = "step " + T + " / " + this.clock.max;
  };
  Viewer.prototype.renderTruth = function () {
    var ep = this.ep;
    clear(this.truth);
    append(this.truth, h("div", {}, h("b", { text: "What opens the door" })));
    var ul = h("ul");
    ep.world.true_door_rules.forEach(function (r) { append(ul, h("li", { text: r })); });
    append(this.truth, ul);
    var others = ep.world.true_rules.filter(function (r) { return ep.world.true_door_rules.indexOf(r) < 0; });
    if (others.length) {
      var ul2 = h("ul");
      others.forEach(function (r) { append(ul2, h("li", { text: r })); });
      append(this.truth, h("details", {}, [h("summary", { text: "The other hidden rules in this world (" + others.length + ")" }), ul2]));
    }
    append(this.truth, h("div", { class: "lr-note", text: "Shortest solution with these rules known: " + ep.optimal_steps + " steps." }));
  };
  Viewer.prototype.toggleReveal = function () {
    var open = this.truth.hasAttribute("hidden");
    if (open) this.truth.removeAttribute("hidden");
    else this.truth.setAttribute("hidden", "hidden");
    this.revealBtn.setAttribute("aria-expanded", open ? "true" : "false");
    this.revealBtn.textContent = open ? "Hide the true rule" : "Reveal the true rule";
  };

  // ---------- hero: compact, autoplaying, looping ----------
  function Hero(root) {
    var base = root.getAttribute("data-base");
    var id = root.getAttribute("data-episode");
    var agents = (root.getAttribute("data-agents") || "search_eig_learned,reflection").split(",");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    getJSON(base + "episodes/" + id + ".json").then(function (ep) {
      clear(root);
      var panesEl = h("div", { class: "lr-panes" });
      var clock;
      var panes = agents.map(function (a) {
        var p = new Pane(panesEl, { compact: true });
        p.set(ep, a);
        append(p.head, [h("span", { class: "lr-pane-title", text: SHORT[a] }), p.status]);
        return p;
      });
      clock = new Clock(function (T) { panes.forEach(function (p) { p.show(T); }); });
      clock.loop = true;
      clock.speed = 1.5;
      clock.max = Math.max.apply(null, panes.map(function (p) { return p.length(); })) - 1;
      var btn = h("button", { class: "lr-btn", type: "button", "aria-label": "Pause", text: "❚❚", on: { click: function () { userPaused = clock.playing; clock.toggle(); } } });
      var userPaused = false;
      clock.onState = function () {
        btn.textContent = clock.playing ? "❚❚" : "▶";
        btn.setAttribute("aria-label", clock.playing ? "Pause" : "Play");
      };
      append(root, [panesEl, h("div", { class: "lr-controls" }, [btn, h("span", { class: "lr-hero-caption", text: root.getAttribute("data-caption") || "" })])]);
      clock.set(0);
      if (reduce) { clock.onState(); return; }
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (es) {
          es.forEach(function (e) {
            if (e.isIntersecting && !userPaused && !clock.playing) clock.play();
            else if (!e.isIntersecting && clock.playing) clock.pause();
          });
        }).observe(root);
      } else clock.play();
    }).catch(function (e) {
      root.textContent = "Could not load the replay (" + e.message + ").";
    });
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-lr-hero]"), function (el) { new Hero(el); });
    Array.prototype.forEach.call(document.querySelectorAll(".lr-viewer"), function (el) { new Viewer(el); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
