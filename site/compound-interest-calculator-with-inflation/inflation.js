/* inflation.js: wires the inflation calculator to calc.js and rates.js, and draws
 * the results. All maths lives in calc.js (the balance, unchanged) and rates.js
 * (today's dollars and the real rate). The chart follows app.js's drawing; a
 * shared chart module would be a separate change. */
(function () {
  "use strict";
  var C = window.CompoundCalc, R = window.Rates;
  var form = document.getElementById("infl-form");
  if (!form || !C || !R) return;
  var NUMERIC = ["principal", "monthly", "ratePct", "years"];
  var money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  var compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
  var OUTPUTS = ["out-final", "out-today"];

  function $(id) { return document.getElementById(id); }

  function readInputs() {
    var raw = {};
    NUMERIC.forEach(function (k) { raw[k] = C.parseAmount(form.elements[k].value, k !== "ratePct"); });
    raw.frequency = form.elements.frequency.value;
    raw.timing = form.querySelector('input[name="timing"]:checked').value;
    return raw;
  }

  function showError(k, msg) {
    $(k + "-err").textContent = msg;
    form.elements[k].setAttribute("aria-invalid", msg ? "true" : "false");
  }

  function niceMax(v) {
    if (!(v > 4)) return 4;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var s = 0; s < steps.length; s++) if (steps[s] * p >= v) return steps[s] * p;
    return 10 * p;
  }

  function axisLabel(v) { return v >= 1e15 ? "$" + v.toExponential(1) : compact.format(v); }

  /* Three lines: the balance (solid), the same balance in today's dollars
   * (dashed) and the money put in (dotted), so they differ by more than colour. */
  function drawChart(principal, rows) {
    var W = 640, H = 280, L = 70, Rm = 14, T = 14, B = 30;
    var pw = W - L - Rm, ph = H - T - B;
    var pts = [{ year: 0, balance: principal, today: principal, contributions: principal }].concat(rows);
    var top = pts[pts.length - 1];
    var max = niceMax(top.balance);
    var years = pts.length - 1;
    var x = function (yr) { return L + (yr / years) * pw; };
    var y = function (v) { return T + ph - (Math.max(0, v) / max) * ph; };
    var line = function (key) {
      return pts.map(function (p, idx) { return (idx ? "L" : "M") + x(p.year).toFixed(1) + " " + y(p[key]).toFixed(1); }).join(" ");
    };
    var out = ['<svg viewBox="0 0 ' + W + " " + H + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'];
    for (var g = 0; g <= 4; g++) {
      var v = (max / 4) * g, gy = y(v).toFixed(1);
      out.push('<line class="grid" x1="' + L + '" x2="' + (W - Rm) + '" y1="' + gy + '" y2="' + gy + '"/>');
      out.push('<text class="axis" x="' + (L - 8) + '" y="' + gy + '" text-anchor="end" dominant-baseline="middle">' + axisLabel(v) + "</text>");
    }
    var every = Math.max(1, Math.ceil(years / 10));
    pts.forEach(function (p) {
      if (p.year % every === 0) out.push('<text class="axis" x="' + x(p.year).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + p.year + "</text>");
    });
    out.push('<path class="ln ln-put" d="' + line("contributions") + '"/>');
    out.push('<path class="ln ln-real" d="' + line("today") + '"/>');
    out.push('<path class="ln ln-compound" d="' + line("balance") + '"/>');
    out.push('<circle class="dot-compound" cx="' + x(top.year).toFixed(1) + '" cy="' + y(top.balance).toFixed(1) + '" r="4"/>');
    out.push('<circle class="dot-real" cx="' + x(top.year).toFixed(1) + '" cy="' + y(top.today).toFixed(1) + '" r="4"/>');
    var colW = pw / Math.max(1, years);
    rows.forEach(function (p) {
      out.push('<rect class="hit" x="' + (x(p.year) - colW / 2).toFixed(1) + '" y="' + T + '" width="' + colW.toFixed(1) + '" height="' + ph + '"><title>Year ' + p.year +
        ": balance " + money.format(p.balance) + ", in today's dollars " + money.format(p.today) + ", put in " + money.format(p.contributions) + "</title></rect>");
    });
    out.push("</svg>");
    $("chart").innerHTML = out.join("");
    $("chart").setAttribute("aria-label", "Growth over " + years + (years === 1 ? " year" : " years") + ". Final balance " + money.format(top.balance) +
      " in future dollars, worth " + money.format(top.today) + " in today's dollars. Money put in " + money.format(top.contributions) + ".");
  }

  function drawTable(rows) {
    var body = $("out-table");
    while (body.firstChild) body.removeChild(body.firstChild);
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      [String(r.year), money.format(r.contributions), money.format(r.balance), money.format(r.today)].forEach(function (text) {
        var td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function update() {
    var raw = readInputs();
    var errors = C.validate(raw);
    NUMERIC.forEach(function (k) {
      var msg = errors[k] || "";
      if (k === "ratePct" && msg === "Enter a number." && form.elements[k].value.indexOf(",") !== -1) msg = "Use a dot for decimals, like 4.5.";
      showError(k, msg);
    });
    var infl = R.checkField(form.elements.inflation.value, R.INFLATION_LIMITS);
    showError("inflation", infl.error);

    var results = $("results");
    if (Object.keys(errors).length || infl.error) {
      // Never leave an old answer on screen as if it still applied.
      results.classList.add("stale");
      OUTPUTS.forEach(function (id) { $(id).textContent = "$..."; });
      $("out-real").textContent = "...%";
      $("out-basis").textContent = "";
      var body = $("out-table");
      while (body.firstChild) body.removeChild(body.firstChild);
      $("chart").setAttribute("aria-label", "No chart: fix the highlighted field.");
      $("out-summary").textContent = errors.frequency || errors.timing || "Fix the highlighted field to see results.";
      return;
    }
    results.classList.remove("stale");

    var pi = infl.value / 100;
    var res = C.calculate(raw);
    var rows = res.yearly.map(function (r) {
      return { year: r.year, balance: r.balance, contributions: r.contributions, today: R.toTodaysDollars(r.balance, pi, r.year) };
    });
    var last = rows[rows.length - 1];
    var apyPct = R.apy(raw.ratePct / 100, raw.frequency) * 100;
    var real = R.realRate(apyPct / 100, pi) * 100;

    $("out-final").textContent = money.format(res.final);
    $("out-today").textContent = money.format(last.today);
    $("out-real").textContent = R.formatPct(real);
    $("out-basis").textContent = "Based on the " + R.formatPct(apyPct) + " APY of " + R.formatInputPct(raw.ratePct) + " compounded " + raw.frequency + ".";
    var note = res.final >= C.EXACT_TO_CENTS_BELOW ? " Numbers this large are only approximate." : "";
    $("out-summary").textContent = "You put in " + money.format(res.contributions) + ". At " + R.formatInputPct(infl.value) +
      " inflation a year, the final balance would buy about what " + money.format(last.today) + " buys today." + note;
    drawChart(raw.principal, rows);
    drawTable(rows);
  }

  form.addEventListener("input", update);
  form.addEventListener("change", update);
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  update();
})();
