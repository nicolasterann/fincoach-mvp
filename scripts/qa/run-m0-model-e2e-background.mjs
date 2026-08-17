// Launch the paid M0 model E2E outside a short-lived audit command.
//
//   node --env-file=.env.local ./scripts/qa/run-m0-model-e2e-background.mjs v45
//
// The launcher exits immediately. It prints stable /tmp paths for the log,
// status JSON and pid; the detached worker records the real child exit code.

import { closeSync, openSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, "m0-model-conversation-e2e.mjs");
const self = fileURLToPath(import.meta.url);

function safeLabel(value) {
  const normalized = String(value ?? "audit")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || "audit";
}

if (process.argv[2] === "--worker") {
  const statusPath = process.argv[3];
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [target], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  writeFileSync(
    statusPath,
    `${JSON.stringify({
      state: "finished",
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode,
      signal: result.signal ?? null,
      spawnError: result.error?.message ?? null,
    })}\n`,
  );
  process.exit(exitCode);
}

const label = safeLabel(process.argv[2]);
const prefix = `/tmp/kipu-m0-model-${label}`;
const logPath = `${prefix}.log`;
const statusPath = `${prefix}.status.json`;
const pidPath = `${prefix}.pid`;
writeFileSync(
  statusPath,
  `${JSON.stringify({ state: "starting", startedAt: new Date().toISOString() })}\n`,
);
const logFd = openSync(logPath, "a");
const worker = spawn(process.execPath, [self, "--worker", statusPath], {
  cwd: process.cwd(),
  env: process.env,
  detached: true,
  stdio: ["ignore", logFd, logFd],
});
closeSync(logFd);
worker.unref();
writeFileSync(pidPath, `${worker.pid}\n`);
writeFileSync(
  statusPath,
  `${JSON.stringify({
    state: "running",
    startedAt: new Date().toISOString(),
    pid: worker.pid,
    logPath,
  })}\n`,
);
process.stdout.write(
  `${JSON.stringify({ pid: worker.pid, logPath, statusPath, pidPath })}\n`,
);
