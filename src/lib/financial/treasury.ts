import type { Account } from "@/types/financial";
import type { CalendarEvent, FinancialCalendar } from "@/lib/financial/financial-calendar";
import { isLiquidSpendable } from "@/lib/financial/liquidity";
import { roundMoney } from "@/lib/financial/money";

// Stage F — TESORERÍA ("Dónde está tu plata"). PURE. The Saldo answers "how
// much can I spend"; this answers "and WHERE is that money physically, where
// SHOULD it be, and what moves get me there". Per-account day-by-day curves
// from the SAME calendar the projection walks (one truth, two resolutions),
// operational floors, the ideal distribution (= the state after the
// recommended moves), the physical homes of the Saldo+Reserva, and a
// withdrawal planner ("saca 3,000$ de la Reserva hacia Wells").
// RECOMMEND-ONLY by design: this module never moves money — it produces moves
// the USER makes (and then logs as real transfers).

/** Operational cushion per account: N days of that account's own everyday burn. */
const BUFFER_DAYS = 5;
/** Ignore dust when proposing moves. */
const MIN_MOVE = 5;
/** Only an account that genuinely carries the everyday life keeps a spending
 *  cushion. A trace share (one stray cash expense) must not mint a standing
 *  floor, and a spend-through cash account never pre-funds an obligation. */
const MIN_EVERYDAY_SHARE = 0.15;

export type ShareConfidence = "high" | "medium" | "low" | "none";

/** One dated slice of an account's own shortfall: how much it needs BY WHEN. The
 *  first tranche is the next/urgent one; the rest are upcoming (later this cycle).
 *  Sums to the account's total shortfall (−surplus). Lets Kipu urge only what's
 *  due next ("744 antes del 22") and surface the rest as "y luego / o todo de una",
 *  instead of collapsing the whole month onto the earliest deadline. */
export interface ShortfallTranche {
  amount: number;
  byDateISO: string | null;
  obligations: string[];
}

export interface TreasuryAccountState {
  accountId: string;
  name: string;
  type: Account["type"];
  currency: string;
  /** Current balance (base). */
  balance: number;
  /** What this account needs to hold TODAY to cover its own dated flows over
   *  the horizon (max cumulative deficit) + its buffer. */
  floor: number;
  buffer: number;
  /** balance − floor. Negative = this account is SHORT (needs a move in). */
  surplus: number;
  /** Lowest projected own balance over the horizon (with today's balance). */
  trough: number;
  /** First day its own balance dips below 0 (null = never within horizon). */
  firstShortfallDateISO: string | null;
  /** Up to 3 human labels of the nearest dated outflows funded here. */
  nextObligations: string[];
  /** Share of the everyday variable burn attributed here (learned). */
  everydayShare: number;
  /** Wallet-type friction money (PayPal-like): usable only after a manual move. */
  deadPocket: boolean;
  /** Some undeclared events were attributed here by assumption. */
  hasAssumedEvents: boolean;
  /** Dated schedule of this account's shortfall (empty when not short). First =
   *  urgent/next; the rest come due later in the cycle. Σ = −surplus. */
  shortfallSchedule: ShortfallTranche[];
  /** Positive free money left AFTER the urgent moves earmark their share —
   *  what a withdrawal/plan can really take without breaking anything. */
  availableAfterEarmarks: number;
}

export interface TreasuryMove {
  fromAccountId: string;
  fromName: string;
  toAccountId: string;
  toName: string;
  amount: number; // base
  /** Deadline (first shortfall of the receiving account); null = ordering move. */
  byDateISO: string | null;
  /** Human reason: obligation labels or the dead-pocket cleanup. */
  reason: string;
  urgent: boolean;
  crossesCurrency: boolean;
}

export interface TreasuryLayerHome {
  accountId: string;
  name: string;
  amount: number; // the free-above-floor money living here (base)
}

export interface TreasurySnapshot {
  /** Liquid spendable accounts only, shortfalls first then by balance desc. */
  accounts: TreasuryAccountState[];
  /** Minimal recommended moves: cover shortfalls, then drain dead pockets. */
  moves: TreasuryMove[];
  totalLiquid: number;
  totalFloors: number;
  /** totalLiquid − totalFloors: the money with no dated job — physically, this
   *  is where the Saldo + Reserva live. Negative → global shortage. */
  freeAboveFloors: number;
  globalShortage: number;
  /** Where the free money lives (above-floor per account, desc). */
  layerHomes: TreasuryLayerHome[];
  /** Ideal balance per account = the state AFTER the recommended moves. */
  ideal: { accountId: string; name: string; amount: number; pct: number }[];
  shareConfidence: ShareConfidence;
}

export interface WithdrawalPlan {
  feasible: boolean;
  targetAmount: number;
  destinationAccountId: string;
  destinationName: string;
  /** Free money already sitting in the destination (counts toward the target). */
  alreadyThere: number;
  moves: TreasuryMove[];
  /** Unfunded remainder after every account's free money (0 when feasible). */
  shortfall: number;
  /** Which layer the withdrawal dips into, per the ENGINE's saldo/reserva. */
  layerCrossed: "none" | "reserva" | "beyond_reserva";
}

export interface EverydaySpendSample {
  sourceAccountId: string | null;
  baseAmount: number; // positive spend
}

export interface AccountShares {
  /** accountId → share of the everyday variable burn, sums to 1 over keys. */
  shares: Map<string, number>;
  confidence: ShareConfidence;
  sampleCount: number;
}

// ── Learned attribution ────────────────────────────────────────────────────────
// Which account pays the user's everyday life? The ledger knows: weight recent
// everyday spend (variable essentials + gustos) by amount per source account.
// No declarations, no guesses presented as facts — a low sample tags itself.
export function learnAccountShares(samples: EverydaySpendSample[], liquidAccounts: Account[]): AccountShares {
  const liquidIds = new Set(liquidAccounts.map((a) => a.id));
  const byAccount = new Map<string, number>();
  let total = 0;
  let count = 0;
  for (const s of samples) {
    if (!s.sourceAccountId || !liquidIds.has(s.sourceAccountId) || !(s.baseAmount > 0)) continue;
    byAccount.set(s.sourceAccountId, (byAccount.get(s.sourceAccountId) ?? 0) + s.baseAmount);
    total += s.baseAmount;
    count += 1;
  }
  if (total <= 0 || byAccount.size === 0) {
    // Nothing learned: fall back to the largest liquid non-wallet balance (the
    // most plausible everyday account), flagged as unlearned.
    const fallback = [...liquidAccounts]
      .filter((a) => a.type !== "wallet")
      .sort((a, b) => b.currentBalanceBase - a.currentBalanceBase)[0] ?? liquidAccounts[0];
    return {
      shares: fallback ? new Map([[fallback.id, 1]]) : new Map(),
      confidence: "none",
      sampleCount: 0,
    };
  }
  const shares = new Map<string, number>();
  for (const [id, amt] of byAccount) shares.set(id, amt / total);
  const top = Math.max(...shares.values());
  const confidence: ShareConfidence = count >= 15 && top >= 0.6 ? "high" : count >= 6 ? "medium" : "low";
  return { shares, confidence, sampleCount: count };
}

// ── The snapshot ───────────────────────────────────────────────────────────────

export interface BuildTreasuryInput {
  accounts: Account[];
  calendar: FinancialCalendar;
  /** Monthly everyday (variable essential) estimate, base. Burn is spread by shares. */
  monthlyEssentialEstimate: number;
  accountShares: AccountShares;
  now?: Date;
  bufferDays?: number;
}

/** Strip the redundant "(pago del mes)" suffix so obligation labels read clean
 *  in the move copy — no "(Visa Pichincha NT (pago del mes))" nested parens. */
function cleanObligation(label: string): string {
  return label.replace(/\s*\(pago del mes\)\s*$/i, "").trim();
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function buildTreasury(input: BuildTreasuryInput): TreasurySnapshot {
  const now = input.now ?? new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const bufferDays = input.bufferDays ?? BUFFER_DAYS;
  const liquid = input.accounts.filter(isLiquidSpendable);
  const horizonDays = input.calendar.horizonDays;
  const dailyEssential = Math.max(0, input.monthlyEssentialEstimate) / 30;

  // Everyday-burn share per liquid account (learned; keys outside liquid are dropped).
  const shareOf = (id: string) => input.accountShares.shares.get(id) ?? 0;

  // Undeclared events go to the account that pays the everyday life (top share;
  // fallback: biggest non-wallet balance) — flagged as assumed, never silent.
  const topShareId =
    [...input.accountShares.shares.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    [...liquid].filter((a) => a.type !== "wallet").sort((a, b) => b.currentBalanceBase - a.currentBalanceBase)[0]?.id ??
    liquid[0]?.id ??
    null;

  // The single non-cash account that most carries the everyday life, so even a
  // fragmented-share user has ONE account holding the burn cushion.
  const topEverydayNonCashId =
    [...input.accountShares.shares.entries()]
      .filter(([id]) => liquid.some((a) => a.id === id && a.type !== "cash"))
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const liquidIds = new Set(liquid.map((a) => a.id));
  const eventsFor = new Map<string, CalendarEvent[]>();
  const assumed = new Set<string>();
  for (const e of input.calendar.events) {
    if (!e.cashflowAffecting || e.daysFromNow < 0 || e.daysFromNow > horizonDays) continue;
    let home = e.accountId && liquidIds.has(e.accountId) ? e.accountId : null;
    if (!home) {
      if (!topShareId) continue;
      home = topShareId;
      assumed.add(home);
    }
    const list = eventsFor.get(home);
    if (list) list.push(e);
    else eventsFor.set(home, [e]);
  }

  const states: TreasuryAccountState[] = liquid.map((account) => {
    const events = eventsFor.get(account.id) ?? [];
    const share = shareOf(account.id);
    // Cash is spend-through (refilled at an ATM, never pre-funded as an
    // obligation) and a trace share must not create a standing floor: only a
    // real everyday account carries the burn cushion.
    const carriesEveryday =
      account.type !== "cash" && (share >= MIN_EVERYDAY_SHARE || account.id === topEverydayNonCashId);
    const dailyBurn = carriesEveryday ? share * dailyEssential : 0;
    const netByDay = new Map<number, number>();
    for (const e of events) netByDay.set(e.daysFromNow, (netByDay.get(e.daysFromNow) ?? 0) + e.signedAmount);

    // Own curve: cumulative net − own burn, day by day. minNet drives floor/trough.
    let runningNet = 0;
    let minNet = 0;
    let firstShortfallDateISO: string | null = null;
    for (let d = 0; d <= horizonDays; d++) {
      runningNet += netByDay.get(d) ?? 0;
      const netAfterBurn = runningNet - dailyBurn * (d + 1);
      if (netAfterBurn < minNet) minNet = netAfterBurn;
      if (firstShortfallDateISO === null && account.currentBalanceBase + netAfterBurn < 0) {
        firstShortfallDateISO = isoOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() + d));
      }
    }
    const buffer = roundMoney(bufferDays * dailyBurn);
    const balance = roundMoney(account.currentBalanceBase);
    // Cash is spend-through (refilled at an ATM, never pre-funded by transfer),
    // so it can never read as "short" and never becomes a move target — its
    // floor never exceeds what it holds. The obligation stays reserved globally
    // in the Saldo; the treasury just never says "move money into cash".
    const rawFloor = Math.max(0, -minNet) + buffer;
    const floor = roundMoney(account.type === "cash" ? Math.min(rawFloor, balance) : rawFloor);
    const nextObligations = events
      .filter((e) => e.signedAmount < 0)
      .sort((a, b) => a.daysFromNow - b.daysFromNow)
      .slice(0, 3)
      .map((e) => cleanObligation(e.label));
    // Schedule-aware shortfall: decompose the account's own deficit into dated
    // tranches (how much it needs BY WHEN). Each new low of its projected balance
    // below 0 is one tranche, tagged with that day's obligations. Cash never
    // schedules (spend-through). The undated buffer cushion folds into the first
    // tranche so the schedule sums to the full shortfall (−surplus).
    const shortfallSchedule: ShortfallTranche[] = [];
    if (account.type !== "cash") {
      let rn = 0;
      let minProj = balance;
      let covered = 0;
      for (let d = 0; d <= horizonDays; d++) {
        rn += netByDay.get(d) ?? 0;
        const proj = balance + rn - dailyBurn * (d + 1);
        if (proj < minProj - 0.005) {
          minProj = proj;
          if (proj < -0.005 && -proj > covered + 0.005) {
            const obligations = events
              .filter((e) => e.daysFromNow === d && e.signedAmount < 0)
              .map((e) => cleanObligation(e.label))
              .slice(0, 3);
            shortfallSchedule.push({
              amount: roundMoney(-proj - covered),
              byDateISO: isoOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() + d)),
              obligations,
            });
            covered = roundMoney(-proj);
          }
        }
      }
      // Fold the buffer + any rounding residual into the FIRST tranche (an
      // immediate cushion, no date of its own), so Σ tranches = full shortfall.
      const shortfall = roundMoney(Math.max(0, floor - balance));
      const scheduledSum = roundMoney(shortfallSchedule.reduce((t, x) => t + x.amount, 0));
      const residual = roundMoney(shortfall - scheduledSum);
      if (residual > 0.005) {
        if (shortfallSchedule.length > 0) {
          shortfallSchedule[0] = { ...shortfallSchedule[0], amount: roundMoney(shortfallSchedule[0].amount + residual) };
        } else if (shortfall > 0.005) {
          shortfallSchedule.push({ amount: shortfall, byDateISO: firstShortfallDateISO, obligations: nextObligations.slice(0, 2) });
        }
      }
    }
    return {
      accountId: account.id,
      name: account.name,
      type: account.type,
      currency: (account.currency || "USD").toUpperCase(),
      balance,
      floor,
      buffer,
      surplus: roundMoney(balance - floor),
      trough: roundMoney(balance + minNet),
      firstShortfallDateISO,
      nextObligations,
      everydayShare: roundMoney(share * 100) / 100,
      deadPocket: account.type === "wallet",
      hasAssumedEvents: assumed.has(account.id),
      shortfallSchedule,
      availableAfterEarmarks: 0, // finalized below, after urgent moves earmark
    };
  });

  states.sort((a, b) => (a.surplus < 0 ? -1 : 0) - (b.surplus < 0 ? -1 : 0) || b.balance - a.balance);

  const totalLiquid = roundMoney(states.reduce((t, s) => t + s.balance, 0));
  const totalFloors = roundMoney(states.reduce((t, s) => t + s.floor, 0));
  const freeAboveFloors = roundMoney(totalLiquid - totalFloors);
  const globalShortage = roundMoney(Math.max(0, -freeAboveFloors));

  // ── Recommended moves (minimal, greedy). Working copy of surpluses. ─────────
  const work = new Map(states.map((s) => [s.accountId, s.surplus] as const));
  const nameOf = new Map(states.map((s) => [s.accountId, s.name] as const));
  const currencyOf = new Map(states.map((s) => [s.accountId, s.currency] as const));
  const moves: TreasuryMove[] = [];

  // Earmark the FULL shortfall from the sources (so the free-money math below is
  // honest — money destined for the WHOLE cycle's obligations is not free), but
  // emit a MOVE only for the urgent slice `moveAmount` (the next tranche). The
  // later tranches are committed but surfaced as they come due, not dumped on the
  // earliest deadline (founder's schedule-aware request).
  const takeFrom = (earmark: number, moveAmount: number, toId: string, byDateISO: string | null, reason: string) => {
    let remainingEarmark = earmark;
    let remainingMove = moveAmount;
    const toCurrency = currencyOf.get(toId);
    // Same currency first, then largest surplus; dead pockets drain first within a tier
    // (their money has no better job than fixing a shortfall).
    const sources = states
      .filter((s) => s.accountId !== toId && (work.get(s.accountId) ?? 0) > MIN_MOVE)
      .sort((a, b) => {
        const aCur = a.currency === toCurrency ? 0 : 1;
        const bCur = b.currency === toCurrency ? 0 : 1;
        if (aCur !== bCur) return aCur - bCur;
        const aDead = a.deadPocket ? 0 : 1;
        const bDead = b.deadPocket ? 0 : 1;
        if (aDead !== bDead) return aDead - bDead;
        return (work.get(b.accountId) ?? 0) - (work.get(a.accountId) ?? 0);
      });
    for (const src of sources) {
      if (remainingEarmark <= MIN_MOVE) break;
      const available = work.get(src.accountId) ?? 0;
      const take = roundMoney(Math.min(available, remainingEarmark));
      if (take <= MIN_MOVE) continue;
      work.set(src.accountId, roundMoney(available - take));
      work.set(toId, roundMoney((work.get(toId) ?? 0) + take));
      const moveSlice = roundMoney(Math.min(take, remainingMove));
      if (moveSlice > MIN_MOVE) {
        moves.push({
          fromAccountId: src.accountId,
          fromName: src.name,
          toAccountId: toId,
          toName: nameOf.get(toId) ?? "",
          amount: moveSlice,
          byDateISO,
          reason,
          urgent: true,
          crossesCurrency: src.currency !== toCurrency,
        });
        remainingMove = roundMoney(remainingMove - moveSlice);
      }
      remainingEarmark = roundMoney(remainingEarmark - take);
    }
    return remainingEarmark;
  };

  // 1) Cover shortfalls, earliest deadline first — urge only the NEXT tranche.
  const shortfalls = states
    .filter((s) => s.surplus < -MIN_MOVE && s.type !== "cash")
    .sort((a, b) => (a.firstShortfallDateISO ?? "9999").localeCompare(b.firstShortfallDateISO ?? "9999"));
  for (const s of shortfalls) {
    const urgent = s.shortfallSchedule[0];
    const moveAmount = urgent ? urgent.amount : -s.surplus;
    const byDateISO = urgent ? urgent.byDateISO : s.firstShortfallDateISO;
    const reason = urgent && urgent.obligations.length
      ? urgent.obligations.slice(0, 2).join(" + ")
      : s.nextObligations.length ? s.nextObligations.slice(0, 2).join(" + ") : "tus pagos del mes";
    takeFrom(-s.surplus, moveAmount, s.accountId, byDateISO, reason);
  }

  // What each account can still give away after the urgent earmarks — the
  // honest base for layerHomes and the withdrawal planner (money already
  // destined to cover a dated shortfall is NOT free).
  const availableAfterEarmarks = new Map(
    states.map((st) => [st.accountId, roundMoney(Math.max(0, work.get(st.accountId) ?? 0))] as const),
  );
  for (const st of states) st.availableAfterEarmarks = availableAfterEarmarks.get(st.accountId) ?? 0;

  // 2) Drain dead pockets: idle wallet money above its floor moves to the
  //    everyday account — but ONLY into a SAME-CURRENCY home. Recommending a
  //    USD→ARS conversion just to "tidy up" is bad advice (it locks in an FX
  //    spread on money that was fine where it sat), so a dead pocket with no
  //    same-currency everyday account stays put.
  for (const dp of states) {
    if (!dp.deadPocket) continue;
    const idle = work.get(dp.accountId) ?? 0;
    if (idle <= MIN_MOVE) continue;
    const anchor = states
      .filter((s) => !s.deadPocket && s.type !== "cash" && s.currency === dp.currency && (shareOf(s.accountId) >= MIN_EVERYDAY_SHARE || s.accountId === topEverydayNonCashId))
      .sort((a, b) => shareOf(b.accountId) - shareOf(a.accountId) || b.balance - a.balance)[0];
    if (!anchor) continue;
    work.set(dp.accountId, 0);
    work.set(anchor.accountId, roundMoney((work.get(anchor.accountId) ?? 0) + idle));
    moves.push({
      fromAccountId: dp.accountId,
      fromName: dp.name,
      toAccountId: anchor.accountId,
      toName: anchor.name,
      amount: roundMoney(idle),
      byDateISO: null,
      reason: "plata sin uso en un bolsillo — mejor donde vive tu día a día",
      urgent: false,
      crossesCurrency: false,
    });
  }

  // Ideal distribution = the state AFTER the moves (floors covered everywhere
  // possible, dead pockets emptied, free money where it already worked).
  const ideal = states.map((s) => {
    const amount = roundMoney(s.floor + Math.max(0, work.get(s.accountId) ?? 0));
    return {
      accountId: s.accountId,
      name: s.name,
      amount,
      pct: totalLiquid > 0 ? Math.round((amount / totalLiquid) * 100) : 0,
    };
  });

  // Where the free money (Saldo + Reserva, physically) lives TODAY — after the
  // urgent moves earmark their share (earmarked money is not free).
  const layerHomes: TreasuryLayerHome[] = states
    .filter((s) => (availableAfterEarmarks.get(s.accountId) ?? 0) > MIN_MOVE)
    .sort((a, b) => (availableAfterEarmarks.get(b.accountId) ?? 0) - (availableAfterEarmarks.get(a.accountId) ?? 0))
    .map((s) => ({ accountId: s.accountId, name: s.name, amount: availableAfterEarmarks.get(s.accountId) ?? 0 }));

  return {
    accounts: states,
    moves,
    totalLiquid,
    totalFloors,
    freeAboveFloors,
    globalShortage,
    layerHomes,
    ideal,
    shareConfidence: input.accountShares.confidence,
  };
}

// ── Withdrawal planner ("saca 3,000$ de la Reserva hacia Wells") ──────────────
// Respects every account's floor (never suggests defunding the rent), prefers
// same-currency and low-friction sources, and names the layer being crossed —
// per the product rule: warn the crossing, never block it.
export function planWithdrawal(
  snapshot: TreasurySnapshot,
  input: {
    amount: number;
    destinationAccountId: string;
    /** ENGINE truths for the layer-cross message (margenKipu.saldo). */
    saldo: number;
    reserva: number;
  },
): WithdrawalPlan | null {
  const dest = snapshot.accounts.find((a) => a.accountId === input.destinationAccountId);
  if (!dest || !(input.amount > 0)) return null;

  const layerCrossed: WithdrawalPlan["layerCrossed"] =
    input.amount <= input.saldo ? "none" : input.amount <= input.saldo + input.reserva ? "reserva" : "beyond_reserva";

  const alreadyThere = roundMoney(Math.min(dest.availableAfterEarmarks, input.amount));
  let remaining = roundMoney(input.amount - alreadyThere);
  const moves: TreasuryMove[] = [];
  if (remaining > MIN_MOVE) {
    const sources = snapshot.accounts
      .filter((a) => a.accountId !== dest.accountId && a.availableAfterEarmarks > MIN_MOVE)
      .sort((a, b) => {
        const aCur = a.currency === dest.currency ? 0 : 1;
        const bCur = b.currency === dest.currency ? 0 : 1;
        if (aCur !== bCur) return aCur - bCur;
        const aDead = a.deadPocket ? 1 : 0; // friction money LAST here (unlike shortfalls)
        const bDead = b.deadPocket ? 1 : 0;
        if (aDead !== bDead) return aDead - bDead;
        return b.availableAfterEarmarks - a.availableAfterEarmarks;
      });
    for (const src of sources) {
      if (remaining <= MIN_MOVE) break;
      const amount = roundMoney(Math.min(src.availableAfterEarmarks, remaining));
      if (amount <= MIN_MOVE) continue;
      moves.push({
        fromAccountId: src.accountId,
        fromName: src.name,
        toAccountId: dest.accountId,
        toName: dest.name,
        amount,
        byDateISO: null,
        reason: `para tu retiro de ${dest.name}`,
        urgent: false,
        crossesCurrency: src.currency !== dest.currency,
      });
      remaining = roundMoney(remaining - amount);
    }
  } else {
    remaining = Math.max(0, remaining);
  }

  return {
    feasible: remaining <= 0,
    targetAmount: roundMoney(input.amount),
    destinationAccountId: dest.accountId,
    destinationName: dest.name,
    alreadyThere,
    moves,
    shortfall: roundMoney(Math.max(0, remaining)),
    layerCrossed,
  };
}

/** Honest empty state (single-account users, stubs): the module goes silent. */
export function emptyTreasury(): TreasurySnapshot {
  return {
    accounts: [],
    moves: [],
    totalLiquid: 0,
    totalFloors: 0,
    freeAboveFloors: 0,
    globalShortage: 0,
    layerHomes: [],
    ideal: [],
    shareConfidence: "none",
  };
}
