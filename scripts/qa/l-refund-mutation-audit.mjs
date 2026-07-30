// Bloque L — mutation audit for the only in-scope change:
// record_person_payment refunds inherit their original registration.
//
// Requires the local Next dev server on port 3000. Every mutation is restored
// byte-for-byte in finally and a final residue comparison is mandatory.
//
//   node ./scripts/qa/l-refund-mutation-audit.mjs

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const cases = [
  {
    name: "LM1 the live executor bypasses the single refund planner",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "      const registration = planPersonRefundRegistration({",
    to: "      const registration = refundRegistrationDecision({",
    detector: "L-1d",
  },
  {
    name: "LM2 NULL historical treatment is replaced by invented Saldo",
    file: "src/lib/capture/capture-matching.ts",
    from: "      budgetTreatment: treatment,\n      relatedTransactionId: found.original.id,",
    to: '      budgetTreatment: treatment ?? "saldo",\n      relatedTransactionId: found.original.id,',
    detector: "L-1b",
  },
  {
    name: "LM3 an unreadable ledger is treated as no matching purchase",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      "      : null;\n" +
      "  return refundRegistrationDecision({\n" +
      "    original,",
    to:
      '      : { outcome: "none" } as const;\n' +
      "  return refundRegistrationDecision({\n" +
      "    original,",
    detector: "L-1c",
  },
  {
    name: "LM4 ambiguity is bypassed by the model's unrecorded flag",
    file: "src/lib/capture/capture-matching.ts",
    from:
      '  if (found?.outcome === "ambiguous") {\n' +
      "    return {\n" +
      '      outcome: "ask",\n' +
      '      reason: "ambiguous",\n' +
      "      candidates: found.count,\n" +
      "      options: found.candidates,\n" +
      "    };\n" +
      "  }",
    to:
      '  if (found?.outcome === "ambiguous" && !input.confirmedUnrecorded) {\n' +
      "    return {\n" +
      '      outcome: "ask",\n' +
      '      reason: "ambiguous",\n' +
      "      candidates: found.count,\n" +
      "      options: found.candidates,\n" +
      "    };\n" +
      "  }",
    detector: "L-1b",
  },
  {
    name: "LM5 the refund write drops its durable original transaction link",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      "        relatedTransactionId:\n" +
      "          registration.relatedTransactionId ?? undefined,",
    to: "        relatedTransactionId: undefined,",
    detector: "L-1d",
  },
  {
    name: "LM6 the refund reader silently shrinks from 60 days to 72 hours",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "        windowHours: REFUND_MATCH_WINDOW_DAYS * 24,",
    to: "        windowHours: 72,",
    detector: "L-1d",
  },
  {
    name: "LM7 one tool's category enum drifts from the canonical set",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "category: { type: \"string\", enum: [...FINANCIAL_CATEGORY_ENUM] }",
    to: 'category: { type: "string", enum: ["other"] }',
    occurrence: 1,
    detector: "L-1d",
  },
  {
    name: "LM8 prior partial refunds no longer cap the remaining amount",
    file: "src/lib/capture/capture-matching.ts",
    from: "    return remainingCents >= cents ? [{ row, remainingCents }] : [];",
    to: "    return row.cents >= cents ? [{ row, remainingCents }] : [];",
    detector: "L-1a",
  },
  {
    name: "LM9 the write trusts the model category instead of the fact",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "        category: registration.category as FinancialCategory,",
    to: '        category: category(args.category, "other"),',
    detector: "L-1d",
  },
  {
    name: "LM10 originalWasNotRecorded becomes authority without user evidence",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      "      input.originalWasNotRecorded === true &&\n" +
      "      refundOriginalWasNotRecorded(input.message),",
    to: "      input.originalWasNotRecorded === true,",
    detector: "L-1c",
  },
  {
    name: "LM11 the live caller falls back to the old 72-hour duplicate read",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      "      const refundRecent = await loadRefundContext(ctx.userId);",
    to:
      "      const refundRecent = await loadDuplicateContext(ctx.userId);",
    detector: "L-1d",
  },
  {
    name: "LM12 the executor ignores the planner's fail-closed ask",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: '      if (registration.outcome === "ask") {',
    to: '      if (false && registration.outcome === "ask") {',
    detector: "L-1d",
  },
  {
    name: "LM13 the write replaces inherited treatment with the model hint",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "        budgetTreatment: registration.budgetTreatment,",
    to:
      '        budgetTreatment: args.budgetTreatment === "saldo" ? "saldo" : null,',
    detector: "L-1d",
  },
  {
    name: "LM14 correct_movement silently accepts a free-text newCategory again",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      '          newCategory: { type: "string", enum: [...FINANCIAL_CATEGORY_ENUM] },',
    to: '          newCategory: { type: "string" },',
    detector: "L-1d",
  },
  {
    name: "LM15 a purchase-only category schema accidentally accepts income",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "enum: [...PURCHASE_CATEGORY_ENUM],",
    to: "enum: [...FINANCIAL_CATEGORY_ENUM],",
    occurrence: 1,
    detector: "L-1d",
  },
  {
    name: "LM16 ambiguity drops the exact candidates found by the complete 60-day read",
    file: "src/lib/capture/capture-matching.ts",
    from: "      options: found.candidates,",
    to: "      options: [],",
    detector: "L-1b",
  },
  {
    name: "LM17 a legacy expense categorized as income becomes a refund authority",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from: "      VALID_PURCHASE_CATEGORIES.has(value as FinancialCategory),",
    to: "      VALID_CATEGORIES.has(value as FinancialCategory),",
    detector: "L-1b",
  },
  {
    name: "LM18 an invalid explicit original id degrades to no original",
    file: "src/lib/capture/capture-matching.ts",
    from:
      '      : { outcome: "invalid_id", originalTransactionId: explicitId };',
    to: '      : { outcome: "none" };',
    detector: "L-1a",
  },
  {
    name: "LM19 a category correction is mistaken for proof that no original existed",
    file: "src/lib/capture/capture-matching.ts",
    from:
      "  const directStatement =\n" +
      "    /^(?:no|nunca)\\s+(?:lo|la)\\s+(?:registre|anote|cargue)$/.test(",
    to:
      "  const directStatement =\n" +
      "    /\\b(?:no|nunca)\\s+(?:lo|la)\\s+(?:registre|anote|cargue)\\b/.test(",
    detector: "L-1b",
  },
  {
    name: "LM20 the canonical applier lets an unproven legacy refund through",
    file: "src/lib/ai/apply-chat-transaction-intent.ts",
    from:
      '  if (intent.type === "refund" && !refundRegistrationIsProven(intent)) {',
    to:
      '  if (false && intent.type === "refund" && !refundRegistrationIsProven(intent)) {',
    detector: "L-1e",
  },
  {
    name: "LM21 the live agent forgets to mark how the refund was proven",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      '        registrationProvenance: registration.derived\n' +
      '          ? "derived_original"\n' +
      '          : "confirmed_unrecorded",',
    to:
      "        registrationProvenance: undefined,",
    detector: "L-1e",
  },
  {
    name: "LM22 the refund drops the original fixed/installment registration",
    file: "src/lib/ai/agent/kipu-agent-tools.ts",
    from:
      "        recurringExpenseId:\n" +
      "          registration.recurringExpenseId ?? undefined,\n" +
      "        originalExternalRef:\n" +
      "          registration.originalExternalRef ?? undefined,",
    to:
      "        recurringExpenseId: undefined,\n" +
      "        originalExternalRef: undefined,",
    detector: "L-1d",
  },
  {
    name: "LM23 an installment refund is classified as a new installment purchase",
    file: "src/lib/financial/category-intelligence.ts",
    from:
      '    txn.type !== "refund" &&\n' +
      '    (txn.externalRef ?? "").startsWith("installment:")',
    to:
      '    (txn.externalRef ?? "").startsWith("installment:")',
    detector: "L-1e",
  },
  {
    name: "LM24 the canonical writer discards inherited fixed/installment provenance",
    file: "src/lib/ai/apply-chat-transaction-intent.ts",
    from:
      "      recurringExpenseId: intent.recurringExpenseId ?? null,\n" +
      "      externalRef: intent.originalExternalRef ?? null,",
    to:
      "      recurringExpenseId: null,\n" +
      "      externalRef: null,",
    detector: "L-1e",
  },
];

const originals = new Map(
  [...new Set(cases.map((item) => item.file))].map((file) => [
    file,
    fs.readFileSync(file, "utf8"),
  ]),
);

if (process.argv.includes("--anchors-only")) {
  let invalid = false;
  for (const item of cases) {
    const original = originals.get(item.file);
    const hits = original.split(item.from).length - 1;
    const expectedHits = item.occurrence ? Math.max(item.occurrence, 1) : 1;
    const ok = item.occurrence ? hits >= expectedHits : hits === 1;
    console.log(`${ok ? "ok" : "FAIL"} · ${item.name} · anchor hits=${hits}`);
    if (!ok) invalid = true;
  }
  console.log(
    `Bloque L refund mutation anchors: ${invalid ? "FAIL" : `${cases.length}/${cases.length}`}`,
  );
  if (invalid) process.exitCode = 1;
} else {
let failed = false;
for (const item of cases) {
  const original = originals.get(item.file);
  const hits = original.split(item.from).length - 1;
  const expectedHits = item.occurrence ? Math.max(item.occurrence, 1) : 1;
  if (
    (!item.occurrence && hits !== 1) ||
    (item.occurrence && hits < expectedHits)
  ) {
    console.error(
      `FAIL · ${item.name}: anchor hits=${hits}, expected ${
        item.occurrence ? `>=${expectedHits}` : "1"
      }`,
    );
    failed = true;
    continue;
  }
  try {
    let mutated = original;
    if (item.occurrence) {
      let seen = 0;
      mutated = original.replaceAll(item.from, (match) => {
        seen += 1;
        return seen === item.occurrence ? item.to : match;
      });
    } else {
      mutated = original.replace(item.from, item.to);
    }
    fs.writeFileSync(item.file, mutated);
    const run = spawnSync(
      process.execPath,
      ["scripts/qa/run-capture-gate.mjs"],
      { encoding: "utf8" },
    );
    const output = `${run.stdout}\n${run.stderr}`;
    const bit = run.status !== 0 && output.includes(item.detector);
    console.log(`${bit ? "ok" : "FAIL"} · ${item.name} → ${item.detector}`);
    if (!bit) {
      failed = true;
      console.error(output.slice(-2000));
    }
  } finally {
    fs.writeFileSync(item.file, original);
  }
}

for (const [file, original] of originals) {
  if (fs.readFileSync(file, "utf8") !== original) {
    console.error(`FAIL · mutation residue: ${file}`);
    failed = true;
  }
}

console.log(
  `Bloque L refund mutations: ${failed ? "FAIL" : `${cases.length}/${cases.length}`}`,
);
if (failed) process.exitCode = 1;
}
