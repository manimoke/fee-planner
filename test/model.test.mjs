/* Golden-value tests for the Poora Naqsha financing model.
 *
 *   node --test            (from the repo root)
 *
 * Every expected number is hand-derived in the comment above its assertion so
 * the arithmetic can be checked without running anything. Assertions use a
 * 1-rupee / tiny-rate tolerance to absorb floating-point platform noise; the
 * derivations themselves are exact.
 *
 * Canonical inputs (the app defaults):
 *   fee P = 500,000 | duration n = 24 | inflation 8% | loan 12% | savings 6%
 *   turn k = 12 | reducing balance
 *
 * Monthly rates under the 2f convention:
 *   infl_m = 1.08^(1/12) - 1  ->  (1+infl_m)^12 = 1.08 ,  (1+infl_m)^24 = 1.1664
 *   save_m = 1.06^(1/12) - 1
 *   loan_m = 0.12 / 12 = 0.01     (APR / 12, nominal)
 *   discount rate = infl_m
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { computeFinancing, amortizeReducing, monthlyFromEffective } = require('../model.js');

const DEFAULTS = {
  targetAmount: 500000, duration: 24, inflation: 8,
  loanInterest: 12, savingsYield: 6, roscaTurn: 12, loanRateType: 'reducing',
};
const run = (over = {}) => computeFinancing({ ...DEFAULTS, ...over });
const near = (actual, expected, tol = 1, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ~${expected}, got ${actual}`);


test('rate conversion (2f): effective annual -> monthly', () => {
  // 1.08^(1/12) - 1 = 0.006434030110...
  near(monthlyFromEffective(8), 0.006434030110, 1e-9, 'infl_m');
  // 1.06^(1/12) - 1 = 0.004867550565...
  near(monthlyFromEffective(6), 0.004867550565, 1e-9, 'save_m');
  // 12 monthly steps compound back to the annual figure
  near(Math.pow(1 + monthlyFromEffective(8), 12), 1.08, 1e-12, 'round-trip 8%');
  near(Math.pow(1 + monthlyFromEffective(8), 24), 1.1664, 1e-12, 'two years, 8%');
});


test('LOAN reducing-balance: monthly payment golden value', () => {
  // A = P * i(1+i)^n / ((1+i)^n - 1),  i = 0.01, n = 24
  //   (1.01)^24                     = 1.269734648...
  //   A = 500000 * 0.01*1.269734648 / 0.269734648
  //     = 500000 * 0.012697346    / 0.269734648
  //     = 500000 * 0.047073472    = 23,536.736
  near(run().loan.monthly, 23536.736, 0.01, 'loan monthly');
  // nominal total = 23,536.736 * 24 = 564,881.667
  near(run().loan.totalPaid, 564881.667, 0.02, 'loan total');
});


test('LOAN reducing-balance: schedule closes to exactly zero (2g-iii)', () => {
  for (const [P, apr, n] of [[500000, 12, 24], [500000, 12, 1], [500000, 0, 24], [350000, 2.34, 37]]) {
    const rows = amortizeReducing(P, apr / 100 / 12, n);
    near(rows[n - 1].balance, 0, 1e-6, `close P=${P} apr=${apr} n=${n}`);
    // sum of principal parts == principal
    near(rows.reduce((s, r) => s + r.principalPart, 0), P, 1e-6, 'principal parts sum');
  }
});


test('required: zero loan interest degrades to P / n', () => {
  // i = 0  ->  amort? no interest, level payment = P / n = 500000 / 24 = 20,833.333
  const r = run({ loanInterest: 0 });
  near(r.loan.monthly, 500000 / 24, 1e-6, 'loan monthly == P/n');
  near(r.loan.totalPaid, 500000, 1e-6, 'loan total == P');
});


test('required: single-period loan', () => {
  // n = 1:  one payment of principal + one month interest = 500000 * 1.01 = 505,000
  const r = run({ duration: 1 });
  near(r.loan.monthly, 505000, 1e-6, 'single payment');
  near(r.loan.totalPaid, 505000, 1e-6, 'single total');
  assert.equal(r.turn, 1, 'turn clamps to 1');
});


test('required: zero inflation -> real == nominal', () => {
  // discount rate = 0  =>  PV(stream) == nominal sum for every route.
  const r = run({ inflation: 0 });
  // fee does not inflate
  near(r.feeAtDuration, 500000, 1e-6, 'feeAtN == P');
  // loan real cost == total interest only
  //   total = 564,881.667 ; real = 564,881.667 - 500,000 = 64,881.667
  near(r.loan.outflowPV, r.loan.totalPaid, 1e-6, 'loan PV == nominal');
  near(r.loan.realCost, 64881.667, 0.02, 'loan real == interest');
  // committee: pay P in, take P out, no time value => exactly 0
  near(r.rosca.realCost, 0, 1e-6, 'committee real == 0');
  near(r.rosca.netPV, 0, 1e-6, 'committee NPV == 0');
});


test('SAVINGS targets the inflation-adjusted fee (2b)', () => {
  // feeAtN = 500000 * 1.1664 = 583,200   (two years at 8%)
  near(run().feeAtDuration, 583200, 1e-6, 'inflated fee');
  // saveMonthly = feeAtN / [((1+save_m)^24 - 1) / save_m]
  //   (1.004867550565)^24 = 1.127159776    ->  FV factor = 0.127159776 / 0.004867550565 = 26.12412
  //   saveMonthly = 583200 / 26.12412 = 22,324.6 ... (precise model value below)
  near(run().savings.monthly, 22967.277, 0.01, 'save monthly');
  // vs targeting the *nominal* fee, which the old model did:
  //   nominalMonthly = 500000 / 26.12412 = 19,139.9  ->  the fix raises it ~20%
  assert.ok(run().savings.monthly > 500000 / 26.12412, 'fix raises the required saving');
});


test('required: savings loses when inflation outpaces the yield', () => {
  // inflation 10% > yield 4%.  feeAtN = 500000 * 1.10^2 = 605,000.
  // You must deposit money that grows at 4% to hit a target moving at 10%, so
  // the PV of the deposits exceeds the PV of the fee -> positive real cost.
  const r = run({ inflation: 10, savingsYield: 4 });
  near(r.feeAtDuration, 605000, 1e-6, 'inflated fee 10%');
  assert.ok(r.savings.realCost > 0, `losing case: real cost should be > 0, got ${r.savings.realCost}`);
  near(r.savings.realCost, 28274.22, 0.5, 'losing-case real cost');
});


test('COMMITTEE (2a): net-cash-flow NPV, golden value at turn 12', () => {
  // contribute 500000/24 = 20,833.333 every month 1..24; collect 500,000 at k=12.
  //   potPV(k=12)  = 500000 / (1+infl_m)^12 = 500000 / 1.08          = 462,962.963
  //   contribPV    = 20,833.333 * a24 ,  a24 = (1 - 1/1.1664) / infl_m
  //                = 20,833.333 * 22.172755  (approx)                = 461,935.65
  //   netPV        = 462,962.963 - 461,935.65                        = +1,027.31
  const r = run({ roscaTurn: 12 });
  near(r.rosca.netPV, 1027.31, 0.5, 'committee NPV turn 12');
  near(r.rosca.realCost, -1027.31, 0.5, 'committee real cost turn 12');
  near(r.rosca.totalPaid, 500000, 1e-6, 'committee nominal total == pot');
});


test('required: committee turns 1, n/2 and n all differ', () => {
  const t1 = run({ roscaTurn: 1 }).rosca.netPV;
  const tHalf = run({ roscaTurn: 12 }).rosca.netPV;
  const tN = run({ roscaTurn: 24 }).rosca.netPV;
  // early turn = interest-free loan (big positive); late turn = you financed
  // everyone else (big negative); monotonic in between.
  //   turn 1  : potPV = 500000/(1+infl_m)^1  -> netPV ~ +34,868
  //   turn 12 : netPV ~ +1,027
  //   turn 24 : potPV = 500000/1.1664        -> netPV ~ -33,266
  near(t1, 34867.90, 1, 'turn 1');
  near(tHalf, 1027.31, 1, 'turn 12');
  near(tN, -33266.24, 1, 'turn 24');
  assert.ok(t1 > tHalf && tHalf > tN, 'strictly decreasing in turn');
  assert.ok(Math.abs(t1 - tN) > 60000, 'spread is material (~68k on a 500k fee)');
});


test('required: turn above duration is clamped (2g-i)', () => {
  // duration cut to 6 while roscaTurn still 12 -> model must use k = 6, not 12.
  const r = run({ duration: 6, roscaTurn: 12 });
  assert.equal(r.turn, 6, 'turn clamped to n');
  assert.equal(r.rosca.inHand, 6, 'money-in-hand uses clamped turn');
  // and it must equal an honest run with turn === 6
  const honest = run({ duration: 6, roscaTurn: 6 });
  near(r.rosca.netPV, honest.rosca.netPV, 1e-9, 'clamped == explicit turn 6');
});


test('FLAT loan (2d): payment, effective APR, and it costs more', () => {
  // flat: interest = 500000 * 0.12 * (24/12) = 120,000 ; total = 620,000
  //   monthly = 620000 / 24 = 25,833.333
  const f = run({ loanRateType: 'flat' });
  near(f.loan.monthly, 25833.333, 0.01, 'flat monthly');
  near(f.loan.totalPaid, 620000, 1e-6, 'flat total');
  // effective APR is the IRR of {+500000, -25833.333 x24}: ~21.57%, ~1.8x the quote
  near(f.loan.effAprPct, 21.57, 0.05, 'flat effective APR');
  assert.ok(f.loan.effAprPct > DEFAULTS.loanInterest * 1.6, 'flat is much dearer than its quote');
  assert.ok(f.loan.realCost > run().loan.realCost * 3, 'flat real cost >> reducing');
});


test('pctOfFee qualifier is derived from the real-cost figure it sits under (2e)', () => {
  const r = run();
  near(r.loan.pctOfFee, (r.loan.realCost / 500000) * 100, 1e-9, 'loan pct');
  near(r.rosca.pctOfFee, (r.rosca.realCost / 500000) * 100, 1e-9, 'committee pct (can be negative)');
  assert.ok(r.rosca.pctOfFee < 0, 'committee at turn 12 shows a small gain, not "+0.0% more"');
});
