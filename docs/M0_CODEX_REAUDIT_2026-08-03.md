> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Informe para Claude — re-auditoría y cierre pendiente de M0

Fecha: 2026-08-03  
Estado del árbol: sin commit, sin deploy.  
Estado de base conocido: migraciones 100 y 101 aplicadas; 102 preparada, **no aplicada**.

## Veredicto corto

Corregí todos los defectos reproducibles que quedaron expuestos por la primera
auditoría externa y por la primera ejecución del E2E de modelo. El árbol local
queda coherente y sus baterías estáticas/adversariales están verdes, pero **M0 no
se puede declarar cerrado todavía** por dos fronteras externas y falsables:

1. Claude debe auditar y aplicar la migración 102; después el E2E PostgreSQL debe
   pasar de 57/59 a **59/59**, dos veces, con exit 0 y residuo cero.
2. La cuenta de OpenAI usada por el E2E devolvió `429 no credits` después de ME3.
   Con créditos disponibles, el E2E del modelo debe completar **22/22 cinco veces**
   sobre el árbol congelado.

No considero un 429 una falla del producto, pero tampoco lo convierto en evidencia
de que los 19 checks no ejecutados pasarían.

## 1. Qué encontré después del informe externo

### [P1] Reabrir una ocurrencia podía restaurar un corte histórico al azar

El informe externo dejó cuatro rojos en el E2E DB. Dos eran baselines globales
del harness (M100.12 y M100.13b); los otros dos, M100.15a/15b, eran un defecto
real y no “estado flotante”.

La cadena exacta era:

1. un corte bancario de 50,60 publica un `financial_fact`;
2. resolver su ocurrencia publica un hecho de resolución que supersede al hecho
   bancario;
3. corregir el corte a 51,00 publicaba otra versión, pero
   `kipu__publish_card_statement_fact` reutilizaba el `created_at` inmutable del
   ciclo como `observed_at`;
4. al reabrir la ocurrencia, el trigger retiraba la resolución y elegía entre
   versiones empatadas mediante `observed_at DESC, id DESC`;
5. un UUID decidía si volvía 50,60 o 51,00.

No era solo un test inestable: era autoridad económica elegida por azar.

### [P1] Los tres caminos sin tools estaban muertos en la API real

El primer E2E del modelo llegó al endpoint y OpenAI respondió 400. El runtime
enviaba `tool_choice: "none"` sin enviar `tools`. Chat Completions rechaza esa
combinación. Había tres instancias:

- respuesta de un plan sin acciones;
- reparación final de voz;
- reparación de voz de una pregunta pendiente.

El TypeScript, los mocks y los gates anteriores aceptaban la forma; solo la API
real reveló que era inválida.

### [P1] Una pregunta financiera de solo lectura era imposible de publicar

El planner entendía correctamente “¿cuánto tengo que pagar de Diners?”: cero
acciones, intención `answer`, cobertura completa y el corte 50,60 presente en el
contexto. Sin embargo, el finalizador solo aceptaba números procedentes de una
tool ejecutada o de un refresh post-write. El mismo contexto verificado que el
planner acababa de leer no podía fundamentar la respuesta. Resultado: el agente
entendía y luego se censuraba.

### [P1 de QA] El E2E del modelo no llegaba al agente

Dos fixtures habían sido escritos sin ejecutarse:

- intentaban persistir `timezone` en `profiles`, columna inexistente;
- confirmaban el sueldo con una forma de fecha que el resolver no admite para
  ese tipo de ocurrencia.

Un E2E que muere preparando la persona no prueba inteligencia del agente.

### [P2 de QA] Un sample no publicable abortaba toda la prueba estocástica

Un sample válido del modelo puede ser rechazado por los contratos deterministas.
Eso debe provocar redelivery de la **misma entrega durable**, no una identidad
nueva ni el aborto del archivo. Sin esa repetición, el E2E confundía variación
del modelo con una falla irrecuperable y no ejercitaba el contrato real de canal.

### [P2 de seguridad] `/dev/m0-agent-eval` era autoridad implícita

El bridge acepta `userId` y llama al orquestador real de dinero. `NODE_ENV`, un
Host loopback aparente o el hecho de llamarse `/dev` no son autoridad: un túnel
puede exponerlo. Necesitaba un secreto QA independiente y comparación segura.

### [P2] El último fallback legacy de la 102 todavía era semánticamente débil

La primera versión de 102 ya eliminaba `observed_at + UUID`, pero para una cadena
legacy incompleta elegía el hecho creado más recientemente y aún desempataría
por UUID. “La fuente sigue viva” no prueba que el payload histórico sea el corte
actual: varias versiones pueden apuntar a la misma fila corregida.

Lo endurecí antes de entregar: el fallback solo restaura un hecho cuyo
**monto, moneda, fecha de corte y día de vencimiento** coinciden con la fila viva
de `debt_statement_cycles` + `debt_accounts`. Sin witness completo, no restaura
nada. Un vínculo ausente es preferible a revivir una cifra equivocada.

## 2. Cómo lo corregí

### Migración 102 — restauración exacta, append-only

Archivo: `supabase/sql/102_m0_restore_exact_independent_fact.sql`.

No reescribe 100 ni 101. Reemplaza solo los dos trigger helpers afectados:

#### `kipu__publish_terminal_occurrence_fact`

- toma el mismo advisory lock de identidad que `kipu_record_financial_fact`;
- captura el `supersedes_fact_id` de la resolución que está retirando;
- retira únicamente el hecho cuyo source es esa ocurrencia;
- conserva un hecho bancario independiente que ya sea current;
- si no existe, restaura el predecessor exacto de la cadena;
- para cadenas legacy incompletas, exige que el payload histórico coincida con
  la fila bancaria viva en las cuatro dimensiones monetarias/temporales;
- nunca usa UUID ni un timestamp de observación empatado como autoridad;
- religa `recurring_occurrences.satisfied_fact_id` al hecho restaurado.

#### `kipu__publish_card_statement_fact`

- las correcciones nuevas usan `observed_at = now()`;
- dejan de fingir que una corrección observada hoy nació cuando se creó el ciclo.

Ambas funciones quedan `SECURITY DEFINER`, owner postgres, `search_path` fijado y
sin EXECUTE para `public`, `anon`, `authenticated` ni `service_role`, porque son
helpers de trigger.

### Runtime OpenAI

En `src/lib/ai/agent/kipu-agent.ts` eliminé las tres formas inválidas. Cuando no
hay tools, el request omite tanto `tools` como `tool_choice`. Cuando sí hay
tools, conserva `{ tools, tool_choice: "auto" }`.

No queda ninguna ocurrencia de `tool_choice: "none"`.

### Evidencia para respuestas read-only

Añadí `verifiedReadOnlyPlanEvidence`, deliberadamente estrecha:

- `actionCount === 0`;
- `response_intent === "answer"`;
- cobertura financiera completa;
- contexto financiero no vacío.

Esa evidencia entra solo en la evidencia amplia de lectura. **Nunca** entra en
`actionEvidence`, así que no puede fundamentar “registré”, “pagué” o cualquier
claim de escritura. La barrera existente de entidad+rol sigue siendo necesaria:
el saldo real de una cuenta no puede probar el corte de otra tarjeta.

El gate comprueba además que:

- Diners puede fundamentar 50,60;
- ese contexto no fundamenta el monto de otra entidad;
- una acción o cobertura incompleta no produce evidencia;
- la evidencia de lectura no puede probar un write.

### E2E del modelo

`scripts/qa/m0-model-conversation-e2e.mjs` ahora:

- escribe timezone en `user_engagement`, no en `profiles`;
- construye la ocurrencia salarial con su amount/currency persistidos y usa el
  contrato real del resolver;
- limpia también `user_engagement`;
- diagnostica `agent_intake_failures`, operaciones, preguntas y receipts;
- ante “no publishable reply” reenvía hasta tres veces el mismo `requestId`;
- nunca inventa una delivery nueva para una respuesta cuyo outcome desconoce;
- exige `M0_EVAL_SECRET` y prueba primero que el bridge rechaza credenciales
  ausentes/incorrectas.

### Bridge de evaluación

`src/app/dev/m0-agent-eval/route.ts` exige simultáneamente:

- no producción;
- ausencia de `VERCEL`;
- host loopback;
- bearer `M0_EVAL_SECRET`, comparado con `timingSafeEqual`.

El bridge sigue usando `handleChatTransactionMessage`: no importa el planner en
aislamiento ni sustituye el orquestador público.

### Harness PostgreSQL

En `scripts/qa/telegram-agent-100-e2e.mjs`:

- M100.12 y M100.13b miden deltas contra baselines capturados justo antes de la
  operación, no saldos globales contaminados por pruebas anteriores;
- la comparación de deudas conserva `id`, para no depender del orden de filas;
- M100.15a exige que el payload restaurado sea exactamente 51,00;
- M100.15b fija el replay/reopen correspondiente;
- el harness cubre las 59 sondas sin abortar ni ocultar checks posteriores.

## 3. Mutaciones que fijan estas fronteras

El runner M0 quedó en **175/175**. Las nuevas mutaciones relevantes son:

- M158: ignora el predecessor exacto;
- M159: elimina el lock compartido de identidad;
- M160: vuelve a usar el nacimiento del ciclo como observed_at;
- M161/M162: bridge o E2E dejan de consumir el secreto;
- M163/M164: undo vuelve a baseline global;
- M165: deja de comprobar el payload monetario restaurado;
- M166: el fallback confía en un source vivo sin comparar el monto;
- M167: compara deudas sin identidad;
- M168/M169: fixtures del modelo vuelven a morir antes del agente;
- M170: se elimina la redelivery exacta;
- M171: la evidencia read-only se deriva pero no se consume;
- M172: una acción intenta usar contexto amplio para autorizar prose financiera;
- M173/M174/M175: reaparece `tool_choice` sin `tools` en cada uno de los tres
  caminos reales.

Todas fueron ejecutadas sobre baseline verde y murieron por su test nombrado.

## 4. Evidencia actual

### PostgreSQL real antes de 102

El E2E fue ejecutado contra 100+101 instaladas y quedó exactamente:

- **57/59**;
- cobertura completa, sin abortos;
- únicos rojos: M100.15a y M100.15b, targets explícitos de 102;
- cero residuo de persona disposable.

No vuelvo verde esos dos tests modificando su expectativa. La migración debe
demostrar el arreglo contra PostgreSQL.

### Modelo real

La primera corrida después de corregir el request OpenAI demostró:

- **ME1**: la ocurrencia Diners ya está satisfecha por el hecho durable;
- **ME2**: una pregunta cross-channel, fuera de la antigua ventana de ocho
  mensajes, responde 50,60 y vencimiento 3 sin escribir;
- **ME3**: el turno incompleto de tres tarjetas pregunta la cuenta origen
  concreta y no paga a medias.

La siguiente llamada devolvió `429 You have no credits remaining`. ME4–ME15 y
sus subcasos no se ejecutaron. No hay un fallo de producto observado después de
ME3; tampoco hay base para certificar 22/22.

### Batería local final

| Suite | Resultado |
|---|---:|
| Capture | **725/725** |
| Mutaciones M0 | **175/175**, residuo cero |
| Mutaciones K | **280/280** |
| Mutaciones L refund | **24/24** |
| Mutaciones Pre-M | **28/28**, residuo cero |
| Onboarding loop / wizard | **22/22 · 161/161** |
| J-2 / J-3 / J-4 | **17/17 · 21/21 · 18/18** |
| `tsc --noEmit` | limpio |
| `npm run lint` | limpio |
| `npm run build` con red | **Compiled successfully** |
| `git diff --check` | limpio |

## 5. Instrucciones exactas para auditar y cerrar

### A. Auditar y aplicar 102

1. Leer el diff completo de 102. No editar 100 ni 101.
2. Antes de aplicar, comprobar que existen las dos funciones target y que los
   anchors/markers de K-102 no están parcialmente instalados.
3. Auditar especialmente:
   - misma llave del advisory lock que el fact writer;
   - `v_exact_predecessor` procede del hecho de resolución current;
   - solo se retira el source de esa ocurrencia;
   - el fallback legacy compara monto, moneda, statement_date y due_day con la
     fila bancaria viva;
   - ausencia de witness deja `satisfied_fact_id = null`;
   - ninguna selección usa UUID como verdad.
4. Aplicar 102 como migración append-only.
5. Verificar por catálogo:
   - ambas funciones SECURITY DEFINER, owner postgres;
   - `search_path = public, pg_temp`;
   - cero EXECUTE externo, incluido service_role;
   - triggers existentes siguen enabled y apuntan a esas funciones.
6. Reaplicar 102 dentro de una transacción revertida y confirmar no-op real.

### B. Ejecutar la frontera PostgreSQL

```bash
node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs
node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs
```

Cada corrida debe producir **59/59**, exit 0, sin `ABORT`, `FALL`,
`COBERTURA INCOMPLETA`, `LIMPIEZA ILEGIBLE` ni `RESIDUO`. Inspeccionar M100.15:
el hecho restaurado debe tener amount 51,00 y la ocurrencia debe enlazarlo.

### C. Ejecutar el modelo real

Con créditos disponibles y el mismo secreto en server y runner:

```bash
M0_EVAL_SECRET='<secreto-local>' KIPU_AGENT_MODE=on npm run dev
M0_EVAL_SECRET='<secreto-local>' node --env-file=.env.local ./scripts/qa/m0-model-conversation-e2e.mjs
```

Repetir la segunda línea cinco veces sobre el árbol congelado. Cada corrida debe
dar **22/22**, exit 0 y residuo cero. Guardar transcripts, no solo el contador.
Auditar en particular:

- respuesta Diners sin write ni repregunta;
- grupo de pagos parcial: ejecuta solo lo independiente y pregunta lo incierto;
- “¿qué falta?” responde el dato concreto;
- continuación usa la misma operación y no repite receipts;
- redelivery exacta no replanea ni reescribe;
- corrección/undo a nivel operación;
- devolución de receivable vs deuda propia vs capital no registrado;
- conversación normal y ambigüedad no generan writes;
- ninguna operación queda eternamente `applying`.

### D. Ronda congelada y release

Repetir capture, 175 mutaciones, tipos, lint y build. Revisar `/dev/chat-review`
con los transcripts. Solo entonces:

1. declarar M0 cerrado;
2. actualizar documentos/cifras si el auditor agregó correcciones;
3. commit + push + deploy;
4. comprobar SHA desplegado, HTTP, runtime logs y smoke post-deploy.

## 6. Preguntas explícitas para Claude

1. ¿La restauración por cadena + payload vivo de 102 conserva alguna situación
   legítima que yo esté descartando, o aún puede revivir una cifra histórica?
2. ¿El lock de identidad puede crear un orden inverso con el lock de
   `debt_statement_cycles`? Si sospechas que sí, haz sonda de dos conexiones;
   no lo concluyas por lectura.
3. ¿`verifiedReadOnlyPlanEvidence` está suficientemente estrecha? Intenta usarla
   para publicar un número de la entidad equivocada o para afirmar un write.
4. ¿Hay otra llamada a Chat Completions sin tools que todavía envíe
   `tool_choice` por una abstracción distinta?
5. ¿La redelivery exacta del E2E reproduce el canal o solo hace que el test sea
   más tolerante? Verifica en DB que no crea otra operación ni otro receipt.
6. ¿Las cinco corridas 22/22 revelan falsos rechazos del contrato del planner?
   Ese es el riesgo de inteligencia más importante que aún no fue medido.

## Condición final

Mi conclusión no es “M0 cerrado”. Es: **todos los defectos conocidos quedan
corregidos localmente y sujetos por mutación; el árbol está listo para su
auditoría ejecutable final**. M0 se cierra únicamente con 102 aplicada,
PostgreSQL 59/59 repetido, modelo 22/22 ×5, ronda congelada y deploy verificado.

