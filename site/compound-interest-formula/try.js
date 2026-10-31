/* try.js: wires the "Try the formula with your numbers" box to formula.js.
 * All maths lives in formula.js and calc.js; this file only reads inputs and
 * writes text. Limits, parsing and messages are v1's (CompoundCalc). */
(function () {
  "use strict";
  var C = window.CompoundCalc, F = window.CompoundFormula;
  var form = document.getElementById("try-form");
  if (!form || !C || !F) return;
  var NUMERIC = ["principal", "monthly", "ratePct", "years"];
  var STEPS = ["s-i", "s-n", "s-growth", "s-p", "s-c", "s-zero", "s-total"];

  function $(id) { return document.getElementById(id); }

  // The note's wording lives in the HTML, so the copy has one home.
  var CENT_NOTE = $("s-note").textContent;
  var BIG_NOTE = "Numbers this large are only approximate.";

  function readInputs() {
    var raw = {};
    NUMERIC.forEach(function (k) { raw[k] = C.parseAmount(form.elements[k].value, k !== "ratePct"); });
    raw.frequency = "monthly";
    raw.timing = form.querySelector('input[name="timing"]:checked').value;
    return raw;
  }

  function showErrors(errors) {
    NUMERIC.forEach(function (k) {
      var msg = errors[k] || "";
      if (k === "ratePct" && msg === "Enter a number." && form.elements[k].value.indexOf(",") !== -1) {
        msg = "Use a dot for decimals, like 4.5.";
      }
      $(k + "-err").textContent = msg;
      form.elements[k].setAttribute("aria-invalid", msg ? "true" : "false");
    });
  }

  function update() {
    var raw = readInputs();
    var errors = C.validate(raw);
    showErrors(errors);
    var out = $("try-out");
    if (Object.keys(errors).length) {
      // Never leave an old answer on screen as if it still applied.
      out.classList.add("stale");
      STEPS.forEach(function (id) { $(id).textContent = "..."; });
      $("s-note").hidden = false;
      $("s-note").textContent = errors.timing || "Fix the highlighted field to see results.";
      return;
    }
    out.classList.remove("stale");
    var steps = F.formulaSteps(raw);
    var d = F.formatSteps(raw, steps);
    var zero = steps.i === 0;
    $("s-i").textContent = d.i;
    $("s-n").textContent = d.N;
    $("s-growth").textContent = d.growth;
    $("s-p").textContent = d.principalPart;
    $("s-c").textContent = d.contributionPart;
    $("s-zero").textContent = d.P + " + " + d.PMT + " × " + d.N;
    $("s-total").textContent = d.total;
    $("c-start").hidden = raw.timing !== "start";
    // At 0% the box shows FV = P + PMT x N in place of the two parts.
    $("row-p").hidden = zero;
    $("row-c").hidden = zero;
    $("row-zero").hidden = !zero;
    var note = d.approximate ? BIG_NOTE : (zero ? "" : CENT_NOTE);
    $("s-note").textContent = note;
    $("s-note").hidden = !note;
  }

  form.addEventListener("input", update);
  form.addEventListener("change", update);
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  // Copy link and restore a link (scenario.js): inputs only, checked like typing.
  if (window.ScenarioLink) window.ScenarioLink.attach({
    model: "formula",
    form: form,
    fields: { principal: { id: "principal" }, monthly: { id: "monthly" }, ratePct: { id: "ratePct" }, years: { id: "years" },
      timing: { radio: "timing" } },
    onChange: update
  });
  update();
})();
