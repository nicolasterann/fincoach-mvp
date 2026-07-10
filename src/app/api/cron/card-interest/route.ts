import { NextRequest, NextResponse } from "next/server";
import {
  loadCardsForInterestAccrual,
  accrueCardInterest,
} from "@/lib/financial/commitments-store";
import { computeCardInterestAccrual } from "@/lib/financial/card-cycle";
import type { RateKind } from "@/lib/financial/interest-math";

export const dynamic = "force-dynamic";

// Day-to-day F3 — BANK-REALISTIC card interest, capitalized daily-but-once-per-cycle.
//
// For each credit card carrying an unpaid statement past its due date (grace period
// lost), interest = balance × monthly rate is added to the debt, exactly like a bank
// posts a finance charge. Idempotent: `last_interest_accrued_on` guards against
// charging twice in the same statement cycle, so running the cron daily is safe. A
// card paid in full by its due date accrues nothing (grace respected). Interest is an
// ESTIMATE (approximates average-daily-balance), refined as real statements arrive.
//
// Wire-up: registered in vercel.json as `{ "path": "/api/cron/card-interest", "schedule": "0 11 * * *" }`
// (11:00 UTC daily, before scheduled-changes at 12:00). Requires CRON_SECRET
// (Vercel sends `Authorization: Bearer <CRON_SECRET>`; the `x-vercel-cron` header is also accepted).
export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  const isVercelCron = request.headers.get("x-vercel-cron") !== null;
  if (auth !== `Bearer ${expectedSecret}` && !isVercelCron) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();
  const todayISO = now.toISOString().slice(0, 10);

  try {
    const cards = await loadCardsForInterestAccrual();
    let charged = 0;
    let totalInterestBase = 0;
    for (const card of cards) {
      const accrual = computeCardInterestAccrual({
        today: now,
        cutoffDay: card.cutoffDay,
        dueDay: card.dueDay,
        currentBalance: card.currentBalanceBase,
        fullPaymentDue: card.fullPaymentDue,
        interestRatePct: card.interestRate,
        interestRateKind: (card.interestRateKind as RateKind | null) ?? "annual_nominal",
        lastInterestAccruedOn: card.lastInterestAccruedOn,
      });
      if (!accrual.shouldAccrue) continue;
      const ok = await accrueCardInterest({
        userId: card.userId,
        debtAccountId: card.id,
        currentBalanceBase: card.currentBalanceBase,
        currentBalanceOriginal: card.currentBalanceOriginal,
        interestBase: accrual.interest,
        todayISO,
      });
      if (ok) {
        charged += 1;
        totalInterestBase += accrual.interest;
      }
    }

    // Aggregate only — no user ids / card names in logs (non-sensitive).
    console.info(
      "[kipu.cron.card-interest]",
      JSON.stringify({ ts: now.toISOString(), scanned: cards.length, charged, totalInterestBase: Math.round(totalInterestBase * 100) / 100 }),
    );

    return NextResponse.json({ ok: true, asOf: todayISO, scanned: cards.length, charged });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "cron-failed" }, { status: 500 });
  }
}
