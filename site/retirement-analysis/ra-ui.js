/* ra-ui.js: the retirement analysis page. Reads the planning profile, calls the engine
 * (RA.simulate, RA.compare, RA.tamStats in ra-engine.js) with the frozen data (RA_DATA in
 * ra-data.js) and draws the results with RAChart (ra-chart.js).
 *
 * Privacy: inputs live in this page's memory only. This file makes no network request and writes
 * nothing to the device; reloading the page brings back the example.
 *
 * Money: every amount is integer cents from the engine or typed by the user and parsed digit by
 * digit. This file never does floating-point arithmetic on a dollar figure it shows; it adds
 * integers and groups digits. Amounts are shown with cents. The three hero figures read "about"
 * and the whole dollar (half up, by integer steps) with the exact figure on the next line.
 *
 * The page's CSP allows no style attribute, so nothing here writes one: state is a class, a
 * hidden attribute or an SVG geometry attribute.
 */
(function () {
  "use strict";

  var RA = window.RA, DATA = window.RA_DATA, Chart = window.RAChart;
  var NOW_YEAR = new Date().getFullYear();
  var COND = { average: "average", below: "below-average", sigBelow: "significantly below-average" };
  function condArt(c) { return c === "average" ? "an" : "a"; }
  var ASSET_CLASS = { usLarge: "ra-c-invest", usMid: "ra-c-iris-light", usSmall: "ra-c-iris-deep", intl: "ra-c-other", bonds: "ra-c-property", cash: "ra-c-cash" };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function show(node, on) { if (on) node.removeAttribute("hidden"); else node.setAttribute("hidden", ""); }
  function pressed(btn, on) { btn.setAttribute("aria-pressed", on ? "true" : "false"); }

  /* ---------- numbers and money (integers only) ---------- */

  function group(digits) {
    var out = "", i;
    for (i = 0; i < digits.length; i++) { if (i && (digits.length - i) % 3 === 0) out += ","; out += digits.charAt(i); }
    return out;
  }
  /* Integer cents to whole dollars, half up, without division by a float. */
  function wholeDollars(cents) {
    var c = Math.abs(cents), rem = c % 100;
    return (c - rem) / 100 + (rem >= 50 ? 1 : 0);
  }
  /* Integer cents to "1,234.56": digits only, no division by a float. */
  function centsText(cents) {
    var c = Math.abs(cents), rem = c % 100;
    return group(String((c - rem) / 100)) + "." + (rem < 10 ? "0" : "") + rem;
  }
  function money(cents) {
    if (cents === null || cents === undefined) return "";
    return (cents < 0 ? "−$" : "$") + centsText(cents);
  }
  /* The whole-dollar figure for a hero tile; the tile shows money() beside it. */
  function roundMoney(cents) { return (cents < 0 ? "−$" : "$") + group(String(wholeDollars(cents))); }
  function signedMoney(cents) {
    if (cents === 0) return "$0.00";
    return (cents < 0 ? "−$" : "+$") + centsText(cents);
  }
  /* "2,500", "$2,500.5", "2500.50" to integer cents; null when empty; NaN when not an amount. */
  function parseMoney(text) {
    var t = String(text).replace(/[\s,$]/g, "");
    if (t === "") return null;
    var m = /^(\d{1,12})(?:\.(\d{0,2}))?$/.exec(t);
    if (!m) return NaN;
    var frac = (m[2] || "") + "00";
    return parseInt(m[1], 10) * 100 + parseInt(frac.slice(0, 2), 10);
  }
  function parseWhole(text) {
    var t = String(text).replace(/\s/g, "");
    if (t === "") return null;
    return /^\d{1,4}$/.test(t) ? parseInt(t, 10) : NaN;
  }
  function parsePct(text) {
    var t = String(text).replace(/[\s%]/g, "");
    if (t === "") return null;
    return /^\d{1,2}(\.\d{0,2})?$/.test(t) ? parseFloat(t) : NaN;
  }
  function pctText(fraction, places) { return (fraction * 100).toFixed(places) + "%"; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* ---------- the profile: fields ---------- */

  var PARTS = ["About you", "Retirement", "Retirement expenses", "Accounts and contributions", "Retirement income"];
  /* kind: money (dollars), age, year, pct. working: shown only while still working. */
  var FIELDS = {
    birthYear: { part: 0, label: "Birth year", kind: "year", hint: "Only the year is used. The page never asks for a name or a birth date." },
    salary: { part: 0, label: "Yearly salary", kind: "money", hint: "For your own reference. It does not change the results.", working: true },
    retireAge: { part: 1, label: "Retirement age", kind: "age", range: [50, 80, 1] },
    planAge: { part: 1, label: "Plan to age", kind: "age", range: [70, 110, 1], hint: "The analysis runs to the year you reach this age." },
    taxRatePct: { part: 1, label: "Tax rate on tax-deferred withdrawals", kind: "pct", range: [0, 50, 1], hint: "One assumption that you type. Not tax advice.", longHint: true },
    essentialMonthly: { part: 2, label: "Essential expenses, a month", kind: "money", range: [0, 15000, 100] },
    nonEssentialMonthly: { part: 2, label: "Non-essential expenses, a month", kind: "money", range: [0, 15000, 100] },
    balDeferred: { part: 3, group: "Tax-deferred", label: "Balance today", kind: "money"},
    contribDeferred: { part: 3, group: "Tax-deferred", label: "Added each year", kind: "money", working: true },
    balTaxable: { part: 3, group: "Taxable", label: "Balance today", kind: "money"},
    contribTaxable: { part: 3, group: "Taxable", label: "Added each year", kind: "money", working: true },
    balExempt: { part: 3, group: "Tax-exempt", label: "Balance today", kind: "money"},
    contribExempt: { part: 3, group: "Tax-exempt", label: "Added each year", kind: "money", working: true },
    ssMonthly: { part: 4, label: "Social Security, monthly amount", kind: "money", range: [0, 6000, 50] },
    ssStartAge: { part: 4, label: "Social Security starts at age", kind: "age", range: [62, 70, 1] },
    pensionMonthly: { part: 4, label: "Pension, monthly amount", kind: "money", range: [0, 10000, 50] },
    pensionStartAge: { part: 4, label: "Pension starts at age", kind: "age", range: [50, 80, 1] },
    annuityMonthly: { part: 4, label: "Annuity income, monthly amount", kind: "money", range: [0, 10000, 50], hint: "An income amount you type. The page does not model buying an annuity.", longHint: true },
    annuityStartAge: { part: 4, label: "Annuity income starts at age", kind: "age", range: [50, 90, 1] }
  };
  var GROUP_HINT = {
    "Tax-deferred": "Such as a traditional 401(k) or IRA: taxed when withdrawn.",
    "Taxable": "Such as a brokerage or savings account.",
    "Tax-exempt": "Such as a Roth account: withdrawals are not taxed here."
  };
  var ROW_FIELDS = {
    other: [{ key: "monthly", label: "Monthly amount", kind: "money" }, { key: "startAge", label: "From age", kind: "age" }, { key: "endAge", label: "To age", kind: "age" }],
    oneTime: [{ key: "amount", label: "Amount", kind: "money" }, { key: "age", label: "At age", kind: "age" }]
  };

  /* The approved line, word for word. Each use is its own element. */
  var EDU_LINE = "For education only, not financial advice.";
  /* The example's mix. true: the example opens with TAM 6, labelled as the example's, and the mix
     is cleared as soon as any example input is edited, so it never carries over to the reader's
     own figures. false: the example opens with no mix at all and the analysis asks for one. */
  var EXAMPLE_OPENS_WITH_MIX = false;

  /* Made-up example inputs. Not anyone's real figures. */
  function exampleInputs() {
    return {
      birthYear: String(NOW_YEAR - 48), status: "working", salary: "92,000",
      retireAge: "65", planAge: "95", taxRatePct: "15",
      essentialMonthly: "4,100", nonEssentialMonthly: "1,500",
      balDeferred: "185,000", contribDeferred: "9,000", balTaxable: "40,000", contribTaxable: "2,000", balExempt: "35,000", contribExempt: "3,000",
      ssMonthly: "2,300", ssStartAge: "67", pensionMonthly: "0", pensionStartAge: "65", annuityMonthly: "0", annuityStartAge: "65",
      other: [{ monthly: "600", startAge: "65", endAge: "70" }], oneTime: [{ amount: "30,000", age: "70" }],
      tam: EXAMPLE_OPENS_WITH_MIX ? 6 : null, example: true, tamExample: EXAMPLE_OPENS_WITH_MIX
    };
  }
  function emptyInputs() {
    var o = { status: "working", other: [], oneTime: [], tam: null, example: false, tamExample: false }, k;
    for (k in FIELDS) o[k] = "";
    return o;
  }
  function copyInputs(a) {
    var o = {}, k;
    for (k in a) o[k] = a[k];
    o.other = a.other.map(function (r) { return { monthly: r.monthly, startAge: r.startAge, endAge: r.endAge }; });
    o.oneTime = a.oneTime.map(function (r) { return { amount: r.amount, age: r.age }; });
    return o;
  }

  var state = {
    inputs: { A: exampleInputs(), B: null }, results: { A: null, B: null }, problems: { A: [], B: [] },
    active: "A", mode: "single", screen: "analysis", cond: "average", view: "projection", tab: "chart",
    cols: { expenses: false, income: false, withdrawals: false }, more: { projection: false, yearly: false }, band: false, openPart: -1
  };
  var ctl = {}, partEls = [], rowHosts = {}, pending = false, lastFlag = "";

  function parseBy(kind, text) { return kind === "money" ? parseMoney(text) : kind === "pct" ? parsePct(text) : parseWhole(text); }
  function showValue(kind, value) {
    if (value === null || value === undefined || isNaN(value)) return "";
    return kind === "money" ? (value % 100 === 0 ? group(String(value / 100)) : centsText(value)) : String(value);
  }
  /* Inputs to the engine's scenario, plus the problems the page can name itself. */
  function toScenario(inp) {
    var problems = [], s = { currentYear: NOW_YEAR, tam: inp.tam, otherIncome: [], oneTime: [] }, k, f, v;
    function bad(field, message) { problems.push({ field: field, message: message }); }
    for (k in FIELDS) {
      f = FIELDS[k];
      v = parseBy(f.kind, inp[k]);
      if (v !== null && isNaN(v)) { bad(k, f.kind === "money" ? "Type a dollar amount, such as 2,500." : f.kind === "pct" ? "Type a percentage from 0 to 50." : "Type a whole number."); v = null; }
      s[k] = v;
    }
    if (s.birthYear === null && !hasProblem(problems, "birthYear")) bad("birthYear", "Type the year you were born.");
    var retired = inp.status === "retired";
    if (retired) {
      if (s.birthYear !== null) s.retireAge = NOW_YEAR - s.birthYear;
      s.salary = 0; s.contribDeferred = 0; s.contribTaxable = 0; s.contribExempt = 0;
    } else if (s.retireAge === null && !hasProblem(problems, "retireAge")) bad("retireAge", "Type the age you plan to retire.");
    if (s.planAge === null && !hasProblem(problems, "planAge")) bad("planAge", "Type the age the plan runs to.");
    if (s.ssMonthly > 0 && s.ssStartAge === null) bad("ssStartAge", "Type the age Social Security starts.");
    if (s.pensionMonthly > 0 && s.pensionStartAge === null) bad("pensionStartAge", "Type the age the pension starts.");
    if (s.annuityMonthly > 0 && s.annuityStartAge === null) bad("annuityStartAge", "Type the age the annuity income starts.");
    inp.other.forEach(function (r, i) {
      var m = parseMoney(r.monthly), a = parseWhole(r.startAge), b = parseWhole(r.endAge);
      if (m === null && a === null && b === null) return;
      if (m === null || isNaN(m) || a === null || isNaN(a) || (b !== null && isNaN(b))) { bad("other." + i, "Other income " + (i + 1) + " needs a monthly amount and a starting age."); return; }
      s.otherIncome.push({ monthly: m, startAge: a, endAge: b });
    });
    inp.oneTime.forEach(function (r, i) {
      var m = parseMoney(r.amount), a = parseWhole(r.age);
      if (m === null && a === null) return;
      if (m === null || isNaN(m) || a === null || isNaN(a)) { bad("oneTime." + i, "One-time income " + (i + 1) + " needs an amount and an age."); return; }
      s.oneTime.push({ amount: m, age: a });
    });
    if (inp.tam === null) bad("tam", "Choose one of the ten asset mixes.");
    return { scenario: s, problems: problems };
  }
  function hasProblem(list, field) { return list.some(function (p) { return p.field === field; }); }

  /* Our own wording for each error code the engine can return. */
  var ERR = {
    birth_year_invalid: "Type the year you were born as a whole year.",
    current_age_out_of_range: "The age this year must be from 18 to 120.",
    retire_age_invalid: "Type a retirement age from 18 to 120.",
    plan_age_invalid: "Type the age the plan runs to, 18 or more.",
    plan_age_over_cap: "The plan-to age cannot be above 120.",
    plan_age_before_current_age: "The plan-to age is below the age this year.",
    retire_age_after_plan_age: "The retirement age is above the plan-to age.",
    money_negative: "This amount cannot be negative.",
    money_too_large: "This amount is larger than the page can handle.",
    money_not_integer_cents: "Type a dollar amount, such as 2,500.",
    ss_start_age_invalid: "The age Social Security starts must be a whole number from 0 to 120.",
    pension_start_age_invalid: "The age the pension starts must be a whole number from 0 to 120.",
    annuity_start_age_invalid: "The age the annuity income starts must be a whole number from 0 to 120.",
    other_income_age_invalid: "Each age must be a whole number from 0 to 120.",
    other_income_ages_out_of_order: "The end age is below the start age.",
    one_time_age_invalid: "The age must be a whole number from 0 to 120.",
    one_time_age_outside_plan: "This age is outside the years of the plan.",
    too_many_rows: "There are more rows than the page can handle.",
    tax_rate_out_of_range: "Type a tax rate from 0 to 50 percent.",
    tam_out_of_range: "Choose an asset mix.",
    amount_overflow: "The amounts grew beyond what the page can hold exactly."
  };

  function simulate(which) {
    var inp = state.inputs[which];
    if (!inp) { state.results[which] = null; state.problems[which] = []; return; }
    var built = toScenario(inp), problems = built.problems, result = null;
    if (!problems.length) {
      result = RA.simulate(built.scenario, DATA);
      if (!result.ok) {
        result.errors.forEach(function (e) {
          var field = String(e.field).replace(/^otherIncome\[(\d+)\].*$/, "other.$1").replace(/^oneTime\[(\d+)\].*$/, "oneTime.$1");
          problems.push({ field: field, message: ERR[e.code] || "This value is outside what the page can use." });
        });
        result = null;
      }
    }
    /* Only the mix is missing: the engine still checks every other value, so a figure that is out
       of range is named now and not after a mix has been picked. Nothing is simulated. */
    else if (problems.length === 1 && problems[0].field === "tam" && RA.validate) {
      RA.validate(built.scenario).forEach(function (e) {
        if (e.code === "tam_out_of_range" || /^tam/.test(String(e.field))) return;
        var field = String(e.field).replace(/^otherIncome\[(\d+)\].*$/, "other.$1").replace(/^oneTime\[(\d+)\].*$/, "oneTime.$1");
        problems.push({ field: field, message: ERR[e.code] || "This value is outside what the page can use." });
      });
    }
    state.results[which] = result;
    state.problems[which] = problems;
  }

  /* ---------- the profile: building it once ---------- */

  function inputBox(id, kind, parent) {
    var val = el("span", "ra-val" + (kind === "money" ? "" : " ra-val-short"), null, parent);
    if (kind === "money") el("span", null, "$", val).setAttribute("aria-hidden", "true");
    var input = el("input", null, null, val);
    input.id = id; input.type = "text"; input.autocomplete = "off";
    input.setAttribute("inputmode", kind === "money" || kind === "pct" ? "decimal" : "numeric");
    if (kind === "pct") el("span", null, "%", val).setAttribute("aria-hidden", "true");
    return { val: val, input: input };
  }
  function tidy(kind, input, store) {
    var v = parseBy(kind, input.value);
    if (v !== null && !isNaN(v)) { input.value = showValue(kind, v); store(input.value); }
  }
  function twoSentences(text) { return /[.?] +[A-Z]/.test(text); }
  /* A field is a well: its label, a slider where the value is continuous, the number box, a help line and the message. */
  function buildField(key, parent) {
    var f = FIELDS[key], wrap = el("div", "ra-field", null, parent), id = "ra-f-" + key, range = null;
    el("label", null, f.label, wrap).setAttribute("for", id);
    var row = el("div", "ra-ctl", null, wrap);
    if (f.range) {
      range = el("input", "ra-range", null, row);
      range.type = "range"; range.min = String(f.range[0]); range.max = String(f.range[1]); range.step = String(f.range[2]);
      range.id = id + "-range";
      range.setAttribute("aria-label", (f.group ? f.group + ", " : "") + f.label + ", slider");
    }
    var box = inputBox(id, f.kind, row), input = box.input;
    if (f.hint) { el("p", "ra-hint" + (twoSentences(f.hint) ? " ra-hint-long" : ""), f.hint, wrap).id = id + "-hint"; input.setAttribute("aria-describedby", id + "-hint " + id + "-err"); }
    else input.setAttribute("aria-describedby", id + "-err");
    if (f.group) input.setAttribute("aria-label", f.group + ", " + f.label.toLowerCase());
    var err = el("p", "ra-err", null, wrap); err.id = id + "-err";
    ctl[key] = { wrap: wrap, input: input, err: err, val: box.val, f: f, range: range };
    input.addEventListener("input", function () { cur()[key] = input.value; touch(); syncRange(key); changed(); });
    input.addEventListener("change", function () { tidy(f.kind, input, function (v) { cur()[key] = v; }); });
    if (range) range.addEventListener("input", function () {
      var v = parseInt(range.value, 10);
      input.value = f.kind === "money" ? group(String(v)) : String(v);
      cur()[key] = input.value; touch(); syncRange(key); changed();
    });
  }
  /* The slider follows the number box and says its value in words. A typed value beyond the
     slider's ends keeps the handle at the end; the box holds the figure. */
  function syncRange(key) {
    var c = ctl[key];
    if (!c.range) return;
    var f = c.f, v = parseBy(f.kind, c.input.value);
    if (v === null || isNaN(v)) { c.range.value = String(f.range[0]); c.range.setAttribute("aria-valuetext", "Not set"); return; }
    var pos = f.kind === "money" ? (v - v % 100) / 100 : Math.round(v);
    c.range.value = String(Math.max(f.range[0], Math.min(f.range[1], pos)));
    c.range.setAttribute("aria-valuetext", f.kind === "money" ? money(v) + " a month" : f.kind === "pct" ? v + " percent" : "Age " + v);
  }
  function card(parent, title, note) {
    var c = el("div", "ra-group", null, parent);
    if (title) el("h3", "ra-group-title", title, c);
    if (note) el("p", "ra-hint", note, c);
    return c;
  }
  function fields(parent, keys) {
    var g = el("div", "ra-fields", null, parent);
    keys.forEach(function (k) { buildField(k, g); });
    return g;
  }
  function mini(parent, title, id) {
    var c = el("div", "ra-mini", null, parent);
    el("p", "ra-h3", title, c);
    el("div", id ? "ra-mini-big" : null, null, c).id = id;
    return c;
  }

  function buildRows(kind, title, emptyText, addText, parent) {
    var g = el("div", "ra-group", null, parent);
    el("h3", "ra-group-title", title, g);
    el("p", "ra-hint", emptyText, g);
    rowHosts[kind] = el("div", "ra-rowlist", null, g);
    var add = el("button", "ra-btn", addText, el("div", "ra-addline", null, g));
    add.type = "button";
    add.addEventListener("click", function () {
      cur()[kind].push(kind === "other" ? { monthly: "", startAge: "", endAge: "" } : { amount: "", age: "" });
      touch(); fillRows(kind); changed();
      var first = rowHosts[kind].lastChild && rowHosts[kind].lastChild.querySelector("input");
      if (first) first.focus();
    });
  }
  function fillRows(kind) {
    var host = rowHosts[kind], rows = cur()[kind], title = kind === "other" ? "Other income " : "One-time income ";
    clear(host);
    rows.forEach(function (r, i) {
      var box = el("div", "ra-row", null, host), grid = el("div", "ra-row-fields", null, box);
      box.setAttribute("role", "group"); box.setAttribute("aria-label", title + (i + 1));
      ROW_FIELDS[kind].forEach(function (rf) {
        var w = el("div", "ra-field", null, grid), id = "ra-r-" + kind + "-" + i + "-" + rf.key;
        el("label", null, rf.label, w).setAttribute("for", id);
        var input = inputBox(id, rf.kind, w).input;
        input.value = r[rf.key];
        input.addEventListener("input", function () { r[rf.key] = input.value; touch(); changed(); });
        input.addEventListener("change", function () { tidy(rf.kind, input, function (v) { r[rf.key] = v; }); });
      });
      el("p", "ra-err", null, box).id = "ra-r-" + kind + "-" + i + "-err";
      var rm = el("button", "ra-link ra-link-tight", "Remove", box);
      rm.type = "button"; rm.setAttribute("aria-label", "Remove " + title.toLowerCase() + (i + 1));
      rm.addEventListener("click", function () { rows.splice(i, 1); touch(); fillRows(kind); changed(); });
    });
  }

  function buildProfile() {
    var list = $("ra-parts"), host = $("ra-forms"), forms = [];
    PARTS.forEach(function (name, i) {
      var li = el("li", null, null, list), b = el("button", null, null, li);
      b.type = "button"; b.id = "ra-part-" + i;
      el("span", null, name, b);
      var flag = el("span", "ra-flag", null, b);
      b.addEventListener("click", function () { openPart(i); });
      var form = el("section", "ra-card ra-form", null, host);
      form.setAttribute("aria-labelledby", "ra-form-h-" + i);
      el("h2", "ra-h2", name, form).id = "ra-form-h-" + i;
      partEls.push({ btn: b, flag: flag, form: form });
      forms.push(form);
    });

    /* 1. About you */
    var c = card(forms[0]), g1 = fields(c, ["birthYear"]);
    var st = el("fieldset", "ra-radiorow", null, el("div", "ra-field", null, g1));
    el("legend", "ra-lab-text", "Working status", st);
    [["working", "Still working"], ["retired", "Retired"]].forEach(function (o) {
      var lab = el("label", null, null, st), r = el("input", null, null, lab);
      r.type = "radio"; r.name = "ra-status"; r.value = o[0];
      lab.appendChild(document.createTextNode(o[1]));
      r.addEventListener("change", function () { cur().status = o[0]; touch(); fillProfile(); changed(); });
    });
    buildField("salary", g1);
    /* 2. Retirement */
    fields(card(forms[1], "Timeline"), ["retireAge", "planAge"]);
    fields(card(forms[1], "Taxes", "The page uses one tax rate, typed by you. It has no tax tables and does not know your filing status or state."), ["taxRatePct"]);
    /* 3. Retirement expenses */
    var m3 = el("div", "ra-form-cards", null, forms[2]);
    mini(m3, "Total expenses", "ra-m-exp");
    fields(card(forms[2], "Monthly expenses in retirement", "Monthly amounts in retirement, in today's dollars. You type them; the page does not estimate them from your salary."), ["essentialMonthly", "nonEssentialMonthly"]);
    /* 4. Accounts and contributions */
    var m4 = el("div", "ra-form-cards", null, forms[3]);
    mini(m4, "Retirement balance today", "ra-m-bal");
    mini(m4, "Retirement contributions", "ra-m-add");
    var tt = mini(m4, "Tax treatment of the balance", null);
    tt.lastChild.id = "ra-m-tax";
    [["Tax-deferred", "balDeferred", "contribDeferred"], ["Taxable", "balTaxable", "contribTaxable"], ["Tax-exempt", "balExempt", "contribExempt"]].forEach(function (g) {
      fields(card(forms[3], g[0], GROUP_HINT[g[0]]), [g[1], g[2]]);
    });
    /* 5. Retirement income */
    var m5 = el("div", "ra-form-cards", null, forms[4]);
    mini(m5, "Lifetime income", "ra-m-life");
    mini(m5, "Other recurring income", "ra-m-other");
    mini(m5, "One-time income", "ra-m-once");
    var life = card(forms[4], "Lifetime income", "Income that carries on for life once it starts: Social Security, pensions and annuities. Type the Social Security amount from your own statement, in today's dollars; the page does not estimate it.");
    fields(life, ["ssMonthly", "ssStartAge", "pensionMonthly", "pensionStartAge", "annuityMonthly", "annuityStartAge"]);
    buildRows("other", "Other recurring income", "Income for a set number of years, such as part-time work or rent. It counts in total income, not in lifetime income.", "Add other income", forms[4]);
    buildRows("oneTime", "One-time income", "A single amount in one year, such as the sale of a home.", "Add one-time income", forms[4]);

    forms.forEach(function (form, i) {
      /* A section that shows a sum the page worked out carries the approved line as its own element. */
      if (form.querySelector(".ra-mini")) el("p", "ra-small ra-edu-line", EDU_LINE, form);
      var foot = el("div", "ra-form-foot", null, form), b;
      if (i > 0) { b = el("button", "ra-btn", "Back", foot); b.type = "button"; b.addEventListener("click", function () { openPart(i - 1); focusForm(i - 1); }); }
      b = el("button", "ra-btn ra-btn-primary", i < forms.length - 1 ? "Continue" : "View the analysis", foot);
      b.type = "button";
      b.addEventListener("click", function () { if (i < forms.length - 1) { openPart(i + 1); focusForm(i + 1); } else setScreen("analysis", true); });
    });
  }
  function focusForm(i) { var h = $("ra-form-h-" + i); h.setAttribute("tabindex", "-1"); h.focus(); }

  function openPart(i) {
    state.openPart = i;
    partEls.forEach(function (p, k) {
      if (k === i) p.btn.setAttribute("aria-current", "step"); else p.btn.removeAttribute("aria-current");
      show(p.form, k === i);
    });
    showPart();
  }
  /* On narrow screens the section list is one sideways row: bring the open section, and its
     "Needs a look" flag, into view. Only the row scrolls, never the page. */
  function showPart() {
    var p = partEls[state.openPart], row = $("ra-parts");
    if (!p || !row.clientWidth || row.scrollWidth <= row.clientWidth) return;
    var a = p.btn.getBoundingClientRect(), b = row.getBoundingClientRect();
    row.scrollLeft += a.left - b.left - (row.clientWidth - a.width) / 2;
  }

  function cur() { return state.inputs[state.active]; }
  /* Any edit to an example's inputs marks it edited and, while the mix is still the one that came
     with the example, clears the mix: the reader's own figures never keep a mix they did not pick. */
  function touch() {
    var c = cur();
    if (!c.example) return;
    c.edited = true;
    if (c.tamExample) { c.tam = null; c.tamExample = false; }
  }

  /* Writes the active scenario's inputs into the controls. */
  function fillProfile() {
    var inp = cur(), k, retired = inp.status === "retired";
    for (k in ctl) {
      ctl[k].input.value = inp[k] === undefined ? "" : inp[k];
      if (ctl[k].f.working) show(ctl[k].wrap, !retired);
    }
    var born = parseWhole(inp.birthYear);
    ctl.retireAge.input.disabled = retired;
    ctl.retireAge.val.classList.toggle("ra-val-off", retired);
    ctl.retireAge.range.disabled = retired;
    if (retired) ctl.retireAge.input.value = born !== null && !isNaN(born) ? String(NOW_YEAR - born) : "";
    Array.prototype.forEach.call(document.querySelectorAll("input[name=ra-status]"), function (r) { r.checked = r.value === inp.status; });
    for (k in ctl) syncRange(k);
    fillRows("other"); fillRows("oneTime");
  }

  function sumMoney(inp, keys) {
    var total = 0;
    keys.forEach(function (k) { var v = parseMoney(inp[k]); if (v !== null && !isNaN(v)) total += v; });
    return total;
  }
  function sumRows(rows, key) {
    var total = 0;
    rows.forEach(function (r) { var v = parseMoney(r[key]); if (v !== null && !isNaN(v)) total += v; });
    return total;
  }
  function bigWithUnit(id, cents, unit) {
    var n = $(id);
    clear(n);
    n.appendChild(document.createTextNode(money(cents)));
    if (unit) el("small", null, " " + unit, n);
  }
  function rowsList(parent, rows) {
    var dl = el("dl", "ra-rows", null, parent);
    rows.forEach(function (r) { var d = el("div", null, null, dl); el("dt", null, r[0], d); el("dd", null, r[1], d); });
    return dl;
  }
  function taxSplit(inp) {
    var bal = sumMoney(inp, ["balDeferred", "balTaxable", "balExempt"]);
    return [["Tax-deferred", "balDeferred"], ["Taxable", "balTaxable"], ["Tax-exempt", "balExempt"]].map(function (a) {
      var c = parseMoney(inp[a[1]]);
      c = c === null || isNaN(c) ? 0 : c;
      return [a[0], (bal > 0 ? Math.round(c * 100 / bal) : 0) + "%"];
    });
  }

  /* The small figure cards in the profile, the chips and the per-field messages. */
  function renderProfile() {
    var inp = cur(), retired = inp.status === "retired", problems = state.problems[state.active], k;
    bigWithUnit("ra-m-exp", sumMoney(inp, ["essentialMonthly", "nonEssentialMonthly"]), "a month");
    bigWithUnit("ra-m-bal", sumMoney(inp, ["balDeferred", "balTaxable", "balExempt"]), "");
    bigWithUnit("ra-m-add", retired ? 0 : sumMoney(inp, ["contribDeferred", "contribTaxable", "contribExempt"]), "a year");
    bigWithUnit("ra-m-life", sumMoney(inp, ["ssMonthly", "pensionMonthly", "annuityMonthly"]), "a month");
    bigWithUnit("ra-m-other", sumRows(inp.other, "monthly"), "a month");
    bigWithUnit("ra-m-once", sumRows(inp.oneTime, "amount"), "");
    var tax = $("ra-m-tax");
    clear(tax);
    rowsList(tax, taxSplit(inp));

    for (k in ctl) { ctl[k].err.textContent = ""; ctl[k].input.removeAttribute("aria-invalid"); ctl[k].val.classList.remove("ra-val-bad"); }
    partEls.forEach(function (p) { p.flag.textContent = ""; });
    /* Row messages are cleared on every pass too, so a row that has been fixed loses its message. */
    Array.prototype.forEach.call(document.querySelectorAll("#ra-forms .ra-row > .ra-err"), function (e) { e.textContent = ""; });
    problems.forEach(function (p) {
      var c = ctl[p.field], m = /^(other|oneTime)\.(\d+)$/.exec(p.field);
      if (c) { c.err.textContent = p.message; c.input.setAttribute("aria-invalid", "true"); c.val.classList.add("ra-val-bad"); partEls[c.f.part].flag.textContent = "Needs a look"; }
      else if (m) { var e = $("ra-r-" + m[1] + "-" + m[2] + "-err"); if (e) e.textContent = p.message; partEls[4].flag.textContent = "Needs a look"; }
    });

    /* A flag that appears or goes changes the width of the open section's button in the sideways row. */
    var flagNow = partEls[state.openPart] ? partEls[state.openPart].flag.textContent : "";
    if (flagNow !== lastFlag) { lastFlag = flagNow; showPart(); }

    var chip = inp.example ? (inp.edited ? "Example inputs, edited" : "Example inputs") : "";
    $("ra-profile-kicker").textContent = "Scenario " + state.active + (chip ? ": " + chip.toLowerCase() : ": your inputs");
    $("ra-example-chip").textContent = chip; show($("ra-example-chip"), !!chip);
    show($("ra-clear"), inp.example); show($("ra-restore"), !inp.example);
  }

  /* ---------- the analysis ---------- */

  function splitText(tam) {
    var t = RA.TAMS[tam - 1];
    if (t.cash === 100) return "100% cash";
    if (t.bonds === 0) return "100% stocks";
    return t.stocks + "% stocks / " + t.bonds + "% bonds";
  }
  function mixText(tam) { return tam === null ? "choose an asset mix" : "TAM " + tam + ": " + splitText(tam); }
  /* The first use on a screen says what the letters stand for on this page: a mix number. */
  function mixTextGloss(tam) { return tam === null ? "choose an asset mix" : "TAM " + tam + " (mix number " + tam + "): " + splitText(tam); }
  /* What the chosen outcome is, in counts from the engine. */
  function condGloss(which) {
    var r = state.results[which], c = r ? r.condition[state.cond] : null;
    if (!c) return "";
    return state.cond === "average" ? "(the middle run of the " + r.runs + ", ranked by how the plan ended)" : "(at least " + c.asGoodOrBetter + " of the " + r.runs + " runs ended as well or better)";
  }
  function shortLabel(key) { var m = DATA.meta && DATA.meta[key]; return m && m.label ? String(m.label).split(/ \(|,/)[0] : key; }
  var statsCache = null;
  function mixStats() { if (!statsCache) { var s = RA.tamStats(DATA); statsCache = s.tams || []; } return statsCache; }
  function condOf(which) { var r = state.results[which]; return r ? r.condition[state.cond] : null; }

  function renderSentence() {
    var inp = cur();
    $("ra-pick-cond-text").textContent = COND[state.cond];
    $("ra-pick-cond-ab-text").textContent = COND[state.cond];
    $("ra-cond-art").textContent = condArt(state.cond);
    $("ra-cond-ab-art").textContent = condArt(state.cond);
    var gloss = condGloss(state.active);
    $("ra-cond-gloss").textContent = gloss;
    /* On phones the gloss leaves the sentence and is said under the chart instead (ra.css). */
    $("ra-cond-below").textContent = gloss ? COND[state.cond].charAt(0).toUpperCase() + COND[state.cond].slice(1) + " outcome: " + gloss.slice(1, -1) + "." : "";
    $("ra-cond-ab-gloss").textContent = condGloss("A");
    /* The clickable word is the mix's name; its split follows as plain text, so the sentence can wrap. */
    $("ra-pick-mix-text").textContent = inp.tam === null ? "choose an asset mix" : "TAM " + inp.tam + " (mix number " + inp.tam + ")";
    $("ra-mix-tail").textContent = inp.tam === null ? "" : ": " + splitText(inp.tam) + (inp.example && inp.tamExample ? ", the example's starting mix" : "");
  }

  /* One donut with its legend, for a TAM or for "nothing chosen". */
  function drawMix(tam, donutHost, legendHost, textHost) {
    clear(donutHost); clear(legendHost);
    textHost.textContent = tam === null ? "No mix chosen yet." : mixText(tam);
    if (tam === null) return;
    var w = null;
    mixStats().forEach(function (t) { if (t.tam === tam) w = t.weights; });
    if (!w) return;
    var parts = [], said = [], t = RA.TAMS[tam - 1];
    RA.ASSETS.forEach(function (a) {
      var pct = Math.round(w[a] * 1000) / 10;
      parts.push({ pct: pct, cls: ASSET_CLASS[a] });
      if (!(pct > 0)) return;
      var li = el("li", null, null, legendHost);
      el("span", "ra-sw " + ASSET_CLASS[a], null, li).setAttribute("aria-hidden", "true");
      el("span", null, shortLabel(a), li);
      el("strong", null, pct.toFixed(1) + "%", li);
      said.push(shortLabel(a) + " " + pct + "%");
    });
    Chart.donut(donutHost, { label: "Donut chart of TAM " + tam + ": " + said.join(", ") + ".", parts: parts, big: (t.cash === 100 ? 100 : t.stocks) + "%", small: t.cash === 100 ? "cash" : "stocks" });
  }

  /* A head cell may carry a line sample (sw) before its text; caption is the table's own source line. */
  function table(host, headList, rows, markAt, caption) {
    clear(host);
    if (caption) el("caption", null, caption, host);
    var thead = el("thead", null, null, host), tr = el("tr", null, null, thead);
    headList.forEach(function (h) {
      var th = el("th", h && h.cls ? h.cls : null, null, tr);
      th.setAttribute("scope", "col");
      if (h && h.sw) el("span", "ra-sw " + h.sw, null, th).setAttribute("aria-hidden", "true");
      th.appendChild(document.createTextNode(h && h.text !== undefined ? h.text : h));
    });
    var tbody = el("tbody", null, null, host);
    rows.forEach(function (cells, i) {
      var row = el("tr", i === markAt ? "ra-rowmark" : null, null, tbody);
      cells.forEach(function (c, k) {
        var cell = el(k === 0 ? "th" : "td", c && c.cls ? c.cls : null, c && c.text !== undefined ? c.text : c, row);
        if (k === 0) cell.setAttribute("scope", "row");
      });
    });
  }
  function moreLine(view, total) {
    var b = document.querySelector('[data-more="' + view + '"]'), shown = state.more[view] ? total : Math.min(5, total);
    document.querySelector('[data-count="' + view + '"]').textContent = "Showing " + shown + " of " + total + " |";
    show(b, total > 5);
    b.textContent = state.more[view] ? "Show the first five" : "Show all";
  }
  function figs(list, note) {
    var host = $("ra-figs");
    clear(host);
    list.forEach(function (f) {
      var d = el("div", "ra-fig", null, host);
      el("dt", null, f[0], d);
      el("dd", null, f[1], d);
      if (f[2]) el("dd", "ra-fig-sub" + (twoSentences(f[2]) ? " ra-fig-sub-long" : ""), f[2], d);
    });
    $("ra-figs-note").textContent = note;
    show($("ra-figs-block"), list.length > 0);
  }

  /* The middle of all runs at the retirement year: the same figure the side by side table shows. */
  function medianAtRetirement(r) { var i = r.meta.retireAge - r.meta.currentAge; return Math.round(r.bands.p50[i > 0 ? i : 0]); }
  /* The three hero figures beside the chart card. A money figure reads "about" and the whole
     dollar, with the exact figure in cents as its own line in the same tile. */
  function renderTiles() {
    var r = state.results[state.active], s = condOf(state.active).summary, m = r.meta, host = $("ra-tiles");
    /* Already retired: every run starts from the typed balance, so the tile says so. */
    var later = m.retireAge > m.currentAge;
    clear(host);
    [{ label: "Runs where the money lasted", big: String(r.lastedCount), unit: "of " + r.runs,
       sub: "In " + r.lastedCount + " of " + r.runs + " simulated runs, the money lasted to age " + m.planAge + " under the assumptions below. This count is approximate. Another set of " + r.runs + " runs could give roughly " + r.lastedRange.lowCount + " to " + r.lastedRange.highCount + "." },
     later
       ? { label: "Savings at retirement, middle of all 500 runs", cents: medianAtRetirement(r), exact: ", the middle of all " + r.runs + " runs at that age.",
           sub: "At the start of the year you reach age " + m.retireAge + ". About half of the " + r.runs + " runs had more saved at that age and about half had less. It does not change with the outcome you pick. The chart draws one run, so its figure at this age can differ." }
       : { label: "Savings today", cents: medianAtRetirement(r), exact: ", the total you typed.",
           sub: "Before any simulated year, so it is the same in every run." },
     /* In the yearly view the key figures sit beside this tile, so its caption says both show one run. */
     { label: "Savings at the end of the plan", cents: s.savingsAtEnd,
       sub: "At the end of the year you reach age " + m.planAge + (state.view === "yearly" ? ", in the one run drawn in the chart, the same run as the key figures." : ", in the one run drawn in the chart.") + " Other runs end higher or lower." }
    ].forEach(function (t) {
      var d = el("div", "ra-tile", null, host);
      el("dt", null, t.label, d);
      var big = el("dd", "ra-tile-big", null, d);
      if (t.cents !== undefined) { el("small", "ra-about", "about", big); big.appendChild(document.createTextNode(roundMoney(t.cents))); el("dd", "ra-tile-exact", money(t.cents) + (t.exact || " in this run."), d); }
      else { big.appendChild(document.createTextNode(t.big)); el("small", "ra-unit", t.unit, big); }
      el("dd", "ra-tile-sub", t.sub, d);
    });
  }

  function renderProjection() {
    var r = state.results[state.active], c = condOf(state.active), years = c.years, m = r.meta;
    var retireIndex = Math.max(0, m.retireAge - m.currentAge), last = years[years.length - 1];
    $("ra-view-sub").textContent = "Savings by account type at the start of each year, from age " + m.currentAge + " to " + m.planAge + ", in one run with " + condArt(state.cond) + " " + COND[state.cond] + " outcome. At any age, this run's savings can differ from the middle of all " + r.runs + " runs.";
    show($("ra-band-note"), state.band);
    if (state.tab === "chart") {
      Chart.projection($("ra-chart-projection"), {
        label: "Stacked area chart of savings by account type from age " + m.currentAge + " to " + m.planAge + ", in today's dollars. One run with " + condArt(state.cond) + " " + COND[state.cond] + " outcome. Savings at retirement in this run, age " + m.retireAge + ": " + money(c.summary.savingsAtRetirement) + ". At the start of the last year: " + money(last.savingsStart) + ". The Table tab lists every year.",
        rows: years.map(function (y) { return { age: y.age, parts: [y.startDeferred, y.startTaxable, y.startExempt] }; }),
        classes: ["ra-c-invest", "ra-c-cash", "ra-c-other"],
        retireIndex: retireIndex, retireText: retireIndex > 0 ? "Retirement, age " + m.retireAge : "",
        band: state.band ? { lo: r.bands.p10, hi: r.bands.p90 } : null,
        readout: function (i) {
          var y = years[i], items = [
            { sw: "ra-c-invest", label: "Tax-deferred", value: money(y.startDeferred) },
            { sw: "ra-c-cash", label: "Taxable", value: money(y.startTaxable) },
            { sw: "ra-c-other", label: "Tax-exempt", value: money(y.startExempt) },
            { sw: state.band ? "ra-sw-line ra-c-ink" : null, label: "Total, this run", value: money(y.savingsStart), lead: true }];
          if (state.band) items.push({ sw: "ra-sw-band", label: "Middle 80% of runs", value: money(r.bands.p10[i]) + " to " + money(r.bands.p90[i]) });
          return { title: y.year + ", age " + y.age, items: items };
        }
      });
    } else {
      var rows = years.map(function (y) { return [String(y.year), String(y.age), money(y.startDeferred), money(y.startTaxable), money(y.startExempt), { text: money(y.savingsStart), cls: "ra-total" }]; });
      table($("ra-table-projection"), ["Year", "Age", "Tax-deferred", "Taxable", "Tax-exempt", "Total savings at start of year"], state.more.projection ? rows : rows.slice(0, 5), state.more.projection ? retireIndex : -1);
      moreLine("projection", rows.length);
    }
    figs([], "");
  }

  function renderMonthly() {
    var c = condOf(state.active), s = c.summary;
    $("ra-view-sub").textContent = "An average month over the " + plural(s.retirementYears, "retirement year", "retirement years") + " of this run.";
    var sentence = $("ra-monthly-sentence");
    clear(sentence);
    sentence.appendChild(document.createTextNode("In this illustration income and withdrawals from savings cover "));
    el("strong", null, s.coveragePct + "%", sentence);
    sentence.appendChild(document.createTextNode(" of monthly expenses in retirement."));
    if (state.tab === "chart") {
      Chart.monthly($("ra-chart-monthly"), {
        label: "Bar chart. In this run, expenses covered by income and withdrawals " + money(s.monthlyMayHave) + " a month; expenses you typed, plus tax, " + money(s.monthlyMayNeed) + " a month; gap " + money(s.monthlyGap) + " a month.",
        have: s.monthlyMayHave, need: s.monthlyMayNeed, gap: s.monthlyGap,
        haveText: money(s.monthlyMayHave), needText: money(s.monthlyMayNeed), gapText: money(s.monthlyGap),
        haveLabel: "In this run: expenses covered by income and withdrawals", needLabel: "Expenses you typed, plus tax", gapLabel: "Gap",
        keys: [{ sw: "ra-c-have", label: "Covered by income and withdrawals", value: money(s.monthlyMayHave) }, { sw: "ra-c-need", label: "Expenses you typed, plus tax", value: money(s.monthlyMayNeed) }]
          .concat(s.monthlyGap > 0 ? [{ sw: "ra-sw-hatch", label: "Gap", value: money(s.monthlyGap) }] : [])
      });
    } else {
      table($("ra-table-monthly"), ["Monthly average", "Amount"], [
        ["In this run: expenses covered by income and withdrawals from savings", money(s.monthlyMayHave)],
        ["Expenses you typed, plus tax", money(s.monthlyMayNeed)],
        ["Gap", { text: money(s.monthlyGap), cls: "ra-total" }],
        ["Share of expenses covered", s.coveragePct + "%"]], -1);
    }
    figs([["In this run: expenses covered", money(s.monthlyMayHave), "The part paid by income and withdrawals from savings"], ["Expenses you typed, plus tax", money(s.monthlyMayNeed), "Expenses and the tax assumption"], ["Gap", money(s.monthlyGap), "Expenses minus the part covered"]],
      "Monthly averages over the retirement years of one simulated run, in today's dollars. A gap of $0.00 in this run does not mean a gap of $0.00 in every run.");
  }

  function bpText(bp) { var whole = (bp - bp % 100) / 100, frac = bp % 100; return whole + "." + (frac < 10 ? "0" : "") + frac + "%"; }

  function renderYearly() {
    var r = state.results[state.active], c = condOf(state.active), m = r.meta, s = c.summary;
    var years = c.years.filter(function (y) { return y.retired; });
    $("ra-view-sub").textContent = "Each retirement year, from age " + years[0].age + " to " + m.planAge + ".";
    $("ra-plan-event").textContent = "The plan runs to age " + m.planAge + ", in " + years[years.length - 1].year;
    if (state.tab === "chart") {
      Chart.yearly($("ra-chart-yearly"), {
        label: "Stacked bar chart of each retirement year from age " + years[0].age + " to " + m.planAge + ": income, withdrawals from savings and any gap, with lines for essential and total expenses. " + (s.shortfallYear === null ? "No year has a gap in this run." : "The first gap is in " + s.shortfallYear + ".") + " The Table tab lists every year.",
        rows: years.map(function (y) { return { age: y.age, income: y.totalIncome, withdrawals: y.withdrawals, gap: y.shortfall, essential: y.essential, total: y.totalExpenses }; }),
        planText: "Plan to age " + m.planAge, totalText: "Total expenses", essentialText: "Essential expenses",
        readout: function (i) {
          var y = years[i], items = [
            { sw: "ra-c-income", label: "Income", value: money(y.totalIncome) },
            { sw: "ra-sw-dots", label: "Withdrawals from savings", value: money(y.withdrawals) }];
          if (s.totalShortfall > 0) items.push({ sw: "ra-sw-hatch", label: "Gap", value: money(y.shortfall) });
          items.push({ sw: "ra-sw-dot ra-c-ink", label: "Total expenses", value: money(y.totalExpenses) }, { sw: "ra-sw-line ra-c-ink", label: "Essential expenses", value: money(y.essential) });
          return { title: y.year + ", age " + y.age, items: items };
        }
      });
    } else {
      var x = state.cols, g = "ra-colgroup", h = ["Year", "Age", "Savings at start of year"];
      if (x.expenses) h.push({ text: "Essential expenses", cls: g }, { text: "Non-essential expenses", cls: g }, { text: "Taxes", cls: g });
      h.push("Total expenses");
      if (x.income) h.push({ text: "Social Security", cls: g }, { text: "Pension", cls: g }, { text: "Annuity income", cls: g }, { text: "Other income", cls: g });
      h.push("Total income");
      if (x.withdrawals) h.push({ text: "Required minimum distribution", cls: g }, { text: "Tax on reinvested RMD", cls: g }, { text: "Withdrawal percentage", cls: g });
      h.push("Withdrawals from savings", "Savings at year end", "Shortfall");
      var rows = years.map(function (y) {
        var row = [String(y.year), String(y.age), money(y.savingsStart)];
        if (x.expenses) row.push({ text: money(y.essential), cls: g }, { text: money(y.nonEssential), cls: g }, { text: money(y.taxOnSpending), cls: g });   /* total expenses count this tax only */
        row.push({ text: money(y.totalExpenses), cls: "ra-total" });
        if (x.income) row.push({ text: money(y.socialSecurity), cls: g }, { text: money(y.pension), cls: g }, { text: money(y.annuity), cls: g }, { text: money(y.otherIncome), cls: g });
        row.push({ text: money(y.totalIncome), cls: "ra-total" });
        if (x.withdrawals) row.push({ text: money(y.rmd), cls: g }, { text: money(y.taxOnReinvestedRmd), cls: g }, { text: bpText(y.withdrawalBp), cls: g });
        row.push(money(y.withdrawals), money(y.savingsEnd), { text: y.shortfall > 0 ? "−" + money(y.shortfall) : "$0.00", cls: y.shortfall > 0 ? "ra-gapcell" : null });
        return row;
      });
      table($("ra-table-yearly"), h, state.more.yearly ? rows : rows.slice(0, 5), -1);
      moreLine("yearly", rows.length);
    }
    /* The second figure flips: the shortfall year when this run has one, otherwise what is left at the end.
       That figure is also the third hero tile, under another label, so its sub-line says they are one number. */
    figs([["Total lifetime income", money(s.totalLifetimeIncome), "Social Security, pensions and annuities, added up over the retirement years"],
      s.shortfallYear === null
        ? ["Assets at the end of the plan", money(s.savingsAtEnd), "No shortfall in this run. The same figure as Savings at the end of the plan."]
        : ["Shortfall year", String(s.shortfallYear), "At age " + s.shortfallAge + ", the first year savings and income did not cover expenses"]],
      "One simulated run with " + condArt(state.cond) + " " + COND[state.cond] + " outcome. Other runs differ. Other recurring and one-time income in this run: " + money(s.totalOtherIncome) + ", counted in total income and not in lifetime income.");
  }

  function renderView() {
    ["projection", "monthly", "yearly"].forEach(function (v) {
      var body = $("ra-view-" + v), on = v === state.view;
      show(body, on);
      if (on) {
        $("ra-view-h").textContent = body.getAttribute("data-title");
        Array.prototype.forEach.call(body.querySelectorAll("[data-pane]"), function (p) { show(p, p.getAttribute("data-pane") === state.tab); });
      }
    });
    $("ra-view").value = state.view;
    selectTab($("ra-viewtabs"), state.tab, "data-tab");
    if (state.view === "projection") renderProjection(); else if (state.view === "monthly") renderMonthly(); else renderYearly();
  }

  /* The summary cards under the chart, also used as the two columns of the side by side screen. */
  function sumCard(parent, title, part, which) {
    var c = el("section", "ra-sum", null, parent), head = el("div", "ra-sum-head", null, c);
    el("h3", "ra-h3", title, head);
    if (part !== null) {
      var e = el("button", "ra-link", "Edit", head);
      e.type = "button"; e.setAttribute("aria-label", "Edit " + title.toLowerCase() + (state.inputs.B ? ", Scenario " + which : ""));
      e.addEventListener("click", function () { state.active = which; state.mode = "single"; fillProfile(); render(); openPart(part); setScreen("profile", true); });
    }
    return c;
  }
  /* single: the four wells of the inputs card. Otherwise one column of the side by side screen,
     which carries its own runs-lasted well and leaves out "Your information". */
  function renderCards(host, which, single) {
    var inp = state.inputs[which], r = state.results[which], m = r.meta, retired = inp.status === "retired", c;
    function v(key) { var f = FIELDS[key], x = parseBy(f.kind, inp[key]); return x === null || isNaN(x) ? "Not set" : (f.kind === "money" ? money(x) : String(x)); }
    if (!single) {
      c = sumCard(host, "Runs where the money lasted", null, which);
      var big = el("p", "ra-sum-big", String(r.lastedCount), c);
      el("small", null, "of " + r.runs, big);
      el("p", "ra-body", "In " + r.lastedCount + " of " + r.runs + " simulated runs, the money lasted to age " + m.planAge + " under the assumptions below. This count is approximate. Another set of " + r.runs + " runs could give roughly " + r.lastedRange.lowCount + " to " + r.lastedRange.highCount + ".", c);
    } else {
      /* The note on the example's mix is a line of its own across the top of the wells, so no well is
         stretched by a paragraph and the wells in a row hold about the same amount. */
      if (inp.example && inp.tamExample) el("p", "ra-body ra-cards-note", "TAM " + inp.tam + " came with the example inputs. The page did not choose it for you; any of the ten mixes can be picked.", host);
      c = sumCard(host, "Your information", 0, which);
      rowsList(c, [["Birth year", v("birthYear")], ["Age this year", String(m.currentAge)], ["Working status", retired ? "Retired" : "Still working"], ["Asset mix", inp.tam === null ? "Not set" : "TAM " + inp.tam]]);
    }
    function savedCard() {
      c = sumCard(host, "Total saved", 3, which);
      el("p", "ra-sum-big", money(sumMoney(inp, ["balDeferred", "balTaxable", "balExempt"])), c);
      rowsList(c, taxSplit(inp).concat([["Added each year", retired ? "$0.00" : money(sumMoney(inp, ["contribDeferred", "contribTaxable", "contribExempt"]))]]));
    }
    function retireCard() {
      c = sumCard(host, "Retirement and expenses", 1, which);
      rowsList(c, [["Retirement age", retired ? "Retired" : String(m.retireAge)], ["Plan-to age", String(m.planAge)], ["Expenses a month", money(sumMoney(inp, ["essentialMonthly", "nonEssentialMonthly"]))]]);
      var d = el("details", null, null, c);
      el("summary", null, "Expense details", d);
      rowsList(d, [["Essential a month", v("essentialMonthly")], ["Non-essential a month", v("nonEssentialMonthly")], ["Tax rate assumption", v("taxRatePct") + "%"]]);
    }
    /* The inputs card follows the planning profile's order, which also pairs wells of like height in
       each row: your information with retirement, total saved with income. */
    if (single) { retireCard(); savedCard(); } else { savedCard(); retireCard(); }
    c = sumCard(host, "Retirement income", 4, which);
    rowsList(c, [["Social Security a month", v("ssMonthly")], ["Pension a month", v("pensionMonthly")], ["Annuity income a month", v("annuityMonthly")],
      ["Other income a month", money(sumRows(inp.other, "monthly"))], ["One-time income", money(sumRows(inp.oneTime, "amount"))]]);
  }

  function renderCompare() {
    var ra = state.results.A, rb = state.results.B, ca = condOf("A"), cb = condOf("B");
    var rows = RA.compare(ra, rb, state.cond).map(function (row) {
      function cell(v) { return v === null ? "None" : row.unit === "cents" ? money(v) : String(v); }
      var d = row.diff === null ? "No number to state" : row.unit === "cents" ? signedMoney(row.diff)
        : row.diff === 0 ? "0" : (row.diff > 0 ? "+" : "−") + plural(Math.abs(row.diff), row.unit === "count" ? "run" : "year", row.unit === "count" ? "runs" : "years");
      return [row.label, cell(row.a), cell(row.b), { text: d, cls: "ra-total" }];
    });
    var medRow = null;
    RA.compare(ra, rb, state.cond).forEach(function (row) { if (row.key === "savingsAtRetirement") medRow = row; });
    table($("ra-table-compare"), ["Figure", { text: "Scenario A", sw: "ra-sw-line ra-c-a" }, { text: "Scenario B", sw: "ra-sw-dash ra-c-b" }, "Difference, B minus A"], rows, -1);

    var ya = ca.years, yb = cb.years, y0 = Math.min(ya[0].year, yb[0].year), y1 = Math.max(ya[ya.length - 1].year, yb[yb.length - 1].year), yearsX = [], va = [], vb = [], y;
    for (y = y0; y <= y1; y++) {
      yearsX.push(y);
      va.push(ya[y - ya[0].year] ? ya[y - ya[0].year].savingsStart : null);
      vb.push(yb[y - yb[0].year] ? yb[y - yb[0].year].savingsStart : null);
    }
    $("ra-ab-chart-sub").textContent = "Total savings at the start of each year, " + y0 + " to " + y1 + ". Scenario A is the solid line marked A; Scenario B is the dashed line marked B.";
    function retireYear(r) { return r.meta.currentYear + Math.max(0, r.meta.retireAge - r.meta.currentAge); }
    Chart.lines($("ra-chart-compare"), {
      label: "Line chart of total savings by year for Scenario A and Scenario B, in today's dollars. " + (medRow ? medRow.label + ": A " + money(medRow.a) + ", B " + money(medRow.b) + ". " : "") + "The table below lists the differences.",
      ages: yearsX, prefix: "",
      series: [
        { values: va, cls: "ra-c-a", markIndex: retireYear(ra) - y0, markText: "A retires", endText: "A" },
        { values: vb, cls: "ra-c-b", markIndex: retireYear(rb) - y0, markText: "B retires", endText: "B" }],
      readout: function (i) {
        var items = [{ sw: "ra-sw-line ra-c-a", label: "Scenario A", value: va[i] === null ? "Outside the plan" : money(va[i]) }, { sw: "ra-sw-dash ra-c-b", label: "Scenario B", value: vb[i] === null ? "Outside the plan" : money(vb[i]) }];
        if (va[i] !== null && vb[i] !== null) items.push({ label: "B minus A", value: signedMoney(vb[i] - va[i]) });
        return { title: String(yearsX[i]), items: items };
      }
    });
    [["A", "ra-ab-a", "ra-sw-line ra-c-a"], ["B", "ra-ab-b", "ra-sw-dash ra-c-b"]].forEach(function (x) {
      var host = $(x[1]);
      clear(host);
      var tag = el("h3", "ra-h2 ra-ab-tag", null, host);
      el("span", "ra-sw " + x[2], null, tag).setAttribute("aria-hidden", "true");
      el("span", null, "Scenario " + x[0], tag);
      /* Each scenario that still holds the example's own mix says so, B as well as A. */
      var sc = state.inputs[x[0]];
      el("p", "ra-body", "Showing one run with " + condArt(state.cond) + " " + COND[state.cond] + " outcome, in today's dollars, using " + (x[0] === "A" ? mixTextGloss(sc.tam) : mixText(sc.tam)) + (sc.example && sc.tamExample ? ", the example's starting mix" : "") + ".", host);
      renderCards(el("div", "ra-cards", null, host), x[0], false);
      /* Each column card ends with the approved line, as its own element and its last child. */
      el("p", "ra-small ra-edu-line", EDU_LINE, host);
    });
  }

  function renderEmpty(which) {
    var list = $("ra-empty-list"), needMix = false, other = false, mixFor = null;
    clear(list);
    which.forEach(function (w) {
      state.problems[w].forEach(function (p) {
        var li = el("li", null, null, list), c = ctl[p.field];
        if (p.field === "tam") { needMix = true; if (mixFor === null) mixFor = w; } else other = true;
        var rowAt = /^(other|oneTime)\.(\d+)$/.exec(p.field), rowName = rowAt ? (rowAt[1] === "other" ? "Other income " : "One-time income ") + (parseInt(rowAt[2], 10) + 1) : "";
        var label = c ? (c.f.group ? c.f.group + ", " : "") + c.f.label : p.field === "tam" ? "Asset mix" : rowName && p.message.indexOf(rowName) !== 0 ? rowName : "";
        var text = (state.inputs.B ? "Scenario " + w + ". " : "") + (label ? label + ": " : "") + p.message;
        if (c || /^(other|oneTime)\./.test(p.field)) {
          var a = el("button", "ra-link", text, li);
          a.type = "button";
          a.addEventListener("click", function () {
            state.active = w; state.mode = "single"; fillProfile(); render();
            openPart(c ? c.f.part : 4); setScreen("profile", false);
            if (c) c.input.focus(); else focusForm(4);
          });
        } else li.textContent = text;
      });
    });
    /* Everything is in except the mix: the card asks for the mix and nothing else. An untouched
       example reaches this only when EXAMPLE_OPENS_WITH_MIX is false. */
    var onlyMix = needMix && !other, inp = mixFor ? state.inputs[mixFor] : null, untouched = !!inp && inp.example && !inp.edited;
    emptyMixFor = mixFor;
    $("ra-empty-h").textContent = !onlyMix ? "The analysis needs a few more details" : untouched ? "Choose a mix to run the example" : "Choose an asset mix";
    $("ra-empty").querySelector(".ra-note").textContent = !onlyMix ? "Fill in the planning profile and the illustration appears here. These are still missing or out of range:"
      : (untouched ? "The example inputs are filled in." : "The figures are in.") + " Pick any of the ten fixed mixes to see the illustration. The page does not pick one for you and does not suggest one.";
    /* With two scenarios the list stays, to say which scenario has no mix yet. */
    show(list, !onlyMix || !!state.inputs.B);
    $("ra-empty-mix").className = onlyMix ? "ra-btn ra-btn-primary" : "ra-link";
    show($("ra-empty-mix"), needMix);
  }

  function renderScenarioBar() {
    var hasB = !!state.inputs.B;
    show($("ra-tab-b"), hasB); show($("ra-tab-ab"), hasB); show($("ra-add-b"), !hasB); show($("ra-remove-b"), hasB);
    pressed($("ra-tab-a"), state.mode === "single" && state.active === "A");
    pressed($("ra-tab-b"), state.mode === "single" && state.active === "B");
    pressed($("ra-tab-ab"), state.mode === "compare");
    show($("ra-scen-note"), hasB);
    $("ra-scen-note").textContent = hasB ? "Scenario B starts as a copy of Scenario A, for you to change. Both draw from the same 500 simulated markets. The planning profile edits Scenario " + state.active + "." : "";
  }

  function render() {
    renderScenarioBar();
    renderProfile();
    renderSentence();
    var compare = state.mode === "compare";
    var need = compare ? ["A", "B"] : [state.active];
    var ok = need.every(function (w) { return !!state.results[w]; });
    show($("ra-empty"), !ok);
    show($("ra-single"), !compare && ok);
    show($("ra-compare"), compare && ok);
    /* The disclaimer sits directly under the hero figures, or directly under the Differences notes. */
    renderRmdNote();
    var disc = $("ra-disclaimer");
    if (compare && ok) $("ra-compare").insertBefore(disc, $("ra-ab"));
    else if (ok) $("ra-single").insertBefore(disc, $("ra-lower"));
    if (!ok) { renderEmpty(need); return; }
    if (state.screen !== "analysis") return;
    if (compare) renderCompare();
    else {
      renderView(); renderTiles();
      Array.prototype.forEach.call(document.querySelectorAll("[data-detail]"), function (n) { show(n, n.getAttribute("data-detail") === state.view); });
      clear($("ra-cards")); renderCards($("ra-cards"), state.active, true);
    }
  }

  function changed() {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(function () {
      pending = false;
      simulate(state.active);
      render();
      renderRmdNote();
    });
  }

  function selectTab(list, value, attr) {
    Array.prototype.forEach.call(list.querySelectorAll("[role=tab]"), function (b) {
      var on = b.getAttribute(attr) === value;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.setAttribute("tabindex", on ? "0" : "-1");
    });
  }
  function setScreen(name, focus) {
    state.screen = name;
    selectTab($("ra-screens"), name, "data-screen");
    show($("analysis"), name === "analysis"); show($("profile"), name === "profile");
    if (name === "profile" && state.openPart < 0) openPart(0);
    render();
    if (name === "profile") showPart();
    if (focus) { $("ra-screen-" + name).focus(); window.scrollTo(0, 0); }
  }

  /* ---------- the assumptions panel (drawn once; every label is read from RA_DATA.meta) ---------- */

  function renderAssumptions() {
    var stats = mixStats(), series = DATA.series || {}, meta = DATA.meta || {}, labels = [], keys = [], k;
    var w = stats.length ? stats[stats.length - 1].window : [DATA.firstYear, DATA.lastYear], span = w[0] + " to " + w[1];
    var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(DATA.readDate || "");
    function dayText(iso) { var x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return x ? parseInt(x[3], 10) + " " + MONTHS[parseInt(x[2], 10) - 1] + " " + x[1] : (iso || ""); }
    /* The table's own caption: fixed wording, with the window and the read date from the data file. */
    table($("ra-table-mixes"), ["Mix", "Split", "Average yearly return after inflation", "Spread of yearly returns (standard deviation)"], stats.map(function (t) {
      return ["TAM " + t.tam, splitText(t.tam), pctText(t.meanReal, 1), pctText(t.volatility, 1)];
    }), -1, "Computed by Stepwell from the series listed under Historical data used, " + span + ", read " + dayText(DATA.readDate) + ".");
    $("ra-end-low").textContent = "TAM 1: all cash. Smallest swings and lowest average return, " + span + ".";
    $("ra-end-high").textContent = "TAM 10: all stocks. Widest swings and highest average return, " + span + ".";
    var rows = [];
    for (k in series) {
      if (!Object.prototype.hasOwnProperty.call(series, k)) continue;
      var m = meta[k] || {};
      if (k !== "inflation") { labels.push(m.label || k); keys.push(k); }
      rows.push([m.label || k, m.measure || "", m.source || "", (m.firstYear || DATA.firstYear) + " to " + (m.lastYear || DATA.lastYear), dayText(m.readDate || DATA.readDate)]);
    }
    table($("ra-table-sources"), ["Series", "What it measures", "Source", "Years", "Read on"], rows, -1);
    /* Under the table: each source's own note on reuse, in full, as the data file words it. Series that
       share a note share a paragraph. Plain text only: the note is set as text, never as markup or a link. */
    var notesHost = $("ra-source-notes"), noteTexts = [], noteNames = [];
    clear(notesHost);
    for (k in series) {
      if (!Object.prototype.hasOwnProperty.call(series, k) || !meta[k] || !meta[k].licence) continue;
      var at = noteTexts.indexOf(meta[k].licence);
      if (at < 0) { noteTexts.push(meta[k].licence); noteNames.push([meta[k].label || k]); } else noteNames[at].push(meta[k].label || k);
    }
    noteTexts.forEach(function (text, i) {
      var p = el("p", "ra-body ra-source-note", null, notesHost);
      el("strong", null, noteNames[i].join("; ") + ".", p);
      p.appendChild(document.createTextNode(" " + text));
    });
    var note = $("ra-data-note");
    clear(note);
    note.appendChild(document.createTextNode("Historical returns from " + span + ", the years where every series has a value. Past years are drawn from this window only. International returns before 1975 are Stepwell's own estimate. Sources are named so the data can be checked. None of them made or reviewed this page, and none endorses it."));
    /* The one-line summary on the closed accordion: window, first source and how many more, read date. */
    var sources = [], first = meta.usLarge || meta[Object.keys(meta)[0]] || {};
    for (k in meta) if (Object.prototype.hasOwnProperty.call(meta, k) && meta[k].source && sources.indexOf(meta[k].source) < 0) sources.push(meta[k].source);
    $("ra-data-line").textContent = "Returns " + span + (first.source ? ", from the " + String(first.source).split(/ \(|,/)[0] + (sources.length > 1 ? " and others" : "") : "") +
      (d ? ", read " + parseInt(d[3], 10) + " " + MONTHS[parseInt(d[2], 10) - 1] + " " + d[1] : "") + ".";
    $("ra-cond-window").textContent = "drawn from historical returns from " + span;
    $("ra-disclaimer-years").textContent = span;
    var sp = DATA.stockSplit, us = DATA.usSplit;
    function pc(x) { return Math.round(parseFloat(x) * 100) + "%"; }
    if (sp && us) $("ra-mix-note").textContent += " Inside the stock part: " + pc(sp.us) + " US and " + pc(sp.intl) + " " + shortLabel("intl").toLowerCase() + ". Inside the US part: " + pc(us.large) + " large, " + pc(us.mid) + " mid and " + pc(us.small) + " small companies. Each group is defined in the table under Historical data used. International returns for 1950 to 1974 are Stepwell's own estimate built from national stock market histories; from 1975 they come from a published research index.";
  }
  function renderRmdNote() {
    var r = state.results[state.active];
    $("ra-rmd-note").textContent = !r ? "" : r.meta.rmdStartBasis === "before_rules" ? "RMDs for this birth year have already started."
      : "For Scenario " + state.active + " that age is " + r.meta.rmdStartAge + (r.meta.rmdStartProposed ? ", which comes from a proposed rule, not a final one." : ".");
  }

  /* ---------- events ---------- */

  var pendingTam = null, emptyMixFor = null, mixFromEmpty = false;
  /* "Choose an asset mix" in the empty card opens the dialog for the scenario that has no mix.
     mixFromEmpty records that, because a pointer or touch press may leave no focus on the card's button. */
  function openMixFromEmpty() {
    if (emptyMixFor && emptyMixFor !== state.active && state.inputs[emptyMixFor]) { state.active = emptyMixFor; fillProfile(); render(); }
    openMix();
    mixFromEmpty = true;
  }
  function openCond() {
    Array.prototype.forEach.call(document.querySelectorAll("input[name=ra-cond]"), function (r) { r.checked = r.value === state.cond; });
    $("ra-dialog-cond").showModal();
  }
  function openMix() {
    mixFromEmpty = false;
    pendingTam = cur().tam;
    Array.prototype.forEach.call(document.querySelectorAll("input[name=ra-tam]"), function (r) { r.checked = parseInt(r.value, 10) === pendingTam; });
    drawMix(cur().tam, $("ra-donut-now"), $("ra-mix-legend-now"), $("ra-mix-now-text"));
    drawPending();
    $("ra-dialog-mix").showModal();
  }
  /* The second donut appears only once the mix picked in the dialog differs from the one in use. */
  function drawPending() {
    var differs = pendingTam !== null && pendingTam !== cur().tam;
    show($("ra-donut-card-new"), differs);
    $("ra-donut-card-new").parentNode.classList.toggle("ra-donuts-one", !differs);
    if (differs) drawMix(pendingTam, $("ra-donut-new"), $("ra-mix-legend-new"), $("ra-mix-new-text"));
  }
  function tabKeys(list, attr, apply) {
    list.addEventListener("keydown", function (ev) {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight" && ev.key !== "Home" && ev.key !== "End") return;
      var tabs = Array.prototype.slice.call(list.querySelectorAll("[role=tab]")), i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      i = ev.key === "Home" ? 0 : ev.key === "End" ? tabs.length - 1 : (i + (ev.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      ev.preventDefault();
      apply(tabs[i].getAttribute(attr));
      tabs[i].focus();
    });
    Array.prototype.forEach.call(list.querySelectorAll("[role=tab]"), function (b) {
      b.addEventListener("click", function () { apply(b.getAttribute(attr)); });
    });
  }

  function wire() {
    var stops = $("ra-stops");
    RA.TAMS.forEach(function (t) {
      var lab = el("label", null, null, stops), r = el("input", null, null, lab);
      r.type = "radio"; r.name = "ra-tam"; r.value = String(t.tam);
      var text = el("span", null, "TAM " + t.tam, lab);
      el("small", null, t.cash === 100 ? "100% cash" : t.stocks + "% stocks", text);
      r.addEventListener("change", function () { pendingTam = t.tam; drawPending(); });
    });
    $("ra-pick-cond").addEventListener("click", openCond);
    $("ra-pick-cond-ab").addEventListener("click", openCond);
    $("ra-pick-mix").addEventListener("click", openMix);
    $("ra-empty-mix").addEventListener("click", openMixFromEmpty);
    Array.prototype.forEach.call(document.querySelectorAll("[data-close]"), function (b) {
      b.addEventListener("click", function () { b.closest("dialog").close(); });
    });
    /* Cancel or Esc in the mix dialog, opened from the "choose a mix" card that is still showing: focus goes back to the
       card's button, also when the press that opened the dialog left no focus on it. "Update analysis" clears
       mixFromEmpty before it closes the dialog, so this runs for a cancelled dialog only. */
    $("ra-dialog-mix").addEventListener("close", function () {
      var fromEmpty = mixFromEmpty, b = $("ra-empty-mix");
      mixFromEmpty = false;
      if (fromEmpty && !$("ra-empty").hasAttribute("hidden") && !b.hasAttribute("hidden")) b.focus();
    });
    $("ra-cond-update").addEventListener("click", function () {
      var r = document.querySelector("input[name=ra-cond]:checked");
      if (r) state.cond = r.value;
      $("ra-dialog-cond").close(); render();
    });
    $("ra-mix-update").addEventListener("click", function () {
      var inp = cur(), fromEmpty = mixFromEmpty;
      mixFromEmpty = false;
      /* Picking a mix is not an edit to the example's inputs, so it does not mark the example edited. */
      if (pendingTam !== null && pendingTam !== inp.tam) { inp.tam = pendingTam; inp.tamExample = false; simulate(state.active); }
      $("ra-dialog-mix").close(); render(); renderRmdNote();
      /* If the dialog was opened from the "choose a mix" card and that card has now gone, focus moves to the mix word in the
         sentence, for pointer, touch and keyboard alike: it does not depend on where focus was left when the dialog closed. */
      if ($("ra-empty").hasAttribute("hidden") && (fromEmpty || document.activeElement === $("ra-empty-mix") || document.activeElement === document.body)) (state.mode === "compare" ? $("ra-pick-cond-ab") : $("ra-pick-mix")).focus();
    });

    $("ra-view").addEventListener("change", function () { state.view = $("ra-view").value; render(); });
    tabKeys($("ra-viewtabs"), "data-tab", function (v) { state.tab = v; render(); });
    tabKeys($("ra-screens"), "data-screen", function (v) { setScreen(v, false); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-screen-go]"), function (b) {
      b.addEventListener("click", function () { setScreen(b.getAttribute("data-screen-go"), true); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-more]"), function (b) {
      b.addEventListener("click", function () { var v = b.getAttribute("data-more"); state.more[v] = !state.more[v]; render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-cols]"), function (b) {
      b.addEventListener("change", function () { state.cols[b.getAttribute("data-cols")] = b.checked; render(); });
    });
    $("ra-band").addEventListener("change", function () { state.band = $("ra-band").checked; render(); });

    function go(which, mode) {
      state.mode = mode;
      if (which) state.active = which;
      if (mode === "compare" && state.screen !== "analysis") setScreen("analysis", false);
      fillProfile(); render(); renderRmdNote();
    }
    $("ra-tab-a").addEventListener("click", function () { go("A", "single"); });
    $("ra-tab-b").addEventListener("click", function () { go("B", "single"); });
    $("ra-tab-ab").addEventListener("click", function () { go(null, "compare"); });
    function addB() {
      state.inputs.B = copyInputs(state.inputs.A);
      simulate("B");
      go("B", "single");
      $("ra-tab-b").focus();
      window.scrollTo(0, 0);
    }
    $("ra-add-b").addEventListener("click", addB);
    $("ra-remove-b").addEventListener("click", function () {
      state.inputs.B = null; state.results.B = null; state.problems.B = [];
      go("A", "single");
      $("ra-tab-a").focus();
    });
    /* A soft edge on the sticky first column once a table has been scrolled sideways. */
    Array.prototype.forEach.call(document.querySelectorAll(".ra-table-wrap"), function (w) {
      w.addEventListener("scroll", function () { w.classList.toggle("ra-scrolled", w.scrollLeft > 0); }, { passive: true });
    });
    $("ra-clear").addEventListener("click", function () {
      state.inputs[state.active] = emptyInputs();
      simulate(state.active); fillProfile(); render(); openPart(0);
      $("ra-restore").focus();
    });
    $("ra-restore").addEventListener("click", function () {
      state.inputs[state.active] = exampleInputs();
      simulate(state.active); fillProfile(); render(); renderRmdNote();
      $("ra-clear").focus();
    });

    var lastWidth = window.innerWidth, layoutPending = false;
    window.addEventListener("resize", function () {
      if (window.innerWidth === lastWidth || layoutPending) return;
      lastWidth = window.innerWidth; layoutPending = true;
      window.requestAnimationFrame(function () { layoutPending = false; render(); });
    });
  }

  function start() {
    /* The page runs only with every part loaded and a data file whose cleared flag is true. */
    if (!RA || !DATA || !Chart || DATA.cleared !== true) {
      show($("ra-empty"), true); show($("ra-single"), false);
      $("ra-empty-h").textContent = "The analysis could not start";
      $("ra-empty").querySelector(".ra-note").textContent = "Part of this page did not load. Reloading the page usually fixes it.";
      return;
    }
    buildProfile();
    wire();
    renderAssumptions();
    simulate("A");
    fillProfile();
    openPart(0);
    render();
    renderRmdNote();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
