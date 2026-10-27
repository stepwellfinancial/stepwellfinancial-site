/* formula.js: the compound interest formula page's maths. Pure functions, no DOM,
 * so QA can test them alone. calc.js is not changed; this module only reads it.
 * See specs/compound-interest-formula.md, "How it calculates".
 *
 * Rates are in percent (5 means 5%), as in calc.js. Growth factors use
 * log1p/expm1, as calc.js does, so small rates keep full precision.
 */
(function (root) {
  "use strict";

  var C = root.CompoundCalc || (typeof require === "function" ? require("./calc.js") : null);

  function rateOf(ratePct) { return ratePct / 100; }

  /* Single deposit: A = P(1 + r/n)^(nt). Years may be fractional, so
   * compound(P, r, 12, 166 / 12) is the balance after 166 months. */
  function compound(principal, ratePct, n, years) {
    var r = rateOf(ratePct);
    if (r === 0) return principal;
    return principal * Math.exp(n * years * Math.log1p(r / n));
  }

  /* Continuous compounding: A = Pe^(rt). */
  function continuous(principal, ratePct, years) {
    return principal * Math.exp(rateOf(ratePct) * years);
  }

  /* Simple interest: A = P(1 + rt). */
  function simple(principal, ratePct, years) {
    return principal * (1 + rateOf(ratePct) * years);
  }

  /* Solving for the rate: r = n((A/P)^(1/(nt)) - 1). Returns percent.
   * Null when there is no answer (P or A not above 0, or no time). */
  function solveRate(principal, target, n, years) {
    if (!(principal > 0) || !(target > 0) || !(n > 0) || !(years > 0)) return null;
    return n * Math.expm1(Math.log(target / principal) / (n * years)) * 100;
  }

  /* Solving for time: t = ln(A/P) / (n ln(1 + r/n)). Null at 0%, where the
   * balance never grows, or when P or A is not above 0. */
  function solveYears(principal, target, ratePct, n) {
    var r = rateOf(ratePct);
    if (!(principal > 0) || !(target > 0) || !(r > 0) || !(n > 0)) return null;
    return Math.log(target / principal) / (n * Math.log1p(r / n));
  }

  /* Solving for the starting amount: P = A / (1 + r/n)^(nt). */
  function solvePrincipal(target, ratePct, n, years) {
    return target / compound(1, ratePct, n, years);
  }

  /* The step-by-step box: monthly compounding, monthly contributions.
   * inputs: {principal, monthly, ratePct, years, timing: "end"|"start"}
   *   i = r/12, N = 12t, growth = (1 + i)^N
   *   principalPart    = P x growth
   *   contributionPart = PMT x (growth - 1) / i, times (1 + i) at the start of
   *                      the month; PMT x N at 0%
   *   total            = CompoundCalc.calculate(..., monthly).final, so it
   *                      matches the calculator by construction. */
  function formulaSteps(inputs) {
    var i = rateOf(inputs.ratePct) / 12;
    var N = 12 * inputs.years;
    var logGrowth = i === 0 ? 0 : N * Math.log1p(i);
    var growth = Math.exp(logGrowth);
    var principalPart = inputs.principal * growth;
    var contributionPart;
    if (i === 0) {
      contributionPart = inputs.monthly * N;
    } else {
      contributionPart = inputs.monthly * Math.expm1(logGrowth) / i * (inputs.timing === "start" ? 1 + i : 1);
    }
    var total = C.calculate({
      principal: inputs.principal, monthly: inputs.monthly, ratePct: inputs.ratePct,
      years: inputs.years, frequency: "monthly", timing: inputs.timing
    }).final;
    return { i: i, N: N, growth: growth, principalPart: principalPart, contributionPart: contributionPart, total: total };
  }

  /* What the box prints (spec: i to 9 decimal places, growth to 6, money to the
   * cent). Still pure: Intl only, no DOM. approximate is true when the total is
   * at or above CompoundCalc.EXACT_TO_CENTS_BELOW, where the page shows v1's
   * "Numbers this large are only approximate." instead of the cent note. */
  var fmtI = new Intl.NumberFormat("en-US", { minimumFractionDigits: 9, maximumFractionDigits: 9, useGrouping: false });
  var fmtGrowth = new Intl.NumberFormat("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
  var fmtCount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  var fmtMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

  function formatSteps(inputs, steps) {
    return {
      P: fmtMoney.format(inputs.principal),
      PMT: fmtMoney.format(inputs.monthly),
      i: fmtI.format(steps.i),
      N: fmtCount.format(steps.N),
      growth: fmtGrowth.format(steps.growth),
      principalPart: fmtMoney.format(steps.principalPart),
      contributionPart: fmtMoney.format(steps.contributionPart),
      total: fmtMoney.format(steps.total),
      approximate: steps.total >= C.EXACT_TO_CENTS_BELOW
    };
  }

  var api = {
    formatSteps: formatSteps,
    compound: compound,
    continuous: continuous,
    simple: simple,
    solveRate: solveRate,
    solveYears: solveYears,
    solvePrincipal: solvePrincipal,
    formulaSteps: formulaSteps
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CompoundFormula = api;
})(typeof self !== "undefined" ? self : this);
