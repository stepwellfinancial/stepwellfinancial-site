/* rates.js: rate conversions for the APY, inflation and rule of 72 pages.
 * Pure functions, no DOM, so QA can test them alone. calc.js is not changed;
 * this module only reads it (for parseAmount). Main site only (two-site spec,
 * "Main-site-only scripts").
 * See specs/apy-calculator.md, specs/compound-interest-calculator-with-inflation.md
 * and specs/rule-of-72-calculator.md, "How it calculates".
 *
 * Units, so nothing is mixed up:
 *   apy, rateFromApy, realRate, toTodaysDollars: rates as DECIMALS (5% = 0.05).
 *   ruleYears, exactDoublingYears: the rate in PERCENT (6 means 6%), as the specs say.
 *   ruleRate, exactDoublingRate: return PERCENT (6 means 6% a year), so the two
 *   can be compared directly.
 * Growth uses log1p/expm1, as calc.js does, so small rates keep full precision.
 */
(function (root) {
  "use strict";

  var C = root.CompoundCalc || (typeof require === "function" ? require("./calc.js") : null);

  /* Periods a year. "continuous" has its own formulas, so it has no count here. */
  var FREQUENCIES = { annually: 1, quarterly: 4, monthly: 12, daily: 365, continuous: null };
  var FREQUENCY_ORDER = ["annually", "quarterly", "monthly", "daily", "continuous"];
  var FREQUENCY_NAMES = { annually: "Annually", quarterly: "Quarterly", monthly: "Monthly", daily: "Daily", continuous: "Continuous" };

  function isFrequency(f) { return Object.prototype.hasOwnProperty.call(FREQUENCIES, f); }

  /* ---------- APY (specs/apy-calculator.md) ---------- */

  /* APY = (1 + r/n)^n - 1; continuous: e^r - 1. r is a decimal. */
  function apy(r, freq) {
    if (!isFrequency(freq)) return NaN;
    if (r === 0) return 0;
    if (freq === "continuous") return Math.expm1(r);
    var n = FREQUENCIES[freq];
    return Math.expm1(n * Math.log1p(r / n));
  }

  /* r = n((1 + APY)^(1/n) - 1); continuous: ln(1 + APY). APY is a decimal. */
  function rateFromApy(a, freq) {
    if (!isFrequency(freq)) return NaN;
    if (a === 0) return 0;
    if (freq === "continuous") return Math.log1p(a);
    var n = FREQUENCIES[freq];
    return n * Math.expm1(Math.log1p(a) / n);
  }

  /* The APY -> savings link (APY spec AC26; HELD on the page until privacy fact
   * F10 is published). apyPct is the APY in percent: the one worked out from the
   * rate, or the one the user entered. The value goes only after "#", to 2
   * decimals. An APY the savings page would refuse (above its 50% limit, or not
   * a number) gives the plain link, so the page never sends a value it ignores.
   * Same site only: the savings page is on the main site too. */
  var SAVINGS_PATH = "/savings-calculator/";
  function savingsLinkHref(apyPct) {
    var v = roundHalfUp(apyPct, 2);
    if (typeof v !== "number" || !isFinite(v) || v < 0 || v > 50) return SAVINGS_PATH;
    return SAVINGS_PATH + "#apy=" + v.toFixed(2);
  }

  /* ---------- Inflation (specs/compound-interest-calculator-with-inflation.md) ---------- */

  /* Real annual rate = (1 + APY) / (1 + inflation) - 1, written as
   * (APY - inflation) / (1 + inflation), the same value, which is exactly 0 when
   * the two are equal. Both are decimals. */
  function realRate(apyDec, inflationDec) {
    return (apyDec - inflationDec) / (1 + inflationDec);
  }

  /* Today's dollars = balance / (1 + inflation)^years, as
   * balance x exp(-years x log1p(inflation)). Never multiplies by (1 + inflation)^years. */
  function toTodaysDollars(balance, inflationDec, years) {
    if (inflationDec === 0) return balance;
    return balance * Math.exp(-years * Math.log1p(inflationDec));
  }

  var INFLATION_LIMITS = { min: 0, max: 20, label: "Inflation rate", decimals: 2, commas: false };

  /* Takes the parsed number (CompoundCalc.parseAmount(text, false)). Returns ""
   * when valid, otherwise the message to show, in v1's pattern. */
  function validateInflation(v) {
    return limitMessage(v, INFLATION_LIMITS);
  }

  /* ---------- Rule of 72 (specs/rule-of-72-calculator.md) ---------- */

  /* k / rate, for k = 72, 70 or 69.3. Null at 0%, never Infinity. */
  function ruleYears(k, ratePct) {
    if (!(ratePct > 0)) return null;
    return k / ratePct;
  }

  /* ln 2 / ln(1 + r), a fixed annual rate compounded once a year. Null at 0%. */
  function exactDoublingYears(ratePct) {
    if (!(ratePct > 0)) return null;
    return Math.LN2 / Math.log1p(ratePct / 100);
  }

  /* k / years, in percent. */
  function ruleRate(k, years) {
    if (!(years > 0)) return null;
    return k / years;
  }

  /* 2^(1/years) - 1, as expm1(ln 2 / years), returned in PERCENT. */
  function exactDoublingRate(years) {
    if (!(years > 0)) return null;
    return Math.expm1(Math.LN2 / years) * 100;
  }

  /* Everything the years-to-double result and the accuracy table show for one
   * rate. "Difference" is the difference of the two DISPLAYED figures, worked in
   * whole hundredths of a year so it never shows a float artefact or "-0.00".
   * "% off" is from the unrounded values, rounded half up to 1 decimal. */
  function doublingComparison(ratePct) {
    var rule = ruleYears(72, ratePct), exact = exactDoublingYears(ratePct);
    if (rule === null || exact === null) return null;
    var ruleH = toHundredths(rule), exactH = toHundredths(exact);
    return {
      rule: rule,
      exact: exact,
      ruleShown: ruleH / 100,
      exactShown: exactH / 100,
      differenceHundredths: ruleH - exactH,   // positive: the rule gives more years
      agree: ruleH === exactH,
      pctOff: roundHalfUp((rule - exact) / exact * 100, 1)
    };
  }

  /* ---------- Rounding and display (pure: Intl only, no DOM) ---------- */

  /* Rounds half away from zero at d decimals, on the number's shortest decimal
   * form, so 1.005 gives 1.01 (not 1.00 as toFixed does). Never returns -0. */
  function roundHalfUp(x, d) {
    if (typeof x !== "number" || !isFinite(x)) return x;
    var sign = x < 0 ? -1 : 1;
    var parts = String(Math.abs(x)).split("e");
    var shifted = Number(parts[0] + "e" + ((parts[1] ? Number(parts[1]) : 0) + d));
    var r = Math.round(shifted);
    var back = Number(r + "e-" + d);
    var out = sign * back;
    return out === 0 ? 0 : out;
  }

  /* A value rounded half up to 2 decimals, as a whole number of hundredths. */
  function toHundredths(x) {
    return Math.round(roundHalfUp(x, 2) * 100);
  }

  var fixedFormats = {};
  function fixed(d) {
    if (!fixedFormats[d]) fixedFormats[d] = new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    return fixedFormats[d];
  }
  var MINUS = "−";

  /* "1,234.50" style, rounded half up first; negatives with a real minus sign;
   * never "-0.00". */
  function formatFixed(x, d) {
    var v = roundHalfUp(x, d);
    var s = fixed(d).format(Math.abs(v));
    return v < 0 ? MINUS + s : s;
  }

  /* As formatFixed, plus a leading "+" for positive values (the "% off" column). */
  function formatSigned(x, d) {
    var v = roundHalfUp(x, d);
    return (v > 0 ? "+" : "") + formatFixed(v, d);
  }

  /* A whole number of hundredths as "0.10" or "-0.09" (with a real minus sign). */
  function formatHundredths(h) {
    var s = fixed(2).format(Math.abs(h) / 100);
    return h < 0 ? MINUS + s : s;
  }

  /* A rate in percent, to 2 decimals: "5.12%". */
  function formatPct(pct, d) {
    return formatFixed(pct, d === undefined ? 2 : d) + "%";
  }

  /* An input rate as the user typed it, without forced decimals: 5 -> "5%", 4.5 -> "4.5%". */
  var plainFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  function formatInputPct(pct) {
    return plainFormat.format(pct) + "%";
  }

  /* ---------- Input checking ---------- */

  /* limits: {min, max, label, decimals (optional), integer (optional)}.
   * v is an already-parsed number (NaN when unreadable). Messages are v1's. */
  function limitMessage(v, lim) {
    if (v === null || v === undefined || typeof v !== "number" || !isFinite(v)) return "Enter a number.";
    if (v < lim.min) return lim.label + " can't be below " + lim.min.toLocaleString("en-US") + ".";
    if (v > lim.max) return lim.label + " can't be above " + lim.max.toLocaleString("en-US") + ".";
    if (lim.integer && Math.floor(v) !== v) return "Use whole years.";
    if (lim.decimals === 2 && Math.abs(v * 100 - Math.round(v * 100)) > 1e-9) return "Use at most 2 decimal places.";
    return "";
  }

  /* Reads one text field: parse as v1 does, then check the limits.
   * limits.commas false refuses commas (rates, and the rule of 72's years); then
   * an unreadable value with a comma gets v1's "Use a dot for decimals, like 4.5."
   * Returns {value, error}; error is "" when valid. */
  function checkField(text, lim) {
    var allowCommas = lim.commas !== false;
    var v = C.parseAmount(text, allowCommas);
    var msg = limitMessage(v, lim);
    if (msg === "Enter a number." && !allowCommas && String(text).indexOf(",") !== -1) msg = "Use a dot for decimals, like 4.5.";
    return { value: v, error: msg };
  }

  var api = {
    FREQUENCIES: FREQUENCIES,
    FREQUENCY_ORDER: FREQUENCY_ORDER,
    FREQUENCY_NAMES: FREQUENCY_NAMES,
    INFLATION_LIMITS: INFLATION_LIMITS,
    apy: apy,
    rateFromApy: rateFromApy,
    savingsLinkHref: savingsLinkHref,
    realRate: realRate,
    toTodaysDollars: toTodaysDollars,
    validateInflation: validateInflation,
    ruleYears: ruleYears,
    exactDoublingYears: exactDoublingYears,
    ruleRate: ruleRate,
    exactDoublingRate: exactDoublingRate,
    doublingComparison: doublingComparison,
    roundHalfUp: roundHalfUp,
    toHundredths: toHundredths,
    formatFixed: formatFixed,
    formatSigned: formatSigned,
    formatHundredths: formatHundredths,
    formatPct: formatPct,
    formatInputPct: formatInputPct,
    limitMessage: limitMessage,
    checkField: checkField
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Rates = api;
})(typeof self !== "undefined" ? self : this);
