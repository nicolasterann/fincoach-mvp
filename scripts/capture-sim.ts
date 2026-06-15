// Stage 12 — terminal runner for the capture field-sim (same scenarios as the
// auth-gated /dev/capture-sim page, see src/lib/capture/capture-field-sim.ts).
//
//   npx tsx --env-file=.env.local scripts/capture-sim.ts [scenario|all] [user-email]
//
// Live model calls (extraction + TTS/Whisper) — run on purpose, never in CI.
// No movement is ever written; DB writes are limited to inert capture_evidence
// audit rows for the chosen user.

import { SIM_SCENARIOS } from "@/lib/capture/capture-field-sim";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

async function resolveUserId(email?: string): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 50 });
  if (error || !data.users.length) {
    throw new Error(`No pude listar usuarios: ${error?.message ?? "vacío"}`);
  }
  const user = email
    ? data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    : data.users[0];
  if (!user) throw new Error(`Usuario ${email} no encontrado`);
  console.log(`Usuario del sim: ${user.email} (${user.id})\n`);
  return user.id;
}

async function main() {
  const which = process.argv[2] ?? "all";
  const email = process.argv[3];
  const wanted =
    which === "all" ? SIM_SCENARIOS : SIM_SCENARIOS.filter((s) => s.id === which);
  if (wanted.length === 0) {
    console.log(`Escenarios: ${SIM_SCENARIOS.map((s) => s.id).join(", ")}, all`);
    process.exit(1);
  }

  const userId = await resolveUserId(email);
  let failed = 0;
  let total = 0;

  for (const scenario of wanted) {
    try {
      const r = await scenario.run(userId);
      console.log(`\n━━ [${r.scenario}] ${r.title}`);
      for (const c of r.checks) {
        total += 1;
        if (!c.pass) failed += 1;
        console.log(`  ${c.pass ? "✓" : "✗"} ${c.name}`);
        console.log(`      ${c.detail.slice(0, 300)}`);
      }
    } catch (error) {
      failed += 1;
      total += 1;
      console.log(`\n━━ [${scenario.id}] ERROR: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(
    `\n${failed === 0 ? "SIM-PASS ✓" : "SIM-FAIL ✗"} ${total - failed}/${total} checks`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

void main();
