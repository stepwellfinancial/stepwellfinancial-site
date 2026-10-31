/* goals.js: the savings calculator's maths. Pure functions, no DOM, so QA can
 * test them alone. calc.js is not changed; growth reuses CompoundCalc.calculate().
 * Used on the main site only.
 *
 * Units: apyPct is in percent (5 means 5%), as typed. i is the monthly rate as a
 * decimal. Money is in dollars. timing is "end" or "start" of each month.
 */
(function (root) {
  "use strict";

  var C = root.CompoundCalc || (typeof require === "function" ? require("./calc.js") : null);

  var MAX_MONTHS = 1200;   // above this, the page says "More than 100 years at these numbers."

  /* i = (1 + APY)^(1/12) - 1, as expm1(log1p(APY)/12), so twelve months at i
   * give exactly the APY. */
  function monthlyRateFromApy(apyPct) {
    var a = apyPct / 100;
    if (a === 0) return 0;
    return Math.expm1(Math.log1p(a) / 12);
  }

  /* Growth mode: CompoundCalc.calculate() unchanged, with monthly compounding at
   * the nominal rate 1200 x i, so its monthly rate r/12 is i. The page validates
   * first; calculate() does not.
   * inputs: {principal, monthly, apyPct, years, timing} */
  function growth(inputs) {
    var i = monthlyRateFromApy(inputs.apyPct);
    return C.calculate({
      principal: inputs.principal, monthly: inputs.monthly, ratePct: 1200 * i,
      years: inputs.years, frequency: "monthly", timing: inputs.timing
    });
  }

  /* B(N) = P(1+i)^N + M'((1+i)^N - 1)/i, M' = M (end) or M(1+i) (start);
   * P + M x N when i = 0. */
  function balanceAfter(P, M, i, months, timing) {
    if (i === 0) return P + M * months;
    var lg = months * Math.log1p(i);
    var Mp = timing === "start" ? M * (1 + i) : M;
    return P * Math.exp(lg) + Mp * Math.expm1(lg) / i;
  }

  /* The first whole month N at whose end B(N) >= T.
   * Returns 0 if P >= T, or null if the goal is never reached.
   * May return more than MAX_MONTHS; the page then shows "More than 100 years". */
  function monthsToTarget(P, M, i, T, timing) {
    if (P >= T) return 0;
    var N;
    if (i === 0) {
      if (M === 0) return null;
      N = Math.ceil((T - P) / M);
    } else {
      if (P === 0 && M === 0) return null;
      var Mp = timing === "start" ? M * (1 + i) : M;
      N = Math.ceil(Math.log((T * i + Mp) / (P * i + Mp)) / Math.log1p(i));
    }
    if (!isFinite(N)) return null;
    if (N < 1) N = 1;
    // Floating point can land the ceiling one month off either way; check and move.
    if (N > 1 && balanceAfter(P, M, i, N - 1, timing) >= T) N -= 1;
    else if (balanceAfter(P, M, i, N, timing) < T) N += 1;
    return N;
  }

  /* The unrounded monthly deposit that reaches T after `months` months. 0 when
   * the starting balance alone gets there. */
  function monthlyNeededExact(P, i, months, T, timing) {
    if (i === 0) {
      if (P >= T) return 0;
      return (T - P) / months;
    }
    var lg = months * Math.log1p(i);
    var g = Math.exp(lg);
    if (P * g >= T) return 0;
    var x = (T - P * g) / (Math.expm1(lg) / i);
    return timing === "start" ? x / (1 + i) : x;
  }

  /* The amount shown: rounded UP to the next cent, in three steps:
   *  1. ceil(x x 100 - 1e-6) / 100, a millionth-of-a-cent tolerance for float
   *     noise on an exact cent amount;
   *  2. if x > 0, at least $0.01;
   *  3. if that deposit still falls short of T by more than a tenth of a cent,
   *     add one cent.
   * $0.00 only when no deposit is required. Never -0. */
  function monthlyNeeded(P, i, months, T, timing) {
    var x = monthlyNeededExact(P, i, months, T, timing);
    if (!(x > 0)) return 0;
    var cents = Math.ceil(x * 100 - 1e-6);
    if (cents < 1) cents = 1;
    if (balanceAfter(P, cents / 100, i, months, timing) < T - 0.001) cents += 1;
    return cents / 100;
  }

  /* "15 years 10 months (190 months)", "2 years (24 months)", "7 months". */
  function formatDuration(N) {
    var y = Math.floor(N / 12), m = N % 12;
    var parts = [];
    if (y) parts.push(y + (y === 1 ? " year" : " years"));
    if (m) parts.push(m + (m === 1 ? " month" : " months"));
    if (!y) return parts.length ? parts[0] : "0 months";
    return parts.join(" ") + " (" + N.toLocaleString("en-US") + " months)";
  }

  /* Input limits, in v1's pattern. Fields a mode does not use are not checked. */
  var LIMITS = {
    principal: { min: 0, max: 100000000, label: "Starting balance" },
    monthly: { min: 0, max: 1000000, label: "Monthly deposit" },
    apyPct: { min: 0, max: 50, label: "APY", decimals: 2, commas: false },
    years: { min: 1, max: 100, label: "Years", integer: true },
    goal: { min: 1, max: 100000000, label: "Savings goal" }
  };
  var MODE_FIELDS = {
    growth: ["principal", "monthly", "apyPct", "years"],
    time: ["principal", "monthly", "apyPct", "goal"],
    monthly: ["principal", "apyPct", "years", "goal"]
  };

  /* The "#apy=<number>" prefill (the APY calculator's link) is read by scenario.js now,
   * as a legacy savings link, with the same limits as typing (LIMITS above). */

  var api = {
    MAX_MONTHS: MAX_MONTHS,
    LIMITS: LIMITS,
    MODE_FIELDS: MODE_FIELDS,
    monthlyRateFromApy: monthlyRateFromApy,
    growth: growth,
    balanceAfter: balanceAfter,
    monthsToTarget: monthsToTarget,
    monthlyNeededExact: monthlyNeededExact,
    monthlyNeeded: monthlyNeeded,
    formatDuration: formatDuration
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SavingsGoals = api;
})(typeof self !== "undefined" ? self : this);
