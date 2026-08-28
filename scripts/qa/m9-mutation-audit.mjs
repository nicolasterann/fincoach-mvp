import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const runner = ["scripts/qa/run-capture-gate.mjs"];
const mutations = [
  {
    file: "src/app/app/layout.tsx",
    from: "<AppContent>{children}</AppContent>",
    name: "M9-1",
    result: "el wrapper vivo deja de alcanzar santuario y detalles",
    to: "<main>{children}</main>",
  },
  {
    file: "src/app/app/cashflow/page.tsx",
    from: 'redirect("/app/mes")',
    name: "M9-2",
    result: "cashflow deja de llegar a Tu mes",
    to: 'redirect("/app/saldo")',
  },
  {
    file: "docs/PRODUCT_SPEC.md",
    from: "living orb whose liquid level",
    name: "M9-3",
    result: "la autoridad vuelve a declarar al quipu como héroe",
    to: "vertical quipu whose liquid level",
  },
  {
    file: "docs/TEST_SCRIPTS.md",
    from: "state=patrimonio-negativo",
    name: "M9-4",
    result: "el guion pierde el estado de patrimonio negativo",
    to: "state=patrimonio-positivo",
  },
];

function runGate() {
  const result = spawnSync(process.execPath, runner, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return {
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  };
}

const baseline = runGate();
if (baseline.status !== 0 || !baseline.output.includes("854/854 capture checks")) {
  process.stderr.write("FAIL · M9 mutation baseline is not green\n");
  process.stderr.write(baseline.output);
  process.exit(1);
}

for (const mutation of mutations) {
  const original = readFileSync(mutation.file, "utf8");
  if (original.split(mutation.from).length !== 2) {
    process.stderr.write(`FAIL · ${mutation.name} anchor count is not one\n`);
    process.exit(1);
  }

  try {
    writeFileSync(mutation.file, original.replace(mutation.from, mutation.to));
    const killed = runGate();
    const namedFailure = killed.output.includes(`✗ ${mutation.name} ·`);
    const oneRed = killed.output.includes("853/854 capture checks");
    if (killed.status === 0 || !namedFailure || !oneRed) {
      process.stderr.write(`FAIL · ${mutation.name} survived or failed without its own name\n`);
      process.stderr.write(killed.output);
      process.exitCode = 1;
      break;
    }
    process.stdout.write(`${mutation.name}: ${mutation.result} (853/854)\n`);
  } finally {
    writeFileSync(mutation.file, original);
  }
}

if (!process.exitCode) {
  const restored = runGate();
  if (restored.status !== 0 || !restored.output.includes("854/854 capture checks")) {
    process.stderr.write("FAIL · restoration did not return to 854/854\n");
    process.stderr.write(restored.output);
    process.exit(1);
  }
  process.stdout.write("restauración: 854/854 capture checks\n");
}
