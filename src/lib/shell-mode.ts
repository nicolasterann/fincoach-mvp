export type ShellMode = "legacy" | "orbe";

let warnedUnknownShellMode = false;

export function getShellMode(): ShellMode {
  const raw = process.env.KIPU_SHELL?.trim().toLowerCase();
  if (!raw || raw === "legacy") return "legacy";
  if (raw === "orbe") return "orbe";

  if (!warnedUnknownShellMode) {
    warnedUnknownShellMode = true;
    console.warn(`[Kipu] KIPU_SHELL=${raw} no es válido; usando legacy.`);
  }
  return "legacy";
}
