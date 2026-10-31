/* savings.js: wires the savings calculator to goals.js. All maths lives in
 * goals.js (and calc.js, through it); this file only reads inputs and writes
 * text. Result wording is the approved wording: keep it word for word.
 * The page never writes to the address bar. */
(function () {
  "use strict";
  var G = window.SavingsGoals, R = window.Rates;
  var form = document.getElementById("savings-form");
  if (!form || !G || !R) return;
  var FIELDS = ["principal", "monthly", "apyPct", "years", "goal"];
  var money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  var plain = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

  function $(id) { return document.getElementById(id); }
  function mode() { return form.querySelector('input[name="mode"]:checked').value; }
  function timing() { return form.querySelector('input[name="timing"]:checked').value; }
  function yearsText(y) { return y + (y === 1 ? " year" : " years"); }

  /* Shows only the fields this mode uses. Hidden fields keep their values, so
   * switching back finds them as they were, and they are not validated. */
  function showFields(m) {
    var used = G.MODE_FIELDS[m];
    FIELDS.forEach(function (k) {
      var off = used.indexOf(k) === -1;
      $("f-" + k).hidden = off;
      if (off) { $(k + "-err").textContent = ""; form.elements[k].setAttribute("aria-invalid", "false"); }
    });
    $("res-growth").hidden = m !== "growth";
    $("res-time").hidden = m !== "time";
    $("res-monthly").hidden = m !== "monthly";
    $("table-section").hidden = m !== "growth";
  }

  function clearTable() {
    var body = $("out-table");
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  function drawTable(yearly) {
    clearTable();
    yearly.forEach(function (r) {
      var tr = document.createElement("tr");
      [String(r.year), money.format(r.contributions), money.format(r.interest), money.format(r.balance)].forEach(function (text) {
        var td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      });
      $("out-table").appendChild(tr);
    });
  }

  function setNote(text) {
    $("out-note").textContent = text;
    $("out-note").hidden = !text;
  }

  function update() {
    var m = mode(), t = timing();
    showFields(m);
    var v = {}, bad = false;
    G.MODE_FIELDS[m].forEach(function (k) {
      var res = R.checkField(form.elements[k].value, G.LIMITS[k]);
      $(k + "-err").textContent = res.error;
      form.elements[k].setAttribute("aria-invalid", res.error ? "true" : "false");
      if (res.error) bad = true;
      v[k] = res.value;
    });

    var results = $("results");
    if (bad) {
      // Never leave an old answer on screen as if it still applied.
      results.classList.add("stale");
      ["out-final", "out-put", "out-interest", "out-amount"].forEach(function (id) { $(id).textContent = "$..."; });
      $("out-time").textContent = "Fix the highlighted field to see results.";
      $("out-monthly").textContent = "Fix the highlighted field to see results.";
      clearTable();
      setNote("");
      return;
    }
    results.classList.remove("stale");
    var apyText = plain.format(v.apyPct) + "%";
    var i = G.monthlyRateFromApy(v.apyPct);

    if (m === "growth") {
      var g = G.growth({ principal: v.principal, monthly: v.monthly, apyPct: v.apyPct, years: v.years, timing: t });
      $("out-final-label").textContent = "Balance after " + yearsText(v.years);
      $("out-final").textContent = money.format(g.final);
      $("out-put").textContent = money.format(g.contributions);
      $("out-interest").textContent = money.format(g.interest);
      drawTable(g.yearly);
      setNote(g.final >= window.CompoundCalc.EXACT_TO_CENTS_BELOW ? "Numbers this large are only approximate." : "");
      return;
    }

    if (m === "time") {
      var N = G.monthsToTarget(v.principal, v.monthly, i, v.goal, t);
      var text;
      if (N === 0) text = "Your starting balance already reaches this goal.";
      else if (N === null) text = "At these numbers the balance would never reach this goal.";
      else if (N > G.MAX_MONTHS) text = "More than 100 years at these numbers.";
      else text = "At these numbers the balance would reach " + money.format(v.goal) + " in " + G.formatDuration(N) +
        ", if the APY stayed at " + apyText + " the whole time.";
      $("out-time").textContent = text;
      setNote("");
      return;
    }

    var amount = G.monthlyNeeded(v.principal, i, 12 * v.years, v.goal, t);
    $("out-amount").textContent = money.format(amount);
    $("out-monthly").textContent = amount === 0
      ? "Your starting balance alone would reach this goal at this APY."
      : "Depositing " + money.format(amount) + " at the " + t + " of each month would bring " + money.format(v.principal) +
        " to " + money.format(v.goal) + " in " + yearsText(v.years) + ", if the APY stayed at " + apyText + " the whole time.";
    setNote("");
  }

  /* Typing a number (calc.js, "Typed numbers"): an unfinished number such as "250," leaves the last result
   * on screen; a real mistake shows its message at once. Leaving a field tidies it and runs the numbers. */
  var C = window.CompoundCalc;
  function isNumberField(el) { return !!C && FIELDS.indexOf(el.name) !== -1; }
  function commasIn(el) { return G.LIMITS[el.name].commas !== false; }
  form.addEventListener("input", function (e) {
    if (isNumberField(e.target) && C.classifyAmount(e.target.value, commasIn(e.target)) === "partial") return;
    update();
  });
  form.addEventListener("change", update);
  form.addEventListener("focusout", function (e) {
    var el = e.target, tidy;
    if (!isNumberField(el)) return;
    tidy = C.formatAmount(el.value, commasIn(el));
    if (tidy !== null && tidy !== el.value) el.value = tidy;
    update();
  });
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  // Copy link and restore a link (scenario.js). It also reads "#apy=<number>", the link the
  // APY calculator offers, as a legacy link that fills the APY. Nothing is written back to
  // the address bar.
  if (window.ScenarioLink) window.ScenarioLink.attach({
    model: "savings",
    form: form,
    fields: { mode: { radio: "mode" }, timing: { radio: "timing" }, principal: { id: "principal" }, monthly: { id: "monthly" },
      apyPct: { id: "apyPct" }, years: { id: "years" }, goal: { id: "goal" } },
    onChange: update
  });
  update();
})();
