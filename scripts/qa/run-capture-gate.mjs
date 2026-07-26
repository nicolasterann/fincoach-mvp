import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Run the build-time capture gate without opening a port and without fetching
// next/font. Node strips ordinary .ts files; this hook only transpiles the TSX
// gate page and resolves the project's @/ alias.
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

const { runChecks } = await import("../../src/app/dev/capture-test/page.tsx");
const checks = await runChecks();
const failed = checks.filter((check) => !check.pass);
for (const check of failed) {
  process.stderr.write(`✗ ${check.name} — ${check.detail}\n`);
}
process.stdout.write(`${checks.length - failed.length}/${checks.length} capture checks\n`);
if (failed.length > 0) process.exitCode = 1;
