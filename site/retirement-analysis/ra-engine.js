/* ra-engine.js: the retirement analysis engine. PURE: no page access, no storage, no network,
 * no clock, no randomness other than the seeded generator below. Loadable in the browser
 * (attaches RA to the global object; rmd-tables.js must be loaded first, global RmdTables) and
 * in Node (module.exports; rmd-tables.js is read from ../rmd-calculator/).
 *
 * The full specification, with every rounding point and a hand-worked example, is
 * docs/retirement-engine.md. An independent implementation should be written from that file,
 * not from this one. The short version:
 *
 *   MONEY     Every amount is an integer number of cents. Rounding is always round half up,
 *             floor(x + 0.5), and happens in exactly four places: (R1) growth of each account,
 *             (R2) the required minimum distribution, (R3) tax on a tax-deferred withdrawal,
 *             (R4) the summary averages. The withdrawal percentage (R5) is a display figure.
 *   RETURNS   Arrive as decimal strings, parsed once to IEEE-754 doubles. Real return of an asset
 *             in a historical year = (1 + nominal) / (1 + inflation) - 1. Portfolio real return =
 *             sum of weight x real return over the assets in the fixed order usLarge, usMid,
 *             usSmall, intl, bonds, cash, skipping assets whose weight is 0.
 *   WINDOW    One sampling window for the whole data file: the years in which every one of the
 *             seven series has a value. Every TAM uses it.
 *   DRAWS     Run r (0 to 499) uses mulberry32 seeded with (SEED + r) mod 2^32. Year t of the run
 *             takes the next value u and uses historical year window[floor(u x windowLength)].
 *   ONE YEAR  Before retirement: any required minimum distribution (R2) at the start of the year,
 *             taxed (R3), the rest moved to the taxable account; grow each account (R1); then add
 *             contributions, recurring income that has started and any one-time income.
 *             In retirement: income, required minimum distribution (R2) and its tax (R3),
 *             withdrawals in the order RMD, taxable, more tax-deferred (grossed up, R3),
 *             tax-exempt; any shortfall; then grow what is left (R1).
 *   OUTCOMES  Runs are ranked by how the plan ended, worst first: a run with a shortfall is worse
 *             than any run without; among those, an earlier first shortfall year, then a larger
 *             total shortfall; among runs without, lower savings at the end; ties keep the lower
 *             run number first. Average is the run at sorted index floor(runs x 50 / 100), below
 *             average at 25, significantly below average at 10.
 */
(function (root, factory) {
  "use strict";
  var tables = null;
  if (typeof module === "object" && module.exports) {
    try { tables = require("../rmd-calculator/rmd-tables.js"); } catch (e) { tables = null; }
    module.exports = factory(tables);
  } else {
    root.RA = factory(root.RmdTables || null);
  }
})(typeof self !== "undefined" ? self : this, function (RMD_TABLES) {
  "use strict";

  var VERSION = "1.2.0";
  var RANK_BASIS = "plan outcome";
  var RUNS = 500;
  var SEED = 20261114;            /* the documented constant; run r uses (SEED + r) mod 2^32 */
  var MAX_AGE = 120;              /* cap on every age, the last age of the Uniform Lifetime Table */
  var MIN_AGE = 18;
  var MAX_MONEY = 100000000000;   /* 1,000,000,000.00 dollars in cents, per money field */
  var MAX_ROWS = 50;              /* other income rows, one-time rows */
  var MAX_TAX_PCT = 50;
  var SAFE = 9007199254740991;    /* 2^53 - 1 */

  var ASSETS = ["usLarge", "usMid", "usSmall", "intl", "bonds", "cash"];
  var DEFAULT_STOCK_SPLIT = { us: 0.7, intl: 0.3 };
  var DEFAULT_US_SPLIT = { large: 0.7, mid: 0.2, small: 0.1 };

  /* Section 2 of the plan: whole percentages of stocks, bonds and cash for TAM 1 to 10. */
  var TAMS = [
    { tam: 1, stocks: 0, bonds: 0, cash: 100 },
    { tam: 2, stocks: 20, bonds: 80, cash: 0 },
    { tam: 3, stocks: 30, bonds: 70, cash: 0 },
    { tam: 4, stocks: 40, bonds: 60, cash: 0 },
    { tam: 5, stocks: 50, bonds: 50, cash: 0 },
    { tam: 6, stocks: 60, bonds: 40, cash: 0 },
    { tam: 7, stocks: 70, bonds: 30, cash: 0 },
    { tam: 8, stocks: 80, bonds: 20, cash: 0 },
    { tam: 9, stocks: 90, bonds: 10, cash: 0 },
    { tam: 10, stocks: 100, bonds: 0, cash: 0 }
  ];

  /* The three market conditions: key, percentile of the ranked runs. */
  var CONDITIONS = [
    { key: "average", percentile: 50 },
    { key: "below", percentile: 25 },
    { key: "sigBelow", percentile: 10 }
  ];
  var BAND_PERCENTILES = [10, 25, 50, 75, 90];

  /* ---------- small exact helpers ---------- */

  function isInt(x) { return typeof x === "number" && isFinite(x) && Math.floor(x) === x; }

  /* floor(a / b) for non-negative integers, corrected so a float quotient can never be off by one. */
  function floorDiv(a, b) {
    var q = Math.floor(a / b);
    var r = a - q * b;
    while (r < 0) { q -= 1; r += b; }
    while (r >= b) { q += 1; r -= b; }
    return q;
  }

  /* n / d rounded half up, exact for integers with 2n + d below 2^53. */
  function divRound(n, d) { return floorDiv(2 * n + d, 2 * d); }

  /* The generator. Returns a function giving the next value in [0, 1). */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* R3. Tax on a gross tax-deferred withdrawal of g cents at rateBp basis points, half up, exact. */
  function taxOn(g, rateBp) {
    if (rateBp === 0 || g === 0) return 0;
    var q = Math.floor(g / 10000);
    var rem = g - q * 10000;
    return q * rateBp + Math.floor((rem * rateBp + 5000) / 10000);
  }

  /* The smallest gross withdrawal g whose amount after tax, g - taxOn(g), is at least n. */
  function grossUp(n, rateBp) {
    if (rateBp === 0 || n === 0) return n;
    var g = Math.floor(n * 10000 / (10000 - rateBp));      /* an estimate, corrected exactly below */
    while (g - taxOn(g, rateBp) < n) g += 1;
    while (g > 0 && (g - 1) - taxOn(g - 1, rateBp) >= n) g -= 1;
    return g;
  }

  /* R1. Growth of one account over a year at real return r, in cents, half up. */
  function growthOf(balance, r) { return Math.floor(balance * r + 0.5); }

  /* Sorted position for a percentile: floor(count x percentile / 100), at most count - 1. */
  function percentileIndex(count, percentile) {
    var i = floorDiv(count * percentile, 100);
    return i > count - 1 ? count - 1 : i;
  }

  function err(list, code, field, message) { list.push({ code: code, field: field, message: message }); }

  /* ---------- the required minimum distribution rule, from rmd-tables.js ---------- */

  function rmdRule(birthYear) {
    var T = RMD_TABLES;
    if (!T || !T.TABLE_III || !T.TABLE_III.divisors || !T.TABLE_III.divisors.length || !T.START_AGE_RULES) return null;
    var rules = T.START_AGE_RULES, startAge = null, proposed = false, basis = "rule", i;
    var earliest = rules[0].fromYear;
    for (i = 0; i < rules.length; i++) {
      if (rules[i].fromYear < earliest) earliest = rules[i].fromYear;
      if (birthYear >= rules[i].fromYear && birthYear <= rules[i].toYear) {
        startAge = rules[i].age; proposed = !!rules[i].proposed;
      }
    }
    if (startAge === null) {
      /* Born before the earliest rule in the file: distributions have already begun. */
      startAge = T.TABLE_III.startAge; basis = birthYear < earliest ? "before_rules" : "no_rule";
    }
    /* Divisors in tenths, as integers, by age 0..MAX_AGE; 0 means no distribution at that age. */
    var div10 = [], t3 = T.TABLE_III, age, d;
    for (age = 0; age <= MAX_AGE; age++) {
      d = 0;
      if (age >= startAge && age >= t3.startAge) {
        d = t3.divisors[Math.min(age, t3.endAge) - t3.startAge];
        d = Math.round(d * 10);
      }
      div10.push(d);
    }
    return { startAge: startAge, proposed: proposed, basis: basis, div10: div10 };
  }

  /* ---------- scenario validation ---------- */

  var MONEY_FIELDS = ["salary", "contribDeferred", "contribTaxable", "contribExempt",
    "balDeferred", "balTaxable", "balExempt", "essentialMonthly", "nonEssentialMonthly",
    "ssMonthly", "pensionMonthly", "annuityMonthly"];

  function money(errors, value, field) {
    if (value === undefined || value === null) return 0;
    if (!isInt(value)) { err(errors, "money_not_integer_cents", field, "This amount must be a whole number of cents."); return 0; }
    if (value < 0) { err(errors, "money_negative", field, "This amount cannot be negative."); return 0; }
    if (value > MAX_MONEY) { err(errors, "money_too_large", field, "This amount is above the largest the tool handles."); return 0; }
    return value;
  }

  function ageField(errors, value, field, code) {
    if (!isInt(value) || value < 0 || value > MAX_AGE) {
      err(errors, code, field, "This age must be a whole number from 0 to " + MAX_AGE + ".");
      return null;
    }
    return value;
  }

  /* Returns { errors, plan }. plan is the normalised scenario the simulation reads. */
  function validate(scenario) {
    var errors = [], s = scenario, p = {}, i, row, f;
    if (!s || typeof s !== "object") {
      err(errors, "scenario_missing", "scenario", "No scenario was given.");
      return { errors: errors, plan: null };
    }
    var yearOk = isInt(s.currentYear) && s.currentYear >= 2000 && s.currentYear <= 2200;
    if (!yearOk) err(errors, "current_year_invalid", "currentYear", "The current year must be a whole year from 2000 to 2200.");
    var birthOk = isInt(s.birthYear);
    if (!birthOk) err(errors, "birth_year_invalid", "birthYear", "The birth year must be a whole year.");
    var age = null;
    if (yearOk && birthOk) {
      age = s.currentYear - s.birthYear;
      if (age < MIN_AGE || age > MAX_AGE) {
        err(errors, "current_age_out_of_range", "birthYear", "The age this year must be from " + MIN_AGE + " to " + MAX_AGE + ".");
        age = null;
      }
    }
    var retireOk = isInt(s.retireAge) && s.retireAge >= MIN_AGE && s.retireAge <= MAX_AGE;
    if (!retireOk) err(errors, "retire_age_invalid", "retireAge", "The retirement age must be a whole number from " + MIN_AGE + " to " + MAX_AGE + ".");
    var planOk = false;
    if (!isInt(s.planAge) || s.planAge < MIN_AGE) err(errors, "plan_age_invalid", "planAge", "The plan-to age must be a whole number of at least " + MIN_AGE + ".");
    else if (s.planAge > MAX_AGE) err(errors, "plan_age_over_cap", "planAge", "The plan-to age cannot be above " + MAX_AGE + ".");
    else planOk = true;
    if (planOk && age !== null && s.planAge < age) { err(errors, "plan_age_before_current_age", "planAge", "The plan-to age is below the age this year."); planOk = false; }
    if (planOk && retireOk && s.retireAge > s.planAge) err(errors, "retire_age_after_plan_age", "retireAge", "The retirement age is above the plan-to age.");

    for (i = 0; i < MONEY_FIELDS.length; i++) { f = MONEY_FIELDS[i]; p[f] = money(errors, s[f], f); }

    p.ssStartAge = 0;
    if (p.ssMonthly > 0) p.ssStartAge = ageField(errors, s.ssStartAge, "ssStartAge", "ss_start_age_invalid");
    p.pensionStartAge = 0;
    if (p.pensionMonthly > 0) p.pensionStartAge = ageField(errors, s.pensionStartAge, "pensionStartAge", "pension_start_age_invalid");
    p.annuityStartAge = 0;
    if (p.annuityMonthly > 0) p.annuityStartAge = ageField(errors, s.annuityStartAge, "annuityStartAge", "annuity_start_age_invalid");

    p.otherIncome = [];
    if (s.otherIncome !== undefined && s.otherIncome !== null) {
      if (!Array.isArray(s.otherIncome)) err(errors, "other_income_invalid", "otherIncome", "Other income must be a list.");
      else if (s.otherIncome.length > MAX_ROWS) err(errors, "too_many_rows", "otherIncome", "There are more than " + MAX_ROWS + " other income rows.");
      else for (i = 0; i < s.otherIncome.length; i++) {
        row = s.otherIncome[i]; f = "otherIncome[" + i + "]";
        if (!row || typeof row !== "object") { err(errors, "other_income_invalid", f, "This row is not valid."); continue; }
        var m = money(errors, row.monthly, f + ".monthly");
        var a0 = ageField(errors, row.startAge, f + ".startAge", "other_income_age_invalid");
        var a1 = (row.endAge === undefined || row.endAge === null) ? MAX_AGE : ageField(errors, row.endAge, f + ".endAge", "other_income_age_invalid");
        if (a0 !== null && a1 !== null && a1 < a0) { err(errors, "other_income_ages_out_of_order", f + ".endAge", "The end age is below the start age."); continue; }
        if (a0 !== null && a1 !== null) p.otherIncome.push({ monthly: m, startAge: a0, endAge: a1 });
      }
    }
    p.oneTime = [];
    if (s.oneTime !== undefined && s.oneTime !== null) {
      if (!Array.isArray(s.oneTime)) err(errors, "one_time_invalid", "oneTime", "One-time income must be a list.");
      else if (s.oneTime.length > MAX_ROWS) err(errors, "too_many_rows", "oneTime", "There are more than " + MAX_ROWS + " one-time income rows.");
      else for (i = 0; i < s.oneTime.length; i++) {
        row = s.oneTime[i]; f = "oneTime[" + i + "]";
        if (!row || typeof row !== "object") { err(errors, "one_time_invalid", f, "This row is not valid."); continue; }
        var amt = money(errors, row.amount, f + ".amount");
        var at = ageField(errors, row.age, f + ".age", "one_time_age_invalid");
        if (at !== null && age !== null && planOk && (at < age || at > s.planAge)) {
          err(errors, "one_time_age_outside_plan", f + ".age", "This age is outside the years of the plan."); continue;
        }
        if (at !== null) p.oneTime.push({ amount: amt, age: at });
      }
    }

    var tax = s.taxRatePct === undefined || s.taxRatePct === null ? 0 : s.taxRatePct;
    if (typeof tax !== "number" || !isFinite(tax) || tax < 0 || tax > MAX_TAX_PCT) {
      err(errors, "tax_rate_out_of_range", "taxRatePct", "The tax rate must be from 0 to " + MAX_TAX_PCT + " percent."); tax = 0;
    }
    p.taxRateBp = Math.floor(tax * 100 + 0.5);     /* the rate is used to the nearest 0.01 percent */

    if (!isInt(s.tam) || s.tam < 1 || s.tam > 10) err(errors, "tam_out_of_range", "tam", "The asset mix must be a whole number from 1 to 10.");

    if (errors.length) return { errors: errors, plan: null };
    p.currentYear = s.currentYear; p.birthYear = s.birthYear; p.currentAge = age;
    p.retireAge = s.retireAge; p.planAge = s.planAge; p.tam = s.tam;
    p.years = s.planAge - age + 1;
    return { errors: errors, plan: p };
  }

  /* ---------- data: weights, window, portfolio real returns ---------- */

  function num(x) {
    if (typeof x === "number") return isFinite(x) ? x : NaN;
    if (typeof x === "string" && /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(x)) return Number(x);
    return NaN;
  }

  function pick(obj, names) {
    for (var i = 0; i < names.length; i++) if (obj[names[i]] !== undefined) return num(obj[names[i]]);
    return NaN;
  }

  function splits(errors, data) {
    var ss = data.stockSplit, us = data.usSplit, a, b, c, d, e;
    if (ss === undefined || ss === null) { a = DEFAULT_STOCK_SPLIT.us; b = DEFAULT_STOCK_SPLIT.intl; }
    else if (Array.isArray(ss)) { a = num(ss[0]); b = num(ss[1]); }
    else if (typeof ss === "object") { a = pick(ss, ["us"]); b = pick(ss, ["intl", "international"]); }
    else { a = NaN; b = NaN; }
    if (us === undefined || us === null) { c = DEFAULT_US_SPLIT.large; d = DEFAULT_US_SPLIT.mid; e = DEFAULT_US_SPLIT.small; }
    else if (Array.isArray(us)) { c = num(us[0]); d = num(us[1]); e = num(us[2]); }
    else if (typeof us === "object") { c = pick(us, ["large", "usLarge"]); d = pick(us, ["mid", "usMid"]); e = pick(us, ["small", "usSmall"]); }
    else { c = NaN; d = NaN; e = NaN; }
    var ok = function (x) { return x >= 0 && x <= 1; };
    if (!(ok(a) && ok(b) && Math.abs(a + b - 1) < 1e-9)) { err(errors, "data_split_invalid", "stockSplit", "The stock split must be two shares that add up to 1."); return null; }
    if (!(ok(c) && ok(d) && ok(e) && Math.abs(c + d + e - 1) < 1e-9)) { err(errors, "data_split_invalid", "usSplit", "The US split must be three shares that add up to 1."); return null; }
    return { us: a, intl: b, large: c, mid: d, small: e };
  }

  /* Weights of the six assets for a TAM, each computed in exactly this order of multiplication. */
  function weightsFor(tam, sp) {
    var row = TAMS[tam - 1];
    var stock = row.stocks / 100;
    return {
      usLarge: stock * sp.us * sp.large,
      usMid: stock * sp.us * sp.mid,
      usSmall: stock * sp.us * sp.small,
      intl: stock * sp.intl,
      bonds: row.bonds / 100,
      cash: row.cash / 100
    };
  }

  /* One series as an array aligned to data.firstYear, numbers or null. */
  function seriesOf(errors, data, name, full) {
    var arr = data.series[name], out = [], offset = 0, i, v, x;
    if (!Array.isArray(arr)) { err(errors, "data_series_missing", "series." + name, "The data file has no " + name + " series."); return null; }
    if (arr.length !== full) {
      var m = data.meta && data.meta[name];
      var first = m ? m.firstYear : undefined;
      if (!isInt(first) || first < data.firstYear || first - data.firstYear + arr.length > full) {
        err(errors, "data_series_length", "series." + name, "The " + name + " series does not line up with the years of the data file."); return null;
      }
      offset = first - data.firstYear;
    }
    for (i = 0; i < full; i++) out.push(null);
    for (i = 0; i < arr.length; i++) {
      v = arr[i];
      if (v === null || v === undefined || v === "") continue;
      x = num(v);
      if (isNaN(x) || x <= -1) { err(errors, "data_value_invalid", "series." + name, "The " + name + " series holds a value that is not a return."); return null; }
      out[offset + i] = x;
    }
    return out;
  }

  /* Returns { errors, prep }. prep: weights, split, windowYears, returns (portfolio real return per window year). */
  function prepare(data, tam) {
    var errors = [];
    if (!data || typeof data !== "object" || !data.series || typeof data.series !== "object" ||
        !isInt(data.firstYear) || !isInt(data.lastYear) || data.lastYear < data.firstYear || data.lastYear - data.firstYear > 1000) {
      err(errors, "data_invalid", "data", "The data file is missing or not in the expected shape.");
      return { errors: errors, prep: null };
    }
    var sp = splits(errors, data);
    if (!sp) return { errors: errors, prep: null };
    var w = weightsFor(tam, sp);
    var full = data.lastYear - data.firstYear + 1;
    var needed = [], ser = {}, i, k, name;
    for (i = 0; i < ASSETS.length; i++) if (w[ASSETS[i]] > 0) needed.push(ASSETS[i]);
    var infl = seriesOf(errors, data, "inflation", full);
    for (i = 0; i < ASSETS.length; i++) ser[ASSETS[i]] = seriesOf(errors, data, ASSETS[i], full);
    if (errors.length) return { errors: errors, prep: null };

    /* One window for the whole file: the years in which EVERY series has a value, whatever the TAM. */
    var windowYears = [], returns = [];
    for (k = 0; k < full; k++) {
      if (infl[k] === null) continue;
      var have = true;
      for (i = 0; i < ASSETS.length; i++) if (ser[ASSETS[i]][k] === null) { have = false; break; }
      if (!have) continue;
      var r = 0;
      for (i = 0; i < needed.length; i++) {
        name = needed[i];
        r = r + w[name] * ((1 + ser[name][k]) / (1 + infl[k]) - 1);
      }
      windowYears.push(data.firstYear + k);
      returns.push(r);
    }
    if (!windowYears.length) {
      err(errors, "window_empty", "data", "No year has a value for every series in the data file.");
      return { errors: errors, prep: null };
    }
    return { errors: errors, prep: { weights: w, split: TAMS[tam - 1], needed: needed, windowYears: windowYears, returns: returns } };
  }

  /* ---------- one run ---------- */

  /* Per-age lookups so the year loop does no searching. */
  function schedule(p, rule) {
    var ss = [], pen = [], ann = [], oth = [], one = [], age, i;
    for (age = 0; age <= MAX_AGE; age++) {
      ss.push(p.ssMonthly > 0 && age >= p.ssStartAge ? 12 * p.ssMonthly : 0);
      pen.push(p.pensionMonthly > 0 && age >= p.pensionStartAge ? 12 * p.pensionMonthly : 0);
      /* An annuity is a typed lifetime income: from its start age to the end of the plan. */
      ann.push(p.annuityMonthly > 0 && age >= p.annuityStartAge ? 12 * p.annuityMonthly : 0);
      var o = 0;
      for (i = 0; i < p.otherIncome.length; i++) if (age >= p.otherIncome[i].startAge && age <= p.otherIncome[i].endAge) o += 12 * p.otherIncome[i].monthly;
      oth.push(o);
      var t = 0;
      for (i = 0; i < p.oneTime.length; i++) if (p.oneTime[i].age === age) t += p.oneTime[i].amount;
      one.push(t);
    }
    return { ss: ss, pen: pen, ann: ann, oth: oth, one: one, div10: rule.div10,
      essential: 12 * p.essentialMonthly, nonEssential: 12 * p.nonEssentialMonthly };
  }

  /* Simulates one run. rets[off + t] is the portfolio real return of year t.
   * If rows is an array, a full record per year is pushed to it. If starts is given, total savings at
   * the start of year t is written to starts[startOff + t].
   * Returns { lasted, firstShort (year index of the first shortfall, -1 if none), totalShort, end, peak }. */
  function runOnce(p, sch, rets, off, rows, starts, startOff, sampled) {
    var D = p.balDeferred, T = p.balTaxable, X = p.balExempt;
    var rate = p.taxRateBp, N = p.years, firstShort = -1, totalShort = 0, peak = 0;
    var E = sch.essential + sch.nonEssential;
    for (var t = 0; t < N; t++) {
      var age = p.currentAge + t;
      var r = rets[off + t];
      var D0 = D, T0 = T, X0 = X, start = D + T + X;
      var contributions = 0, incomeSaved = 0, rmd = 0, rmdReinvested = 0, withdrawals = 0, shortfall = 0;
      var taxOnSpending = 0, taxOnReinvestedRmd = 0;
      var ss = sch.ss[age], pen = sch.pen[age], ann = sch.ann[age], oth = sch.oth[age], one = sch.one[age], gD, gT, gX;
      var retired = age >= p.retireAge;
      if (starts) starts[startOff + t] = start;

      /* Required minimum distribution (R2) on the tax-deferred balance at the start of the year,
       * from the RMD start age on, retired or not; taxed (R3). */
      var d10 = sch.div10[age], rmdTax = 0;
      if (d10 > 0 && D > 0) {
        rmd = divRound(D * 10, d10);
        if (rmd > D) rmd = D;
        rmdTax = taxOn(rmd, rate);
        D -= rmd;
      }
      var rmdNet = rmd - rmdTax;

      if (!retired) {
        /* Before retirement. 1: the whole RMD after tax moves to the taxable account, start of year. */
        rmdReinvested = rmdNet;
        T += rmdNet;
        taxOnReinvestedRmd = rmdTax;
        withdrawals = rmdTax;
        /* 2: growth over the year (R1). */
        gD = growthOf(D, r); gT = growthOf(T, r); gX = growthOf(X, r);
        D += gD; T += gT; X += gX;
        /* 3: end-of-year additions: contributions, then recurring income that has started and
         * one-time income of this age, both into the taxable account. */
        D += p.contribDeferred; T += p.contribTaxable; X += p.contribExempt;
        contributions = p.contribDeferred + p.contribTaxable + p.contribExempt;
        incomeSaved = ss + pen + ann + oth + one;
        T += incomeSaved;
      } else {
        /* In retirement: all cash flows at the start of the year, then growth on what is left. */
        var income = ss + pen + ann + oth + one;
        var need = E > income ? E - income : 0;
        var surplus = income > E ? income - E : 0;
        var used = rmdNet < need ? rmdNet : need;
        var n = need - used;
        rmdReinvested = rmdNet - used;
        /* 2. What is not needed goes to the taxable account: RMD beyond need, income beyond expenses. */
        T += rmdReinvested + surplus;
        incomeSaved = surplus;
        /* 3. Taxable account. */
        var wT = T < n ? T : n;
        T -= wT; n -= wT;
        /* 4. More from the tax-deferred account, grossed up for tax (R3). */
        var g = 0, gTax = 0;
        if (n > 0 && D > 0) {
          g = grossUp(n, rate);
          if (g > D) g = D;
          gTax = taxOn(g, rate);
          D -= g; n -= (g - gTax);
        }
        /* 5. Tax-exempt account. */
        var wX = X < n ? X : n;
        X -= wX; n -= wX;
        /* 6. Anything still uncovered is the shortfall. */
        shortfall = n;
        if (shortfall > 0) { if (firstShort < 0) firstShort = t; totalShort += shortfall; }
        /* The RMD's tax is split: the part on the gross amount that met the need is tax on
         * spending; the rest is tax on the reinvested RMD. All of it when nothing was reinvested. */
        var rmdSpendTax = rmdReinvested === 0 ? rmdTax : taxOn(grossUp(used, rate), rate);
        taxOnSpending = rmdSpendTax + gTax;
        taxOnReinvestedRmd = rmdTax - rmdSpendTax;
        withdrawals = rmd - rmdReinvested + wT + g + wX;
        /* 7. Growth over the year on what is left (R1). */
        gD = growthOf(D, r); gT = growthOf(T, r); gX = growthOf(X, r);
        D += gD; T += gT; X += gX;
      }
      var end = D + T + X;
      if (end > peak) peak = end;
      if (rows) {
        var bp = start > 0 ? Math.floor((withdrawals / start) * 10000 + 0.5) : 0;   /* R5 */
        rows.push({
          year: p.currentYear + t, age: age, retired: retired,
          sampledYear: sampled ? sampled[t] : null, realReturn: r,
          savingsStart: start, startDeferred: D0, startTaxable: T0, startExempt: X0,
          contributions: contributions,
          essential: retired ? sch.essential : 0, nonEssential: retired ? sch.nonEssential : 0,
          taxOnSpending: taxOnSpending, taxOnReinvestedRmd: taxOnReinvestedRmd,
          taxes: taxOnSpending + taxOnReinvestedRmd, totalExpenses: retired ? E + taxOnSpending : 0,
          socialSecurity: ss, pension: pen, annuity: ann, otherRecurring: oth, oneTime: one,
          /* Lifetime income is the guaranteed sources only; other income is everything else. */
          lifetimeIncome: ss + pen + ann, otherIncome: oth + one, totalIncome: ss + pen + ann + oth + one,
          incomeSaved: incomeSaved,
          rmd: rmd, rmdReinvested: rmdReinvested,
          withdrawals: withdrawals, withdrawalBp: bp, withdrawalPct: bp / 100,
          growth: gD + gT + gX,
          savingsEnd: end, endDeferred: D, endTaxable: T, endExempt: X,
          shortfall: shortfall
        });
      }
    }
    return { lasted: firstShort < 0, firstShort: firstShort, totalShort: totalShort, end: D + T + X, peak: peak };
  }

  /* Run numbers ordered by plan outcome, worst first. firstShort[i] is the year index of run i's
   * first shortfall (-1 if none), totalShort[i] its total shortfall, ends[i] its savings at the end.
   *   a run with a shortfall is worse than any run without;
   *   with a shortfall: the earlier first shortfall year is worse, then the larger total shortfall;
   *   without: the lower savings at the end is worse;
   *   remaining ties keep the lower run number first. */
  function outcomeOrder(firstShort, totalShort, ends) {
    var order = [];
    for (var i = 0; i < ends.length; i++) order.push(i);
    order.sort(function (x, y) {
      var sx = firstShort[x] >= 0, sy = firstShort[y] >= 0;
      if (sx !== sy) return sx ? -1 : 1;
      if (sx) {
        if (firstShort[x] !== firstShort[y]) return firstShort[x] - firstShort[y];
        if (totalShort[x] !== totalShort[y]) return totalShort[x] > totalShort[y] ? -1 : 1;
      } else if (ends[x] !== ends[y]) return ends[x] < ends[y] ? -1 : 1;
      return x - y;
    });
    return order;
  }

  /* ---------- summaries ---------- */

  function summarise(rows, p) {
    var first = null, retYears = 0, life = 0, otherTotal = 0, total = 0, short = 0, atRetire = null, i, row;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (!row.retired) continue;
      if (atRetire === null) atRetire = row.savingsStart;
      retYears += 1;
      life += row.lifetimeIncome;
      otherTotal += row.otherIncome;
      total += row.totalExpenses;
      short += row.shortfall;
      if (first === null && row.shortfall > 0) first = row;
    }
    var months = 12 * retYears;
    var need = divRound(total, months);                 /* R4 */
    var have = divRound(total - short, months);         /* R4 */
    return {
      shortfallYear: first ? first.year : null,
      shortfallAge: first ? first.age : null,
      totalLifetimeIncome: life,
      totalOtherIncome: otherTotal,
      monthlyMayHave: have,
      monthlyMayNeed: need,
      monthlyGap: need - have,
      coveragePct: total > 0 ? floorDiv(100 * (total - short), total) : 100,
      savingsAtRetirement: atRetire,
      savingsAtEnd: rows[rows.length - 1].savingsEnd,
      totalShortfall: short,
      retirementYears: retYears
    };
  }

  /* A rough 95 percent range for the count of runs where the money lasted (Wilson score interval). */
  function lastedRangeOf(k, n) {
    var z = 1.96, ph = k / n, z2 = z * z;
    var denom = 1 + z2 / n;
    var centre = (ph + z2 / (2 * n)) / denom;
    var half = z * Math.sqrt(ph * (1 - ph) / n + z2 / (4 * n * n)) / denom;
    var lo = Math.floor(n * (centre - half) + 0.5), hi = Math.floor(n * (centre + half) + 0.5);
    if (lo < 0) lo = 0; if (hi > n) hi = n;
    if (lo > k) lo = k; if (hi < k) hi = k;
    return { lowCount: lo, highCount: hi, lowPct: Math.floor(100 * lo / n + 0.5), highPct: Math.floor(100 * hi / n + 0.5), method: "wilson95" };
  }

  function fail(errors) {
    return { ok: false, errors: errors, runs: 0, condition: null, lastedCount: null, lastedRange: null, bands: null, meta: null };
  }

  /* ---------- the public functions ---------- */

  function simulate(scenario, data, options) {
    var errors = [], v, d, rule;
    try {
      v = validate(scenario);
      errors = errors.concat(v.errors);
      var tamOk = scenario && typeof scenario === "object" && isInt(scenario.tam) && scenario.tam >= 1 && scenario.tam <= 10;
      d = prepare(data, tamOk ? scenario.tam : 1);
      errors = errors.concat(d.errors);
      rule = v.plan ? rmdRule(v.plan.birthYear) : rmdRule(1960);
      if (!rule) err(errors, "rmd_table_missing", "rmdTables", "The required minimum distribution table is not loaded.");
      var runs = RUNS;
      if (options && options.runs !== undefined) {
        if (isInt(options.runs) && options.runs >= 1 && options.runs <= 10000) runs = options.runs;
        else err(errors, "runs_invalid", "options.runs", "The number of runs must be a whole number from 1 to 10000.");
      }
      if (errors.length) return fail(errors);

      var p = v.plan, prep = d.prep, N = p.years, W = prep.returns.length;
      var sch = schedule(p, rule);
      var rets = new Float64Array(runs * N), idx = new Int32Array(runs * N), market = new Float64Array(runs);
      var run, t, k, gen, growth;
      for (run = 0; run < runs; run++) {
        gen = mulberry32(SEED + run);
        growth = 1;
        for (t = 0; t < N; t++) {
          k = Math.floor(gen() * W);
          idx[run * N + t] = k;
          rets[run * N + t] = prep.returns[k];
          growth = growth * (1 + prep.returns[k]);
        }
        market[run] = growth;
      }

      /* Every run, lightly: savings at the start of each year, whether the money lasted, the end. */
      var starts = new Float64Array(runs * N), ends = new Float64Array(runs), lastedCount = 0, peak = 0, res;
      var firstShort = new Int32Array(runs), totalShort = new Float64Array(runs);
      for (run = 0; run < runs; run++) {
        res = runOnce(p, sch, rets, run * N, null, starts, run * N, null);
        if (res.lasted) lastedCount += 1;
        ends[run] = res.end;
        firstShort[run] = res.firstShort;
        totalShort[run] = res.totalShort;
        if (res.peak > peak) peak = res.peak;
      }
      if (peak > SAFE / 32) {
        err(errors, "amount_overflow", "scenario", "The amounts grew beyond what the tool can hold exactly.");
        return fail(errors);
      }

      /* The three market conditions: one whole run each, chosen by how the plan ended in it. */
      var order = outcomeOrder(firstShort, totalShort, ends), condition = {}, c, pos, rows, sampled;
      for (c = 0; c < CONDITIONS.length; c++) {
        pos = percentileIndex(runs, CONDITIONS[c].percentile);
        run = order[pos];
        rows = []; sampled = [];
        for (t = 0; t < N; t++) sampled.push(prep.windowYears[idx[run * N + t]]);
        runOnce(p, sch, rets, run * N, rows, null, 0, sampled);
        condition[CONDITIONS[c].key] = {
          key: CONDITIONS[c].key, percentile: CONDITIONS[c].percentile,
          run: run, rank: pos, asGoodOrBetter: runs - pos, rankBasis: RANK_BASIS,
          marketGrowth: market[run],
          marketReturn: Math.pow(market[run], 1 / N) - 1,      /* display only */
          years: rows, summary: summarise(rows, p)
        };
      }

      /* Percentile bands of total savings at the start of each year, and at the very end. */
      var bands = { years: [], ages: [], end: {} }, col = new Float64Array(runs), b, key;
      for (b = 0; b < BAND_PERCENTILES.length; b++) bands["p" + BAND_PERCENTILES[b]] = [];
      for (t = 0; t < N; t++) {
        bands.years.push(p.currentYear + t); bands.ages.push(p.currentAge + t);
        for (run = 0; run < runs; run++) col[run] = starts[run * N + t];
        col.sort();
        for (b = 0; b < BAND_PERCENTILES.length; b++) bands["p" + BAND_PERCENTILES[b]].push(col[percentileIndex(runs, BAND_PERCENTILES[b])]);
      }
      ends.sort();
      for (b = 0; b < BAND_PERCENTILES.length; b++) { key = "p" + BAND_PERCENTILES[b]; bands.end[key] = ends[percentileIndex(runs, BAND_PERCENTILES[b])]; }

      return {
        ok: true, errors: [], runs: runs, condition: condition,
        lastedCount: lastedCount, lastedRange: lastedRangeOf(lastedCount, runs), bands: bands,
        meta: {
          version: VERSION,
          window: [prep.windowYears[0], prep.windowYears[prep.windowYears.length - 1]],
          windowYears: prep.windowYears.slice(), windowLength: W,
          seed: SEED, generator: "mulberry32", rankBasis: RANK_BASIS,
          tam: p.tam, split: { stocks: prep.split.stocks, bonds: prep.split.bonds, cash: prep.split.cash },
          weights: prep.weights, seriesUsed: prep.needed.concat(["inflation"]),
          currentYear: p.currentYear, currentAge: p.currentAge, retireAge: p.retireAge, planAge: p.planAge, years: N,
          rmdStartAge: rule.startAge, rmdStartProposed: rule.proposed, rmdStartBasis: rule.basis,
          taxRateBp: p.taxRateBp, dataCleared: data.cleared === true
        }
      };
    } catch (e) {
      /* Nothing above should throw; if it does, the caller still gets a named error, not an exception. */
      return fail([{ code: "internal_error", field: "engine", message: "The analysis could not be completed." }]);
    }
  }

  /* Side by side figures for two results under one market condition ("average" unless given).
   * diff is b minus a; null where either side has no value. Units: count, year or cents. */
  function compare(a, b, conditionKey) {
    var key = conditionKey || "average";
    if (!a || !b || !a.ok || !b.ok || !a.condition[key] || !b.condition[key]) return [];
    var sa = a.condition[key].summary, sb = b.condition[key].summary;
    function row(k, label, unit, basis, x, y) {
      return { key: k, label: label, unit: unit, basis: basis, a: x, b: y, diff: (x === null || y === null) ? null : y - x };
    }
    /* Savings at retirement does not depend on which run is shown: it is the 50th percentile band of
     * total savings at the start of the year the person reaches the retirement age (the first year
     * if already retired), the same for every condition. */
    function medianAtRetirement(r) {
      var i = r.meta.retireAge - r.meta.currentAge;
      return r.bands.p50[i > 0 ? i : 0];
    }
    return [
      row("lastedCount", "Runs where the money lasted", "count", "all runs", a.lastedCount, b.lastedCount),
      row("shortfallYear", "Shortfall year", "year", "run shown", sa.shortfallYear, sb.shortfallYear),
      row("savingsAtRetirement", "Savings at retirement, middle of all 500 runs", "cents", "median band", medianAtRetirement(a), medianAtRetirement(b)),
      row("totalLifetimeIncome", "Total lifetime income", "cents", "run shown", sa.totalLifetimeIncome, sb.totalLifetimeIncome),
      row("monthlyGap", "Monthly gap", "cents", "run shown", sa.monthlyGap, sb.monthlyGap)
    ];
  }

  /* For the assumptions panel: each TAM's split, weights, window, and the average and the
   * volatility (sample standard deviation) of its yearly real return in that window.
   * Returns { ok, errors, tams: [ { tam, split, weights, window, windowLength, meanReal, volatility } ] }. */
  function tamStats(data) {
    var out = [], errors = [], t, d, i, n, mean, ss;
    try {
      for (t = 1; t <= 10; t++) {
        d = prepare(data, t);
        if (d.errors.length) { errors = errors.concat(d.errors); continue; }
        n = d.prep.returns.length; mean = 0; ss = 0;
        for (i = 0; i < n; i++) mean += d.prep.returns[i];
        mean = mean / n;
        for (i = 0; i < n; i++) ss += (d.prep.returns[i] - mean) * (d.prep.returns[i] - mean);
        out.push({
          tam: t, split: { stocks: d.prep.split.stocks, bonds: d.prep.split.bonds, cash: d.prep.split.cash },
          weights: d.prep.weights, window: [d.prep.windowYears[0], d.prep.windowYears[n - 1]], windowLength: n,
          meanReal: mean, volatility: n > 1 ? Math.sqrt(ss / (n - 1)) : 0
        });
      }
    } catch (e) {
      return { ok: false, errors: [{ code: "internal_error", field: "engine", message: "The figures could not be worked out." }], tams: [] };
    }
    return { ok: errors.length === 0, errors: errors, tams: out };
  }

  return {
    VERSION: VERSION, RUNS: RUNS, SEED: SEED, MAX_AGE: MAX_AGE, MIN_AGE: MIN_AGE, MAX_MONEY: MAX_MONEY,
    TAMS: TAMS, ASSETS: ASSETS, CONDITIONS: CONDITIONS, BAND_PERCENTILES: BAND_PERCENTILES,
    simulate: simulate, compare: compare, tamStats: tamStats,
    validate: function (scenario) { try { return validate(scenario).errors; } catch (e) { return [{ code: "internal_error", field: "engine", message: "The inputs could not be checked." }]; } },
    /* Exposed for tests and for an independent check; not needed by the page. */
    _: { mulberry32: mulberry32, taxOn: taxOn, grossUp: grossUp, growthOf: growthOf, divRound: divRound,
      percentileIndex: percentileIndex, outcomeOrder: outcomeOrder, prepare: prepare, rmdRule: rmdRule, lastedRangeOf: lastedRangeOf }
  };
});
