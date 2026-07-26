import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const relativePage = process.argv[2];
const label = process.argv[3] ?? "checks";
if (!relativePage) {
  throw new Error("Usage: node scripts/qa/run-static-gate.mjs <page.tsx> [label]");
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const base = specifier.startsWith("@/")
      ? path.resolve("src", specifier.slice(2))
      : specifier.startsWith(".") &&
          context.parentURL?.startsWith("file:") &&
          new URL(context.parentURL).pathname.includes("/src/")
        ? path.resolve(path.dirname(new URL(context.parentURL).pathname), specifier)
        : null;
    if (!base) return nextResolve(specifier, context);
    const target = fs.existsSync(`${base}.ts`)
      ? `${base}.ts`
      : fs.existsSync(`${base}.tsx`)
        ? `${base}.tsx`
        : base;
    return nextResolve(pathToFileURL(target).href, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".tsx")) return nextLoad(url, context);
    const filename = new URL(url);
    const source = fs.readFileSync(filename, "utf8");
    const defaultExport = source.indexOf("\nexport default ");
    const gateOnly = defaultExport >= 0 ? source.slice(0, defaultExport) : source;
    const output = ts.transpileModule(gateOnly, {
      fileName: filename.pathname,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
      reportDiagnostics: false,
    }).outputText;
    return { format: "module", source: output, shortCircuit: true };
  },
});

const pageUrl = pathToFileURL(path.resolve(relativePage)).href;
const { runChecks } = await import(pageUrl);
if (typeof runChecks !== "function") {
  throw new Error(`${relativePage} must export runChecks`);
}
const checks = await runChecks();
const failed = checks.filter((check) => !check.pass);
for (const check of failed) {
  process.stderr.write(`✗ ${check.name} — ${check.detail}\n`);
}
process.stdout.write(`${checks.length - failed.length}/${checks.length} ${label}\n`);
if (failed.length > 0) process.exitCode = 1;
