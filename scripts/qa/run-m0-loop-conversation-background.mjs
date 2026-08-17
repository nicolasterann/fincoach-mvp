// Launch one paid M0 loop/on three-lane run outside a short-lived audit command.
//
//   node --env-file=.env.local ./scripts/qa/run-m0-loop-conversation-background.mjs on-1 --mode=on
//   node --env-file=.env.local ./scripts/qa/run-m0-loop-conversation-background.mjs loop-1 --mode=loop
//
// The matching Next dev server must already be alive in the requested mode.
// The launcher exits immediately and prints stable paths for the complete log,
// status JSON and pid. The detached worker records the real child exit code.

import { closeSync, openSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, "m0-loop-conversation-e2e.mjs");
const self = fileURLToPath(import.meta.url);

function safeLabel(value) {
  const normalized = String(value ?? "audit")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || "audit";
}

function modeFrom(argv) {
  const raw = argv.find((value) => value.startsWith("--mode="));
  const value = raw?.slice("--mode=".length);
  if (value !== "loop" && value !== "on") {
    throw new Error("--mode=loop|on is required");
  }
  return value;
}

if (process.argv[2] === "--worker") {
  const statusPath = process.argv[3];
  const usagePath = process.argv[4];
  const mode = modeFrom(process.argv.slice(5));
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [target, `--mode=${mode}`], {
    cwd: process.cwd(),
    env: { ...process.env, M0_LOOP_USAGE_STATUS_PATH: usagePath },
    stdio: "inherit",
  });
  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  writeFileSync(
    statusPath,
    `${JSON.stringify({
      state: "finished",
      mode,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode,
      signal: result.signal ?? null,
      spawnError: result.error?.message ?? null,
      usagePath,
    })}\n`,
  );
  process.exit(exitCode);
}

const label = safeLabel(process.argv[2]);
const mode = modeFrom(process.argv.slice(3));
const prefix = `/tmp/kipu-m0-loop-${label}`;
const logPath = `${prefix}.log`;
const statusPath = `${prefix}.status.json`;
const usagePath = `${prefix}.usage.json`;
const pidPath = `${prefix}.pid`;
writeFileSync(
  statusPath,
  `${JSON.stringify({
    state: "starting",
    mode,
    startedAt: new Date().toISOString(),
    usagePath,
  })}\n`,
);
const logFd = openSync(logPath, "w");
const worker = spawn(
  process.execPath,
  [self, "--worker", statusPath, usagePath, `--mode=${mode}`],
  {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  },
);
closeSync(logFd);
worker.unref();
writeFileSync(pidPath, `${worker.pid}\n`);
writeFileSync(
  statusPath,
  `${JSON.stringify({
    state: "running",
    mode,
    startedAt: new Date().toISOString(),
    pid: worker.pid,
    logPath,
    usagePath,
  })}\n`,
);
process.stdout.write(
  `${JSON.stringify({ mode, pid: worker.pid, logPath, statusPath, usagePath, pidPath })}\n`,
);
