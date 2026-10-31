/* apy.js: wires the APY calculator to rates.js. All maths lives in rates.js;
 * this file only reads inputs and writes text. */
(function () {
  "use strict";
  var R = window.Rates;
  var form = document.getElementById("apy-form");
  if (!form || !R) return;

  function $(id) { return document.getElementById(id); }

  var LIMITS = R.APY_LIMITS;   // in rates.js, so scenario links check the same limits
  // The direction is named in the field label, the result label and the table,
  // so a result can never be read as the other kind.
  var FIELD_LABEL = { toApy: "Interest rate (nominal annual rate)", toRate: "APY (annual percentage yield)" };
  var HELP = { toApy: $("value-help").textContent, toRate: "The APY as quoted, for example on a savings account." };
  var COLUMN = { toApy: "APY", toRate: "Interest rate" };
  var ADVERB = { annually: "annually", quarterly: "quarterly", monthly: "monthly", daily: "daily", continuous: "continuously" };

  function direction() { return form.querySelector('input[name="direction"]:checked').value; }

  function caption(dir, value) {
    if (dir === "toRate") return "The interest rate that gives " + (value === 5 ? "an example APY of 5%" : "an APY of " + R.formatInputPct(value)) + ", at each compounding frequency";
    return (value === 5 ? "An example rate of 5%" : "A rate of " + R.formatInputPct(value)) + ", as APY at each compounding frequency";
  }

  function convert(dir, dec, freq) { return dir === "toApy" ? R.apy(dec, freq) : R.rateFromApy(dec, freq); }

  function drawTable(dir, dec) {
    var body = $("freq-rows");
    while (body.firstChild) body.removeChild(body.firstChild);
    R.FREQUENCY_ORDER.forEach(function (f) {
      var v = convert(dir, dec, f) * 100;
      var tr = document.createElement("tr");
      [R.FREQUENCY_NAMES[f], R.formatPct(v), R.formatPct(v, 4)].forEach(function (text) {
        var td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function update() {
    var dir = direction(), freq = form.elements.frequency.value;
    var input = form.elements.value;
    $("value-label").textContent = FIELD_LABEL[dir];
    $("value-help").textContent = HELP[dir];
    $("freq-kind").textContent = COLUMN[dir];

    var res = R.checkField(input.value, LIMITS[dir]);
    $("value-err").textContent = res.error;
    input.setAttribute("aria-invalid", res.error ? "true" : "false");
    var link = $("savings-link");   // held: absent until the Privacy page describes it

    if (res.error || !Object.prototype.hasOwnProperty.call(R.FREQUENCIES, freq)) {
      // Never leave an old answer on screen as if it still applied.
      $("results").classList.add("stale");
      $("out-label").textContent = dir === "toApy" ? "APY (effective annual rate)" : "Interest rate (nominal annual rate)";
      $("out-main").textContent = "...";
      $("out-precise").textContent = "Fix the highlighted field to see results.";
      var body = $("freq-rows");
      while (body.firstChild) body.removeChild(body.firstChild);
      $("freq-caption").textContent = "Fix the highlighted field to see the table.";
      if (link) link.setAttribute("href", "/savings-calculator/");
      return;
    }

    $("results").classList.remove("stale");
    var dec = res.value / 100;
    var out = convert(dir, dec, freq) * 100;
    $("out-label").textContent = dir === "toApy" ? "APY (effective annual rate)" : "Interest rate (nominal annual rate), compounded " + ADVERB[freq];
    $("out-main").textContent = R.formatPct(out);
    $("out-precise").textContent = "More precisely " + R.formatPct(out, 4);
    $("freq-caption").textContent = caption(dir, res.value);
    drawTable(dir, dec);
    // The APY the link carries: worked out from the rate, or the APY entered.
    if (link) link.setAttribute("href", R.savingsLinkHref(dir === "toApy" ? out : res.value));
  }

  form.addEventListener("input", update);
  form.addEventListener("change", update);
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  // Copy link and restore a link (scenario.js): inputs only, checked like typing.
  if (window.ScenarioLink) window.ScenarioLink.attach({
    model: "apy",
    form: form,
    fields: { direction: { radio: "direction" }, frequency: { id: "frequency" }, value: { id: "value" } },
    onChange: update
  });
  update();
})();
