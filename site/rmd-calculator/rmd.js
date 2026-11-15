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

  /* ---------- Sliders. A slider position is a small whole number (Number). It becomes money only through
   * posToCents, which multiplies a BigInt position by a BigInt step: no dollar figure is ever a Number.
   * These helpers touch no DOM; the tests read this block from the source and run it. ---------- */
  /* BEGIN slider helpers */
  var SLIDER = { balanceStepCents: 500000n, balanceMaxPos: 200, growthStepBp: 25, growthMaxPos: 80 };
  function clampPos(pos, max) { pos = Math.round(Number(pos)); if (!(pos > 0)) return 0; return pos > max ? max : pos; }
  function posToCents(pos) { return BigInt(clampPos(pos, SLIDER.balanceMaxPos)) * SLIDER.balanceStepCents; }
  function centsToPos(cents) {
    var p = (BigInt(cents) + SLIDER.balanceStepCents / 2n) / SLIDER.balanceStepCents;
    return p > BigInt(SLIDER.balanceMaxPos) ? SLIDER.balanceMaxPos : Number(p);
  }
  /* Cents as field text: "100,000", or "100,000.50" when there are cents. */
  function centsToField(cents) { var s = formatMoney(cents).slice(1); return s.slice(-3) === ".00" ? s.slice(0, -3) : s; }
  function posToBp(pos) { return clampPos(pos, SLIDER.growthMaxPos) * SLIDER.growthStepBp; }
  function bpToPos(bp) { return clampPos(bp / SLIDER.growthStepBp, SLIDER.growthMaxPos); }
  /* Basis points as field text: 425 -> "4.25", 450 -> "4.5", 500 -> "5". */
  function bpToField(bp) {
    var w = Math.floor(bp / 100), f = bp % 100;
    return f === 0 ? String(w) : w + "." + ((f < 10 ? "0" : "") + f).replace(/0$/, "");
  }
  /* The birth-year step buttons: one year earlier or later, kept inside the years the engine accepts.
   * A field that does not hold a year is left alone (null), so its message stays. */
  function stepYear(text, delta, cur, maxAge) {
    var y = /^\d{4}$/.test(String(text).trim()) ? parseInt(text, 10) : null, lo = cur - (maxAge - 1);
    if (y === null) return null;
    y += delta;
    return String(y < lo ? lo : (y > cur ? cur : y));
  }
  /* "2026-11-14" -> "14 Nov 2026", for the one-line sources summary. Text only; no Date object. */
  function plainDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso), names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return m && names[parseInt(m[2], 10) - 1] ? parseInt(m[3], 10) + " " + names[parseInt(m[2], 10) - 1] + " " + m[1] : iso;
  }
  /* The year comes from the data's "used for 2026 distributions"; the two dates are the table's own. */
  function sourcesSummary(taxYear, reviewDate, nextReview) {
    var y = /used for (\d{4})/.exec(taxYear);
    return "Sources: IRS (Publications 590-A and 590-B, T.D. 10001, RMD FAQs) and Social Security; " + (y ? "used for " + y[1] + "; " : "") + "read " + plainDate(reviewDate) + "; next review " + plainDate(nextReview);
  }
  /* The hero figure steps down in size as it gets longer, so it never breaks inside a number. */
  function figureSize(text) { var n = String(text).length; return n <= 9 ? "" : (n <= 10 ? "f2" : (n <= 12 ? "f3" : (n <= 14 ? "f4" : "f5"))); }
  /* What the readout says for one table row: the same strings the table shows. */
  function readoutFor(row) {
    var when = row.year + ", age " + row.age, rmd = formatMoney(row.rmdCents), bal = formatMoney(row.balanceCents);
    return { when: when, rmd: rmd, balance: bal, text: "In this illustration, " + when + ": RMD " + rmd + ", balance " + bal };
  }
  /* A year picked from the chart whose row is folded away needs the whole table open, so its highlight can be seen. */
  function needsAllRows(i, showingAll, collapsedRows) { return !showingAll && i >= collapsedRows; }
  /* END slider helpers */

  /* ---------- The chart's years and the "When is the first RMD due?" card. These helpers touch no DOM and
   * hold no start age or birth-year range of their own: the start age, the first RMD year, the two
   * birth-year messages and the accepted years all come from calculate(), which reads RmdTables.
   * "today" is { y, m, d }; the tests pin it. ---------- */
  /* BEGIN first-due helpers */
  /* The chart draws the table's years up to the year the owner is endAge. The table itself is not cut. */
  function chartRows(rows, endAge) { return rows.filter(function (r) { return r.age <= endAge; }); }
  var CHART_PAST = "The chart shows years up to age " + LIMITS.endAge + ". For later ages, see the table below.";
  function chartNote(growthText) { return "Illustration of the table below, up to age " + LIMITS.endAge + ", not a forecast. Growth of " + growthText + " percent a year is your assumption."; }
  /* True once the day is after 1 April of the year y. */
  function afterFirstApril(today, y) { return today.y > y || (today.y === y && (today.m > 4 || (today.m === 4 && today.d > 1))); }
  /* What the card says for the text in its field: { error } or { answer, source }. */
  function firstDue(text, today, tables) {
    if (String(text == null ? "" : text).trim() === "") return { error: "Enter a birth year to see the first RMD year." };
    var res = calculate({ birthYear: text, balance: "0", growth: "0", currentYear: today.y }, tables);
    if (!res.ok) return { error: res.errors.birthYear };
    var B = res.birthYear, C = today.y, A = res.startAge, Y = res.startYear, N = Y + 1, read = plainDate(tables.REVIEW_DATE);
    var dates = "1 April and 31 December dates from IRS Publication 590-B, 2025 edition, and the IRS RMD FAQs; read " + read + ". Full rows in the sources table below.";
    if (res.older) {
      /* The engine's own sentences for these birth years: "... have already started." and then its source. */
      var s = res.startLine.split(" Source: ");
      return { answer: s[0] + " " + res.aprilNote + " Later RMDs are due by 31 December, so the RMD for " + C + " is due by 31 December " + C + ".", source: "Source: " + s[1] };
    }
    if (res.startRule.proposed) {
      return {
        answer: "For birth year " + B + ", the final regulations leave the start age open. A proposed rule says age " + A + ". Under the proposed rule, age " + A + " is reached in " + Y + ", so the first RMD would be for " + Y + ", due by 1 April " + N + " at the latest, and the RMD for " + N + " would be due by 31 December " + N + ". A delayed first payment would bring two payments into " + N + ". We found no final rule for " + B + " when we read the IRS pages on " + read + ".",
        source: "Source: proposed rule in IRB 2024-33 (2024); " + dates
      };
    }
    var source = "Source: start age from the final regulations (T.D. 10001, IRB 2024-33, 2024); " + dates;
    if (afterFirstApril(today, N)) {
      return { answer: "For birth year " + B + ", age " + A + " was reached in " + Y + ", so the first RMD was for " + Y + ". The IRS rule allowed it to be taken as late as 1 April " + N + ". Later RMDs are due by 31 December, so the RMD for " + C + " is due by 31 December " + C + ".", source: source };
    }
    return {
      answer: "For birth year " + B + ", age " + A + " " + (Y < C ? "was" : "is") + " reached in " + Y + ", so the first RMD is for " + Y + ". It is due by 1 April " + N + " at the latest, and it can also be taken during " + Y + ". Later RMDs are due by 31 December, starting with the RMD for " + N + ", due by 31 December " + N + ". A delayed first payment brings two payments into " + N + ": the first RMD and that year's own RMD.",
      source: source
    };
  }
  /* END first-due helpers */
  /* The one place the page reads today's date for the card. */
  function today() { var d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }; }

  /* ---------- Chart: inline SVG built with DOM calls. Dollar labels come from BigInt cents;
   * Number is used only for pixel positions. Position and size are SVG attributes, never styles. ---------- */
  var NS = "http://www.w3.org/2000/svg";
  var COLLAPSED_ROWS = 10;
  var showAll = false, chartAll = true, lastRes = null, lastWidth = 0, chartRefs = null, active = 0, firstDraw = true;

  function svgEl(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) { if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, String(attrs[k])); }
    if (parent) parent.appendChild(e);
    return e;
  }
  function px(n) { return Math.round(n * 10) / 10; }

  /* A tick step in whole dollars (BigInt) so that at most `most` steps reach the top of the axis. */
  function tickStep(maxCents, most) {
    var maxD = (maxCents + 99n) / 100n, p = 1n, i, st;
    if (maxD < 1n) return 1n;
    for (;;) {
      var cs = [1n, 2n, 5n];
      for (i = 0; i < 3; i++) { st = cs[i] * p; if ((maxD + st - 1n) / st <= most) return st; }
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
    if (v >= 1000n) return trimmed(v, 1000n, "K");
    return "$" + v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function drawChart(res) {
    var box = $("rmd-chart"), scrub = $("rmd-scrub");
    clear(box);
    chartRefs = null;
    var upTo = res && res.ok ? chartRows(res.rows, LIMITS.endAge) : [];
    $("rmd-chart-card").classList.toggle("no-years", !!(res && res.ok && res.rows.length && !upTo.length));
    if (res && res.ok && res.rows.length && !upTo.length) {
      /* An owner already past the chart's last age: no years to draw. The readout shows the table's first row. */
      var past = document.createElement("p");
      past.className = "rmd-chart-empty rmd-chart-past"; past.textContent = CHART_PAST;
      box.appendChild(past);
      box.setAttribute("aria-label", CHART_PAST);
      scrub.disabled = true;
      setActive(0);
      return;
    }
    if (!res || !res.ok || !res.rows.length) {
      var ph = document.createElement("p");
      ph.className = "rmd-chart-empty"; ph.textContent = "Fix the highlighted field to see the chart.";
      box.appendChild(ph);
      box.setAttribute("aria-label", "No chart: fix the highlighted field.");
      scrub.disabled = true;
      return;
    }
    var rows = chartAll ? upTo : upTo.slice(0, COLLAPSED_ROWS), n = rows.length, i;
    var W = Math.max(260, Math.round(box.clientWidth) || 640);
    lastWidth = Math.round(box.clientWidth);
    var narrow = W < 460;
    var ml = narrow ? 50 : 58, mr = 12, plotW = W - ml - mr;
    /* One frame, one x axis: the balance line in the upper part, and under it, inside the same frame,
     * a lower band for the yearly RMD bars with its own labelled scale. */
    var hA = narrow ? 120 : 132, hB = narrow ? 56 : 58, gap = 18;
    var topA = 34, botA = topA + hA, topB = botA + gap, botB = topB + hB, H = botB + 26;
    var svg = svgEl("svg", { "class": "rmd-svg", viewBox: "0 0 " + W + " " + H, width: W, height: H, "aria-hidden": "true", focusable: "false" });

    /* Gradients: colours come from the stylesheet through the stop classes. */
    var defs = svgEl("defs", {}, svg);
    var gA = svgEl("linearGradient", { id: "rmd-grad-bal", gradientUnits: "userSpaceOnUse", x1: 0, y1: topA, x2: 0, y2: botA }, defs);
    svgEl("stop", { "class": "g-bal-0", offset: 0 }, gA); svgEl("stop", { "class": "g-bal-1", offset: 1 }, gA);
    var gB = svgEl("linearGradient", { id: "rmd-grad-bar", gradientUnits: "userSpaceOnUse", x1: 0, y1: topB, x2: 0, y2: botB }, defs);
    svgEl("stop", { "class": "g-bar-0", offset: 0 }, gB); svgEl("stop", { "class": "g-bar-1", offset: 1 }, gB);

    var maxBal = 0n, maxRmd = 0n;
    for (i = 0; i < n; i++) {
      if (rows[i].balanceCents > maxBal) maxBal = rows[i].balanceCents;
      if (rows[i].rmdCents > maxRmd) maxRmd = rows[i].rmdCents;
    }
    var stepA = tickStep(maxBal, 3n), stepB = tickStep(maxRmd, 2n);
    var topAcents = ((maxBal + 99n) / 100n + stepA - 1n) / stepA * stepA * 100n;
    var topBcents = ((maxRmd + 99n) / 100n + stepB - 1n) / stepB * stepB * 100n;
    if (topAcents === 0n) topAcents = 100n;
    if (topBcents === 0n) topBcents = 100n;
    var fa = Number(topAcents), fb = Number(topBcents);

    var slot = plotW / n;
    function cx(k) { return ml + slot * (k + 0.5); }

    /* The band behind the year the readout shows. Drawn first so it sits behind everything. */
    var bandW = Math.max(slot, 14);
    svgEl("rect", { "class": "zone", x: ml, y: botA, width: px(plotW), height: botB - botA }, svg);
    var band = svgEl("rect", { "class": "band", x: px(cx(0) - bandW / 2), y: topA - 6, width: px(bandW), height: botB - topA + 6, rx: 7 }, svg);

    function grid(top, bot, stepD, topCents, label, cls) {
      var h = bot - top, v, tc = topCents / 100n;
      if (cls === "plabel-rmd") { stepD = tc; svgEl("text", { "class": "plabel " + cls, x: ml - 8, y: px((top + bot) / 2), dy: ".32em", "text-anchor": "end" }, svg).textContent = label; }
      else svgEl("text", { "class": "plabel " + cls, x: 0, y: top - 17 }, svg).textContent = label;
      for (v = 0n; v <= tc; v += stepD) {
        var y = bot - (Number(v * 100n) / Number(topCents)) * h;
        svgEl("line", { "class": v === 0n ? "base" : "grid", x1: ml, x2: W - mr, y1: px(y), y2: px(y) }, svg);
        svgEl("text", { "class": "axis", x: ml - 8, y: px(y), dy: ".32em", "text-anchor": "end" }, svg).textContent = axisLabel(v);
      }
    }
    grid(topA, botA, stepA, topAcents, "Balance", "plabel-bal");
    grid(topB, botB, stepB, topBcents, "RMD", "plabel-rmd");

    /* Balance: gradient area, line, and a glowing dot at the last year. */
    var pts = [], ys = [], d = "";
    for (i = 0; i < n; i++) {
      var yb = px(botA - (Number(rows[i].balanceCents) / fa) * hA);
      ys.push(yb);
      pts.push(px(cx(i)) + " " + yb);
    }
    d = "M" + pts.join(" L");
    if (n > 1) {
      svgEl("path", { "class": "area-bal", fill: "url(#rmd-grad-bal)", d: d + " L" + px(cx(n - 1)) + " " + botA + " L" + px(cx(0)) + " " + botA + " Z" }, svg);
      svgEl("path", { "class": firstDraw ? "ln-bal ln-draw" : "ln-bal", pathLength: 1, d: d }, svg);
      firstDraw = false;
    }
    svgEl("circle", { "class": "end-halo", cx: px(cx(n - 1)), cy: ys[n - 1], r: 9 }, svg);
    svgEl("circle", { "class": "end-dot", cx: px(cx(n - 1)), cy: ys[n - 1], r: 4.5 }, svg);

    /* RMD: rounded bars. The first bar is this year's when there is an RMD this year. */
    var bw = Math.max(3, Math.min(26, slot * 0.66)), bars = [];
    for (i = 0; i < n; i++) {
      var bh = (Number(rows[i].rmdCents) / fb) * hB;
      if (rows[i].rmdCents > 0n && bh < 2) bh = 2;
      bars.push(svgEl("rect", { "class": i === 0 && res.thisYear ? "bar bar-now" : "bar", fill: "url(#rmd-grad-bar)", x: px(cx(i) - bw / 2), y: px(botB - bh), width: px(bw), height: px(bh), rx: px(Math.min(5, bw / 2, bh / 2)) }, svg));
    }

    /* Year labels, thinned so they never touch. */
    var every = Math.max(1, Math.ceil(46 / slot));
    for (i = 0; i < n; i += every) {
      svgEl("text", { "class": "axis", x: px(cx(i)), y: botB + 19, "text-anchor": "middle" }, svg).textContent = String(rows[i].year);
    }
    /* The marker on the balance line for the year the readout shows. */
    var dot = svgEl("circle", { "class": "act-dot", cx: px(cx(0)), cy: ys[0], r: 5 }, svg);
    box.appendChild(svg);

    var f = rows[0], l = rows[n - 1];
    box.setAttribute("aria-label", "Bar chart of the RMD for each year from " + f.year + " to " + l.year + ", with a line for the balance under your growth assumption. In this illustration the RMD is " + formatMoney(f.rmdCents) + " in " + f.year + " and " + formatMoney(l.rmdCents) + " in " + l.year + ". The table below has every figure.");

    chartRefs = { svg: svg, W: W, n: n, ml: ml, slot: slot, bandW: bandW, band: band, dot: dot, bars: bars, ys: ys };
    scrub.disabled = false;
    scrub.setAttribute("max", String(n - 1));
    setActive(active);
  }

  /* Show one year in the readout, on the chart and in the table. i is a row index. */
  function setActive(i) {
    if (!lastRes) return;
    var c = chartRefs, all = lastRes.rows, trs = $("rmd-rows").children, k;
    var last = (c ? c.n : all.length) - 1;
    if (!(i > 0)) i = 0;
    if (i > last) i = last;
    active = i;
    if (needsAllRows(i, showAll, COLLAPSED_ROWS) && trs.length > i) { showAll = true; renderRows(); }
    var ro = readoutFor(all[i]), scrub = $("rmd-scrub");
    setText("ro-when", ro.when);
    setText("ro-rmd", ro.rmd);
    setText("ro-bal", ro.balance);
    scrub.value = String(i);
    scrub.setAttribute("aria-valuetext", ro.text);
    for (k = 0; k < trs.length; k++) trs[k].classList.toggle("sel", k === i);
    if (!c) return;
    var x = c.ml + c.slot * (i + 0.5);
    c.band.setAttribute("x", String(px(x - c.bandW / 2)));
    c.dot.setAttribute("cx", String(px(x)));
    c.dot.setAttribute("cy", String(c.ys[i]));
    for (k = 0; k < c.bars.length; k++) c.bars[k].classList.toggle("bar-sel", k === i);
  }

  /* The row index under a pointer: pixel geometry only. */
  function indexAt(evt) {
    var c = chartRefs;
    if (!c) return -1;
    var b = c.svg.getBoundingClientRect();
    if (!b.width) return -1;
    var k = Math.floor(((evt.clientX - b.left) * (c.W / b.width) - c.ml) / c.slot);
    return k < 0 ? 0 : (k >= c.n ? c.n - 1 : k);
  }
  function onPoint(evt) { var k = indexAt(evt); if (k >= 0 && k !== active) setActive(k); }

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

  /* An error message is a stroke-only line icon and then the words. The colour is never the only sign. */
  function setError(el, text) {
    clear(el);
    if (!text) return;
    var ic = svgEl("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" }, el);
    svgEl("circle", { cx: 8, cy: 8, r: 6.2 }, ic);
    svgEl("path", { d: "M8 4.8v3.9M8 11.1v.1" }, ic);
    el.appendChild(document.createTextNode(text));
  }
  function showErrors(errors) {
    ["birthYear", "balance", "growth", "spouseBirthYear"].forEach(function (f) {
      var inp = $(f), err = $(f + "-err");
      if (!inp || !err) return;
      setError(err, errors[f] || "");
      inp.setAttribute("aria-invalid", errors[f] ? "true" : "false");
      /* A field with a message also shows its format hint (on phones the hint is otherwise shown on focus). */
      var well = inp.closest(".rmd-field");
      if (well) well.classList.toggle("bad", !!errors[f]);
    });
  }

  /* Each slider follows its field whenever the field holds a value the engine accepts. */
  function setRange(id, pos, text) { var el = $(id); el.value = String(pos); el.setAttribute("aria-valuetext", text); }
  function syncSliders() {
    var bm = parseMoney(form.elements.balance.value), gg = parseGrowth(form.elements.growth.value);
    if (!bm.error) setRange("balance-range", centsToPos(bm.cents), formatMoney(bm.cents));
    if (!gg.error) setRange("growth-range", bpToPos(gg.bp), bpToField(gg.bp) + " percent a year");
  }
  /* A slider writes its value into its field as text; the engine then reads the field as before. */
  function fromSlider(el) {
    var f = el.getAttribute("data-for");
    if (f === "balance") form.elements.balance.value = centsToField(posToCents(el.value));
    else if (f === "growth") form.elements.growth.value = bpToField(posToBp(el.value));
  }
  function nudgeYear(delta) {
    var v = stepYear(form.elements.birthYear.value, delta, year, LIMITS.maxAge);
    if (v === null) return;
    form.elements.birthYear.value = v;
    update();
  }

  /* ---------- The card "When is the first RMD due?". It has its own field outside the form, so nothing typed
   * in it reaches the calculator. Until the reader gives it a different year it follows the calculator's
   * birth year, whenever that field holds a year the engine accepts. ---------- */
  var dueOwn = false, dueShown = null;
  function renderDue() {
    var inp = $("dueYear"), r = firstDue(inp.value, today(), T), key = JSON.stringify(r);
    if (key === dueShown) return;   // the same words are not written again, so they are not announced again
    dueShown = key;
    setError($("dueYear-err"), r.error || "");
    inp.setAttribute("aria-invalid", r.error ? "true" : "false");
    inp.closest(".rmd-field").classList.toggle("bad", !!r.error);
    setText("due-answer", r.error ? "" : r.answer);
    setText("due-source", r.error ? "" : r.source);
  }
  function followDue() {
    var v = form.elements.birthYear.value.trim();
    if (!dueOwn && !firstDue(v, today(), T).error) $("dueYear").value = v;
    renderDue();
  }
  function editDue() {
    dueOwn = $("dueYear").value.trim() !== form.elements.birthYear.value.trim();
    renderDue();
  }
  function nudgeDue(delta) {
    var v = stepYear($("dueYear").value, delta, today().y, LIMITS.maxAge);
    if (v === null) return;
    $("dueYear").value = v;
    editDue();
  }

  function update() {
    followDue();
    var res = calculate({
      birthYear: form.elements.birthYear.value, balance: form.elements.balance.value, growth: form.elements.growth.value,
      spouse: spouseOn && form.elements.spouse.checked, spouseBirthYear: form.elements.spouseBirthYear.value, currentYear: year
    });
    var rows = $("rmd-rows");
    clear(rows);
    $("results").classList.toggle("stale", !res.ok);
    if (spouseOn) $("spouse-year-field").hidden = !form.elements.spouse.checked;
    showErrors(res.ok ? {} : res.errors);
    syncSliders();
    $("out-main").className = "big" + (!res.ok || res.noRmdThisYear ? " is-text" : (figureSize(formatMoney(res.thisYear.rmdCents)) ? " " + figureSize(formatMoney(res.thisYear.rmdCents)) : ""));
    if (!res.ok) {
      setText("out-main", "...");
      setText("out-detail", "Fix the highlighted field to see results.");
      $("table-scope-note").hidden = false;
      setText("out-start", ""); setText("out-april", ""); setText("out-table", ""); setText("out-proposed", "");
      setText("rmd-caption", "Fix the highlighted field to see the table.");
      ["stat-age", "stat-div", "stat-first"].forEach(function (id) { setText(id, "..."); });
      setText("stat-first-sub", "");
      setText("rmd-chart-note", "");
      setText("ro-when", ""); setText("ro-rmd", ""); setText("ro-bal", "");
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
    setText("rmd-chart-note", chartNote(g));
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
    if (rows.firstChild && res.thisYear) {
      rows.firstChild.className = "now";
      var tag = document.createElement("span");
      tag.className = "now-tag"; tag.textContent = "This year";
      rows.firstChild.firstChild.appendChild(tag);
    }
    renderRows();
    $("rmd-range").hidden = chartRows(res.rows, LIMITS.endAge).length <= COLLAPSED_ROWS;
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
  if ($("sources-summary")) setText("sources-summary", sourcesSummary(T.TAX_YEAR, T.REVIEW_DATE, T.NEXT_REVIEW));
  var rd = $("review-line");
  if (rd) rd.textContent = "Review date: " + T.REVIEW_DATE + ". Next review: " + T.NEXT_REVIEW + ". Source: " + T.SOURCE_LINE + ". Tax year: " + T.TAX_YEAR + ".";

  $("birthYear-down").addEventListener("click", function () { nudgeYear(-1); });
  $("birthYear-up").addEventListener("click", function () { nudgeYear(1); });
  $("dueYear").addEventListener("input", editDue);
  $("dueYear-down").addEventListener("click", function () { nudgeDue(-1); });
  $("dueYear-up").addEventListener("click", function () { nudgeDue(1); });
  /* "Back to the example inputs" also puts the card back in step with the calculator (this runs before the reset below). */
  $("rmd-reset").addEventListener("click", function () { dueOwn = false; });

  $("rmd-toggle").addEventListener("click", function () { showAll = !showAll; renderRows(); });
  $("rmd-range").addEventListener("click", function (e) {
    var b = e.target, btns = $("rmd-range").getElementsByTagName("button"), k;
    if (!b || b.tagName !== "BUTTON") return;
    chartAll = b.getAttribute("data-range") === "all";
    for (k = 0; k < btns.length; k++) btns[k].setAttribute("aria-pressed", btns[k] === b ? "true" : "false");
    drawChart(lastRes);
  });
  $("rmd-chart").addEventListener("pointermove", onPoint);
  $("rmd-chart").addEventListener("pointerdown", onPoint);
  $("rmd-scrub").addEventListener("input", function () { setActive(parseInt($("rmd-scrub").value, 10)); });
  $("rmd-reset").addEventListener("click", function () { form.reset(); active = 0; update(); });
  window.addEventListener("resize", function () {
    var w = Math.round($("rmd-chart").clientWidth);
    if (lastRes && w && w !== lastWidth) drawChart(lastRes);
    fitHint();
  });
  function onInput(e) {
    var t = e.target;
    if (t && t.type === "range" && t.getAttribute("data-for")) fromSlider(t);
    update();
  }
  form.addEventListener("input", onInput);
  form.addEventListener("change", onInput);
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  update();
})(typeof self !== "undefined" ? self : this);
