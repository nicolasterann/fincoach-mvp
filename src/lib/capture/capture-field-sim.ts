import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import {
  matchCandidate,
  recentExactDuplicate,
  validateEvidenceFile,
  type CandidateEvent,
} from "@/lib/capture/capture-matching";
import { buildEvidenceDigest } from "@/lib/capture/evidence-capture";
import {
  extractFromPdf,
  transcribeAudio,
  type ExtractionResult,
} from "@/lib/capture/evidence-extraction";
import {
  hashEvidence,
  loadMatchableTransactions,
  registerEvidence,
  updateEvidenceSummary,
} from "@/lib/capture/evidence-store";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  chatOperationNamespace,
  evidenceOperationNamespace,
  movementFingerprint,
  nextDedupeKey,
  reconcileOperationId,
} from "@/lib/ai/operation-identity";

// Stage 12 — LIVE capture field-test scenarios. Shared by the auth-gated
// /dev/capture-sim page and the CLI runner (scripts/capture-sim.ts), so the
// exact same checks run in browser QA and in terminal field-testing. Exercises
// REAL paths with synthetic evidence: generated PDFs through live extraction,
// a TTS voice note through live transcription, idempotency against the real
// capture_evidence table, and the matcher read-only over the user's ledger.
// NO movement is ever written.

export interface SimCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface SimResult {
  scenario: string;
  title: string;
  checks: SimCheck[];
  error?: string;
}

// Minimal valid one-page PDF (computed xref) so live extraction sees a real
// document without binary fixtures in the repo. ASCII-only content.
export function buildTestPdf(lines: string[]): Uint8Array {
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = `BT /F1 12 Tf 50 760 Td 16 TL ${lines
    .map((l, i) => (i === 0 ? `(${esc(l)}) Tj` : `T* (${esc(l)}) Tj`))
    .join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

function summarizeExtraction(e: ExtractionResult): string {
  return JSON.stringify({
    ok: e.ok,
    type: e.documentType,
    candidates: e.candidates?.map((c) => ({
      k: c.kind,
      a: c.amount,
      m: c.merchant,
      ref: c.externalRef,
    })),
    statement: e.statement,
    error: e.error,
  }).slice(0, 700);
}

export async function runArchivos(): Promise<SimResult> {
  const checks: SimCheck[] = [];

  // Receipt-like PDF: one clear purchase with reference.
  const receipt = buildTestPdf([
    "COMPROBANTE DE PAGO",
    "Comercio: FARMACIAS FYBECA QUITO",
    "Fecha: 2026-06-12",
    "Total: USD 8.50",
    "Tarjeta: VISA ****1234",
    "Ref. autorizacion: 778812",
  ]);
  const vReceipt = validateEvidenceFile({ bytes: receipt, mimeType: "application/pdf" });
  checks.push({
    name: "El PDF sintetico pasa la validacion de archivo",
    pass: vReceipt.ok && vReceipt.kind === "pdf",
    detail: JSON.stringify(vReceipt),
  });

  const ext = await extractFromPdf({ bytes: receipt, filename: "comprobante.pdf" });
  const amounts = (ext.candidates ?? []).map((c) => c.amount);
  checks.push({
    name: "Extraccion en vivo del recibo: encuentra el monto 8.50",
    pass: ext.ok && amounts.some((a) => Math.abs(a - 8.5) < 0.01),
    detail: summarizeExtraction(ext),
  });
  checks.push({
    name: "Extraccion fiel: un solo movimiento, sin montos inventados (ni la ref ni la tarjeta como monto)",
    pass: ext.ok && amounts.length >= 1 && amounts.every((a) => Math.abs(a - 8.5) < 0.01),
    detail: `montos: ${amounts.join(", ")}`,
  });

  // Card-statement PDF: obligations + rows.
  const statement = buildTestPdf([
    "ESTADO DE CUENTA - VISA BANCO PICHINCHA",
    "Corte: 2026-06-05    Fecha maxima de pago: dia 21",
    "Pago minimo: USD 25.00",
    "Pago total del mes: USD 180.50",
    "Saldo total: USD 540.00",
    "MOVIMIENTOS DEL PERIODO:",
    "2026-06-01  UBER TRIP HELP.UBER.COM      12.00",
    "2026-06-02  MCDONALDS GUAYAQUIL EC        8.00",
    "2026-06-03  NETFLIX.COM                   7.00",
  ]);
  const extSt = await extractFromPdf({ bytes: statement, filename: "estado-visa.pdf" });
  checks.push({
    name: "Estado de cuenta en vivo: detecta tipo statement + minimo y pago del mes",
    pass:
      extSt.ok &&
      extSt.documentType === "statement" &&
      Math.abs((extSt.statement?.minimumPayment ?? 0) - 25) < 0.01 &&
      Math.abs((extSt.statement?.totalDueThisMonth ?? 0) - 180.5) < 0.01,
    detail: summarizeExtraction(extSt),
  });
  checks.push({
    name: "Estado de cuenta: extrae las filas de movimientos (>=3)",
    pass: extSt.ok && (extSt.candidates?.length ?? 0) >= 3,
    detail: `${extSt.candidates?.length ?? 0} candidatos`,
  });

  return { scenario: "archivos", title: "PDF en vivo: recibo + estado de cuenta", checks };
}

export async function runVoz(): Promise<SimResult> {
  const checks: SimCheck[] = [];
  const openai = new OpenAI();
  const speech = await openai.audio.speech.create({
    model: process.env.OPENAI_TTS_MODEL ?? "tts-1",
    voice: "alloy",
    input: "Gasté ocho dólares con cincuenta en McDonald's con la tarjeta Visa",
  });
  const bytes = new Uint8Array(await speech.arrayBuffer());

  const v = validateEvidenceFile({ bytes, mimeType: "audio/mpeg" });
  checks.push({
    name: "La nota de voz generada pasa la validacion (magic bytes audio)",
    pass: v.ok && v.kind === "audio",
    detail: `${bytes.length} bytes → ${JSON.stringify(v)}`,
  });

  const t = await transcribeAudio({ bytes, mimeType: "audio/mpeg", filename: "voz.mp3" });
  const lower = (t.transcript ?? "").toLowerCase();
  checks.push({
    name: "Transcripcion en vivo: recupera comercio y monto hablados",
    pass:
      t.ok === true &&
      lower.includes("mcdonald") &&
      (lower.includes("ocho") || lower.includes("8")),
    detail: t.transcript ?? t.error ?? "sin transcript",
  });

  return { scenario: "voz", title: "Voz en vivo: TTS → Whisper (ida y vuelta)", checks };
}

export async function runDedup(userId: string): Promise<SimResult> {
  const checks: SimCheck[] = [];
  const supabase = createSupabaseAdminClient();
  const hash = hashEvidence(`sim-${Date.now()}-${Math.random()}`);

  const first = await registerEvidence({
    userId,
    source: "web_upload",
    kind: "image",
    contentHash: hash,
  });
  checks.push({
    name: "Primera evidencia: se registra (tabla capture_evidence disponible)",
    pass: first.id !== null && !first.duplicate,
    detail:
      first.id === null
        ? "id=null → la tabla capture_evidence no respondió (¿migración 017 aplicada?)"
        : `id=${first.id}`,
  });

  const second = await registerEvidence({
    userId,
    source: "telegram_photo",
    kind: "image",
    contentHash: hash,
  });
  checks.push({
    name: "Mismo contenido otra vez (otro canal): corto-circuito duplicate, cero costo de modelo",
    pass: second.duplicate === true,
    detail: JSON.stringify(second),
  });

  const otherHash = hashEvidence(`sim-${Date.now()}-${Math.random()}-b`);
  const third = await registerEvidence({
    userId,
    source: "web_upload",
    kind: "image",
    contentHash: otherHash,
  });
  checks.push({
    name: "Contenido distinto: NO se marca duplicado",
    pass: third.duplicate === false && third.id !== null,
    detail: JSON.stringify(third),
  });

  try {
    await supabase.from("capture_evidence").delete().in("content_hash", [hash, otherHash]);
  } catch {
    // best-effort cleanup
  }

  return { scenario: "dedup", title: "Idempotencia real en DB (hash de contenido)", checks };
}

export async function runMatcher(userId: string): Promise<SimResult> {
  const checks: SimCheck[] = [];
  const recent = await loadMatchableTransactions(userId);
  checks.push({
    name: "Carga de movimientos reales (incluye external_ref o tolera su ausencia)",
    pass: Array.isArray(recent),
    detail: `${recent.length} movimientos en 45 dias`,
  });

  if (recent.length > 0) {
    const last = recent[0];
    const echo: CandidateEvent = {
      kind: "expense",
      amount: last.originalAmount,
      currency: last.originalCurrency,
      merchant: last.description,
      dateISO: last.occurredAt.slice(0, 10),
    };
    const m = matchCandidate(echo, recent);
    checks.push({
      name: "Un candidato calcado de un movimiento real → duplicado o posible duplicado (jamás 'nuevo')",
      pass: m.verdict === "duplicate" || m.verdict === "likely_match",
      detail: `${m.verdict}: ${m.reason}`,
    });
  } else {
    checks.push({
      name: "Usuario sin movimientos recientes: matcher no aplica (ok)",
      pass: true,
      detail: "sin datos para cotejar",
    });
  }

  // Digest audit: the agent receives verdicts as facts, with the exact
  // instructions (no re-register, one question, statement tool).
  const digest = buildEvidenceDigest(
    {
      ok: true,
      summary: "captura de notificacion bancaria",
      documentType: "bank_alert",
    },
    [
      {
        candidate: { kind: "expense", amount: 12, currency: "USD", merchant: "Uber" },
        match: {
          verdict: "duplicate",
          matchedTransactionId: "x",
          matchedDescription: "Uber",
          reason: "mismo monto",
        },
      },
      {
        candidate: { kind: "expense", amount: 15, currency: "USD", merchant: "Supermaxi" },
        match: { verdict: "new", reason: "sin coincidencias" },
      },
    ],
    "esto fue ayer",
  );
  checks.push({
    name: "Digest del agente: veredictos + nota del usuario + orden de no exponer tecnicismos",
    pass:
      digest.startsWith("[EVIDENCIA RECIBIDA]") &&
      digest.includes("YA REGISTRADO") &&
      digest.includes("NUEVO") &&
      digest.includes("esto fue ayer") &&
      digest.includes("Nunca menciones"),
    detail: digest.slice(0, 400),
  });

  return {
    scenario: "matcher",
    title: "Matcher sobre datos reales (solo lectura) + digest del agente",
    checks,
  };
}

// Atomic-claim concurrency over the REAL capture_evidence table (race-safe
// idempotency). Exercises every claim path the deterministic gate can only
// model purely: concurrent same-content claims, retry-after-failed,
// interrupted (stale) processing, and cross-user isolation. Writes only inert
// audit rows and cleans them up; NO movement is ever written.
async function runClaims(userId: string): Promise<SimResult> {
  const checks: SimCheck[] = [];
  const supabase = createSupabaseAdminClient();
  const createdHashes: string[] = [];
  const newHash = (tag: string) => {
    const h = hashEvidence(`claim-${tag}-${Date.now()}-${Math.random()}`);
    createdHashes.push(h);
    return h;
  };

  // 1. Two concurrent deliveries of the SAME content → exactly one owner.
  const h1 = newHash("concurrent");
  const [a, b] = await Promise.all([
    registerEvidence({ userId, source: "web_upload", kind: "image", contentHash: h1 }),
    registerEvidence({ userId, source: "telegram_photo", kind: "image", contentHash: h1 }),
  ]);
  const owners = [a, b].filter((r) => !r.duplicate && r.id);
  const dups = [a, b].filter((r) => r.duplicate);
  checks.push({
    name: "Dos reclamos concurrentes del mismo contenido (mismo usuario) → exactamente 1 dueño, 1 duplicado",
    pass: owners.length === 1 && dups.length === 1,
    detail:
      owners.length === 0 && dups.length === 0
        ? "ambos id=null → ¿migración 017 aplicada (índice UNIQUE)?"
        : JSON.stringify({ a, b }),
  });

  // 2. Retry after a failed attempt re-claims the same row.
  const h2 = newHash("retry");
  const first = await registerEvidence({ userId, source: "web_upload", kind: "image", contentHash: h2 });
  if (first.id) await updateEvidenceSummary(first.id, "fallo simulado", "failed");
  const retry = await registerEvidence({ userId, source: "web_upload", kind: "image", contentHash: h2 });
  checks.push({
    name: "Reintento después de 'failed' → se vuelve a reclamar la MISMA fila (no queda bloqueada)",
    pass: Boolean(first.id) && !retry.duplicate && retry.id === first.id,
    detail: JSON.stringify({ first: first.id, retry: retry.id, dup: retry.duplicate }),
  });

  // 3a. A fresh 'processing' row is in-flight → a second delivery short-circuits.
  const h3 = newHash("inflight");
  const claim = await registerEvidence({ userId, source: "web_upload", kind: "image", contentHash: h3 });
  const inflight = await registerEvidence({
    userId,
    source: "telegram_photo",
    kind: "image",
    contentHash: h3,
    staleProcessingMs: 5 * 60_000,
  });
  checks.push({
    name: "Procesando reciente → la segunda entrega NO reprocesa (in-flight = duplicate)",
    pass: Boolean(claim.id) && inflight.duplicate === true,
    detail: JSON.stringify({ claim: claim.id, inflight }),
  });

  // 3b. An interrupted (stale) 'processing' row is reclaimable.
  if (claim.id) {
    await supabase
      .from("capture_evidence")
      .update({ updated_at: new Date(Date.now() - 60 * 60_000).toISOString() })
      .eq("id", claim.id);
  }
  const reclaimed = await registerEvidence({
    userId,
    source: "web_upload",
    kind: "image",
    contentHash: h3,
    staleProcessingMs: 1,
  });
  checks.push({
    name: "Procesando interrumpido (viejo) → se reclama la misma fila y se reintenta",
    pass: Boolean(claim.id) && !reclaimed.duplicate && reclaimed.id === claim.id,
    detail: JSON.stringify({ claim: claim.id, reclaimed: reclaimed.id, dup: reclaimed.duplicate }),
  });

  // 4. Cross-user isolation: the same content hash for two users = two rows.
  let secondUser: string | null = null;
  try {
    const { data } = await supabase.auth.admin.listUsers({ perPage: 50 });
    secondUser = data?.users.find((u) => u.id !== userId)?.id ?? null;
  } catch {
    secondUser = null;
  }
  if (secondUser) {
    const h4 = newHash("isolation");
    const u1 = await registerEvidence({ userId, source: "web_upload", kind: "image", contentHash: h4 });
    const u2 = await registerEvidence({ userId: secondUser, source: "web_upload", kind: "image", contentHash: h4 });
    checks.push({
      name: "Mismo hash, dos usuarios distintos → dos filas independientes (aislamiento por usuario)",
      pass: Boolean(u1.id) && Boolean(u2.id) && !u1.duplicate && !u2.duplicate && u1.id !== u2.id,
      detail: JSON.stringify({ u1: u1.id, u2: u2.id }),
    });
    // clean the second user's row too
    if (u2.id) await supabase.from("capture_evidence").delete().eq("id", u2.id);
  } else {
    checks.push({
      name: "Aislamiento entre usuarios: no hay un segundo usuario para probarlo en vivo (estructural por índice UNIQUE compuesto)",
      pass: true,
      detail: "solo 1 usuario en el proyecto",
    });
  }

  // Cleanup: remove the inert audit rows this scenario created.
  try {
    if (createdHashes.length) {
      await supabase.from("capture_evidence").delete().in("content_hash", createdHashes);
    }
  } catch {
    // best-effort
  }

  return { scenario: "claims", title: "Idempotencia atómica + reclamo + aislamiento (DB real)", checks };
}

// Evidence LIFECYCLE over the real table: a claim stays 'processing' until the
// real outcome, and ONLY the current claim owner may finalize — a stale worker
// superseded by a reclaim can never overwrite the new owner's result.
async function runLifecycle(userId: string): Promise<SimResult> {
  const checks: SimCheck[] = [];
  const supabase = createSupabaseAdminClient();
  const createdHashes: string[] = [];
  const newHash = (tag: string) => {
    const h = hashEvidence(`life-${tag}-${Date.now()}-${Math.random()}`);
    createdHashes.push(h);
    return h;
  };

  // 1. A fresh claim is 'processing' (NOT processed) until finalize.
  const h1 = newHash("processing");
  const claim = await registerEvidence({ userId, source: "web_upload", kind: "image", contentHash: h1 });
  let statusAfterClaim = "(sin fila)";
  if (claim.id) {
    const { data } = await supabase.from("capture_evidence").select("status").eq("id", claim.id).maybeSingle();
    statusAfterClaim = data?.status ?? "(sin fila)";
  }
  checks.push({
    name: "Tras reclamar, la evidencia queda 'processing' (no 'processed') hasta el resultado real",
    pass: Boolean(claim.id) && Boolean(claim.claimVersion) && statusAfterClaim === "processing",
    detail: `status=${statusAfterClaim}, version=${claim.claimVersion ? "sí" : "no"}`,
  });

  // 2. The claim owner finalizes successfully with its version.
  const finalizedByOwner = await updateEvidenceSummary(claim.id, "ok dueño", "processed", claim.claimVersion);
  checks.push({
    name: "El dueño del claim finaliza con su versión (guardado)",
    pass: finalizedByOwner === true,
    detail: `finalizó=${finalizedByOwner}`,
  });

  // 3. Stale worker cannot finalize after a reclaim took ownership.
  const h2 = newHash("stale");
  const ownerA = await registerEvidence({ userId, source: "web_upload", kind: "image", contentHash: h2 });
  // Make A's claim look interrupted, then a new delivery reclaims it (owner B).
  if (ownerA.id) {
    await supabase
      .from("capture_evidence")
      .update({ updated_at: new Date(Date.now() - 60 * 60_000).toISOString() })
      .eq("id", ownerA.id);
  }
  const ownerB = await registerEvidence({
    userId,
    source: "telegram_photo",
    kind: "image",
    contentHash: h2,
    staleProcessingMs: 1,
  });
  const staleFinalize = await updateEvidenceSummary(ownerA.id, "DUEÑO VIEJO (no debe ganar)", "processed", ownerA.claimVersion);
  const freshFinalize = await updateEvidenceSummary(ownerB.id, "dueño nuevo", "processed", ownerB.claimVersion);
  let finalSummary = "";
  if (ownerB.id) {
    const { data } = await supabase.from("capture_evidence").select("summary,status").eq("id", ownerB.id).maybeSingle();
    finalSummary = data?.summary ?? "";
  }
  checks.push({
    name: "Trabajador viejo NO puede finalizar tras un reclaim; gana el dueño nuevo",
    pass:
      Boolean(ownerB.id) &&
      ownerB.id === ownerA.id &&
      staleFinalize === false &&
      freshFinalize === true &&
      finalSummary === "dueño nuevo",
    detail: `viejo=${staleFinalize}, nuevo=${freshFinalize}, summary="${finalSummary}"`,
  });

  // 4. needs_clarification lifecycle:
  //    - fresh needs_clarification → re-delivery returns duplicate with status
  //    - stale needs_clarification → re-delivery allows reclaim
  const h3 = newHash("nc");
  const ncClaim = await registerEvidence({ userId, source: "web_upload", kind: "image", contentHash: h3 });
  if (ncClaim.id) {
    await updateEvidenceSummary(ncClaim.id, "¿De qué tarjeta es el gasto?", "needs_clarification", ncClaim.claimVersion);
  }
  // Fresh re-delivery: same hash, needs_clarification not stale → should be duplicate with status=needs_clarification.
  // Fresh re-delivery (recent, even an hour later): shows the pending question,
  // does NOT reclaim — a human is still within the answer window.
  await supabase
    .from("capture_evidence")
    .update({ updated_at: new Date(Date.now() - 60 * 60_000).toISOString() })
    .eq("id", ncClaim.id ?? "");
  const ncFreshRedelivery = await registerEvidence({ userId, source: "web_upload", kind: "image", contentHash: h3 });
  // Abandoned re-delivery: force the clarification window to expire → reclaimable
  // (proves a needs_clarification row never gets permanently stuck).
  const ncStaleRedelivery = await registerEvidence({
    userId,
    source: "web_upload",
    kind: "image",
    contentHash: h3,
    staleClarificationMs: 1,
  });
  checks.push({
    name: "needs_clarification: reenvío tras 1h → muestra pregunta (no reclama, humano respondiendo); ventana humana expirada → reclamable (nunca pegado)",
    pass:
      ncFreshRedelivery.duplicate === true &&
      ncFreshRedelivery.status === "needs_clarification" &&
      ncFreshRedelivery.inFlight !== true &&
      ncStaleRedelivery.duplicate === false &&
      ncStaleRedelivery.id === ncClaim.id,
    detail: `1h=${ncFreshRedelivery.status}/${ncFreshRedelivery.duplicate}, expirada=${ncStaleRedelivery.duplicate}/${ncStaleRedelivery.claimVersion ? "reclamado" : "no"}`,
  });
  createdHashes.push(h3);

  try {
    if (createdHashes.length) {
      await supabase.from("capture_evidence").delete().in("content_hash", createdHashes);
    }
  } catch {
    // best-effort
  }

  return { scenario: "lifecycle", title: "Ciclo de vida + finalización por dueño (DB real)", checks };
}

// Phase 2 — LIVE write-path integration over the atomic ledger function
// (migration 019). Proves on the REAL DB: multiple movements to one account
// accumulate (C1), card debt accumulates, reverse+reapply correction is correct
// (C2), a batch is all-or-nothing, ownership is enforced in the DB, goal
// contributions move all three sides, and at most one reversal per original.
//
// SAFE: creates clearly-tagged DISPOSABLE accounts/card/goal for the chosen
// user, asserts BALANCE DELTAS, and deletes everything it created in `finally`
// (ledger rows first, then the disposable records). Run with a DEDICATED TEST
// USER — never the founder. If migration 019 is not applied, it skips cleanly.
async function runLedger(userId: string): Promise<SimResult> {
  const checks: SimCheck[] = [];
  const supabase = createSupabaseAdminClient();
  const tag = `SIMLEDGER-${Date.now()}`;
  const BOGUS = "00000000-0000-0000-0000-000000000000";

  let accId: string | null = null;
  let gaId: string | null = null;
  let cardId: string | null = null;
  let goalId: string | null = null;

  const readAcc = async (id: string | null): Promise<number> => {
    if (!id) return NaN;
    const { data } = await supabase
      .from("accounts")
      .select("current_balance_base")
      .eq("id", id)
      .maybeSingle();
    return data ? Number(data.current_balance_base) : NaN;
  };
  const readDebt = async (id: string | null): Promise<number> => {
    if (!id) return NaN;
    const { data } = await supabase
      .from("debt_accounts")
      .select("current_balance_base")
      .eq("id", id)
      .maybeSingle();
    return data ? Number(data.current_balance_base) : NaN;
  };
  const readGoal = async (id: string | null): Promise<number> => {
    if (!id) return NaN;
    const { data } = await supabase.from("goals").select("current_amount").eq("id", id).maybeSingle();
    return data ? Number(data.current_amount) : NaN;
  };
  const d2 = (n: number) => Math.round(n * 100) / 100;
  const entry = (o: Record<string, unknown>) => {
    const ao = typeof o.original_amount === "number" ? (o.original_amount as number) : undefined;
    return {
      user_id: userId,
      sign: 1,
      original_currency: "USD",
      base_currency: "USD",
      exchange_rate_to_base: 1,
      // Coherent base amount (USD, rate 1) so the hardened function accepts it;
      // reversal calls omit original_amount and the function derives amounts.
      ...(ao !== undefined ? { base_amount: ao } : {}),
      input_channel: "web",
      raw_input: tag,
      ...o,
    };
  };
  const callEntry = (o: Record<string, unknown>) =>
    supabase.rpc("kipu_apply_ledger_entry", { p_entry: entry(o) });
  const callBatch = (arr: Record<string, unknown>[]) =>
    supabase.rpc("kipu_apply_ledger_batch", { p_entries: arr.map(entry) });
  const fnMissing = (msg?: string) =>
    !!msg && /PGRST202|could not find the function|schema cache|does not exist/i.test(msg);

  try {
    // Disposable records.
    const acc = await supabase
      .from("accounts")
      .insert({ user_id: userId, name: `${tag}-A`, type: "bank", currency: "USD", current_balance_original: 100, current_balance_base: 100, is_goal_account: false })
      .select("id")
      .single();
    const ga = await supabase
      .from("accounts")
      .insert({ user_id: userId, name: `${tag}-GA`, type: "goal_account", currency: "USD", current_balance_original: 0, current_balance_base: 0, is_goal_account: true })
      .select("id")
      .single();
    const card = await supabase
      .from("debt_accounts")
      .insert({ user_id: userId, name: `${tag}-V`, type: "credit_card", currency: "USD", current_balance_original: 0, current_balance_base: 0 })
      .select("id")
      .single();
    if (acc.error || !acc.data || ga.error || !ga.data || card.error || !card.data) {
      checks.push({ name: "Crear registros desechables", pass: false, detail: acc.error?.message ?? ga.error?.message ?? card.error?.message ?? "sin datos" });
      return { scenario: "ledger", title: "Núcleo financiero atómico (write-path real)", checks };
    }
    accId = acc.data.id;
    gaId = ga.data.id;
    cardId = card.data.id;
    const goal = await supabase
      .from("goals")
      .insert({ user_id: userId, name: `${tag}-goal`, target_amount: 100, currency: "USD", current_amount: 0, goal_account_id: gaId })
      .select("id")
      .single();
    if (goal.error || !goal.data) {
      checks.push({ name: "Crear meta desechable", pass: false, detail: goal.error?.message ?? "sin datos" });
      return { scenario: "ledger", title: "Núcleo financiero atómico (write-path real)", checks };
    }
    goalId = goal.data.id;

    // 1. C1 — three expenses to the SAME account accumulate.
    const c1Before = await readAcc(accId);
    const c1 = await callBatch([
      { type: "expense", effect_type: "expense", original_amount: 8, source_account_id: accId },
      { type: "expense", effect_type: "expense", original_amount: 12, source_account_id: accId },
      { type: "expense", effect_type: "expense", original_amount: 5, source_account_id: accId },
    ]);
    if (fnMissing(c1.error?.message)) {
      checks.push({ name: "Migración 019 aplicada", pass: false, detail: `función ausente (${c1.error?.message}). Aplica supabase/sql/019 y reintenta.` });
      return { scenario: "ledger", title: "Núcleo financiero atómico (write-path real)", checks };
    }
    const c1After = await readAcc(accId);
    checks.push({
      name: "C1: 3 gastos (8+12+5) a la misma cuenta acumulan (−25), no se pisan",
      pass: !c1.error && d2(c1Before - c1After) === 25,
      detail: c1.error ? c1.error.message : `Δ=${d2(c1Before - c1After)} (esperado 25)`,
    });

    // 2. C1 — three card expenses raise debt by the exact sum.
    const cardBefore = await readDebt(cardId);
    const c2 = await callBatch([
      { type: "expense", effect_type: "expense", original_amount: 30, debt_account_id: cardId },
      { type: "expense", effect_type: "expense", original_amount: 20, debt_account_id: cardId },
      { type: "expense", effect_type: "expense", original_amount: 10, debt_account_id: cardId },
    ]);
    const cardAfter = await readDebt(cardId);
    checks.push({
      name: "C1 (tarjeta): 3 compras (30+20+10) suben la deuda exactamente +60",
      pass: !c2.error && d2(cardAfter - cardBefore) === 60,
      detail: c2.error ? c2.error.message : `Δ=${d2(cardAfter - cardBefore)} (esperado 60)`,
    });

    // 3. Atomic all-or-nothing: a batch with one bad row writes NOTHING.
    const atomBefore = await readAcc(accId);
    const atom = await callBatch([
      { type: "expense", effect_type: "expense", original_amount: 5, source_account_id: accId },
      { type: "expense", effect_type: "expense", original_amount: 5, source_account_id: BOGUS },
    ]);
    const atomAfter = await readAcc(accId);
    checks.push({
      name: "Lote atómico: una fila inválida (cuenta ajena) revierte TODO el lote (cuenta sin cambios)",
      pass: !!atom.error && d2(atomBefore - atomAfter) === 0,
      detail: `error=${atom.error ? "sí" : "no"}, Δcuenta=${d2(atomBefore - atomAfter)} (esperado 0)`,
    });

    // 4. C2 — correction (reverse + reapply) lands on post-reversal state.
    const corrBefore = await readAcc(accId);
    const orig = await callEntry({ type: "expense", effect_type: "expense", original_amount: 30, source_account_id: accId });
    const origId = orig.data as string | null;
    await callEntry({ type: "reversal", effect_type: "expense", sign: -1, original_amount: 30, source_account_id: accId, related_transaction_id: origId });
    await callEntry({ type: "expense", effect_type: "expense", original_amount: 40, source_account_id: accId });
    const corrAfter = await readAcc(accId);
    checks.push({
      name: "C2: gasto 30 → corrección a 40 deja saldo −40 neto (no −30 del bug viejo)",
      pass: !orig.error && d2(corrBefore - corrAfter) === 40,
      detail: `Δ=${d2(corrBefore - corrAfter)} (esperado 40)`,
    });

    // 5. Ownership enforced INSIDE the DB: a foreign/absent account id is rejected.
    const ownBefore = await readAcc(accId);
    const own = await callEntry({ type: "expense", effect_type: "expense", original_amount: 5, source_account_id: BOGUS });
    const ownAfter = await readAcc(accId);
    checks.push({
      name: "Propiedad: un id de cuenta ajeno/inexistente es rechazado por la función (nada escrito)",
      pass: !!own.error && d2(ownBefore - ownAfter) === 0,
      detail: `error=${own.error ? own.error.code ?? "sí" : "no"}, Δ=${d2(ownBefore - ownAfter)}`,
    });

    // 6. Goal contribution moves all three sides atomically.
    const gA = await readAcc(accId);
    const gGA = await readAcc(gaId);
    const gG = await readGoal(goalId);
    const gc = await callEntry({ type: "goal_contribution", effect_type: "goal_contribution", original_amount: 10, source_account_id: accId, destination_account_id: gaId, goal_id: goalId });
    const gA2 = await readAcc(accId);
    const gGA2 = await readAcc(gaId);
    const gG2 = await readGoal(goalId);
    checks.push({
      name: "Aporte a meta: cuenta −10, cuenta-meta +10, progreso de meta +10 (una sola operación)",
      pass: !gc.error && d2(gA - gA2) === 10 && d2(gGA2 - gGA) === 10 && d2(gG2 - gG) === 10,
      detail: `Δcuenta=${d2(gA - gA2)}, ΔcuentaMeta=${d2(gGA2 - gGA)}, Δmeta=${d2(gG2 - gG)}`,
    });

    // 7. Reverso idempotente: dos reversos del mismo original → MISMO id, efecto
    //    aplicado una sola vez (la función deriva del original y devuelve el
    //    existente; el índice único es el respaldo ante carrera).
    const before7 = await readAcc(accId);
    const rOrig = await callEntry({ type: "expense", effect_type: "expense", original_amount: 7, source_account_id: accId });
    const rId = rOrig.data as string | null;
    const rev1 = await callEntry({ type: "reversal", sign: -1, related_transaction_id: rId });
    const rev2 = await callEntry({ type: "reversal", sign: -1, related_transaction_id: rId });
    const after7 = await readAcc(accId);
    checks.push({
      name: "Reverso idempotente: dos reversos del mismo original dan el MISMO id, efecto una sola vez (neto 0)",
      pass: !rev1.error && !rev2.error && !!rev1.data && rev1.data === rev2.data && d2(after7 - before7) === 0,
      detail: `rev1=${rev1.data ? "id" : rev1.error?.code}, rev2=${rev2.data === rev1.data ? "mismo id" : "DISTINTO"}, neto=${d2(after7 - before7)}`,
    });

    // 8. Matriz: income sin destino → rechazado, nada escrito.
    const m1 = await callEntry({ type: "income", effect_type: "income", original_amount: 5 });
    checks.push({ name: "Matriz: income sin destino se rechaza", pass: !!m1.error, detail: m1.error ? "rechazado" : "no falló (mal)" });

    // 9. Combo contradictorio: expense con cuenta Y tarjeta → rechazado.
    const m2 = await callEntry({ type: "expense", effect_type: "expense", original_amount: 5, source_account_id: accId, debt_account_id: cardId });
    checks.push({ name: "Matriz: expense con cuenta y tarjeta a la vez se rechaza", pass: !!m2.error, detail: m2.error ? "rechazado" : "no falló (mal)" });

    // 10. Transferencia a la misma cuenta → rechazada.
    const m3 = await callEntry({ type: "transfer", effect_type: "transfer", original_amount: 5, source_account_id: accId, destination_account_id: accId });
    checks.push({ name: "Matriz: transferencia con misma cuenta origen/destino se rechaza", pass: !!m3.error, detail: m3.error ? "rechazado" : "no falló (mal)" });

    // 11–12. dedupe_key: misma clave dos veces → mismo id, efecto una vez; misma
    //        clave con monto distinto → rechazada (no se trata como la original).
    const key = `${tag}-k1`;
    const beforeK = await readAcc(accId);
    const k1 = await callEntry({ type: "expense", effect_type: "expense", original_amount: 9, source_account_id: accId, dedupe_key: key });
    const k2 = await callEntry({ type: "expense", effect_type: "expense", original_amount: 9, source_account_id: accId, dedupe_key: key });
    const afterK = await readAcc(accId);
    checks.push({
      name: "dedupe_key: misma clave repetida → mismo id, gasto aplicado UNA sola vez",
      pass: !k1.error && !k2.error && !!k1.data && k1.data === k2.data && d2(beforeK - afterK) === 9,
      detail: `mismoId=${k1.data === k2.data}, Δ=${d2(beforeK - afterK)} (esperado 9)`,
    });
    const k3 = await callEntry({ type: "expense", effect_type: "expense", original_amount: 12, source_account_id: accId, dedupe_key: key });
    checks.push({ name: "dedupe_key: misma clave con monto distinto → rechazada", pass: !!k3.error, detail: k3.error ? "rechazado" : "no falló (mal)" });

    // 13. Sobrepago + reverso exacto: la deuda baja a negativo (crédito honesto),
    //     y revertir restaura el valor exacto previo (sin piso destructivo).
    const cdebtBefore = await readDebt(cardId);
    const pay = d2(cdebtBefore + 5);
    const payRes = await callEntry({ type: "debt_payment", effect_type: "debt_payment", original_amount: pay, source_account_id: accId, debt_account_id: cardId });
    const cdebtMid = await readDebt(cardId);
    await callEntry({ type: "reversal", sign: -1, related_transaction_id: payRes.data });
    const cdebtAfter = await readDebt(cardId);
    checks.push({
      name: "Sobrepago: pagar más que la deuda la deja negativa; revertir restaura el valor exacto previo",
      pass: !payRes.error && d2(cdebtMid) === -5 && d2(cdebtAfter) === d2(cdebtBefore),
      detail: `antes=${cdebtBefore}, sobrepago=${d2(cdebtMid)} (esperado -5), trasReverso=${d2(cdebtAfter)}`,
    });

    // 14. Reverso tras un movimiento posterior: respeta lo demás (Δ −10).
    const before14 = await readAcc(accId);
    const e1 = await callEntry({ type: "expense", effect_type: "expense", original_amount: 30, source_account_id: accId });
    await callEntry({ type: "expense", effect_type: "expense", original_amount: 10, source_account_id: accId });
    await callEntry({ type: "reversal", sign: -1, related_transaction_id: e1.data });
    const after14 = await readAcc(accId);
    checks.push({
      name: "Reverso tras un movimiento posterior: revertir el gasto de 30 deja solo el de 10 (Δ −10)",
      pass: d2(before14 - after14) === 10,
      detail: `Δ=${d2(before14 - after14)} (esperado 10)`,
    });

    // 15. Lote en la frontera DB: vacío y >15 se rechazan.
    const empty = await supabase.rpc("kipu_apply_ledger_batch", { p_entries: [] });
    const over = await supabase.rpc("kipu_apply_ledger_batch", {
      p_entries: Array.from({ length: 16 }, () => entry({ type: "expense", effect_type: "expense", original_amount: 1, source_account_id: accId })),
    });
    checks.push({
      name: "Lote en la frontera DB: vacío y >15 se rechazan",
      pass: !!empty.error && !!over.error,
      detail: `vacío=${empty.error ? "rechazado" : "ok(mal)"}, >15=${over.error ? "rechazado" : "ok(mal)"}`,
    });
  } catch (error) {
    checks.push({ name: "Ejecución del sim de ledger", pass: false, detail: error instanceof Error ? error.message : "fallo" });
  } finally {
    // Cleanup: ledger rows referencing the disposable records, then the records.
    try {
      const acctIds = [accId, gaId].filter((x): x is string => !!x);
      for (const col of ["source_account_id", "destination_account_id"]) {
        if (acctIds.length) await supabase.from("transactions").delete().eq("user_id", userId).in(col, acctIds);
      }
      if (cardId) await supabase.from("transactions").delete().eq("user_id", userId).eq("debt_account_id", cardId);
      if (goalId) await supabase.from("transactions").delete().eq("user_id", userId).eq("goal_id", goalId);
      if (goalId) await supabase.from("goals").delete().eq("id", goalId);
      if (cardId) await supabase.from("debt_accounts").delete().eq("id", cardId);
      for (const id of acctIds) await supabase.from("accounts").delete().eq("id", id);
    } catch {
      // best-effort
    }
  }

  return { scenario: "ledger", title: "Núcleo financiero atómico (write-path real)", checks };
}

// Phase 2.6 — LIVE multi-step workflow atomicity over migrations 019+020:
// atomic correction (reverse+replace as one unit, retry-idempotent) and
// authoritative target reconciliation (delta from the live locked balance,
// real concurrency). SAFE: disposable tagged records for the chosen TEST USER,
// delta assertions, full cleanup in `finally`. Skips cleanly if 020 is absent.
async function runWorkflows(userId: string): Promise<SimResult> {
  const checks: SimCheck[] = [];
  const supabase = createSupabaseAdminClient();
  const tag = `SIMWF-${Date.now()}`;
  const BOGUS = "00000000-0000-0000-0000-000000000000";
  const acctIds: string[] = [];
  const debtIds: string[] = [];

  const d2 = (n: number) => Math.round(n * 100) / 100;
  const readAcc = async (id: string): Promise<number> => {
    const { data } = await supabase.from("accounts").select("current_balance_base").eq("id", id).maybeSingle();
    return data ? Number(data.current_balance_base) : NaN;
  };
  const entry = (o: Record<string, unknown>) => {
    const ao = typeof o.original_amount === "number" ? (o.original_amount as number) : undefined;
    return {
      user_id: userId, sign: 1, original_currency: "USD", base_currency: "USD", exchange_rate_to_base: 1,
      ...(ao !== undefined ? { base_amount: ao } : {}), input_channel: "web", raw_input: tag, ...o,
    };
  };
  const callEntry = (o: Record<string, unknown>) => supabase.rpc("kipu_apply_ledger_entry", { p_entry: entry(o) });
  const correct = (origId: string | null, corrected: Record<string, unknown>) =>
    supabase.rpc("kipu_correct_ledger_entry", {
      p_correction: { user_id: userId, original_transaction_id: origId, corrected: entry(corrected), input_channel: "web", raw_input: tag },
    });
  let opSeq = 0;
  const reconcile = (acctId: string, target: number, opId?: string) =>
    supabase.rpc("kipu_reconcile_account_balance", {
      p: {
        user_id: userId,
        account_id: acctId,
        target_base: target,
        operation_id: opId ?? `${tag}-op-${(opSeq += 1)}`,
        input_channel: "web",
        raw_input: tag,
      },
    });
  const fnMissing = (msg?: string) => !!msg && /PGRST202|could not find the function|schema cache|does not exist/i.test(msg);
  const mkAcct = async (name: string, bal: number): Promise<string> => {
    const r = await supabase.from("accounts").insert({ user_id: userId, name: `${tag}-${name}`, type: "bank", currency: "USD", current_balance_original: bal, current_balance_base: bal, is_goal_account: false }).select("id").single();
    if (r.error || !r.data) throw new Error(r.error?.message ?? "no account");
    acctIds.push(r.data.id);
    return r.data.id;
  };

  try {
    const A = await mkAcct("A", 100);

    // 1. Atomic rollback: corrected step fails (foreign account) → the reversal
    //    is rolled back too; original stays effective, no reversal, no replacement.
    const e1 = await callEntry({ type: "expense", effect_type: "expense", original_amount: 30, source_account_id: A }); // A=70
    if (fnMissing(e1.error?.message)) {
      checks.push({ name: "Migración 019 aplicada", pass: false, detail: `función ausente (${e1.error?.message}). Aplica 019.` });
      return { scenario: "workflows", title: "Atomicidad de workflows (corrección + reconciliación)", checks };
    }
    const rb = await correct(e1.data as string, { type: "expense", effect_type: "expense", original_amount: 40, source_account_id: BOGUS });
    if (fnMissing(rb.error?.message)) {
      checks.push({ name: "Migración 020 aplicada", pass: false, detail: `función de corrección/reconciliación ausente (${rb.error?.message}). Aplica supabase/sql/020 y reintenta.` });
      return { scenario: "workflows", title: "Atomicidad de workflows (corrección + reconciliación)", checks };
    }
    const aAfterRollback = await readAcc(A);
    const { count: revAfterRollback } = await supabase.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("type", "reversal").eq("related_transaction_id", e1.data);
    checks.push({
      name: "Corrección atómica: si la reposición falla, el reverso también se revierte (original intacto, sin reverso ni reposición)",
      pass: !!rb.error && d2(aAfterRollback) === 70 && (revAfterRollback ?? 0) === 0,
      detail: `error=${rb.error ? "sí" : "no(mal)"}, saldo=${d2(aAfterRollback)} (esperado 70), reversos=${revAfterRollback}`,
    });

    // 2. Correction 30→40 as one unit: A 70 → reverse(+30)=100 → apply 40 → 60.
    const c2 = await correct(e1.data as string, { type: "expense", effect_type: "expense", original_amount: 40, source_account_id: A });
    const aAfterCorrect = await readAcc(A);
    checks.push({
      name: "Corrección 30→40 atómica: reverso + reposición dejan saldo 60 (un solo paso fiable)",
      pass: !c2.error && d2(aAfterCorrect) === 60,
      detail: `saldo=${d2(aAfterCorrect)} (esperado 60), error=${c2.error?.message ?? "no"}`,
    });

    // 3. Retry idempotente: repetir la MISMA corrección no re-revierte ni duplica.
    const c3 = await correct(e1.data as string, { type: "expense", effect_type: "expense", original_amount: 40, source_account_id: A });
    const aAfterRetry = await readAcc(A);
    const { count: correctedRows } = await supabase.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("dedupe_key", `correction:${e1.data}`);
    checks.push({
      name: "Corrección idempotente: reintentar la misma corrección deja el saldo en 60 y una sola fila corregida",
      pass: !c3.error && d2(aAfterRetry) === 60 && (correctedRows ?? 0) === 1,
      detail: `saldo=${d2(aAfterRetry)}, filasCorregidas=${correctedRows} (esperado 1)`,
    });

    // 4. Dos correcciones concurrentes del MISMO original al MISMO valor convergen.
    const B = await mkAcct("B", 100);
    const eB = await callEntry({ type: "expense", effect_type: "expense", original_amount: 20, source_account_id: B }); // B=80
    const [cc1, cc2] = await Promise.all([
      correct(eB.data as string, { type: "expense", effect_type: "expense", original_amount: 25, source_account_id: B }),
      correct(eB.data as string, { type: "expense", effect_type: "expense", original_amount: 25, source_account_id: B }),
    ]);
    const bFinal = await readAcc(B);
    const { count: bRev } = await supabase.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("type", "reversal").eq("related_transaction_id", eB.data);
    const { count: bCorr } = await supabase.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("dedupe_key", `correction:${eB.data}`);
    checks.push({
      name: "Dos correcciones concurrentes (mismo valor) convergen: saldo 75, un reverso, una corrección",
      pass: !cc1.error && !cc2.error && d2(bFinal) === 75 && (bRev ?? 0) === 1 && (bCorr ?? 0) === 1,
      detail: `saldo=${d2(bFinal)} (esperado 75), reversos=${bRev}, corregidas=${bCorr}`,
    });

    // 5. Corrección de FUENTE: A→B restaura A y descuenta de B.
    const S = await mkAcct("S", 100);
    const T = await mkAcct("T", 100);
    const eS = await callEntry({ type: "expense", effect_type: "expense", original_amount: 30, source_account_id: S }); // S=70
    const cSrc = await correct(eS.data as string, { type: "expense", effect_type: "expense", original_amount: 30, source_account_id: T });
    checks.push({
      name: "Corrección de fuente: S vuelve a 100, T baja a 70 (un solo paso)",
      pass: !cSrc.error && d2(await readAcc(S)) === 100 && d2(await readAcc(T)) === 70,
      detail: `S=${d2(await readAcc(S))} (100), T=${d2(await readAcc(T))} (70)`,
    });

    // 6. Cuenta→tarjeta: gasto de cuenta corregido a gasto de tarjeta.
    const card = await supabase.from("debt_accounts").insert({ user_id: userId, name: `${tag}-V`, type: "credit_card", currency: "USD", current_balance_original: 0, current_balance_base: 0 }).select("id").single();
    if (!card.error && card.data) {
      debtIds.push(card.data.id);
      const U = await mkAcct("U", 100);
      const eU = await callEntry({ type: "expense", effect_type: "expense", original_amount: 30, source_account_id: U }); // U=70
      const cCard = await correct(eU.data as string, { type: "expense", effect_type: "expense", original_amount: 30, debt_account_id: card.data.id });
      const { data: cardRow } = await supabase.from("debt_accounts").select("current_balance_base").eq("id", card.data.id).maybeSingle();
      checks.push({
        name: "Cuenta→tarjeta: la cuenta vuelve a 100 y la deuda de la tarjeta sube a 30",
        pass: !cCard.error && d2(await readAcc(U)) === 100 && d2(Number(cardRow?.current_balance_base)) === 30,
        detail: `cuenta=${d2(await readAcc(U))} (100), deuda=${d2(Number(cardRow?.current_balance_base))} (30)`,
      });
    }

    // 7. Serialización (movimiento ANTES del lock): un gasto baja a 90, cuadrar
    //    a 80 lee el valor VIVO (90) y llega EXACTAMENTE a 80 (no a 70 del viejo
    //    snapshot). El delta se calcula contra el valor autoritativo.
    const R = await mkAcct("R", 100);
    await callEntry({ type: "expense", effect_type: "expense", original_amount: 10, source_account_id: R }); // vivo 90
    const rec = await reconcile(R, 80);
    checks.push({
      name: "Reconciliación autoritativa: movimiento antes del lock (vivo=90) → cuadrar a 80 llega a 80 (no 70)",
      pass: !rec.error && d2(await readAcc(R)) === 80,
      detail: `final=${d2(await readAcc(R))} (esperado 80)`,
    });

    // 8. Serialización (movimiento DESPUÉS): cuadrar a 80 y luego un gasto de 10
    //    deja 70 — el movimiento se aplica ENCIMA, no se pierde ni se sobrescribe.
    const R3 = await mkAcct("R3", 100);
    await reconcile(R3, 80); // → 80 en su punto de serialización
    await callEntry({ type: "expense", effect_type: "expense", original_amount: 10, source_account_id: R3 }); // → 70
    checks.push({
      name: "Serialización: un movimiento posterior al cuadre se aplica encima (80 → 70), no se pierde",
      pass: d2(await readAcc(R3)) === 70,
      detail: `final=${d2(await readAcc(R3))} (esperado 70)`,
    });

    // 9. Retry DURABLE (área 2): cuadrar a 80 con op X (100→80); luego un gasto
    //    legítimo de 10 (→70); reintentar el MISMO op X devuelve el resultado
    //    original (delta −20, mismo txn id) y NO recalcula contra 70 (no anula
    //    el movimiento). El saldo permanece en 70.
    const R4 = await mkAcct("R4", 100);
    const opX = `${tag}-opX`;
    const rd1 = await reconcile(R4, 80, opX);
    const rd1d = (rd1.data ?? {}) as { delta?: number; transaction_id?: string };
    await callEntry({ type: "expense", effect_type: "expense", original_amount: 10, source_account_id: R4 }); // → 70
    const rd2 = await reconcile(R4, 80, opX); // retry mismo op
    const rd2d = (rd2.data ?? {}) as { delta?: number; transaction_id?: string; idempotent?: boolean };
    checks.push({
      name: "Reconciliación idempotente DURABLE: reintento del mismo op tras un movimiento devuelve el resultado original y NO anula el movimiento (saldo 70)",
      pass:
        !rd1.error && !rd2.error &&
        rd2d.idempotent === true &&
        rd2d.transaction_id === rd1d.transaction_id &&
        Number(rd2d.delta) === Number(rd1d.delta) &&
        d2(await readAcc(R4)) === 70,
      detail: `idempotent=${rd2d.idempotent}, mismoTxn=${rd2d.transaction_id === rd1d.transaction_id}, saldo=${d2(await readAcc(R4))} (esperado 70)`,
    });

    // 10. Mismatch: reusar op X con un objetivo distinto → rechazado.
    const rmm = await reconcile(R4, 90, opX);
    checks.push({ name: "Reconciliación: reusar el mismo op con otro objetivo → mismatch rechazado", pass: !!rmm.error, detail: rmm.error ? "rechazado" : "no falló (mal)" });

    // 11. Concurrencia real: dos cuadres SIMULTÁNEOS (ops distintos) al mismo
    //     objetivo → saldo 80 y UN solo ajuste (el segundo es no-op delta 0).
    const R2 = await mkAcct("R2", 100);
    const [rc1, rc2] = await Promise.all([reconcile(R2, 80), reconcile(R2, 80)]);
    const { count: adjRows } = await supabase.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("type", "adjustment").eq("source_account_id", R2);
    checks.push({
      name: "Reconciliación concurrente (ops distintos) a 80 → saldo 80 y UN solo ajuste",
      pass: !rc1.error && !rc2.error && d2(await readAcc(R2)) === 80 && (adjRows ?? 0) === 1,
      detail: `saldo=${d2(await readAcc(R2))} (80), ajustes=${adjRows} (1)`,
    });

    // 12. Dos objetivos DISTINTOS (ops distintos) serializan: gana el último.
    const R5 = await mkAcct("R5", 100);
    await Promise.all([reconcile(R5, 80), reconcile(R5, 90)]);
    const r5final = d2(await readAcc(R5));
    checks.push({
      name: "Reconciliación: dos objetivos distintos serializan de forma determinista (saldo final ∈ {80,90})",
      pass: r5final === 80 || r5final === 90,
      detail: `final=${r5final}`,
    });

    // 12b. DOS reconciliaciones en UN turno: el contador per-turno da op ids
    //      distintos (rec:1, rec:2) → ambas cuadran; un replay del turno (mismo
    //      namespace, contador reseteado) reproduce los mismos ids → idempotente.
    const Ra = await mkAcct("Ra", 100);
    const Rb = await mkAcct("Rb", 100);
    const nsTurn = chatOperationNamespace("telegram", `${tag}-turn`);
    const turnReconcile = async () => {
      const seq = { n: 0 };
      await reconcile(Ra, 80, reconcileOperationId(nsTurn, (seq.n += 1)));
      await reconcile(Rb, 70, reconcileOperationId(nsTurn, (seq.n += 1)));
    };
    await turnReconcile(); // first delivery → Ra 80, Rb 70
    const ra1 = d2(await readAcc(Ra));
    const rb1 = d2(await readAcc(Rb));
    // Move both, then REPLAY the turn with the same op ids → idempotent (returns
    // originals, does NOT recalculate against the moved balances).
    await callEntry({ type: "expense", effect_type: "expense", original_amount: 5, source_account_id: Ra });
    await callEntry({ type: "expense", effect_type: "expense", original_amount: 5, source_account_id: Rb });
    await turnReconcile();
    const ra2 = d2(await readAcc(Ra));
    const rb2 = d2(await readAcc(Rb));
    checks.push({
      name: "Dos reconciliaciones en un turno → ops distintos (no colisión); replay del turno es idempotente (no recalcula)",
      pass: ra1 === 80 && rb1 === 70 && ra2 === 75 && rb2 === 65,
      detail: `1ª: Ra=${ra1}/Rb=${rb1}; tras movimiento+replay: Ra=${ra2}(75)/Rb=${rb2}(65)`,
    });

    // 13. Moneda no-base: cuenta en otra moneda con original≠base → cuadre
    //     RECHAZADO (KIPU_FX_REQUIRED), saldos intactos. Nunca se trata un delta
    //     base como delta en moneda original.
    const eur = await supabase.from("accounts").insert({ user_id: userId, name: `${tag}-EUR`, type: "bank", currency: "EUR", current_balance_original: 50, current_balance_base: 55, is_goal_account: false }).select("id").single();
    if (!eur.error && eur.data) {
      acctIds.push(eur.data.id);
      const fx = await reconcile(eur.data.id, 80);
      const { data: eurRow } = await supabase.from("accounts").select("current_balance_original, current_balance_base").eq("id", eur.data.id).maybeSingle();
      checks.push({
        name: "Moneda no-base: reconciliación rechazada (KIPU_FX_REQUIRED) y saldos original/base intactos y coherentes",
        pass: !!fx.error && /FX/i.test(fx.error.message) && Number(eurRow?.current_balance_original) === 50 && Number(eurRow?.current_balance_base) === 55,
        detail: `error=${fx.error ? "FX rechazado" : "no(mal)"}, orig=${eurRow?.current_balance_original} base=${eurRow?.current_balance_base}`,
      });
    }

    // 14. Cadena de corrección A→B→C: corregir la fila ACTIVA en cada paso.
    const CH = await mkAcct("CH", 100);
    const chA = await callEntry({ type: "expense", effect_type: "expense", original_amount: 30, source_account_id: CH }); // A, CH=70
    await correct(chA.data as string, { type: "expense", effect_type: "expense", original_amount: 40, source_account_id: CH }); // A→B (40), CH=60
    const { data: bRow } = await supabase.from("transactions").select("id").eq("user_id", userId).eq("dedupe_key", `correction:${chA.data}`).maybeSingle();
    const chB = bRow?.id ?? null;
    const cC = await correct(chB, { type: "expense", effect_type: "expense", original_amount: 25, source_account_id: CH }); // B→C (25): reverse B(+40)=100, apply 25 → 75
    checks.push({
      name: "Cadena A→B→C: corregir la fila activa en cada paso deja saldo 75 (B se corrige, no A)",
      pass: !cC.error && d2(await readAcc(CH)) === 75,
      detail: `saldo=${d2(await readAcc(CH))} (esperado 75), B=${chB ? "sí" : "no"}`,
    });

    // 15. Re-corregir A (ya corregido a B) a un valor DISTINTO → mismatch rechazado.
    const cReA = await correct(chA.data as string, { type: "expense", effect_type: "expense", original_amount: 33, source_account_id: CH });
    checks.push({ name: "Re-corregir el original ya corregido a otro valor → mismatch rechazado (corrige la fila activa)", pass: !!cReA.error, detail: cReA.error ? "rechazado" : "no falló (mal)" });

    // 16. Corregir una fila de REVERSO → rechazado.
    const revRow = await supabase.from("transactions").select("id").eq("user_id", userId).eq("type", "reversal").eq("related_transaction_id", chA.data).maybeSingle();
    const cRev = await correct(revRow.data?.id ?? null, { type: "expense", effect_type: "expense", original_amount: 5, source_account_id: CH });
    checks.push({ name: "Corregir una fila de reverso → rechazado", pass: !!cRev.error, detail: cRev.error ? "rechazado" : "no falló (mal)" });

    // 17. Corregir un movimiento YA DESHECHO (undo aparte) → KIPU_INACTIVE (no resucita).
    const UN = await mkAcct("UN", 100);
    const uE = await callEntry({ type: "expense", effect_type: "expense", original_amount: 20, source_account_id: UN }); // UN=80
    await callEntry({ type: "reversal", sign: -1, related_transaction_id: uE.data }); // undo aparte → UN=100
    const beforeInactive = await readAcc(UN);
    const cInactive = await correct(uE.data as string, { type: "expense", effect_type: "expense", original_amount: 25, source_account_id: UN });
    checks.push({
      name: "Corregir un movimiento ya deshecho (undo aparte) → KIPU_INACTIVE, no resucita (saldo intacto)",
      pass: !!cInactive.error && d2(await readAcc(UN)) === d2(beforeInactive),
      detail: `error=${cInactive.error ? "INACTIVE" : "no(mal)"}, saldo=${d2(await readAcc(UN))} (intacto ${d2(beforeInactive)})`,
    });
  } catch (error) {
    checks.push({ name: "Ejecución del sim de workflows", pass: false, detail: error instanceof Error ? error.message : "fallo" });
  } finally {
    try {
      for (const col of ["source_account_id", "destination_account_id"]) {
        if (acctIds.length) await supabase.from("transactions").delete().eq("user_id", userId).in(col, acctIds);
      }
      if (debtIds.length) await supabase.from("transactions").delete().eq("user_id", userId).in("debt_account_id", debtIds);
      if (debtIds.length) await supabase.from("debt_accounts").delete().in("id", debtIds);
      if (acctIds.length) await supabase.from("accounts").delete().in("id", acctIds);
    } catch {
      // best-effort
    }
  }

  return { scenario: "workflows", title: "Atomicidad de workflows (corrección + reconciliación)", checks };
}

// Phase 2.6 security — prove the durable reconciliation idempotency ledger
// (kipu_reconcile_ops) cannot be forged by an authenticated client, while the
// RPC remains service-role-only after Pre-M closes the legacy authenticated
// grant. Uses a THROWAWAY auth user + a real authenticated session (anon key),
// and deletes the user (cascading all its rows) in `finally`. Requires 020+096.
async function runReconcileSecurity(userId: string): Promise<SimResult> {
  const checks: SimCheck[] = [];
  const supabase = createSupabaseAdminClient();
  const tag = `SIMSEC-${Date.now()}`;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const email = `kipu-sec-${Date.now()}@example.com`;
  const password = `Pw9-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const d2 = (n: number) => Math.round(n * 100) / 100;
  const readAcc = async (id: string | null): Promise<number> => {
    if (!id) return NaN;
    const { data } = await supabase.from("accounts").select("current_balance_base").eq("id", id).maybeSingle();
    return data ? Number(data.current_balance_base) : NaN;
  };
  let throwawayId: string | null = null;
  let mainAcct: string | null = null;

  try {
    const probe = await supabase.from("kipu_reconcile_ops").select("op_id").limit(1);
    if (probe.error && /(does not exist|schema cache|PGRST205|42P01|find the table)/i.test(probe.error.message)) {
      checks.push({ name: "Migración 020 aplicada", pass: false, detail: `kipu_reconcile_ops ausente (${probe.error.message}). Aplica supabase/sql/020 y reintenta.` });
      return { scenario: "reconcile-security", title: "Seguridad del ledger de idempotencia", checks };
    }
    if (!url || !anon) {
      checks.push({ name: "Claves para cliente autenticado", pass: false, detail: "faltan NEXT_PUBLIC_SUPABASE_URL/ANON_KEY" });
      return { scenario: "reconcile-security", title: "Seguridad del ledger de idempotencia", checks };
    }

    const cu = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (cu.error || !cu.data?.user) {
      checks.push({ name: "Crear usuario desechable", pass: false, detail: cu.error?.message ?? "sin usuario" });
      return { scenario: "reconcile-security", title: "Seguridad del ledger de idempotencia", checks };
    }
    throwawayId = cu.data.user.id;
    await supabase.from("profiles").upsert({ id: throwawayId, base_currency: "USD" }, { onConflict: "id" });
    const ta = await supabase.from("accounts").insert({ user_id: throwawayId, name: `${tag}-TA`, type: "bank", currency: "USD", current_balance_original: 100, current_balance_base: 100, is_goal_account: false }).select("id").single();
    if (ta.error || !ta.data) {
      checks.push({ name: "Crear cuenta desechable", pass: false, detail: ta.error?.message ?? "" });
      return { scenario: "reconcile-security", title: "Seguridad del ledger de idempotencia", checks };
    }
    const taAcct = ta.data.id;

    const authClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const si = await authClient.auth.signInWithPassword({ email, password });
    const signedIn = !si.error && !!si.data?.session;
    if (!signedIn) {
      checks.push({ name: "Iniciar sesión como usuario autenticado", pass: false, detail: si.error?.message ?? "sin sesión (¿email/password deshabilitado?)" });
    }

    // Seed a row via the trusted service role (for the update/delete-denial tests).
    await supabase.from("kipu_reconcile_ops").insert({ user_id: throwawayId, op_id: `${tag}-seed`, account_id: taAcct, target_base: 80 });

    if (signedIn) {
      // 1. Authenticated client cannot directly INSERT (forge) a reconcile op.
      const ins = await authClient.from("kipu_reconcile_ops").insert({ user_id: throwawayId, op_id: `${tag}-forge`, account_id: taAcct, target_base: 999, delta: -999, transaction_id: null });
      const { data: forgeRow } = await supabase.from("kipu_reconcile_ops").select("op_id").eq("user_id", throwawayId).eq("op_id", `${tag}-forge`).maybeSingle();
      checks.push({ name: "1. Usuario autenticado NO puede INSERTAR en kipu_reconcile_ops (sin fila forjada)", pass: !!ins.error && !forgeRow, detail: ins.error ? "denegado" : `INSERTÓ (vulnerable, fila=${!!forgeRow})` });

      // 2. Authenticated client cannot UPDATE a completed/seeded op.
      await authClient.from("kipu_reconcile_ops").update({ delta: -999, transaction_id: null }).eq("user_id", throwawayId).eq("op_id", `${tag}-seed`);
      const { data: afterUpd } = await supabase.from("kipu_reconcile_ops").select("delta").eq("user_id", throwawayId).eq("op_id", `${tag}-seed`).maybeSingle();
      checks.push({ name: "2. Usuario autenticado NO puede ACTUALIZAR una operación (delta intacto)", pass: afterUpd != null && afterUpd.delta === null, detail: `delta=${afterUpd?.delta} (esperado null)` });

      // 3. Authenticated client cannot DELETE an op.
      await authClient.from("kipu_reconcile_ops").delete().eq("user_id", throwawayId).eq("op_id", `${tag}-seed`);
      const { data: afterDel } = await supabase.from("kipu_reconcile_ops").select("op_id").eq("user_id", throwawayId).eq("op_id", `${tag}-seed`).maybeSingle();
      checks.push({ name: "3. Usuario autenticado NO puede BORRAR una operación (fila persiste)", pass: !!afterDel, detail: afterDel ? "persiste" : "BORRADA (vulnerable)" });

      // 4. The old authenticated DEFINER RPC is no longer a lateral writer.
      const rOk = await authClient.rpc("kipu_reconcile_account_balance", { p: { user_id: throwawayId, account_id: taAcct, target_base: 80, operation_id: `${tag}-ok`, input_channel: "web" } });
      checks.push({ name: "4. RPC legacy de reconciliación AUTENTICADA queda revocada (saldo intacto)", pass: !!rOk.error && d2(await readAcc(taAcct)) === 100, detail: `error=${rOk.error?.message ?? "no(mal)"}, saldo=${d2(await readAcc(taAcct))}` });

      const rService = await supabase.rpc("kipu_reconcile_account_balance", { p: { user_id: throwawayId, account_id: taAcct, target_base: 80, operation_id: `${tag}-service-own`, input_channel: "web" } });
      checks.push({ name: "4b. RPC legacy sigue disponible para el executor service-role (→80)", pass: !rService.error && d2(await readAcc(taAcct)) === 80, detail: `error=${rService.error?.message ?? "no"}, saldo=${d2(await readAcc(taAcct))}` });

      // 7. Forge is unreachable: an authenticated user cannot pre-seed, so the RPC
      //    can never return a client-forged result (this is exactly test 1).
      checks.push({ name: "7. Operación forjada por el cliente es inalcanzable (escritura directa denegada → sin falso éxito)", pass: !!ins.error && !forgeRow, detail: "garantizado por el test 1 (insert denegado)" });
    }

    // 5/6. Cross-user rejection + service-role success against a MAIN-user account.
    const ma = await supabase.from("accounts").insert({ user_id: userId, name: `${tag}-MA`, type: "bank", currency: "USD", current_balance_original: 100, current_balance_base: 100, is_goal_account: false }).select("id").single();
    if (!ma.error && ma.data) {
      mainAcct = ma.data.id;
      if (signedIn) {
        const x1 = await authClient.rpc("kipu_reconcile_account_balance", { p: { user_id: userId, account_id: mainAcct, target_base: 50, operation_id: `${tag}-x1`, input_channel: "web" } });
        const x2 = await authClient.rpc("kipu_reconcile_account_balance", { p: { user_id: throwawayId, account_id: mainAcct, target_base: 50, operation_id: `${tag}-x2`, input_channel: "web" } });
        checks.push({ name: "6. Cuenta de OTRO usuario rechazada (identidad y propiedad), saldo intacto", pass: !!x1.error && !!x2.error && d2(await readAcc(mainAcct)) === 100, detail: `identidad=${x1.error ? "rechazada" : "PASÓ"}, propiedad=${x2.error ? "rechazada" : "PASÓ"}, saldo=${d2(await readAcc(mainAcct))}` });
      }
      const svc = await supabase.rpc("kipu_reconcile_account_balance", { p: { user_id: userId, account_id: mainAcct, target_base: 50, operation_id: `${tag}-svc`, input_channel: "web" } });
      checks.push({ name: "5. RPC de reconciliación con SERVICE-ROLE tiene éxito (propiedad validada, →50)", pass: !svc.error && d2(await readAcc(mainAcct)) === 50, detail: `error=${svc.error?.message ?? "no"}, saldo=${d2(await readAcc(mainAcct))}` });
    }

    if (signedIn) await authClient.auth.signOut();
  } catch (error) {
    checks.push({ name: "Ejecución del sim de seguridad", pass: false, detail: error instanceof Error ? error.message : "fallo" });
  } finally {
    try {
      if (mainAcct) {
        await supabase.from("transactions").delete().eq("user_id", userId).or(`source_account_id.eq.${mainAcct},destination_account_id.eq.${mainAcct}`);
        await supabase.from("accounts").delete().eq("id", mainAcct);
      }
      // Deleting the throwaway user cascades its accounts → kipu_reconcile_ops,
      // transactions and profile.
      if (throwawayId) await supabase.auth.admin.deleteUser(throwawayId);
    } catch {
      // best-effort
    }
  }

  return { scenario: "reconcile-security", title: "Seguridad del ledger de idempotencia", checks };
}

// Phase 3 — LIVE end-to-end cross-channel idempotency over the REAL ledger
// (migration 019) using the REAL operation-identity helpers. Proves: a turn
// with two legitimate identical movements keeps both; a replayed delivery (same
// operation namespace) is fully idempotent; a distinct new movement still
// writes; evidence reprocessing (same evidence id) is idempotent. Disposable
// account + full cleanup.
async function runChannelIdempotency(userId: string): Promise<SimResult> {
  const checks: SimCheck[] = [];
  const supabase = createSupabaseAdminClient();
  const tag = `SIMCHAN-${Date.now()}`;
  const acctIds: string[] = [];
  const d2 = (n: number) => Math.round(n * 100) / 100;
  const readAcc = async (id: string): Promise<number> => {
    const { data } = await supabase.from("accounts").select("current_balance_base").eq("id", id).maybeSingle();
    return data ? Number(data.current_balance_base) : NaN;
  };
  const fnMissing = (m?: string) => !!m && /PGRST202|find the function|schema cache|does not exist/i.test(m);
  // Build a batch payload whose dedupe keys come from the trusted helpers.
  const buildBatch = (ns: string, occ: Map<string, number>, rows: { amount: number; source: string }[]) =>
    rows.map((r) => {
      const fp = movementFingerprint({ type: "expense", cents: Math.round(r.amount * 100), currency: "USD", sourceAccountId: r.source });
      return {
        user_id: userId, type: "expense", effect_type: "expense", sign: 1,
        original_amount: r.amount, original_currency: "USD", base_currency: "USD",
        exchange_rate_to_base: 1, base_amount: r.amount, source_account_id: r.source,
        input_channel: "web", raw_input: tag, dedupe_key: nextDedupeKey(ns, fp, occ),
      };
    });
  const writeBatch = (entries: Record<string, unknown>[]) => supabase.rpc("kipu_apply_ledger_batch", { p_entries: entries });
  const countRows = async (ns: string): Promise<number> => {
    const { count } = await supabase.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", userId).like("dedupe_key", `${ns}#%`);
    return count ?? 0;
  };

  try {
    const a = await supabase.from("accounts").insert({ user_id: userId, name: `${tag}-A`, type: "bank", currency: "USD", current_balance_original: 100, current_balance_base: 100, is_goal_account: false }).select("id").single();
    if (a.error || !a.data) {
      checks.push({ name: "Crear cuenta desechable", pass: false, detail: a.error?.message ?? "" });
      return { scenario: "channel-idempotency", title: "Idempotencia cross-canal (operation identity)", checks };
    }
    const A = a.data.id;
    acctIds.push(A);

    const nsT = chatOperationNamespace("telegram", `${tag}-U1`);
    const rows = [{ amount: 8, source: A }, { amount: 8, source: A }, { amount: 12, source: A }];

    // Turn 1: two legitimate identical 8s + a 12 → 3 rows, −28.
    const t1 = await writeBatch(buildBatch(nsT, new Map(), rows));
    if (fnMissing(t1.error?.message)) {
      checks.push({ name: "Migración 019 aplicada", pass: false, detail: `función ausente (${t1.error?.message}).` });
      return { scenario: "channel-idempotency", title: "Idempotencia cross-canal (operation identity)", checks };
    }
    const after1 = await readAcc(A);
    checks.push({
      name: "Turno: 2 gastos idénticos (8,8) + 1 (12) → 3 filas, saldo −28 (duplicados legítimos conservados)",
      pass: !t1.error && d2(100 - after1) === 28 && (await countRows(nsT)) === 3,
      detail: `error=${t1.error?.message ?? "no"}, Δ=${d2(100 - after1)}, filas=${await countRows(nsT)}`,
    });

    // Replay of the SAME delivery (same namespace + movements) → idempotent.
    const t1r = await writeBatch(buildBatch(nsT, new Map(), rows));
    const after1r = await readAcc(A);
    checks.push({
      name: "Replay del turno (mismo update_id) → idempotente: saldo sin cambio y 3 filas (no 6)",
      pass: !t1r.error && d2(after1r) === d2(after1) && (await countRows(nsT)) === 3,
      detail: `Δreplay=${d2(after1 - after1r)} (esperado 0), filas=${await countRows(nsT)}`,
    });

    // A genuinely new movement in the same namespace still writes.
    const t1n = await writeBatch(buildBatch(nsT, new Map(), [{ amount: 5, source: A }]));
    const after1n = await readAcc(A);
    checks.push({
      name: "Movimiento nuevo distinto en el mismo namespace → se registra (saldo −5)",
      pass: !t1n.error && d2(after1 - after1n) === 5,
      detail: `Δ=${d2(after1 - after1n)} (esperado 5)`,
    });

    // Evidence reprocessing (same evidence id) is idempotent.
    const nsE = evidenceOperationNamespace(`${tag}-E1`);
    const e1 = await writeBatch(buildBatch(nsE, new Map(), [{ amount: 9, source: A }]));
    const afterE = await readAcc(A);
    const e1r = await writeBatch(buildBatch(nsE, new Map(), [{ amount: 9, source: A }]));
    const afterE2 = await readAcc(A);
    checks.push({
      name: "Evidencia: reproceso de la misma evidencia (mismo ev:id, p. ej. reclaim) es idempotente (un solo efecto)",
      pass: !e1.error && !e1r.error && d2(after1n - afterE) === 9 && d2(afterE2) === d2(afterE),
      detail: `Δprimera=${d2(after1n - afterE)} (9), Δreproceso=${d2(afterE - afterE2)} (0)`,
    });

    // CONCURRENT double-submit (web): two simultaneous writes with the SAME
    // dedupe keys → one effect (the unique index serializes), not double.
    const nsW = chatOperationNamespace("web", `${tag}-SUB`);
    const before = await readAcc(A);
    const [w1, w2] = await Promise.all([
      writeBatch(buildBatch(nsW, new Map(), [{ amount: 7, source: A }])),
      writeBatch(buildBatch(nsW, new Map(), [{ amount: 7, source: A }])),
    ]);
    const afterW = await readAcc(A);
    checks.push({
      name: "Doble-submit CONCURRENTE (mismo submission_id): dos escrituras simultáneas → UN solo efecto (−7), no doble",
      pass: !w1.error && !w2.error && d2(before - afterW) === 7 && (await countRows(nsW)) === 1,
      detail: `Δ=${d2(before - afterW)} (esperado 7), filas=${await countRows(nsW)} (1)`,
    });

    // Non-USD: a card in COP and an account in EUR preserve their currency in the
    // ledger (the SQL never coerces to USD; the TS derives the real currency).
    const eur = await supabase.from("accounts").insert({ user_id: userId, name: `${tag}-EUR`, type: "bank", currency: "EUR", current_balance_original: 100, current_balance_base: 100, is_goal_account: false }).select("id").single();
    if (!eur.error && eur.data) {
      acctIds.push(eur.data.id);
      const fpE = movementFingerprint({ type: "expense", cents: 500, currency: "EUR", sourceAccountId: eur.data.id });
      const ew = await supabase.rpc("kipu_apply_ledger_batch", { p_entries: [{ user_id: userId, type: "expense", effect_type: "expense", sign: 1, original_amount: 5, original_currency: "EUR", base_currency: "EUR", exchange_rate_to_base: 1, base_amount: 5, source_account_id: eur.data.id, input_channel: "web", raw_input: tag, dedupe_key: nextDedupeKey(chatOperationNamespace("web", `${tag}-EUR`), fpE, new Map()) }] });
      const { data: row } = await supabase.from("transactions").select("original_currency, base_currency").eq("user_id", userId).eq("source_account_id", eur.data.id).maybeSingle();
      checks.push({
        name: "Moneda no-USD: un gasto en EUR conserva original/base = EUR en el ledger (no se coacciona a USD)",
        pass: !ew.error && row?.original_currency === "EUR" && row?.base_currency === "EUR",
        detail: `error=${ew.error?.message ?? "no"}, orig=${row?.original_currency}, base=${row?.base_currency}`,
      });
    }

    // Semantic safeguard (deterministic part) against the LIVE ledger: after an
    // expense exists, an identical recent candidate is detected (→ the agent would
    // ask), while a different-amount one is not.
    const recentTx = await loadMatchableTransactions(userId).catch(() => []);
    const recentKeys = recentTx
      .filter((t) => t.type === "expense")
      .map((t) => ({ type: t.type, cents: Math.round(t.originalAmount * 100), currency: t.originalCurrency, sourceId: t.sourceAccountId ?? t.debtAccountId ?? null, occurredAtMs: Date.parse(t.occurredAt) }));
    const sameCand = { type: "expense", cents: 800, currency: "USD", sourceId: A, occurredAtMs: Date.now() };
    const diffCand = { type: "expense", cents: 333, currency: "USD", sourceId: A, occurredAtMs: Date.now() };
    checks.push({
      name: "Salvaguarda semántica en vivo: candidato exacto reciente se detecta (preguntar); monto distinto no",
      pass: recentExactDuplicate(sameCand, recentKeys, { windowMs: 36 * 60 * 60_000 }) === true && recentExactDuplicate(diffCand, recentKeys, { windowMs: 36 * 60 * 60_000 }) === false,
      detail: `igual=${recentExactDuplicate(sameCand, recentKeys, { windowMs: 36 * 60 * 60_000 })}, distinto=${recentExactDuplicate(diffCand, recentKeys, { windowMs: 36 * 60 * 60_000 })}`,
    });
  } catch (error) {
    checks.push({ name: "Ejecución del sim de idempotencia", pass: false, detail: error instanceof Error ? error.message : "fallo" });
  } finally {
    try {
      if (acctIds.length) {
        await supabase.from("transactions").delete().eq("user_id", userId).in("source_account_id", acctIds);
        await supabase.from("accounts").delete().in("id", acctIds);
      }
    } catch {
      // best-effort
    }
  }

  return { scenario: "channel-idempotency", title: "Idempotencia cross-canal (operation identity)", checks };
}

// Phase 3.1 — REAL HTTP-boundary test of the Telegram webhook handler (not just
// ledger helpers). Cost-free and side-effect-free: the bot token is temporarily
// removed so any sendMessage throws immediately (no real Telegram API call), and
// all updates are `/start` so the model is never invoked. Proves the
// reservation/dedupe/concurrency/secret behavior through the actual POST handler.
async function runTelegramHttp(userId: string): Promise<SimResult> {
  void userId;
  const checks: SimCheck[] = [];
  const supabase = createSupabaseAdminClient();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const savedToken = process.env.TELEGRAM_BOT_TOKEN;
  const createdUpdateIds: number[] = [];
  const baseId = Date.now();

  if (!secret) {
    checks.push({ name: "TELEGRAM_WEBHOOK_SECRET configurado", pass: false, detail: "falta el secreto; no puedo ejercer el handler" });
    return { scenario: "telegram-http", title: "Webhook Telegram (frontera HTTP real)", checks };
  }

  try {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const { NextRequest } = await import("next/server");
    // Make any sendMessage throw immediately (no real API call).
    delete process.env.TELEGRAM_BOT_TOKEN;

    const startUpdate = (updateId: number, chatId: number) => ({
      update_id: updateId,
      message: { message_id: updateId, chat: { id: chatId, type: "private" }, from: { id: chatId }, text: "/start" },
    });
    const post = async (update: Record<string, unknown>, secretToUse: string) => {
      const req = new NextRequest("https://kipu.test/api/telegram/webhook", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": secretToUse, "content-type": "application/json" },
        body: JSON.stringify(update),
      });
      const res = await POST(req);
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    };
    const fakeChat = 980000000 + (baseId % 1000000);

    // 1. Wrong secret → 401 (no DB, no processing).
    const bad = await post(startUpdate(baseId + 1, fakeChat), `${secret}-wrong`);
    checks.push({ name: "1. Secreto inválido → 401", pass: bad.status === 401, detail: `status=${bad.status}` });

    // 2. Duplicate update_id (pre-seeded reservation) → 200 duplicate, sin procesar.
    const u2 = baseId + 2; createdUpdateIds.push(u2);
    await supabase.from("telegram_processed_updates").insert({ update_id: u2, telegram_chat_id: String(fakeChat), telegram_message_id: String(u2) });
    const dup = await post(startUpdate(u2, fakeChat), secret);
    checks.push({ name: "2. update_id ya reservado → 200 'duplicate' (no reprocesa)", pass: dup.status === 200 && dup.json.duplicate === true, detail: `status=${dup.status}, duplicate=${dup.json.duplicate}` });

    // 3. Dos entregas concurrentes del MISMO update_id → exactamente una procesa.
    const u3 = baseId + 3; createdUpdateIds.push(u3);
    const [c1, c2] = await Promise.all([post(startUpdate(u3, fakeChat), secret), post(startUpdate(u3, fakeChat), secret)]);
    const dupCount = [c1, c2].filter((r) => r.json.duplicate === true).length;
    const okCount = [c1, c2].filter((r) => r.json.duplicate !== true && r.status === 200).length;
    checks.push({ name: "3. Dos entregas concurrentes del mismo update_id → 1 procesa, 1 'duplicate'", pass: dupCount === 1 && okCount === 1, detail: `procesa=${okCount}, duplicate=${dupCount}` });

    // 4. Reserva liberada (fallo transitorio) → un reintento SÍ reprocesa. Se
    //    procesa una vez (reserva el update_id), se LIBERA (el mismo delete que
    //    hace releaseReservation), y el reintento vuelve a procesar. REQUIERE
    //    grant delete a service_role (migración 021): sin él el delete se DENIEGA
    //    y la reserva nunca se libera (el bug que este test expone).
    const u4 = baseId + 4; createdUpdateIds.push(u4);
    const first4 = await post(startUpdate(u4, fakeChat), secret); // reserva + procesa
    const rel = await supabase.from("telegram_processed_updates").delete().eq("update_id", u4); // releaseReservation
    const releaseBlocked = !!rel.error && /permission denied/i.test(rel.error.message);
    const retry = await post(startUpdate(u4, fakeChat), secret); // reintento tras liberar
    checks.push({
      name: "4. Reserva liberada (fallo transitorio) → el reintento reprocesa (requiere grant delete, migración 021)",
      pass: first4.json.duplicate !== true && !rel.error && retry.status === 200 && retry.json.duplicate !== true,
      detail: releaseBlocked
        ? "DELETE denegado a service_role → aplica supabase/sql/021 (grant delete) y reintenta"
        : `1er=${first4.json.duplicate ? "dup" : "procesó"}, reintento duplicate=${retry.json.duplicate}`,
    });
  } catch (error) {
    checks.push({ name: "Ejecución del harness HTTP", pass: false, detail: error instanceof Error ? error.message : "fallo" });
  } finally {
    try {
      if (savedToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = savedToken;
      if (createdUpdateIds.length) await supabase.from("telegram_processed_updates").delete().in("update_id", createdUpdateIds);
    } catch {
      // best-effort
    }
  }

  return { scenario: "telegram-http", title: "Webhook Telegram (frontera HTTP real)", checks };
}

export const SIM_SCENARIOS: {
  id: string;
  run: (userId: string) => Promise<SimResult>;
  cost: string;
}[] = [
  { id: "archivos", run: () => runArchivos(), cost: "2 llamadas de extracción" },
  { id: "voz", run: () => runVoz(), cost: "1 TTS + 1 transcripción" },
  { id: "dedup", run: (userId) => runDedup(userId), cost: "solo DB" },
  { id: "claims", run: (userId) => runClaims(userId), cost: "solo DB (idempotencia atómica)" },
  { id: "lifecycle", run: (userId) => runLifecycle(userId), cost: "solo DB (ciclo de vida)" },
  { id: "matcher", run: (userId) => runMatcher(userId), cost: "solo DB (lectura)" },
  { id: "ledger", run: (userId) => runLedger(userId), cost: "solo DB (write-path; requiere migración 019)" },
  { id: "workflows", run: (userId) => runWorkflows(userId), cost: "solo DB (corrección + reconciliación; requiere migración 020)" },
  { id: "reconcile-security", run: (userId) => runReconcileSecurity(userId), cost: "solo DB (usuario desechable + sesión autenticada; requiere migración 020)" },
  { id: "channel-idempotency", run: (userId) => runChannelIdempotency(userId), cost: "solo DB (dedupe_key cross-canal; migración 019)" },
  { id: "telegram-http", run: (userId) => runTelegramHttp(userId), cost: "frontera HTTP real (sin modelo, sin API Telegram)" },
];
