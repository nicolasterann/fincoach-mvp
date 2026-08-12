# Protocolo de auditoría final congelada — Bloque M0

**Estado:** PREPARADO, NO EJECUTADO  
**Fecha de sellado:** 2026-08-09  
**Objetivo:** obtener la última firma de M0 sin permitir que el auditor cambie
producto, harness, assertions o criterio después de observar el resultado.

## 1. Limitación declarada

Claude participó en auditorías y correcciones anteriores, por lo que no puede
convertirse literalmente en un autor independiente. Como no hay un tercer
auditor disponible, esta ronda usa **independencia de procedimiento**:

- sesión nueva, sin continuar el chat que modificó el árbol;
- superficie de runtime sellada por hash antes de ejecutar;
- criterios, orden y stopping rule fijados en este documento;
- cero ediciones durante la auditoría;
- una sola muestra completa pagada del modelo;
- el mismo hash debe existir al finalizar.

El informe debe nombrar esta limitación. No puede afirmar independencia personal;
sólo una ejecución congelada, predeclarada y no adaptativa.

## 2. Árbol que se audita

La superficie sellada incluye:

- `src/`
- `supabase/sql/`
- `scripts/qa/`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `eslint.config.mjs`
- `next.config.ts`
- `vercel.json`
- `.env.example`

No incluye documentación ni `.env.local`/secretos.

Comando canónico:

```bash
find src supabase/sql scripts/qa package.json package-lock.json tsconfig.json \
  eslint.config.mjs next.config.ts vercel.json .env.example \
  -type f -print0 \
  | sort -z \
  | xargs -0 shasum -a 256 \
  | shasum -a 256
```

**Hash de la ronda ORIGINAL del 2026-08-09 (histórico, ya consumida):**

```text
db2d622e6245836d5041927e6da7561857511267db453afb145a60adc42ec53b
```

**Archivos en aquella superficie:** `483`.

> **El sello NO es fijo.** Aquella ronda terminó `M0_ABIERTO` y cada reparación
> posterior produjo un árbol nuevo con su propio sello — v24 `cef2cae8…`, v25
> `9e1acc66…`, v26 `121a68e7…`, v27 `c7a551f3…`, v28 `8a36cc18…` y v29
> `<ver el relevo vigente>`. Antes de auditar, toma el sello y el conteo de
> archivos del relevo vigente
> (`docs/M0_CLAUDE_SNAPSHOT_READ_V24_2026-08-09.md`, §4) y verifica ESE valor;
> este documento fija el PROCEDIMIENTO, no un hash perpetuo. Nunca se reescribe
> un sello para fingir que el árbol no cambió: se declara el nuevo y por qué
> cambió.

Si el hash o el conteo difieren antes de empezar, la ronda no es comparable y
debe detenerse como `TREE_MISMATCH`. No se actualiza este documento para aceptar
el árbol nuevo: primero se explica quién lo cambió y por qué.

## 3. Evidencia previa que se puede verificar, pero no repetir por costo

- Claude v23: modelo `22/22` dos veces sobre el mismo servidor/árbol, logs
  `/tmp/v23a.log` y `/tmp/v23b.log`.
- PostgreSQL `65/65 ×2`.
- Capture `750/750`.
- Mutaciones M0 `342/342`, baseline verde, exit 0.
- Smoke founder-equivalente S0–S8 verde sobre persona disposable, documentado
  en `docs/M0_CLAUDE_FOUNDER_SMOKE_2026-08-09.md`.
- Migraciones 100–108 aplicadas.

La ronda final verifica esos artefactos y ejecuta una muestra adicional; no
compra de nuevo dos votos completos ni reconstruye el smoke temporal.

## 4. Prohibiciones durante la ronda

El auditor NO puede:

- editar, crear, borrar, formatear ni restaurar archivos del repositorio;
- cambiar una aserción aunque crea que está equivocada;
- aplicar migraciones;
- commit, push o deploy;
- cambiar modelos, prompts, variables persistidas o contratos;
- sembrar la cuenta real del founder;
- ejecutar dos mutation runners en paralelo;
- repetir la muestra completa si sale roja;
- convertir `FALL`, `BLOCKED`, `ABORT`, cobertura incompleta, cleanup ilegible o
  residuo en verde por explicación narrativa.

Una observación cuestionable se reporta; no se corrige dentro de esta ronda.

## 5. Auditoría de fuente antes de ejecutar

Sin modificar nada, revisar al menos:

1. El planner conserva autoridad semántica general y recibe el catálogo completo;
   no existe un router léxico previo que elija la tool por frases.
2. Los canonizadores sólo modifican la dimensión declarada y devuelven `raw`
   ante cualquier precondición no demostrada.
3. Los writers monetarios quedan detrás de plan validado, preflight y operación
   durable; el modelo de respuesta no tiene tools.
4. Toda escritura económica produce receipt reversible o es rehusada.
5. Una lectura incompleta falla cerrada, sin convertirse en ausencia.
6. Los diagnósticos de intake son whitelist y no contienen candidate JSON,
   prompt, mensaje crudo ni secretos.
7. Una escritura verificada no puede quedar sin respuesta por una opinión de
   estilo.
8. El runner cuenta `BLOCKED` como rojo y no como cobertura verde.

Cualquier P1/P2 nuevo demostrado por fuente detiene la ronda antes de gastar la
muestra del modelo.

## 6. Ejecución determinista predeclarada

Ejecutar en este orden y de forma serial:

```bash
git diff --check
npx tsc --noEmit
npm run lint
node --experimental-strip-types ./scripts/qa/run-capture-gate.mjs
node ./scripts/qa/telegram-agent-regression-audit.mjs
node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs
npm run build
```

Resultados requeridos:

- capture `750/750`;
- mutaciones `342/342`, exit 0, sin anchor miss y con restauración completa;
- PostgreSQL `65/65`, exit 0, sin `ABORT`, `FALL`, `RESIDUO`,
  `LIMPIEZA ILEGIBLE` ni `COBERTURA INCOMPLETA`;
- build compilado;
- ningún proceso de mutation runner queda vivo.

Un rojo detiene la ronda. No se inicia el modelo.

## 7. Única muestra pagada

Arrancar un servidor nuevo desde el árbol ya construido, con
`KIPU_AGENT_MODE=on` y el `M0_EVAL_SECRET` de `.env.local`. Confirmar que el
runner ve el contrato:

```text
m0-agent-eval-2026-08-09-intake-diagnostics-v23
```

Ejecutar exactamente una vez:

```bash
node --env-file=.env.local ./scripts/qa/m0-model-conversation-e2e.mjs
```

Requerido:

- `22/22`;
- exit 0;
- cero `FALL`, `BLOCKED` y errores de contrato;
- cleanup por identidad;
- cero operaciones, steps, intake failures, receivables, marcadores o
  transacciones huérfanas atribuibles a la persona disposable.

Los reintentos internos de una misma delivery pertenecen al contrato del runner;
no autorizan a volver a ejecutar la suite completa. Si la muestra sale roja, la
ronda termina roja y se conserva el primer diagnóstico tipado.

## 8. Comprobaciones finales

1. Detener el servidor.
2. Verificar residuo por identidad, no por totales globales: producción y crons
   comparten la base y pueden cambiar conteos legítimos durante la auditoría.
3. Verificar por lectura que la satisfacción durable de Diners 2026-07 sigue
   ligada a su fact; no ejecutar writes sobre el founder.
4. Repetir el comando de hash de §2 y exigir el mismo valor.
5. Ejecutar `git diff --check`.

## 9. Forma obligatoria del informe

El reporte final debe incluir:

- hash inicial y final;
- declaración `NO_EDITS_DURING_AUDIT`;
- cada comando y exit code;
- resultados numéricos sin redondear;
- contrato del servidor;
- resultado de la única muestra;
- residuo por identidad;
- cualquier P1/P2 encontrado, aunque otra batería esté verde;
- limitación: misma familia de auditor, independencia sólo procedural;
- veredicto binario:
  - `APROBADO_PARA_COMMIT_Y_DEPLOY`, o
  - `M0_ABIERTO` con la primera causa concreta.

No puede declarar M0 cerrado todavía. Un resultado verde autoriza el siguiente
paso: commit del árbol exacto, deploy del SHA exacto y smoke productivo final.

## 10. Stopping rule

```text
hash distinto          → STOP · TREE_MISMATCH
P1/P2 por fuente       → STOP · M0_ABIERTO
determinista rojo      → STOP · M0_ABIERTO
modelo distinto de 22  → STOP · M0_ABIERTO · no repetir
residuo o hash final   → STOP · M0_ABIERTO
todo verde             → APROBADO_PARA_COMMIT_Y_DEPLOY
```
