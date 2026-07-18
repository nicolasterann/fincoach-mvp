import { NextRequest, NextResponse } from "next/server";
import {
  readCardsForInterestAccrual,
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
// (11:00 UTC daily, before scheduled-changes at 12:00). Strict bearer auth: Vercel
// sends `Authorization: Bearer <CRON_SECRET>` when the env var exists, so no
// header-presence bypass (x-vercel-cron is spoofable off Vercel — same reasoning as
// scheduled-changes).
export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const now = new Date();
  const todayISO = now.toISOString().slice(0, 10);

  try {
    // La lectura reporta sobre sí misma ({ok, complete, cards}): antes un scan
    // fallido llegaba como "cero tarjetas" y el cron respondía 200 — ninguna tarjeta
    // acumulaba interés y nadie se enteraba. Un fallo de lectura es un fallo de la
    // corrida, no una mañana sin deudas.
    const read = await readCardsForInterestAccrual();
    if (!read.ok) {
      console.error("[kipu.cron.card-interest]", JSON.stringify({ ts: now.toISOString(), error: "cards-scan-failed" }));
      return NextResponse.json({ ok: false, error: "cards-scan-failed" }, { status: 500 });
    }
    // Consumo del brazo PARCIAL a propósito: cada tarjeta es independiente e
    // idempotente (CAS + last_interest_accrued_on), así que acumular lo visto es
    // correcto — y el veredicto de abajo YA cuenta complete:false como corrida 5xx.
    const cards = read.complete ? read.cards : read.partial;
    let charged = 0;
    let conflicts = 0;
    let writeFailed = 0;
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
      const result = await accrueCardInterest({
        userId: card.userId,
        debtAccountId: card.id,
        currentBalanceBase: card.currentBalanceBase,
        currentBalanceOriginal: card.currentBalanceOriginal,
        interestBase: accrual.interest,
        todayISO,
      });
      if (result === "applied") {
        charged += 1;
        totalInterestBase += accrual.interest;
      } else if (result === "conflict") {
        // CAS: una compra aterrizó entre la lectura y el write. Benigno e
        // idempotente — mañana acumula sobre el saldo correcto. Se cuenta, no 5xx.
        conflicts += 1;
      } else {
        // Error real de escritura: un interés que no aterrizó es deuda subestimada.
        writeFailed += 1;
      }
    }

    // Veredicto (re-auditoría 2, punto 10): la corrida es sana solo si vio TODAS las
    // tarjetas y ningún write falló de verdad. complete:false o writeFailed>0 ⇒ 5xx,
    // porque acumular es idempotente (last_interest_accrued_on + CAS) y el retry es
    // gratis; un 200 con tarjetas sin evaluar se veía idéntico a una mañana sin deudas.
    const healthy = read.complete && writeFailed === 0;
    const body = {
      ok: healthy,
      complete: read.complete,
      asOf: todayISO,
      scanned: cards.length,
      charged,
      conflicts,
      writeFailed,
    };
    // Aggregate only — no user ids / card names in logs (non-sensitive).
    const log = JSON.stringify({ ts: now.toISOString(), ...body, totalInterestBase: Math.round(totalInterestBase * 100) / 100 });
    if (healthy) console.info("[kipu.cron.card-interest]", log);
    else console.error("[kipu.cron.card-interest]", log);

    return NextResponse.json(body, { status: healthy ? 200 : 500 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "cron-failed" }, { status: 500 });
  }
}
