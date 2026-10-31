/* rule72.js: wires the rule of 72 calculator to rates.js. All maths lives in
 * rates.js; this file only reads inputs and writes text. */
(function () {
  "use strict";
  var R = window.Rates;
  var form = document.getElementById("r72-form");
  if (!form || !R) return;

  function $(id) { return document.getElementById(id); }

  var LIMITS = R.RULE72_LIMITS;   // in rates.js, so scenario links check the same limits
  var FIELD = { years: "ratePct", rate: "years" };   // the one field each mode uses

  function mode() { return form.querySelector('input[name="mode"]:checked').value; }
  function yearsText(x) { return R.formatFixed(x, 2) + " years"; }

  function show(which) {
    $("res-years").hidden = which !== "years";
    $("res-rate").hidden = which !== "rate";
    $("res-zero").hidden = which !== "zero";
    $("res-fix").hidden = which !== "fix";
  }

  function update() {
    var m = mode(), k = FIELD[m], other = k === "ratePct" ? "years" : "ratePct";
    $("f-" + k).hidden = false;
    $("f-" + other).hidden = true;
    $(other + "-err").textContent = "";
    form.elements[other].setAttribute("aria-invalid", "false");

    var res = R.checkField(form.elements[k].value, LIMITS[k]);
    $(k + "-err").textContent = res.error;
    form.elements[k].setAttribute("aria-invalid", res.error ? "true" : "false");
    if (res.error) { show("fix"); return; }   // never leave an old answer on screen

    if (m === "rate") {
      $("r-rule").textContent = R.formatPct(R.ruleRate(72, res.value));
      $("r-exact").textContent = R.formatPct(R.exactDoublingRate(res.value));
      show("rate");
      return;
    }

    var c = R.doublingComparison(res.value);
    if (c === null) { show("zero"); return; }   // 0%: never Infinity or a blank
    $("y-rule").textContent = yearsText(c.rule);
    $("y-exact").textContent = yearsText(c.exact);
    $("y-off").textContent = c.agree
      ? "The rule of 72 and the exact answer agree to 2 decimal places."
      : "The rule of 72 is off by " + R.formatHundredths(c.differenceHundredths) + " years";
    $("y-minus").hidden = !(c.differenceHundredths < 0);
    $("y-70").textContent = yearsText(R.ruleYears(70, res.value));
    $("y-693").textContent = yearsText(R.ruleYears(69.3, res.value));
    show("years");
  }

  form.addEventListener("input", update);
  form.addEventListener("change", update);
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  // Copy link and restore a link (scenario.js): inputs only, checked like typing.
  if (window.ScenarioLink) window.ScenarioLink.attach({
    model: "rule72",
    form: form,
    fields: { mode: { radio: "mode" }, ratePct: { id: "ratePct" }, years: { id: "years" } },
    onChange: update
  });
  update();
})();
