> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0 · CIERRE — Instrucción exacta para Codex: limpieza del stack envelope + docs de cierre

Fecha: 2026-08-24 · Autor: Claude (Fable) · Autoriza: founder (mandato verbal
registrado en `docs/M0_CLAUDE_AUDIT_TOOL_LOOP_2026-08-14.md`, ADENDA 64)

**Para: Codex.** Este documento es tu contrato completo. No hay contexto
implícito: todo lo que necesitas está aquí o en los archivos que este documento
nombra. Si algo del contrato te parece equivocado, PARA y anótalo en tu reporte
— la objeción es bienvenida; la desviación unilateral no.

---

## 0. Flujo de tres actores (qué te toca a ti)

1. **Tú (Codex):** ejecutas ESTA limpieza en una rama, con gates verdes, y
   entregas un reporte. **No haces merge a main.**
2. **Claude:** audita tu diff completo, corre la muestra real contra el modelo
   y emite veredicto.
3. **Founder:** con el veredicto verde, declara M0 CERRADO y el Bloque M
   (front) desbloqueado.

## 1. Contexto mínimo

- Producción sirve el **loop nativo de tool-calling** (`KIPU_AGENT_MODE=loop`)
  desde hace semanas; el founder lo aprobó tras su uso real y la batería
  completa (ver ADENDAs 29–64 del dossier).
- El stack **envelope** (planner de envelope + validadores + compiladores +
  barreras de publicación v29–v44 + recovery de intake + challenges 088 del
  camino del agente) quedó **muerto en producción**: nada lo alcanza en modo
  `loop`. Es la fuente histórica de los fallos robóticos que M0 existió para
  eliminar.
- Tu trabajo: **borrarlo por alcanzabilidad**, reducir `AgentMode`, podar el
  harness que fijaba lo borrado, y actualizar los documentos del proyecto
  declarando M0 cerrado. Balance esperado: **~15.000–20.000 líneas eliminadas,
  cero comportamiento observable cambiado.**

## 2. Estado del árbol al recibirlo

- Rama base: `main` (el commit del cierre funcional de metas + fondeo 124; los
  gates de ese commit están íntegros en la ADENDA 64 del dossier: muestra real
  de 35 carriles corrida DOS veces con 34/35 cada una — rojos DISJUNTOS e
  itinerantes de varianza de forma del modelo, ambos carriles verdes enfocados
  en el mismo árbol y en la otra corrida, GA_FUNDING verde 3/3 —, capture
  891/891, mutaciones 601/601, PostgreSQL 82/82 + M116–M124, DRY 32/32,
  OLA0 16/16, CAL 2/2, tsc/lint/build limpios).
- Migraciones aplicadas: **001–124**. La próxima es **125** — pero este
  contrato **no incluye ninguna migración** (ver límites, §7).

## 3. REGLA DE ORO: borrado por ALCANZABILIDAD, no por lista histórica

El criterio de qué muere es **qué código es inalcanzable desde las superficies
vivas**, que son exactamente estas:

1. `KIPU_AGENT_MODE=loop` → `runKipuAgentLoop` (`kipu-agent-loop.ts`) y todo lo
   que importa.
2. `KIPU_AGENT_MODE=off` → pipeline legacy (`chat-transaction-handler.ts`,
   parser + fixed-expense matcher + advisory/coach/router). **Congelado, no se
   toca.** Es el fallback de emergencia.
3. Entry points: web (`transaction-actions.ts`), Telegram
   (`api/telegram/webhook`), crons (calendario/cierre/FX), captura de evidencia,
   onboarding, y las superficies `/app/*`.

Todo lo alcanzable **solo** desde `agentMode() === "on"` o `"shadow"` muere.

**ADVERTENCIA sobre la tabla histórica** (dossier §2, ADENDA 5): esa tabla dice
«ELIMINAR agent-action-guard». **Está superseded**: durante el programa del loop,
`agent-action-guard.ts` se volvió pieza VIVA del loop
(`serverMonetaryEvidenceRequirement`, `serverConfirmationRequirement`,
`SIMULATION_HYPOTHESIS_PATHS`, `emphasizedStatedAmounts` — las dos barreras
gemelas de evidencia monetaria que corren en CADA turno del loop). De ese
archivo solo muere lo que únicamente el envelope llamaba. La tabla es historia;
la alcanzabilidad es la ley.

## 4. Kill-list verificada (punto de partida, no techo)

Mapa de imports verificado el 2026-08-24:

| Objetivo | Detalle |
|---|---|
| `src/lib/ai/agent/agent-planner.ts` (≈5.000 líneas) | Se borra ENTERO. Solo lo importan `kipu-agent.ts` (camino envelope) y `capture-test/page.tsx` (pins). |
| Ramas `"on"`/`"shadow"` en `kipu-agent.ts` (≈6.800 líneas totales; una fracción grande muere) | El orquestador envelope: planificación por envelope, validadores, bounded repair, recovery tipado, diagnósticos de intake del envelope, barreras de publicación v29–v44 (`response_requirements`, plantillas canónicas, juez de voz con veto, grounding-como-500). **OJO:** ese mismo archivo contiene piezas VIVAS que el loop importa (`buildAgentContextDataMessage`, `computeLiveTotalsByCurrency`, `writeDeniedWithReceipt`, `committedFiguresFromReceipts`, `replyOmitsCommittedFigure`, `mutationClaimNeedsActionReceipt`, `sanitizeAgentReply` + regex anti-fuga, `agentMode`, `loopPostWriteReceiptContinuity`, tipos compartidos). Cirugía, no demolición. |
| `agent-action-challenges.ts` (178 líneas) y el camino de challenges 088 | Muere si el loop no lo alcanza (el loop confirma por manifiesto durable 112–115, no por challenge de tool). Verifica la alcanzabilidad ANTES de borrar: lo importan `kipu-agent-tools.ts`, `agent-action-guard.ts` y `kipu-agent.ts`. Si alguna tool viva lo llama en modo loop, esa parte se queda. |
| `chat-transaction-handler.ts` ramas `agentMode() === "on"` | Los dispatch a `"on"` (líneas ~222, ~427, ~565 al día de este contrato) mueren; los de `"loop"` y el pipeline legacy quedan. |
| Pins del harness que fijaban lo borrado | Ver §6. |

Lo que la kill-list no nombró pero tu análisis de alcanzabilidad encuentre
muerto: bórralo también, y decláralo en el reporte con su prueba de
inalcanzabilidad (quién lo importaba y por qué ya no).

## 5. Keep-list INTOCABLE

- **PostgreSQL entero** (001–124): RPCs, locks, CAS, RLS, guards de moneda,
  append-only. Cero cambios, cero DDL.
- **Las ~124 tools** (`kipu-agent-tools.ts`): cuerpos intactos. Solo se
  permiten quitar imports/ramas que únicamente el envelope usaba, con prueba.
- **Manifiesto durable de operación** (migraciones 112–115) +
  `agent-operation-store.ts` + `agent-operation-authority.ts` (lo que el loop
  alcanza): es LA pieza de confirmación del loop.
- **`kipu-agent-loop.ts` completo**: prompt, barreras (writeDenied,
  committedFigures, mutation-claim, quote-witness, anti-re-narración),
  continuidad 1AF, telemetría.
- **`agent-action-guard.ts`**: vivo por el loop (ver §3).
- **Builders**: contexto financiero, memoria, calendario, archivo
  conversacional, briefing proactivo.
- **Doctrina MoneyRead / Saldo fail-closed**: vive en tools y motor.
- **Pipeline legacy `off` congelado** + parser + matcher.
- **El harness**: `capture-test`, mutaciones, sondas PostgreSQL, DRY/OLA0/CAL,
  el E2E conversacional (`m0-loop-conversation-e2e.mjs`) y sus 35 carriles.
- **Registro de sensibilidad** y regex anti-fuga.

## 6. AgentMode y harness

1. `AgentMode` pasa de `"off" | "shadow" | "on" | "loop"` a **`"off" | "loop"`**.
   Compat: un env que diga `on` o `shadow` resuelve a `"loop"` (con un
   `console.warn` una sola vez). El rollback documentado deja de ser «a on» y
   pasa a ser **a `off`** (pipeline legacy). Actualiza `.env.example` y toda
   mención en docs.
2. **Poda del harness — regla estricta:** se eliminan SOLO los checks (IR*) y
   mutantes (M0M*) cuyo objeto es código borrado. **Prohibido debilitar o
   borrar un check que fija código vivo.** Tras la poda:
   - cero pins huérfanos (todo anchor de mutante debe existir con hits=1;
     todo `includes(...)` de un IR debe encontrar su texto),
   - los totales NUEVOS de capture y mutaciones se reportan con la lista
     exacta de IDs eliminados y una línea por ID diciendo qué código muerto
     fijaba.
3. Gates que DEBEN salir verdes en tu rama, en este orden, con salida íntegra
   en el reporte: `npx tsc --noEmit` · `npm run lint` (0 errores) ·
   `npm run build` · `node scripts/qa/run-capture-gate.mjs` ·
   DRY (`--dry-run`) 32/32 · OLA0 (`--ola0`) 16/16 · CAL
   (`m0-ola0-calibration.mjs`) 2/2 · sondas PostgreSQL (M0 82/82 y
   `m0-loop-116-e2e.mjs`…`m0-loop-124-e2e.mjs`) · mutaciones
   (`telegram-agent-regression-audit.mjs`) SOLAS al final, con baseline verde.
   La muestra real de 35 carriles NO la corres tú: la corre Claude en la
   auditoría (cuesta dinero y es su instrumento).

## 7. Límites duros (idénticos a los del proyecto)

- **Cero SQL / migraciones / RLS / grants.** Si crees que algo exige DDL, PARA
  y anótalo.
- Cero cambios en writers, motor financiero, prompts del loop, schemas de
  tools, `.env` de producción, Telegram webhook, auth.
- **Cero cambio de comportamiento observable.** La limpieza es sustractiva por
  definición: si borrar algo te exige cambiar el comportamiento de una
  superficie viva, ese algo NO estaba muerto — PARA y anótalo.
- No commitees secretos; no toques `supabase/`.

## 8. Documentos a actualizar (la mitad declarativa del cierre)

1. **`CLAUDE.md`** y **`AGENTS.md`**: M0 pasa de «ACTUAL/ACTIVO» a **CERRADO**,
   con dos párrafos de resumen (loop nativo como cerebro único; el envelope
   eliminado; la vara final que cumplió: muestra 35/35, nueve+ clases de
   defecto con red permanente). El «bloque activo» pasa a ser **Bloque M
   (el front completo), DESBLOQUEADO**. `AgentMode` documentado como
   `off | loop` con rollback a `off`. Migraciones: 001–124 aplicadas, próxima
   125. Poda además las secciones enormes de historia v10–v44/M0.11A a una
   referencia breve al dossier (los detalles viven en `docs/`, no en el
   standing brief; el brief debe volver a ser legible).
2. **`docs/ROADMAP.md`**: M0 CERRADO con fecha y vara final; M desbloqueado
   como único bloque activo; el orden vivo apunta a M.
3. **`docs/BUILD_PROGRESS.md`**: entrada de cierre de M0 (fecha, commit de tu
   rama, resumen de la limpieza con el balance de líneas).
4. **`docs/AI_NATIVE_ARCHITECTURE.md`**: §5 (migración por etapas) se marca
   COMPLETADA; el estado final descrito es el loop.
5. **Docs M0 históricos** (`M0_*` en `docs/`): NO se borran. Añade al tope de
   cada uno una línea `> HISTÓRICO — M0 cerró el <fecha>; ver docs/ROADMAP.md.`
   (el dossier `M0_CLAUDE_AUDIT_TOOL_LOOP_2026-08-14.md` la lleva también,
   dejando claro que sus ADENDAs son el expediente del cierre).
6. **`docs/TEST_SCRIPTS.md`**: si menciona modos `on`/`shadow`, actualízalo.

## 9. Entrega

1. Rama: **`m0-closure-cleanup`** desde `main`. Commits solo ahí. **NO
   merge, NO push a main.**
2. Reporte: **`docs/M0_CIERRE_CODEX_CLEANUP_REPORT_2026-08-24.md`** (formato
   del dossier §8): alcance vs contrato con desviaciones explícitas; archivos
   tocados con una línea cada uno; decisiones donde el contrato daba libertad;
   **salida íntegra de todos los gates** (texto real, no resumen); lo que NO
   hiciste a propósito; riesgos y objeciones; la lista de IR*/M0M* podados con
   su justificación una-línea.
3. Claude auditará: diff completo, re-corrida de gates, grep adversarial de
   pins huérfanos y de referencias colgantes a lo borrado, y la muestra real
   de 35 carriles sobre tu rama. Merge y declaración de cierre solo después.

— Fin del contrato. Duda estructural ⇒ PARA y anótala; no improvises.
