import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const runner = ["scripts/qa/run-capture-gate.mjs"];
const mutations = [
  {
    file: "src/app/manifest.ts",
    from: 'sizes: "192x192"',
    name: "M8-1",
    to: 'sizes: "191x191"',
  },
  {
    file: "public/sw.js",
    from: `  if (policy.strategy === "network-only") {
    const networkResponse = fetch(request);
    event.respondWith(
      policy.fallback === "offline"
        ? networkResponse.catch(() => caches.match(OFFLINE_URL))
        : networkResponse,
    );
    return;
  }`,
    name: "M8-2",
    result: "escritura cache con alias c muerta por nombre",
    to: `  if (policy.strategy === "network-only") {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        caches.open(CACHE_NAME).then((c) => c.put(request, res.clone()));
        return res;
      })),
    );
    return;
  }`,
  },
  {
    file: "src/app/page.tsx",
    from: 'data-product-image="orbe"',
    name: "M8-3",
    to: 'data-product-image="ring"',
  },
  {
    file: "src/app/globals.css",
    from: "    env(safe-area-inset-left);",
    name: "M8-4",
    to: "    0;",
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
if (baseline.status !== 0 || !baseline.output.includes("850/850 capture checks")) {
  process.stderr.write("FAIL · M8 mutation baseline is not green\n");
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
    const oneRed = killed.output.includes("849/850 capture checks");
    if (killed.status === 0 || !namedFailure || !oneRed) {
      process.stderr.write(`FAIL · ${mutation.name} survived or failed without its own name\n`);
      process.stderr.write(killed.output);
      process.exitCode = 1;
      break;
    }
    process.stdout.write(
      `${mutation.name}: ${mutation.result ?? "mutación muerta por nombre"} (849/850)\n`,
    );
  } finally {
    writeFileSync(mutation.file, original);
  }
}

if (!process.exitCode) {
  const restored = runGate();
  if (restored.status !== 0 || !restored.output.includes("850/850 capture checks")) {
    process.stderr.write("FAIL · restoration did not return to 850/850\n");
    process.stderr.write(restored.output);
    process.exit(1);
  }
  process.stdout.write("restauración: 850/850 capture checks\n");
}
