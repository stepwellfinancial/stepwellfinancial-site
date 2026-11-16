/* ra-chart.js: the retirement analysis charts, drawn as inline SVG with DOM calls.
 *
 * No network, no storage, no style attributes (the page's CSP forbids them): every colour comes
 * from a class in ra.css, every position from an SVG geometry attribute.
 *
 * Money arrives as integer cents. This file never adds, rounds or formats a dollar figure shown
 * as a number: the caller passes the texts for the readout row. Cents are turned into pixels
 * here (geometry only), and the axis labels are round tick values this file chooses itself.
 *
 *   RAChart.projection(host, opts)   stacked area by account type, retirement marker, optional band
 *   RAChart.monthly(host, opts)      two bars: income and expenses a month, the gap hatched
 *   RAChart.yearly(host, opts)       stacked bars per retirement year, expense lines, plan-age marker
 *   RAChart.lines(host, opts)        two total-savings lines (Scenario A and B), each named at its end
 *   RAChart.donut(host, opts)        the asset-mix donut
 *
 * Each chart is an <svg role="img"> with an aria-label; the page shows the same numbers as a table.
 */
(function (root) {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var uid = 0;

  function svgEl(name, attrs, parent) {
    var e = document.createElementNS(NS, name), k;
    if (attrs) for (k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, String(attrs[k]));
    if (parent) parent.appendChild(e);
    return e;
  }
  function htmlEl(name, cls, text, parent) {
    var e = document.createElement(name);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function r1(n) { return Math.round(n * 10) / 10; }

  /* Round tick values in whole dollars, about three of them, covering maxCents. */
  function ticks(maxCents) {
    var max = Math.max(maxCents / 100, 1);
    var pow = Math.pow(10, Math.floor(Math.log(max / 3) / Math.LN10));
    var mult = [1, 2, 2.5, 5, 10], step = pow, i;
    for (i = 0; i < mult.length; i++) { step = mult[i] * pow; if (max / step <= 3.5) break; }
    step = Math.max(1, Math.round(step));
    var out = [], v = 0;
    while (v < max) { v += step; out.push(v); }
    return { step: step, top: v, values: out };
  }
  /* "$0", "$500", "$25k", "$1.5M": tick values only. */
  function tickLabel(dollars) {
    if (dollars >= 1000000) { var t = Math.round(dollars / 100000); return "$" + (t % 10 === 0 ? String(t / 10) : (Math.floor(t / 10) + "." + (t % 10))) + "M"; }
    if (dollars >= 1000) { var h = Math.round(dollars / 100); return "$" + (h % 10 === 0 ? String(h / 10) : (Math.floor(h / 10) + "." + (h % 10))) + "k"; }
    return "$" + String(dollars);
  }

  function frame(host, opts, height) {
    clear(host);
    var w = Math.max(280, Math.floor(host.clientWidth || 640));
    var narrow = w < 520;
    var h = typeof height === "function" ? height(narrow, w) : height;
    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, width: w, height: h, role: "img", "aria-label": opts.label, "class": "ra-svg", focusable: "false" }, host);
    return { svg: svg, w: w, h: h, narrow: narrow, id: "rac" + (++uid) };
  }

  function yAxis(f, box, tk) {
    var g = svgEl("g", { "class": "ra-axis", "aria-hidden": "true" }, f.svg), i, y;
    for (i = 0; i <= tk.values.length; i++) {
      var v = i === 0 ? 0 : tk.values[i - 1];
      y = r1(box.y1 - (v / tk.top) * (box.y1 - box.y0));
      svgEl("line", { x1: box.x0, x2: box.x1, y1: y, y2: y, "class": i === 0 ? "ra-base" : "ra-gridline" }, g);
      svgEl("text", { x: box.x0 - 8, y: y + 4, "text-anchor": "end", "class": "ra-tick" }, g).textContent = tickLabel(v);
    }
    return g;
  }

  /* The plot box. On a narrow chart the plot is PLOT_NARROW px high (240) with tighter margins
     above and below it, or PLOT_SMALL (228) where the drawing is under 300 px wide (a 360 px
     screen); on a wide one it is 220 px inside the 280 px drawing, as before. */
  var PLOT_NARROW = 240, PLOT_SMALL = 228;
  function chartHeight(narrow, w) { return narrow ? (w < 300 ? PLOT_SMALL : PLOT_NARROW) + 22 + 22 : 280; }
  function plotBox(f, right) { return f.narrow ? { x0: 52, x1: f.w - right, y0: 22, y1: f.h - 22 } : { x0: 52, x1: f.w - right, y0: 30, y1: f.h - 30 }; }

  /* Labels under the plot about every five years, or every ten on a narrow chart; a label is
     skipped where it would crowd the one before it. Ages on a narrow chart count back from the
     last age, so the plan-to age is always labelled (55, 65, 75, 85, 95). The unit ("Age") sits
     once in the left gutter, so no label carries a prefix. */
  function ageAxis(f, box, ages, xOf, opts) {
    var g = svgEl("g", { "class": "ra-axis", "aria-hidden": "true" }, f.svg);
    var span = ages[ages.length - 1] - ages[0];
    var every = span > 12 ? (f.narrow ? 10 : 5) : (span > 5 ? 2 : 1);
    var unit = opts && opts.prefix !== undefined ? opts.prefix : "Age";
    var from = f.narrow && unit && every === 10 ? ages[ages.length - 1] % every : 0;
    if (unit) svgEl("text", { x: box.x0 - 8, y: box.y1 + 18, "text-anchor": "end", "class": "ra-tick" }, g).textContent = unit;
    /* On a narrow chart the first age may sit close to the unit, so the yearly bars read "Age 65 75 85 95". */
    var i, last = unit ? box.x0 + (f.narrow ? -21 : 6) : -100;
    for (i = 0; i < ages.length; i++) {
      if (ages[i] % every !== from) continue;
      var x = xOf(i), text = String(ages[i]), need = text.length * 8 + 8;
      if (x - last < need) continue;
      last = x;
      svgEl("text", { x: r1(x), y: box.y1 + 18, "text-anchor": "middle", "class": "ra-tick" }, g).textContent = text;
    }
    return g;
  }

  function marker(f, box, x, text, side) {
    var g = svgEl("g", { "class": "ra-marker", "aria-hidden": "true" }, f.svg);
    svgEl("line", { x1: r1(x), x2: r1(x), y1: box.y0 - 6, y2: box.y1 }, g);
    var anchor = side || (x > (box.x0 + box.x1) / 2 ? "end" : "start");
    svgEl("text", { x: r1(x + (anchor === "end" ? -6 : 6)), y: box.y0 - 10, "text-anchor": anchor }, g).textContent = text;
    return g;
  }

  /* The readout row is also the chart's legend: every item carries its key (a colour, a pattern or
     a line sample) beside its name and value. An item marked lead (the total) shares the first
     line with the year on phones; ra.css does that. */
  function keyItems(list, items) {
    var k;
    for (k = 0; k < items.length; k++) {
      var li = htmlEl("li", null, null, list);
      if (items[k].sw) htmlEl("span", "ra-sw " + items[k].sw, null, li).setAttribute("aria-hidden", "true");
      if (items[k].lead) li.className = "ra-readout-lead";
      htmlEl("span", "ra-readout-label", items[k].label, li);
      htmlEl("span", "ra-readout-value ra-numeral", items[k].value, li);
    }
  }

  /* The readout row and pointer, tap and arrow-key handling shared by the charts with an x axis. */
  function interact(host, f, box, n, xOf, start, opts, onMove) {
    var cursor = svgEl("line", { "class": "ra-cursor", y1: box.y0, y2: box.y1, x1: 0, x2: 0, "aria-hidden": "true" }, f.svg);
    var hit = svgEl("rect", { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0, "class": "ra-hit", "aria-hidden": "true" }, f.svg);
    var out = htmlEl("div", "ra-readout", null, host);
    out.setAttribute("aria-live", "polite");
    var idx = -1;
    function show(i) {
      i = Math.max(0, Math.min(n - 1, i));
      if (i === idx) return;
      idx = i;
      var x = r1(xOf(i));
      cursor.setAttribute("x1", x); cursor.setAttribute("x2", x);
      if (onMove) onMove(i, x);
      clear(out);
      var data = opts.readout(i);
      htmlEl("strong", "ra-readout-title", data.title, out);
      keyItems(htmlEl("ul", "ra-readout-items", null, out), data.items);
    }
    function fromEvent(ev) {
      var rect = f.svg.getBoundingClientRect();
      var px = (ev.clientX - rect.left) * (f.w / (rect.width || f.w));
      var best = 0, bd = Infinity, i;
      for (i = 0; i < n; i++) { var d = Math.abs(xOf(i) - px); if (d < bd) { bd = d; best = i; } }
      show(best);
    }
    hit.addEventListener("pointermove", fromEvent);
    hit.addEventListener("pointerdown", fromEvent);
    host.setAttribute("tabindex", "0");
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", opts.label + " Use the left and right arrow keys to read each year.");
    host.onkeydown = function (ev) {
      var step = ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowRight" ? 1 : 0;
      if (ev.key === "Home") { show(0); ev.preventDefault(); return; }
      if (ev.key === "End") { show(n - 1); ev.preventDefault(); return; }
      if (step) { show(idx + step); ev.preventDefault(); }
    };
    show(start);
  }

  function gradient(defs, id, cls) {
    var g = svgEl("linearGradient", { id: id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    svgEl("stop", { offset: "0", "class": cls + " ra-stop-top" }, g);
    svgEl("stop", { offset: "1", "class": cls + " ra-stop-bottom" }, g);
  }
  function hatch(defs, id) {
    var p = svgEl("pattern", { id: id, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
    svgEl("rect", { width: 6, height: 6, "class": "ra-hatch-bg" }, p);
    svgEl("rect", { width: 3, height: 6, "class": "ra-hatch-fg" }, p);
  }
  /* Withdrawals: a dotted fill, so they differ from income by pattern as well as colour. */
  function dots(defs, id) {
    var p = svgEl("pattern", { id: id, width: 5, height: 5, patternUnits: "userSpaceOnUse" }, defs);
    svgEl("rect", { width: 5, height: 5, "class": "ra-dots-bg" }, p);
    svgEl("circle", { cx: 2.5, cy: 2.5, r: 1, "class": "ra-dots-fg" }, p);
  }
  function linePath(pts) {
    var d = "", i;
    for (i = 0; i < pts.length; i++) d += (i ? "L" : "M") + r1(pts[i][0]) + " " + r1(pts[i][1]);
    return d;
  }
  function glowDot(parent, x, y, cls) {
    var g = svgEl("g", { "class": "ra-enddot " + cls, "aria-hidden": "true" }, parent);
        svgEl("circle", { cx: r1(x), cy: r1(y), r: 4, "class": "ra-core" }, g);
    return g;
  }

  /* opts: { label, rows: [{ age, parts: [cents, cents, cents] }], classes: [3 class names, bottom to top],
             retireIndex, retireText, band: { lo: [cents], hi: [cents] } or null, readout(i) } */
  function projection(host, opts) {
    var f = frame(host, opts, chartHeight);
    var rows = opts.rows, n = rows.length, i, k;
    var box = plotBox(f, 16);
    var max = 0, totals = [];
    for (i = 0; i < n; i++) {
      var t = 0;
      for (k = 0; k < rows[i].parts.length; k++) t += rows[i].parts[k];
      totals.push(t);
      if (t > max) max = t;
      if (opts.band && opts.band.hi[i] > max) max = opts.band.hi[i];
    }
    var tk = ticks(max), topCents = tk.top * 100;
    function xOf(j) { return n > 1 ? box.x0 + (j / (n - 1)) * (box.x1 - box.x0) : (box.x0 + box.x1) / 2; }
    function yOf(c) { return box.y1 - (c / topCents) * (box.y1 - box.y0); }
    var defs = svgEl("defs", null, f.svg);
    yAxis(f, box, tk);
    var ages = []; for (i = 0; i < n; i++) ages.push(rows[i].age);
    ageAxis(f, box, ages, xOf);

    if (opts.band) {
      var up = [], down = [];
      for (i = 0; i < n; i++) { up.push([xOf(i), yOf(opts.band.hi[i])]); down.unshift([xOf(i), yOf(opts.band.lo[i])]); }
      svgEl("path", { d: linePath(up.concat(down)) + "Z", "class": "ra-band", "aria-hidden": "true" }, f.svg);
      svgEl("path", { d: linePath(up), "class": "ra-band-edge", "aria-hidden": "true" }, f.svg);
      svgEl("path", { d: linePath(down), "class": "ra-band-edge", "aria-hidden": "true" }, f.svg);
    }

    /* With the range on, the three areas fade (a class) and the total is drawn as an ink line. */
    var base = [], g = svgEl("g", { "aria-hidden": "true", "class": opts.band ? "ra-areas ra-areas-fade" : "ra-areas" }, f.svg);
    for (i = 0; i < n; i++) base.push(0);
    for (k = 0; k < opts.classes.length; k++) {
      var top = [], bottom = [], any = false;
      for (i = 0; i < n; i++) {
        bottom.unshift([xOf(i), yOf(base[i])]);
        base[i] += rows[i].parts[k];
        if (rows[i].parts[k] > 0) any = true;
        top.push([xOf(i), yOf(base[i])]);
      }
      if (!any) continue;
      gradient(defs, f.id + "g" + k, opts.classes[k]);
      svgEl("path", { d: linePath(top.concat(bottom)) + "Z", fill: "url(#" + f.id + "g" + k + ")", "class": "ra-area" }, g);
      svgEl("path", { d: linePath(top), "class": "ra-area-line " + opts.classes[k] }, g);
    }
    if (opts.band) {
      var totalPts = [];
      for (i = 0; i < n; i++) totalPts.push([xOf(i), yOf(totals[i])]);
      svgEl("path", { d: linePath(totalPts), "class": "ra-total-line", "aria-hidden": "true" }, f.svg);
    }
    if (opts.retireIndex > 0 && opts.retireIndex < n) marker(f, box, xOf(opts.retireIndex), opts.retireText);
    /* The latest point of the total, marked once with a soft glow. */
    var latest = svgEl("g", { "class": "ra-latest ra-c-ink", "aria-hidden": "true" }, f.svg);
    svgEl("circle", { cx: r1(xOf(n - 1)), cy: r1(yOf(totals[n - 1])), r: 9, "class": "ra-halo" }, latest);
    svgEl("circle", { cx: r1(xOf(n - 1)), cy: r1(yOf(totals[n - 1])), r: 4.5, "class": "ra-core" }, latest);
    var dots = svgEl("g", { "aria-hidden": "true" }, f.svg), dot = null;
    interact(host, f, box, n, xOf, Math.max(0, Math.min(n - 1, opts.retireIndex)), opts, function (j, x) {
      if (dot) dots.removeChild(dot);
      dot = glowDot(dots, x, yOf(totals[j]), "ra-c-ink");
    });
  }

  /* opts: { label, have, need, gap (cents), haveText, needText, gapText, haveLabel, needLabel, gapLabel,
             keys: [{ sw, label, value }] for the legend row under the bars } */
  function monthly(host, opts) {
    var f = frame(host, opts, 176);
    var defs = svgEl("defs", null, f.svg);
    hatch(defs, f.id + "h");
    var x0 = 2, x1 = f.w - 2, max = Math.max(opts.have, opts.need, 1), bh = 30;
    function len(c) { return Math.max(0, (c / max) * (x1 - x0)); }
    /* The drawn width of a text node; an estimate from its length where the browser gives none. */
    function textW(node, chars, per) {
      var w = 0;
      try { w = node.getComputedTextLength(); } catch (e) { w = 0; }
      return w > 0 ? w : chars * per;
    }
    /* One bar with its name above it. A name wider than the chart wraps by words; the value sits
       at the right end of the name's last line, or on a line of its own when that line has no
       room for it, so the two never share space. Returns where the bar was drawn. */
    function row(y, label, valueText, cents, cls) {
      var g = svgEl("g", { "aria-hidden": "true" }, f.svg), full = x1 - x0, lh = 20, i;
      var val = svgEl("text", { x: x1, y: y, "text-anchor": "end", "class": "ra-bar-value" }, g);
      val.textContent = valueText;
      var vw = textW(val, valueText.length, 9.5);
      var lab = svgEl("text", { x: x0, y: y, "class": "ra-bar-label" }, g), probe = svgEl("tspan", { x: x0, y: y }, lab);
      function width(s) { probe.textContent = s; return textW(probe, s.length, 7.6); }
      var words = String(label).split(" "), lines = [], line = "";
      if (width(label) + 12 + vw <= full) line = label;
      else for (i = 0; i < words.length; i++) {
        var next = line ? line + " " + words[i] : words[i];
        if (line && width(next) > full) { lines.push(line); line = words[i]; } else line = next;
      }
      lines.push(line);
      var lastW = width(line);
      lab.removeChild(probe);
      for (i = 0; i < lines.length; i++) svgEl("tspan", { x: x0, y: y + i * lh }, lab).textContent = lines[i];
      var vy = y + (lines.length - 1) * lh;
      if (lastW + 12 + vw > full) vy += lh;
      val.setAttribute("y", vy);
      svgEl("rect", { x: x0, y: vy + 10, width: r1(full), height: bh, rx: 4, "class": "ra-bar-track" }, g);
      if (cents > 0) svgEl("rect", { x: x0, y: vy + 10, width: r1(Math.max(len(cents), 4)), height: bh, rx: 4, "class": "ra-bar " + cls }, g);
      return { g: g, barY: vy + 10 };
    }
    var top = row(18, opts.haveLabel, opts.haveText, opts.have, "ra-c-have");
    if (opts.gap > 0 && opts.need > opts.have) {
      var gx = x0 + len(opts.have) + 3, gw = x0 + len(opts.need) - gx;
      if (gw > 6) {
        svgEl("rect", { x: r1(gx), y: top.barY, width: r1(gw), height: bh, rx: 4, fill: "url(#" + f.id + "h)", "class": "ra-gap-rect" }, top.g);
        if (gw > 150) svgEl("text", { x: r1(gx + gw / 2), y: top.barY + 20, "text-anchor": "middle", "class": "ra-gap-text" }, top.g).textContent = opts.gapLabel + " " + opts.gapText;
      }
    }
    var low = row(top.barY + bh + 46, opts.needLabel, opts.needText, opts.need, "ra-c-need");
    /* The drawing is as tall as its two rows turned out to be: 176 when neither name wraps. */
    var h = low.barY + bh + 32;
    f.svg.setAttribute("viewBox", "0 0 " + f.w + " " + h);
    f.svg.setAttribute("height", h);
    if (opts.keys && opts.keys.length) keyItems(htmlEl("ul", "ra-readout-items", null, htmlEl("div", "ra-readout", null, host)), opts.keys);
  }

  /* opts: { label, rows: [{ age, income, withdrawals, gap, essential, total }], planText, readout(i) } */
  function yearly(host, opts) {
    var f = frame(host, opts, chartHeight);
    var rows = opts.rows, n = rows.length, i;
    var box = plotBox(f, 16);
    var max = 0;
    for (i = 0; i < n; i++) max = Math.max(max, rows[i].income + rows[i].withdrawals + rows[i].gap, rows[i].total);
    var tk = ticks(max), topCents = tk.top * 100;
    var bandW = (box.x1 - box.x0) / Math.max(n, 1), bw = Math.max(2, Math.min(26, bandW * 0.68)), rx = Math.min(2, bw / 2);
    function xOf(j) { return box.x0 + bandW * (j + 0.5); }
    function hOf(c) { return (c / topCents) * (box.y1 - box.y0); }
    var defs = svgEl("defs", null, f.svg);
    hatch(defs, f.id + "h");
    dots(defs, f.id + "d");
    yAxis(f, box, tk);
    var ages = []; for (i = 0; i < n; i++) ages.push(rows[i].age);
    ageAxis(f, box, ages, xOf);
    var bars = svgEl("g", { "aria-hidden": "true" }, f.svg), cols = [];
    for (i = 0; i < n; i++) {
      var col = svgEl("g", { "class": "ra-col" }, bars), y = box.y1, parts = [[rows[i].income, "ra-c-income", null], [rows[i].withdrawals, "ra-draw-rect", "url(#" + f.id + "d)"], [rows[i].gap, "ra-gap-rect", "url(#" + f.id + "h)"]], k;
      for (k = 0; k < parts.length; k++) {
        var hh = hOf(parts[k][0]);
        if (hh < 0.5) continue;
        var pad = hh > 4 ? 1 : 0;
        svgEl("rect", { x: r1(xOf(i) - bw / 2), y: r1(y - hh + pad), width: r1(bw), height: r1(hh - pad), rx: Math.min(rx, (hh - pad) / 2), fill: parts[k][2], "class": "ra-bar " + parts[k][1] }, col);
        y -= hh;
      }
      cols.push(col);
    }
    var ess = [], tot = [];
    for (i = 0; i < n; i++) { ess.push([xOf(i), box.y1 - hOf(rows[i].essential)]); tot.push([xOf(i), box.y1 - hOf(rows[i].total)]); }
    var lines = svgEl("g", { "aria-hidden": "true" }, f.svg);
    svgEl("path", { d: linePath(ess), "class": "ra-line ra-c-ink" }, lines);
    svgEl("path", { d: linePath(tot), "class": "ra-line ra-line-dot ra-c-ink" }, lines);
    /* The two lines are named at their right ends. Unless the lines are far enough apart for a
       label to sit clear between them, the lower label drops under its own line, so it never
       lies on the other line. Below 480 px ra.css hides these labels; the readout row keys both
       lines at every width. */
    if (n > 0 && opts.totalText) {
      var ty = tot[n - 1][1] - 12, ey = ess[n - 1][1] - 12;
      if (Math.abs(ty - ey) < 36) ey = ess[n - 1][1] + 19;
      svgEl("text", { x: r1(box.x1 - 8), y: r1(Math.max(box.y0 + 12, ty)), "text-anchor": "end", "class": "ra-line-label" }, lines).textContent = opts.totalText;
      svgEl("text", { x: r1(box.x1 - 8), y: r1(Math.min(box.y1 - 6, ey)), "text-anchor": "end", "class": "ra-line-label" }, lines).textContent = opts.essentialText;
    }
    marker(f, box, box.x1 - 1, opts.planText, "end").setAttribute("class", "ra-marker ra-marker-thin");
    var on = null;
    interact(host, f, box, n, xOf, 0, opts, function (j) {
      if (on) on.setAttribute("class", "ra-col");
      on = cols[j];
      on.setAttribute("class", "ra-col ra-col-on");
    });
  }

  /* opts: { label, ages: [int], series: [{ values: [cents or null], cls, markIndex, markText }], readout(i) } */
  function lines(host, opts) {
    var f = frame(host, opts, chartHeight);
    var n = opts.ages.length, i, s, max = 0;
    var box = plotBox(f, 26);
    for (s = 0; s < opts.series.length; s++) for (i = 0; i < n; i++) if (opts.series[s].values[i] > max) max = opts.series[s].values[i];
    var tk = ticks(max), topCents = tk.top * 100;
    function xOf(j) { return n > 1 ? box.x0 + (j / (n - 1)) * (box.x1 - box.x0) : (box.x0 + box.x1) / 2; }
    function yOf(c) { return box.y1 - (c / topCents) * (box.y1 - box.y0); }
    var defs = svgEl("defs", null, f.svg);
    yAxis(f, box, tk);
    ageAxis(f, box, opts.ages, xOf, opts);
    var g = svgEl("g", { "aria-hidden": "true" }, f.svg), marks = [];
    for (s = 0; s < opts.series.length; s++) {
      var pts = [], ser = opts.series[s];
      for (i = 0; i < n; i++) if (ser.values[i] !== null && ser.values[i] !== undefined) pts.push([xOf(i), yOf(ser.values[i])]);
      if (!pts.length) continue;
      if (s === 0) {
        gradient(defs, f.id + "g" + s, ser.cls);
        svgEl("path", { d: linePath(pts) + "L" + r1(pts[pts.length - 1][0]) + " " + box.y1 + "L" + r1(pts[0][0]) + " " + box.y1 + "Z", fill: "url(#" + f.id + "g" + s + ")", "class": "ra-area ra-area-soft" }, g);
      }
      svgEl("path", { d: linePath(pts), "class": "ra-line ra-line-main " + ser.cls + (s ? " ra-line-dash" : "") }, g);
      if (ser.markIndex > 0 && ser.markIndex < n) {
        var mx = xOf(ser.markIndex), my = yOf(ser.values[ser.markIndex] || 0);
        glowDot(g, mx, my, ser.cls);
        marks.push({ x: mx, y: my, text: ser.markText });
      }
    }
    /* The retirement labels are staggered: one above its point and one below, so they never meet.
       The first series goes above unless its point is the lower of the two on the drawing. */
    var above = marks.length === 2 && marks[0].y > marks[1].y ? 1 : 0;
    for (s = 0; s < marks.length; s++) {
      var ly = s === above ? Math.max(12, marks[s].y - 14) : Math.min(box.y1 - 6, marks[s].y + 24);
      svgEl("text", { x: r1(marks[s].x), y: r1(ly), "text-anchor": marks[s].x > (box.x0 + box.x1) * 0.6 ? "end" : "middle", "class": "ra-mark-text" }, g).textContent = marks[s].text;
    }
    /* Each line is named at its right end, so the pair never depends on colour. Close ends are nudged apart. */
    var ends = [];
    for (s = 0; s < opts.series.length; s++) {
      var sv = opts.series[s].values, li = -1;
      for (i = n - 1; i >= 0; i--) if (sv[i] !== null && sv[i] !== undefined) { li = i; break; }
      if (li >= 0 && opts.series[s].endText) ends.push({ x: xOf(li) + 8, y: yOf(sv[li]) + 4, text: opts.series[s].endText, cls: opts.series[s].cls });
    }
    if (ends.length === 2 && Math.abs(ends[0].x - ends[1].x) < 14 && Math.abs(ends[0].y - ends[1].y) < 15) {
      var up = ends[0].y <= ends[1].y ? 0 : 1, mid = (ends[0].y + ends[1].y) / 2;
      ends[up].y = mid - 8; ends[1 - up].y = mid + 8;
    }
    for (s = 0; s < ends.length; s++) svgEl("text", { x: r1(ends[s].x), y: r1(ends[s].y), "class": "ra-end-label " + ends[s].cls, "aria-hidden": "true" }, f.svg).textContent = ends[s].text;
    interact(host, f, box, n, xOf, Math.floor(n / 2), opts, null);
  }

  /* opts: { label, parts: [{ pct, cls }], big, small } */
  function donut(host, opts) {
    clear(host);
    var size = 168, r = 62, c = 2 * Math.PI * r, off = 0, i;
    var svg = svgEl("svg", { viewBox: "0 0 " + size + " " + size, width: size, height: size, role: "img", "aria-label": opts.label, "class": "ra-svg ra-donut", focusable: "false" }, host);
    svgEl("circle", { cx: size / 2, cy: size / 2, r: r, "class": "ra-donut-track" }, svg);
    var live = 0;
    for (i = 0; i < opts.parts.length; i++) if (opts.parts[i].pct > 0) live++;
    for (i = 0; i < opts.parts.length; i++) {
      var p = opts.parts[i];
      if (!(p.pct > 0)) continue;
      var len = c * p.pct / 100, gap = live > 1 ? 2 : 0, draw = Math.max(1, len - gap);
      svgEl("circle", { cx: size / 2, cy: size / 2, r: r, "class": "ra-donut-seg " + p.cls, "stroke-dasharray": r1(draw) + " " + r1(c - draw), "stroke-dashoffset": r1(-off), transform: "rotate(-90 " + size / 2 + " " + size / 2 + ")" }, svg);
      off += len;
    }
    svgEl("text", { x: size / 2, y: size / 2 + 4, "text-anchor": "middle", "class": "ra-donut-big" }, svg).textContent = opts.big;
    svgEl("text", { x: size / 2, y: size / 2 + 24, "text-anchor": "middle", "class": "ra-donut-small" }, svg).textContent = opts.small;
  }

  var api = { projection: projection, monthly: monthly, yearly: yearly, lines: lines, donut: donut, ticks: ticks, tickLabel: tickLabel };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RAChart = api;
})(typeof self !== "undefined" ? self : this);
