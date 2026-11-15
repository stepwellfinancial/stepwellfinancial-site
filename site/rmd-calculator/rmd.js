/* rmd.js: the RMD calculator.
 * Part 1 is pure (no DOM, no network, no storage) and runs in node for the tests: window.RmdCalc / module.exports.
 * Part 2 wires the form and only runs in a browser page that has the form.
 * All figures come from rmd-tables.js. Money is whole cents (integers) so rounding is exact:
 * round half up to cents, and the rounded cents are carried into the next row. */
(function (root) {
  "use strict";
  var T = (typeof module === "object" && module.exports) ? require("./rmd-tables.js") : root.RmdTables;

  var LIMITS = { maxBalanceCents: 100000000000n, maxGrowthBp: 2000, maxRows: 40, endAge: 100, oldEndAge: 120, maxAge: 130 };

  /* Exact half-up integer division for BigInt n >= 0, d > 0. No floating point anywhere in the money path. */
  function divRound(n, d) { return (2n * n + d) / (2n * d); }

  function parseYear(s) {
    s = String(s == null ? "" : s).trim();
    return /^\d{4}$/.test(s) ? parseInt(s, 10) : null;
  }

  /* "1,234.5" -> 123450 cents. Extra decimals round half up. Returns {cents} or {error}. */
  function parseMoney(s) {
    s = String(s == null ? "" : s).trim();
    if (s === "") return { error: "Enter your balance on 31 December of last year, in dollars. Use 0 if it is empty." };
    if (/^-/.test(s)) return { error: "The balance cannot be negative." };
    var m = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d+))?$/.exec(s);
    if (!m || (m[1] === undefined && m[2] === undefined)) return { error: "Enter the balance as a number, for example 100000 or 100,000.50." };
    var frac = m[2] || "";
    var cents = BigInt((m[1] || "0").replace(/,/g, "") + (frac + "00").slice(0, 2));
    if (frac.length > 2 && frac.charAt(2) >= "5") cents += 1n;
    if (cents > LIMITS.maxBalanceCents) return { error: "Enter a balance of 1,000,000,000 dollars or less." };
    return { cents: cents };
  }

  /* "3.5" -> 350 basis points (hundredths of a percent). */
  function parseGrowth(s) {
    s = String(s == null ? "" : s).trim();
    if (s === "") return { error: "Enter a growth rate from 0 to 20 percent. Use 0 for none." };
    if (/^-/.test(s)) return { error: "The growth rate cannot be negative. Use 0 to 20 percent." };
    var m = /^(\d+)?(?:\.(\d+))?$/.exec(s);
    if (!m || (m[1] === undefined && m[2] === undefined)) return { error: "Enter the growth rate as a number, for example 0 or 4.5." };
    if (m[2] && m[2].length > 2) return { error: "Use at most two decimals, for example 4.25." };
    var bp = parseInt(m[1] || "0", 10) * 100 + (m[2] ? parseInt((m[2] + "0").slice(0, 2), 10) : 0);
    if (bp > LIMITS.maxGrowthBp) return { error: "Enter a growth rate from 0 to 20 percent." };
    return { bp: bp };
  }

  function startRule(birthYear, tables) {
    var rules = (tables || T).START_AGE_RULES;
    for (var i = 0; i < rules.length; i++) {
      if (birthYear >= rules[i].fromYear && birthYear <= rules[i].toYear) return rules[i];
    }
    return null;
  }

  function divisorIII(age, tables) {
    var t3 = (tables || T).TABLE_III;
    var a = Math.min(Math.max(age, t3.startAge), t3.endAge);
    return t3.divisors[a - t3.startAge];
  }

  function hasTableII(tables) { return !!((tables || T).TABLE_II); }

  function divisorII(ownerAge, spouseAge, tables) {
    var t2 = (tables || T).TABLE_II;
    if (!t2 || !t2[ownerAge]) return null;
    var v = t2[ownerAge][spouseAge];
    return typeof v === "number" ? v : null;
  }

  /* balanceCents: BigInt (a whole number is accepted). divisor: a table value such as 26.5, held as tenths. */
  function rmdCents(balanceCents, divisor) {
    return divRound(BigInt(balanceCents) * 10n, BigInt(Math.round(divisor * 10)));
  }

  /* cents: BigInt (a whole number is accepted). */
  function formatMoney(cents) {
    var c = BigInt(cents), r = c % 100n;
    var whole = (c / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return "$" + whole + "." + (r < 10n ? "0" : "") + r.toString();
  }

  /* input: { birthYear, balance, growth, spouse (bool), spouseBirthYear, currentYear } (strings or numbers).
   * Returns { ok:false, errors:{field:message} } or { ok:true, ... } (see below). */
  function calculate(input, tables) {
    tables = tables || T;
    var errors = {}, any = false;
    var cur = input.currentYear != null ? input.currentYear : new Date().getFullYear();
    var by = parseYear(input.birthYear);
    var oldest = cur - (LIMITS.maxAge - 1);   // an age of 130 or more is not accepted
    if (by === null) { errors.birthYear = "Enter your birth year as four digits, for example 1953."; }
    else if (by > cur || by < oldest) { errors.birthYear = "Enter a birth year from " + oldest + " to " + cur + "."; }
    var bal = parseMoney(input.balance);
    if (bal.error) errors.balance = bal.error;
    var gr = parseGrowth(input.growth == null || input.growth === "" ? "0" : input.growth);
    if (gr.error) errors.growth = gr.error;

    var useSpouse = !!input.spouse && hasTableII(tables);
    var sby = null;
    if (useSpouse) {
      sby = parseYear(input.spouseBirthYear);
      if (sby === null || sby < 1900 || sby > cur) errors.spouseBirthYear = "Enter your spouse's birth year as four digits, from 1900 to " + cur + ".";
    }
    for (var k in errors) { if (Object.prototype.hasOwnProperty.call(errors, k)) any = true; }
    if (any) return { ok: false, errors: errors };

    /* Birth years before the first start-age rule: RMDs have already started. Nothing else is stated about them. */
    var older = by < tables.MIN_BIRTH_YEAR;
    var rule = older ? null : startRule(by, tables);
    var startAge = older ? null : rule.age, startYear = older ? null : by + startAge;
    var tableII = useSpouse && (sby - by) >= 11;
    var tableNote;
    if (!hasTableII(tables)) tableNote = "This calculator covers the Uniform Lifetime Table only. If the only beneficiary is a spouse more than 10 years younger, the IRS uses a different table and the RMD can be lower.";
    else if (!useSpouse) tableNote = "Uniform Lifetime Table (Table III) used.";
    else if (tableII) tableNote = "Joint Life and Last Survivor Table (Table II) used: spouse is 11 or more birth years younger.";
    else tableNote = "Uniform Lifetime Table (Table III) used: Table II needs a spouse born at least 11 years after you, and the spouse here is " + (sby > by ? (sby - by) + " years younger" : "not younger") + ".";

    var out = {
      ok: true, birthYear: by, currentYear: cur, startAge: startAge, startYear: startYear,
      startRule: rule, proposedNote: rule && rule.proposed ? rule.note : "",
      table: tableII ? "II" : "III", tableNote: tableNote,
      noRmdThisYear: !older && cur < startYear, firstRmdYear: older ? cur : Math.max(cur, startYear),
      firstRmdAge: (older ? cur : Math.max(cur, startYear)) - by, thisYear: null, rows: [], error: null,
      older: older,
      aprilNote: older ? "The 1 April first-year option applies only to the first RMD year, so it does not apply here." : "",
      startLine: older ? "RMDs for this birth year have already started. Source: IRS Publication 590-B, 2025 edition (age 72 for tax years 2020 to 2022; age 73 from 2023), read 14 Nov 2026."
        : "Start age " + startAge + " for birth year " + by + ", so the first RMD year is " + startYear + ". " + (rule.proposed ? "" : rule.note + " ") + "Source: " + rule.source + ". Review date: " + tables.REVIEW_DATE + ".",
      coverageNote: older ? "The table starts at this year's age and runs to age " + LIMITS.oldEndAge + " or " + LIMITS.maxRows + " rows, whichever comes first." : ""
    };

    var balance = bal.cents, year = cur, row, div, r;
    var factor = BigInt(10000 + gr.bp);
    while (!older && year < startYear) { balance = divRound(balance * factor, 10000n); year++; }   // years before the first RMD: growth only
    var endAge = older ? LIMITS.oldEndAge : LIMITS.endAge;
    while ((out.rows.length === 0 || year - by <= endAge) && out.rows.length < LIMITS.maxRows) {
      var age = year - by;
      div = tableII ? divisorII(age, year - sby, tables) : divisorIII(age, tables);
      if (div === null) { out.error = "The Table II value for owner age " + age + " and spouse age " + (year - sby) + " is not in the data."; break; }
      r = rmdCents(balance, div);
      row = { year: year, age: age, balanceCents: balance, divisor: div, rmdCents: r };
      out.rows.push(row);
      balance = divRound((balance - r) * factor, 10000n);
      year++;
    }
    if (!out.noRmdThisYear && out.rows.length) out.thisYear = out.rows[0];
    return out;
  }

  var api = {
    LIMITS: LIMITS, calculate: calculate, parseMoney: parseMoney, parseGrowth: parseGrowth, parseYear: parseYear,
    startRule: startRule, divisorIII: divisorIII, divisorII: divisorII, hasTableII: hasTableII,
    rmdCents: rmdCents, formatMoney: formatMoney, divRound: divRound
  };
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  root.RmdCalc = api;

  /* ---------- Part 2: the page (browser only) ---------- */
  if (typeof document === "undefined") return;
  var form = document.getElementById("rmd-form");
  if (!form) return;
  function $(id) { return document.getElementById(id); }
  function setText(id, text) { $(id).textContent = text; }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function cell(tag, text, scope) { var c = document.createElement(tag); c.textContent = text; if (scope) c.setAttribute("scope", scope); return c; }

  var year = new Date().getFullYear();
  $("birthYear").setAttribute("max", String(year));
  $("birthYear").setAttribute("min", String(year - (LIMITS.maxAge - 1)));
  var spouseOn = hasTableII();
  $("spouse-block").hidden = !spouseOn;
  setText("table-scope-note", spouseOn ? "" : "This calculator covers the Uniform Lifetime Table only. If the only beneficiary is a spouse more than 10 years younger, the IRS uses a different table and the RMD can be lower.");

  /* ---------- Chart: inline SVG built with DOM calls. Dollar labels come from BigInt cents;
   * Number is used only for pixel positions. ---------- */
  var NS = "http://www.w3.org/2000/svg";
  var COLLAPSED_ROWS = 10;
  var showAll = false, lastRes = null, lastWidth = 0;

  function svgEl(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) { if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, String(attrs[k])); }
    if (parent) parent.appendChild(e);
    return e;
  }
  function px(n) { return Math.round(n * 10) / 10; }

  /* A tick step in whole dollars (BigInt) so that at most 4 steps reach the top of the axis. */
  function tickStep(maxCents) {
    var maxD = (maxCents + 99n) / 100n, p = 1n, i, st;
    if (maxD < 1n) return 1n;
    for (;;) {
      var cs = [1n, 2n, 5n];
      for (i = 0; i < 3; i++) { st = cs[i] * p; if ((maxD + st - 1n) / st <= 4n) return st; }
      p *= 10n;
    }
  }
  function trimmed(v, unit, suffix) {
    var whole = v / unit, frac = ((v % unit) * 100n) / unit, f = frac.toString();
    if (frac < 10n) f = "0" + f;
    f = f.replace(/0+$/, "");
    return "$" + whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "") + suffix;
  }
  /* An axis label for a whole-dollar BigInt value. */
  function axisLabel(v) {
    if (v >= 1000000000n) return trimmed(v, 1000000000n, "B");
    if (v >= 1000000n) return trimmed(v, 1000000n, "M");
    if (v >= 10000n) return trimmed(v, 1000n, "K");
    return "$" + v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function drawChart(res) {
    var box = $("rmd-chart");
    clear(box);
    if (!res || !res.ok || !res.rows.length) {
      var ph = document.createElement("p");
      ph.className = "rmd-note"; ph.textContent = "Fix the highlighted field to see the chart.";
      box.appendChild(ph);
      box.setAttribute("aria-label", "No chart: fix the highlighted field.");
      return;
    }
    var rows = res.rows, n = rows.length, i;
    var W = Math.max(260, Math.round(box.clientWidth) || 640);
    lastWidth = Math.round(box.clientWidth);
    var narrow = W < 460;
    var ml = narrow ? 46 : 54, mr = 8, plotW = W - ml - mr;
    var hA = narrow ? 100 : 120, hB = narrow ? 92 : 110, gap = 42;
    var topA = 30, botA = topA + hA, topB = botA + gap, botB = topB + hB, H = botB + 28;
    var svg = svgEl("svg", { "class": "rmd-svg", viewBox: "0 0 " + W + " " + H, "aria-hidden": "true", focusable: "false" });

    var maxBal = 0n, maxRmd = 0n;
    for (i = 0; i < n; i++) {
      if (rows[i].balanceCents > maxBal) maxBal = rows[i].balanceCents;
      if (rows[i].rmdCents > maxRmd) maxRmd = rows[i].rmdCents;
    }
    var stepA = tickStep(maxBal), stepB = tickStep(maxRmd);
    var topAcents = ((maxBal + 99n) / 100n + stepA - 1n) / stepA * stepA * 100n;
    var topBcents = ((maxRmd + 99n) / 100n + stepB - 1n) / stepB * stepB * 100n;
    if (topAcents === 0n) topAcents = 100n;
    if (topBcents === 0n) topBcents = 100n;
    var fa = Number(topAcents), fb = Number(topBcents);

    function grid(top, bot, stepD, topCents, label) {
      var h = bot - top, v, tc = topCents / 100n;
      svgEl("text", { "class": "plabel", x: 0, y: top - 16 }, svg).textContent = label;
      for (v = 0n; v <= tc; v += stepD) {
        var y = bot - (Number(v * 100n) / Number(topCents)) * h;
        svgEl("line", { "class": v === 0n ? "base" : "grid", x1: ml, x2: W - mr, y1: px(y), y2: px(y) }, svg);
        svgEl("text", { "class": "axis", x: ml - 6, y: px(y), dy: ".32em", "text-anchor": "end" }, svg).textContent = axisLabel(v);
      }
    }
    grid(topA, botA, stepA, topAcents, "Balance");
    grid(topB, botB, stepB, topBcents, "RMD");

    var slot = plotW / n;
    function cx(k) { return ml + slot * (k + 0.5); }

    /* Balance: area and line. */
    var pts = [], d = "";
    for (i = 0; i < n; i++) {
      var yb = botA - (Number(rows[i].balanceCents) / fa) * hA;
      pts.push(px(cx(i)) + " " + px(yb));
    }
    d = "M" + pts.join(" L");
    svgEl("path", { "class": "area-bal", d: d + " L" + px(cx(n - 1)) + " " + botA + " L" + px(cx(0)) + " " + botA + " Z" }, svg);
    svgEl("path", { "class": "ln-bal", d: d }, svg);

    /* RMD: bars, with a title (hover text) on each. */
    var bw = Math.max(2, Math.min(28, slot * 0.7));
    for (i = 0; i < n; i++) {
      var bh = (Number(rows[i].rmdCents) / fb) * hB;
      var bar = svgEl("rect", { "class": i === 0 && res.thisYear ? "bar bar-now" : "bar", x: px(cx(i) - bw / 2), y: px(botB - bh), width: px(bw), height: px(Math.max(bh, rows[i].rmdCents > 0n ? 1 : 0)), rx: bw > 6 ? 2 : 0 }, svg);
      svgEl("title", {}, bar).textContent = rows[i].year + ", age " + rows[i].age + ": RMD " + formatMoney(rows[i].rmdCents);
    }

    /* Year labels, thinned so they never touch. */
    var every = Math.max(1, Math.ceil(44 / slot));
    for (i = 0; i < n; i += every) {
      svgEl("text", { "class": "axis", x: px(cx(i)), y: botB + 18, "text-anchor": "middle" }, svg).textContent = String(rows[i].year);
    }
    box.appendChild(svg);

    var f = rows[0], l = rows[n - 1];
    box.setAttribute("aria-label", "Bar chart of the RMD for each year from " + f.year + " to " + l.year + ", with a line for the balance under your growth assumption. In this illustration the RMD is " + formatMoney(f.rmdCents) + " in " + f.year + " and " + formatMoney(l.rmdCents) + " in " + l.year + ". The table below has every figure.");
  }

  function renderRows() {
    var rows = $("rmd-rows").children, n = rows.length, i, btn = $("rmd-toggle");
    for (i = 0; i < n; i++) rows[i].hidden = !showAll && i >= COLLAPSED_ROWS;
    btn.hidden = n <= COLLAPSED_ROWS;
    btn.setAttribute("aria-expanded", showAll ? "true" : "false");
    btn.textContent = showAll ? "Show the first " + COLLAPSED_ROWS + " years" : "Show all " + n + " years";
    fitHint();
  }
  /* The sideways-scroll hint shows only when the table is wider than its box. */
  function fitHint() {
    var w = $("rmd-rows").parentNode.parentNode, hint = $("rmd-scroll-hint");
    if (hint) hint.hidden = !(w.scrollWidth > w.clientWidth + 1);
  }

  function showErrors(errors) {
    ["birthYear", "balance", "growth", "spouseBirthYear"].forEach(function (f) {
      var inp = $(f), err = $(f + "-err");
      if (!inp || !err) return;
      err.textContent = errors[f] || "";
      inp.setAttribute("aria-invalid", errors[f] ? "true" : "false");
    });
  }

  function update() {
    var res = calculate({
      birthYear: form.elements.birthYear.value, balance: form.elements.balance.value, growth: form.elements.growth.value,
      spouse: spouseOn && form.elements.spouse.checked, spouseBirthYear: form.elements.spouseBirthYear.value, currentYear: year
    });
    var rows = $("rmd-rows");
    clear(rows);
    $("results").classList.toggle("stale", !res.ok);
    if (spouseOn) $("spouse-year-field").hidden = !form.elements.spouse.checked;
    showErrors(res.ok ? {} : res.errors);
    if (!res.ok) {
      setText("out-main", "...");
      setText("out-detail", "Fix the highlighted field to see results.");
      $("table-scope-note").hidden = false;
      setText("out-start", ""); setText("out-april", ""); setText("out-table", ""); setText("out-proposed", "");
      setText("rmd-caption", "Fix the highlighted field to see the table.");
      ["stat-age", "stat-div", "stat-first"].forEach(function (id) { setText(id, "..."); });
      setText("stat-first-sub", "");
      setText("rmd-chart-note", "");
      lastRes = null;
      drawChart(null);
      renderRows();
      return;
    }
    if (res.noRmdThisYear) {
      setText("out-main", "No RMD this year");
      setText("out-detail", "Your first RMD year is " + res.startYear + ", at age " + res.startAge + ".");
    } else {
      var t = res.thisYear;
      setText("out-main", formatMoney(t.rmdCents));
      setText("out-detail", "RMD for " + t.year + ": " + formatMoney(t.balanceCents) + " divided by " + t.divisor.toFixed(1) + " (Table " + res.table + "), at age " + t.age + ".");
    }
    var g = form.elements.growth.value || "0";
    if (res.noRmdThisYear) {
      setText("stat-age", String(res.currentYear - res.birthYear));
      setText("stat-div", "Not yet");
    } else {
      setText("stat-age", String(res.thisYear.age));
      setText("stat-div", res.thisYear.divisor.toFixed(1));
    }
    setText("stat-age-label", "Age in " + res.currentYear);
    setText("stat-div-label", "Divisor used (Table " + res.table + ")");
    setText("stat-first", res.older ? "Already started" : String(res.startYear));
    setText("stat-first-sub", res.older ? "" : "At age " + res.startAge);
    setText("rmd-chart-note", "Illustration of the table below, not a forecast. Growth of " + g + " percent a year is your assumption.");
    setText("out-start", res.startLine);
    setText("out-april", res.aprilNote);
    setText("out-proposed", res.proposedNote);
    setText("out-table", res.tableNote + (res.error ? " " + res.error : ""));
    /* The scope note and the table note are the same sentence when Table II is off: show it once. */
    $("table-scope-note").hidden = !!$("table-scope-note").textContent && res.tableNote === $("table-scope-note").textContent;
    setText("rmd-caption", "Year by year from " + res.firstRmdYear + ", each year on the 31 December basis. Growth of " + (form.elements.growth.value || "0") + " percent a year is your assumption, not a forecast." + (res.coverageNote ? " " + res.coverageNote : ""));
    res.rows.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.appendChild(cell("th", String(r.year), "row"));
      tr.appendChild(cell("td", String(r.age)));
      tr.appendChild(cell("td", formatMoney(r.balanceCents)));
      tr.appendChild(cell("td", r.divisor.toFixed(1)));
      tr.appendChild(cell("td", formatMoney(r.rmdCents)));
      rows.appendChild(tr);
    });
    if (rows.firstChild && res.thisYear) rows.firstChild.className = "now";
    renderRows();
    lastRes = res;
    drawChart(res);
  }

  /* Sources table, drawn from rmd-tables.js. */
  var sb = $("sources-rows");
  if (sb) T.SOURCES.forEach(function (s) {
    var tr = document.createElement("tr");
    tr.appendChild(cell("th", s.figure, "row"));
    tr.appendChild(cell("td", s.value));
    var td = document.createElement("td"), a = document.createElement("a");
    a.href = s.url; a.textContent = s.url.replace(/^https:\/\//, ""); td.appendChild(a); tr.appendChild(td);
    tr.appendChild(cell("td", s.taxYear));
    tr.appendChild(cell("td", s.retrieved));
    tr.appendChild(cell("td", s.nextReview));
    sb.appendChild(tr);
  });
  var rd = $("review-line");
  if (rd) rd.textContent = "Review date: " + T.REVIEW_DATE + ". Next review: " + T.NEXT_REVIEW + ". Source: " + T.SOURCE_LINE + ". Tax year: " + T.TAX_YEAR + ".";

  $("rmd-toggle").addEventListener("click", function () { showAll = !showAll; renderRows(); });
  window.addEventListener("resize", function () {
    var w = Math.round($("rmd-chart").clientWidth);
    if (lastRes && w && w !== lastWidth) drawChart(lastRes);
    fitHint();
  });
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  update();
})(typeof self !== "undefined" ? self : this);
