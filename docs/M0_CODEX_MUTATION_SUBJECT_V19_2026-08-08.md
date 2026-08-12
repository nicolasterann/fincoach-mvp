# M0 — handoff v19: el sujeto de una mutación no es un participio

Fecha: 2026-08-08  
Estado: **implementado localmente, sin commit, sin deploy y sin migración nueva**  
Contrato de runtime: `m0-agent-eval-2026-08-08-mutation-subject-v19`

## Contexto de la ronda

La auditoría externa v18 ejecutó una corrida válida completa del E2E de modelo.
El lifecycle nuevo funcionó: ME5 pasó y una consulta de estado dejó su propia
operación read-only `completed` sin copiar ni consumir el pendiente de la
operación original. El resultado fue 21/22; el único rojo fue ME10b.

ME10b llegó correctamente hasta una propuesta server-owned de
`record_person_payment`: dos montos exigieron confirmación, `wrote=false`,
`needsInfo=true`, cero writes. La publicación agotó sus tres reparaciones y
terminó en HTTP 500 con `mutation_claim_not_proved`.

Claude aisló el falso positivo directamente contra la expresión viva:

- `…el préstamo de 60 que ya tienes registrado` → bloqueado;
- `El préstamo ya estaba registrado antes` → bloqueado;
- `Voy a acreditar 40…` → publicable;
- `Todavía no lo registré` → publicable.

La palabra `registrado` describía un hecho previo del usuario, pero
`MUTATION_CLAIM` incluía participios libres y la interpretaba como si Kipu
afirmara haber escrito en ese turno. La misma función decide además si un monto
debe ligarse a evidencia de acción o a evidencia read-only, por lo que acomodar
solamente ME10b habría dejado la clasificación incorrecta en otra barrera.

## Corrección de producto

Archivo principal: `src/lib/ai/agent/kipu-agent.ts`.

`hasPositiveMutationClaim` ahora está exportada y clasifica construcciones que
afirman una acción, no la mera presencia de un participio:

1. **Acción finita de Kipu:** `registré`, `guardé`, `pagué`, `dejé`, etc.
2. **Resultado explícito:** `quedó registrado/guardado/aplicado`.
3. **Perfecto o impersonal:** `he registrado`, `se ha registrado`,
   `se registró`.
4. **Recibo breve autónomo:** `Registrado.`, `Guardado.`, `Listo.`, `Hecho.`.

Quedan fuera, correctamente, los estados descriptivos:

- `el préstamo que ya tienes registrado`;
- `el préstamo ya estaba registrado antes`;
- `el préstamo está registrado`;
- `de hecho, el préstamo está registrado`;
- `listo para confirmar` y `Listo: para confirmar la propuesta`.
- `confirma para que registre`, `si quieres que guarde` y `antes de que pague`:
  son subjuntivos de una propuesta, no pretéritos sin tilde de Kipu.

No se aflojó la barrera monetaria ni la exigencia de recibos. Las siguientes
formas siguen dando `mutation_claim_not_proved` cuando `wrote=false` y no hay
recibo durable: `Registrado.`, `he registrado`, `se registró`, `quedó
registrado`, `lo registré` y `ya dejé registrada la devolución`.

### Dos huecos adyacentes cerrados antes de gastar otra muestra

- `hecho` ya no se detecta dentro del conector normal `de hecho`.
- `listo` sólo cuenta como recibo cuando constituye toda la respuesta. Una
  propuesta que empieza `Listo: para confirmar…` no se confunde con un write;
  si la respuesta dice `Listo, ya dejé registrada…`, el verbo `dejé` mantiene
  el fail-closed.

La rama impersonal termina con lookahead de separador y no con `\b`: en
JavaScript la letra acentuada final de `registró` no es `\w`, de modo que un
word-boundary después de `ó` no existe. IR266 y M0M312 fijan expresamente esa
trampa.

## Cobertura añadida

### IR266 — barrera completa

`src/app/dev/capture-test/page.tsx` prueba tres niveles:

1. La función pura distingue estados descriptivos de acciones reales.
2. Una propuesta natural con `wrote=false`, `needsInfo=true` y un pending
   concreto atraviesa `finalizeAgentReply` completa.
3. Una afirmación no probada (`La devolución quedó registrada`) es rechazada
   por la razón tipada exacta `mutation_claim_not_proved`.

Capture final: **745/745**.

### Mutaciones M0M306–M0M314

Las nueve mueren por IR266:

- M0M306 reintroduce el participio libre en `SUCCESS_CLAIM`;
- M0M307 desconecta perfectos/impersonales;
- M0M308 desconecta recibos participiales autónomos;
- M0M309 vuelve a leer `listo` discursivo como write;
- M0M310 deja de consumir el veredicto dentro de publicación;
- M0M311 desconecta `Listo.`/`Hecho.` autónomos;
- M0M312 repone el `\b` ASCII después de pretéritos acentuados;
- M0M313 elimina `dejé`, reabriendo la frase real `ya dejé registrada`.
- M0M314 vuelve a aceptar el subjuntivo `registre` como una acción completada.

Runner completo, serial: **314/314**, exit 0, restauración byte-for-byte y cero
residuo.

## Verificación hecha por Codex

- `npx tsc --noEmit` → limpio;
- `node scripts/qa/run-capture-gate.mjs` → **745/745**;
- `node scripts/qa/telegram-agent-regression-audit.mjs` → **314/314**, exit 0;
- `node --check scripts/qa/telegram-agent-regression-audit.mjs` → limpio;
- no se ejecutó el E2E de modelo, por control de presupuesto;
- no hay migración 108: el defecto y el fix son enteramente TypeScript.

## Auditoría solicitada a Claude

Seguir este orden y no gastar muestras adicionales antes de tiempo:

1. **Fuente.** Confirmar que un participio descriptivo no es autoridad de
   mutación y que las formas activas, perfectas, impersonales, resultativas y
   los recibos autónomos siguen fail-closed. Revisar especialmente `de hecho`,
   `listo para`, `Listo: para confirmar` y `ya dejé registrada`.
2. **Determinista.** `tsc`, lint, `git diff --check`, capture **745/745** y
   mutaciones **314/314** en serial. No tocar aserciones para acomodar resultados.
3. **PostgreSQL.** Ejecutar el E2E **64/64 dos veces**, exit 0 y residuo cero.
   No hay SQL nuevo; esto sólo demuestra que el árbol congelado no regresó la
   frontera ya aplicada 100–107.
4. **Build/runtime.** Borrar `.next`, compilar con red y confirmar que fuente y
   servidor reportan exactamente `mutation-subject-v19`.
5. **Modelo: una sola corrida.** Ejecutar una muestra completa 22/22. La
   expectativa falsable es que ME10b publique la propuesta natural, permanezca
   `wrote=false/needsInfo=true` y no termine en 500; los otros 21 checks deben
   conservarse. Si queda roja, detenerse y reportar la causa tipada. No gastar
   las cuatro muestras de estabilidad en esa ronda.
6. Sólo después de un primer 22/22 limpio, informar al founder antes de decidir
   el gasto de las cuatro corridas de estabilidad y la ronda congelada final.

## Archivos de esta pasada

- `src/lib/ai/agent/kipu-agent.ts`
- `src/app/dev/capture-test/page.tsx`
- `src/lib/ai/agent/m0-eval-contract.ts`
- `scripts/qa/telegram-agent-regression-audit.mjs`
- `CLAUDE.md`
- `AGENTS.md`
- `docs/ROADMAP.md`
- `scripts/qa/README.md`
- este documento

M0 permanece **ABIERTO** hasta que el E2E real llegue a 22/22 y se cumpla la
regla de estabilidad/ronda externa congelada. El producto sí queda corregido
para el único defecto conocido de la corrida v18.
