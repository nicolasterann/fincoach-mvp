import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Bloque N3 · Mutación con dientes — y el CABLE además de la conducta.
//
// La lección que costó tres niveles en este bloque: una función pura sujeta no
// alcanza si el argumento o la llamada se pueden cortar. Por eso cada defecto de
// abajo viene en dos sabores cuando aplica: romper LO QUE HACE, y cortar EL
// CABLE que lo conecta con lo que se ve.
//
// La vara es que la mutación mate una aserción POR SU NOMBRE. Que se caiga el
// build no prueba nada: prueba que el código no compila, no que alguien estaba
// mirando.

const TOTAL = 879;
const runner = ["scripts/qa/run-capture-gate.mjs"];

const CONTRACT = "src/app/app/components/shell/shell-orb-contract.ts";
const SHADER = "src/app/app/components/shell/orb-shader.ts";
const LIVE = "src/app/app/components/shell/LiveOrb.tsx";
const SHELL = "src/app/app/components/shell/SantuarioShell.tsx";
const TILT = "src/app/app/components/shell/useDeviceTilt.ts";
const CSS = "src/app/globals.css";

const mutations = [
  {
    name: "N3-1",
    result: "el lleno vuelve a tocar el borde: sin aire arriba, el menisco desaparece",
    file: CONTRACT,
    from: "export const ORB_WATERLINE_CEILING = 0.84;",
    to: "export const ORB_WATERLINE_CEILING = 1;",
  },
  {
    name: "N3-1",
    result: "el trazo se aplana contra el tope y los valores del medio dejan de distinguirse",
    file: CONTRACT,
    from: "  return ORB_WATERLINE_FLOOR * (1 - bounded) + ORB_WATERLINE_CEILING * bounded;",
    to: "  return ORB_WATERLINE_FLOOR * (1 - bounded) + ORB_WATERLINE_CEILING * Math.min(1, bounded * 4);",
  },
  {
    name: "N3-1",
    result: "CABLE · el payload acota el DATO con el mapeo de dibujo",
    file: "src/app/app/components/shell/shell-payload.ts",
    from: "  const orbs: ShellOrb[] = [",
    to: "  void orbWaterline;\n  const orbs: ShellOrb[] = [",
    also: {
      from: '} from "./shell-orb-contract";',
      to: '  orbWaterline,\n} from "./shell-orb-contract";',
    },
  },
  {
    name: "N3-2",
    result: "las vecinas se apagan de golpe: la salida deja de ser movimiento",
    file: CONTRACT,
    from: "      presence: 1 - smoothstep(ORB_PRESENCE_NEAR, ORB_PRESENCE_FAR, Math.abs(offset)),",
    to: "      presence: Math.abs(offset) < ORB_PRESENCE_FAR ? 1 : 0,",
  },
  {
    name: "N3-2",
    result: "la vecina se muestra DEGRADADA durante el gesto en vez de entera",
    file: CONTRACT,
    from: "export const ORB_PRESENCE_NEAR = 0.34;",
    to: "export const ORB_PRESENCE_NEAR = 0.02;",
  },
  {
    name: "N3-3",
    result: "CABLE · la capa activa se vuelve a derivar a mano y puede separarse del lienzo",
    file: SHELL,
    from: `    const observed = orbActiveIndex({
      count: payload.orbs.length,
      position: track.scrollLeft / track.clientWidth,
    });`,
    to: `    const observed = Math.max(
      0,
      Math.min(payload.orbs.length - 1, Math.round(track.scrollLeft / track.clientWidth)),
    );`,
  },
  {
    name: "N3-3",
    result: "el snap nativo se va y hay que reponer inercia, snap y accesibilidad a mano",
    file: CSS,
    from: "  scroll-snap-type: x mandatory;",
    to: "  scroll-snap-type: none;",
  },
  {
    name: "N3-4",
    result: "el lienzo dibuja agua donde el motor NO PUDO LEER",
    file: LIVE,
    from: '        if (orb.fill === "sin-dato") continue;',
    to: '        if (orb.fill === "sin-dato" && false) continue;',
  },
  {
    name: "N3-4",
    result: "el cristal recupera su línea de agua: un nivel que el motor no afirma",
    file: SHADER,
    from: "  surfaceSeen *= 1.0 - crystal;",
    to: "  surfaceSeen *= 1.0;",
  },
  {
    name: "N3-4",
    result: "CABLE · el DOM deja de apagarse y vuelven a existir dos orbes del mismo objeto",
    file: CSS,
    from: '  .kipu-shell-orb:not([data-orb-fill="sin-dato"]) { opacity: 0; }',
    to: '  .kipu-shell-orb[data-active="true"] { opacity: 0; }',
  },
  {
    name: "N3-5",
    result: "el orbe vuelve a pedirle a la GPU el camino de bajo consumo",
    file: SHADER,
    from: '    powerPreference: "high-performance",',
    to: '    powerPreference: "low-power",',
  },
  {
    name: "N3-5",
    result: "se deja de intentar WebGL2 y el degradado pasa a ser el único camino",
    file: SHADER,
    from: '  const gl2 = canvas.getContext("webgl2", attributes);',
    to: "  const gl2 = null;",
  },
  {
    name: "N3-6",
    result: "CABLE · el permiso deja de colgar del gesto y iOS no lo concede nunca",
    file: SHELL,
    from: "      onPointerDown={deviceTilt.armFromUserGesture}",
    to: "",
  },
  {
    name: "N3-6",
    result: "un rechazo de transporte se guarda como denegado y cierra la puerta para siempre",
    file: TILT,
    from: "        armed.current = false;",
    to: '        store("denied");',
  },
  {
    name: "N3-6",
    result: "el oleaje pasa a DEPENDER del giroscopio: sin permiso el agua se muere",
    file: SHADER,
    from: "const float WAVE_AMP = 0.026;",
    to: "const float WAVE_AMP_BASE = 0.026;\n#define WAVE_AMP (WAVE_AMP_BASE * length(uTilt))",
  },
];

function runGate() {
  const run = spawnSync(process.execPath, runner, { encoding: "utf8" });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

const baseline = runGate();
if (baseline.status !== 0 || !baseline.output.includes(`${TOTAL}/${TOTAL} capture checks`)) {
  process.stderr.write(`FAIL · N3 mutation baseline is not ${TOTAL}/${TOTAL}\n`);
  process.stderr.write(baseline.output);
  process.exit(1);
}
process.stdout.write(`línea base: ${TOTAL}/${TOTAL} capture checks\n`);

for (const mutation of mutations) {
  const touched = [mutation.file, ...(mutation.also ? [mutation.file] : [])];
  const original = readFileSync(mutation.file, "utf8");
  if (original.split(mutation.from).length !== 2) {
    process.stderr.write(`FAIL · ${mutation.name} anchor count is not one (${mutation.file})\n`);
    process.exitCode = 1;
    break;
  }
  try {
    let mutated = original.replace(mutation.from, mutation.to);
    if (mutation.also) {
      if (mutated.split(mutation.also.from).length !== 2) {
        process.stderr.write(`FAIL · ${mutation.name} secondary anchor is not one\n`);
        process.exitCode = 1;
        break;
      }
      mutated = mutated.replace(mutation.also.from, mutation.also.to);
    }
    writeFileSync(mutation.file, mutated);
    const killed = runGate();
    const namedFailure = killed.output.includes(`✗ ${mutation.name} ·`);
    if (killed.status === 0 || !namedFailure) {
      process.stderr.write(
        `FAIL · ${mutation.name} sobrevivió o murió sin su nombre — ${mutation.result}\n`,
      );
      process.stderr.write(killed.output);
      process.exitCode = 1;
      break;
    }
    const count = killed.output.match(/(\d+)\/(\d+) capture checks/u);
    process.stdout.write(
      `${mutation.name}: ${mutation.result} (${count ? count[0] : "sin conteo"})\n`,
    );
  } finally {
    writeFileSync(mutation.file, original);
    void touched;
  }
}

if (!process.exitCode) {
  const restored = runGate();
  if (restored.status !== 0 || !restored.output.includes(`${TOTAL}/${TOTAL} capture checks`)) {
    process.stderr.write(`FAIL · restoration did not return to ${TOTAL}/${TOTAL}\n`);
    process.stderr.write(restored.output);
    process.exit(1);
  }
  process.stdout.write(`restauración: ${TOTAL}/${TOTAL} capture checks\n`);
}
