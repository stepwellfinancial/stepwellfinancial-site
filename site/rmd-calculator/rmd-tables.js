/* rmd-tables.js: DATA ONLY. No logic. rmd.js reads this and nothing else for figures.
 *
 * To drop in verified data (docs/rmd-source-data/irs-tables-2026-11-14.json), replace the
 * values below. Do not change rmd.js.
 *
 *   TABLE_III      Uniform Lifetime Table: divisors for ages START..END, in order. Ages above END
 *                  use the last value. Source: Pub 590-B Appendix B, Table III.
 *   TABLE_II       Joint Life and Last Survivor Table. null means "not loaded": the spouse option
 *                  is hidden and the page says the calculator covers the Uniform Lifetime Table only.
 *                  When loaded it is an object { "<owner age>": { "<spouse age>": divisor } }.
 *                  Load it only after the full table passes a two-source compare.
 *   START_AGE_RULES  Start age by birth year. confirmed_on_irs_page is false when the rule was read
 *                  somewhere other than an irs.gov page. proposed is true when the rule is not final.
 *   SOURCES        Rows of the sources table on the page (and of docs/figure-review-tracker.md).
 */
(function (root, factory) {
  "use strict";
  var data = factory();
  if (typeof module === "object" && module.exports) module.exports = data;
  else root.RmdTables = data;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  return {
    PUBLICATION: "IRS Publication 590-B, 2025 edition (for use in preparing 2025 returns); its examples are for 2026 distributions",
    TAX_YEAR: "2025 edition of Pub 590-B, used for 2026 distributions",
    REVIEW_DATE: "2026-11-14",
    NEXT_REVIEW: "2027-01-15",
    SOURCE_LINE: "https://www.irs.gov/publications/p590b (Appendix B, Table III, Uniform Lifetime Table)",

    TABLE_III: {
      startAge: 72,
      endAge: 120,
      divisors: [
        27.4, 26.5, 25.5, 24.6, 23.7, 22.9, 22.0, 21.1, 20.2, 19.4,
        18.5, 17.7, 16.8, 16.0, 15.2, 14.4, 13.7, 12.9, 12.2, 11.5,
        10.8, 10.1, 9.5, 8.9, 8.4, 7.8, 7.3, 6.8, 6.4, 6.0,
        5.6, 5.2, 4.9, 4.6, 4.3, 4.1, 3.9, 3.7, 3.5, 3.4,
        3.3, 3.1, 3.0, 2.9, 2.8, 2.7, 2.5, 2.3, 2.0
      ]
    },

    TABLE_II: null,

    START_AGE_RULES: [
      {
        fromYear: 1951, toYear: 1958, age: 73, proposed: false, confirmed_on_irs_page: true,
        note: "Final regulations (T.D. 10001, 2024): born 1951 through 1958, age 73.",
        source: "https://www.irs.gov/irb/2024-33_IRB"
      },
      {
        fromYear: 1959, toYear: 1959, age: 73, proposed: true, confirmed_on_irs_page: false,
        note: "For people born in 1959 the IRS rule was still proposed, not final, when we checked on 14 Nov 2026. The proposed rule says age 73.",
        source: "https://www.irs.gov/irb/2024-33_IRB"
      },
      {
        fromYear: 1960, toYear: 9999, age: 75, proposed: false, confirmed_on_irs_page: true,
        note: "Final regulations (T.D. 10001, 2024): born 1960 or later, age 75.",
        source: "https://www.irs.gov/irb/2024-33_IRB"
      }
    ],

    /* What an irs.gov page confirms about the start age. */
    START_AGE_CONFIRMED: {
      text: "IRS Publication 590-B confirms age 73 for tax years 2023 and later.",
      source: "https://www.irs.gov/publications/p590b",
      confirmed_on_irs_page: true
    },

    MIN_BIRTH_YEAR: 1951,

    EDUCATION_LINE: "For education only, not financial advice. This is not tax or legal advice either. Figures are from the IRS and Social Security sources listed below, for the tax year shown. Your own situation can differ; a tax professional or the plan administrator can confirm your number.",

    SOURCES: [
      { figure: "Publication used", value: "2025 edition of Pub 590-B; its examples are for 2026 distributions", url: "https://www.irs.gov/publications/p590b", taxYear: "2025 pub, 2026 RMDs", retrieved: "2026-11-14", nextReview: "2027-01-15" },
      { figure: "Uniform Lifetime Table (Table III)", value: "Divisors for ages 72 to 120 and over, from 27.4 down to 2.0", url: "https://www.irs.gov/publications/p590b", taxYear: "2025 pub, used for 2026", retrieved: "2026-11-14", nextReview: "2027-01-15" },
      { figure: "Start age", value: "Age 73 for tax years 2023 and later; age 72 for 2020, 2021 or 2022", url: "https://www.irs.gov/publications/p590b", taxYear: "2025", retrieved: "2026-11-14", nextReview: "2027-01-15" },
      { figure: "Start age by birth year", value: "Born 1951 to 1958: 73. Born 1960 or later: 75. Born 1959: proposed rule, not final, 73. From IRB 2024-33 (final regulation T.D. 10001, 12 Aug 2024)", url: "https://www.irs.gov/irb/2024-33_IRB", taxYear: "Regulations of 2024", retrieved: "2026-11-14", nextReview: "2027-01-15" },
      { figure: "First payment by 1 April", value: "The first RMD may be delayed to 1 April of the next year; later RMDs are due by 31 December", url: "https://www.irs.gov/publications/p590b", taxYear: "2025 and 2026", retrieved: "2026-11-14", nextReview: "2027-01-15" },
      { figure: "How an RMD is worked out", value: "Account balance at close of business on 31 December of the preceding year, divided by the divisor", url: "https://www.irs.gov/publications/p590b", taxYear: "2025", retrieved: "2026-11-14", nextReview: "2027-01-15" },
      { figure: "Tax on a missed RMD", value: "25% excise tax on the amount not distributed; 10% if corrected in time (the IRS RMD FAQs, question 8, say within two years; Pub 590-B gives the exact end of the window)", url: "https://www.irs.gov/publications/p590b", taxYear: "2025", retrieved: "2026-11-14", nextReview: "2027-01-15" },
      { figure: "Waiver of the tax", value: "The IRS may waive it for a reasonable error; the request uses Form 5329 and a statement of explanation.", url: "https://www.irs.gov/publications/p590b", taxYear: "2025", retrieved: "2026-11-14", nextReview: "2027-01-15" },
      { figure: "Roth IRA owner", value: "The original owner does not have to take distributions at any age", url: "https://www.irs.gov/publications/p590b", taxYear: "2025", retrieved: "2026-11-14", nextReview: "2027-01-15" },
      { figure: "Roth 401(k)", value: "RMD rules do not apply to designated Roth accounts while the owner is alive", url: "https://www.irs.gov/retirement-plans/retirement-plan-and-ira-required-minimum-distributions-faqs", taxYear: "2024 onward", retrieved: "2026-11-14", nextReview: "2027-01-15" },
      { figure: "Conversion is taxed", value: "Converted amounts are normally included in income for the year converted", url: "https://www.irs.gov/publications/p590a", taxYear: "2025", retrieved: "2026-11-14", nextReview: "2027-01-15" },
      { figure: "An RMD cannot be converted", value: "Amounts that must be distributed from a traditional IRA for a year cannot be converted (Pub 590-A); they are not eligible for rollover treatment (Pub 590-B)", url: "https://www.irs.gov/publications/p590a", taxYear: "2025", retrieved: "2026-11-14", nextReview: "2027-01-15" },
      { figure: "Five-year rules", value: "Two different rules: one for qualified Roth distributions, one for the 10% additional tax on converted amounts", url: "https://www.irs.gov/publications/p590b", taxYear: "2025", retrieved: "2026-11-14", nextReview: "2027-01-15" },
      { figure: "Medicare Part B standard premium and income look-back", value: "$202.90 a month in 2026, or higher depending on income; 2026 income-related amounts generally use the tax return filed in 2025 for tax year 2024. Income thresholds are not shown because they could not be confirmed", url: "https://www.ssa.gov/benefits/medicare/medicare-premiums.html", taxYear: "2026", retrieved: "2026-11-14", nextReview: "2027-01-15" }
    ]
  };
});
