/* =============================================================================
 *  POORA NAQSHA — FINANCING MODEL
 *
 *  Pure functions, no DOM, no framework. Loaded as a plain <script> by
 *  index.html (globals) and require()'d by test/model.test.mjs (module.exports).
 *
 *  Rate conventions (2f) — a deliberate choice per input:
 *    * inflation and savings yield are quoted as EFFECTIVE ANNUAL rates.
 *      Monthly equivalent: (1 + r)^(1/12) - 1.
 *    * loan interest is a quoted APR (nominal, compounded monthly), so the
 *      monthly rate is r / 12 — this is how lenders in this market actually
 *      cut an amortization schedule.
 *    * every route is discounted at the inflation rate: a rupee next year is
 *      worth less to a family whose fee rises with inflation.
 *
 *  Rounding policy (2g-ii): all arithmetic runs in floating-point rupees with
 *  NO intermediate rounding. Figures are rounded to whole rupees only at the
 *  presentation boundary, by rupees() in index.html's render layer.
 *
 *  "Real cost of a route" (2c): PV(everything you pay) minus PV(the fee, valued
 *  in the month that route puts the money in your hands). Lower is better; a
 *  negative number means the route leaves you ahead in today's money. Reported
 *  next to "money in hand" (months until you hold the fee), because for a family
 *  with a due date, timing can outweigh rupees.
 * ============================================================================= */

function monthlyFromEffective(annualPct) {
  return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
}

// Reducing-balance amortization. The final instalment absorbs any floating-point
// residual so the balance closes to exactly 0 (2g-iii).
function amortizeReducing(principal, monthlyRate, months) {
  const base = monthlyRate === 0
    ? principal / months
    : principal * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
  const rows = [];
  let balance = principal;
  for (let m = 1; m <= months; m++) {
    const interest = balance * monthlyRate;
    let principalPart = base - interest;
    let payment = base;
    if (m === months) { principalPart = balance; payment = balance + interest; }
    balance -= principalPart;
    rows.push({ month: m, payment, interest, principalPart, balance });
  }
  return rows;
}

// Flat-rate loan (2d): total interest = principal x annualRate x years, added up
// front and split evenly. Widely quoted in this market and close to double the
// effective cost of an equivalently-quoted reducing-balance loan.
function flatSchedule(principal, annualPct, months) {
  const totalInterest = principal * (annualPct / 100) * (months / 12);
  const payment = (principal + totalInterest) / months;
  const rows = [];
  let balance = principal + totalInterest;
  for (let m = 1; m <= months; m++) {
    balance -= payment;
    rows.push({ month: m, payment, balance: Math.max(0, balance) });
  }
  return rows;
}

// Effective monthly rate on a stream of `payment` for `months` against
// `principal` received now, solved by bisection on NPV. Used to show the true
// APR behind a flat quote (2d).
function effectiveMonthlyRate(principal, payment, months) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 128; i++) {
    const r = (lo + hi) / 2;
    let npv = -principal;
    for (let m = 1; m <= months; m++) npv += payment / Math.pow(1 + r, m);
    if (npv > 0) lo = r; else hi = r;
  }
  return (lo + hi) / 2;
}

function computeFinancing({ targetAmount, duration, inflation, loanInterest, savingsYield, roscaTurn, loanRateType }) {
  const P = Math.max(0, targetAmount);
  const n = Math.max(1, Math.round(duration));
  // 2g-i: the turn slider's max tracks duration, so cutting duration can leave a
  // stale, out-of-range turn in state. Clamp once, here, for every consumer.
  const k = Math.min(Math.max(1, Math.round(roscaTurn)), n);

  const infl_m = monthlyFromEffective(inflation);
  const save_m = monthlyFromEffective(savingsYield);
  const loan_m = (loanInterest / 100) / 12;
  const disc_m = infl_m;

  const pv = (amount, month) => amount / Math.pow(1 + disc_m, month);
  const pvStream = (pmt, from, to) => {
    let s = 0;
    for (let m = from; m <= to; m++) s += pv(pmt, m);
    return s;
  };
  const pctOfFee = (v) => (P > 0 ? (v / P) * 100 : 0);

  // ---- LOAN: fee is in hand at month 0, repaid over n months ----
  const isFlat = loanRateType === 'flat';
  const loanRows = isFlat ? flatSchedule(P, loanInterest, n) : amortizeReducing(P, loan_m, n);
  const loanMonthly = loanRows[0].payment;
  const loanNominalTotal = loanRows.reduce((s, r) => s + r.payment, 0);
  const loanClosingBalance = loanRows[n - 1].balance;
  const loanEffAprPct = isFlat ? effectiveMonthlyRate(P, loanMonthly, n) * 12 * 100 : loanInterest;
  const loanOutflowPV = loanRows.reduce((s, r) => s + pv(r.payment, r.month), 0);
  const loanRealCost = loanOutflowPV - pv(P, 0);

  // ---- SAVINGS: save toward the INFLATED fee, in hand at month n (2b) ----
  const feeAtN = P * Math.pow(1 + infl_m, n);
  const fvFactor = save_m === 0 ? n : (Math.pow(1 + save_m, n) - 1) / save_m;
  const saveMonthly = feeAtN / fvFactor; // ordinary annuity: deposits at month end
  const saveNominalTotal = saveMonthly * n;
  const saveOutflowPV = pvStream(saveMonthly, 1, n);
  const saveRealCost = saveOutflowPV - pv(feeAtN, n); // pv(feeAtN, n) === P by construction

  // ---- COMMITTEE (ROSCA) — explicit net cash-flow series (2a) ----
  // Contribute pot/n every month 1..n INCLUDING the month you collect (standard
  // in Pakistani committees); collect the whole pot in month k. Assumptions,
  // made explicit: the committee runs n members over n months and the pot equals
  // the fee amount.
  const roscaMonthly = P / n;
  const roscaContribPV = pvStream(roscaMonthly, 1, n);
  const roscaPotPV = pv(P, k);
  const roscaNetPV = roscaPotPV - roscaContribPV; // > 0 means you are ahead
  const roscaRealCost = -roscaNetPV;
  const roscaNominalTotal = roscaMonthly * n; // === P

  // ---- cumulative cash PAID (outflow chart) ----
  const cashOut = [];
  let loanCum = 0, saveCum = 0, roscaCum = 0;
  for (let m = 1; m <= n; m++) {
    loanCum += loanRows[m - 1].payment;
    saveCum += saveMonthly;
    roscaCum += roscaMonthly;
    cashOut.push({ month: m, loan: loanCum, savings: saveCum, rosca: roscaCum });
  }

  const mk = (realCost, monthly, nominalTotal, outflowPV, inHand, extra) => ({
    realCost, monthly, totalPaid: nominalTotal, outflowPV, inHand,
    pctOfFee: pctOfFee(realCost), ...(extra || {}),
  });

  return {
    turn: k,
    feeNow: P,
    feeAtDuration: feeAtN,
    loan: mk(loanRealCost, loanMonthly, loanNominalTotal, loanOutflowPV, 0, {
      rateType: isFlat ? 'flat' : 'reducing', effAprPct: loanEffAprPct, closingBalance: loanClosingBalance,
    }),
    savings: mk(saveRealCost, saveMonthly, saveNominalTotal, saveOutflowPV, n, {}),
    rosca: mk(roscaRealCost, roscaMonthly, roscaNominalTotal, roscaContribPV, k, { netPV: roscaNetPV }),
    cashOutflow: cashOut,
    loanSchedule: loanRows,
    costData: [
      { key: 'loan', name: 'Amortized Loan', value: loanRealCost, inHand: 0, color: 'var(--loan)' },
      { key: 'savings', name: 'Compound Savings', value: saveRealCost, inHand: n, color: 'var(--savings)' },
      { key: 'rosca', name: 'Committee (ROSCA)', value: roscaRealCost, inHand: k, color: 'var(--rosca)' },
    ],
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { monthlyFromEffective, amortizeReducing, flatSchedule, effectiveMonthlyRate, computeFinancing };
}
