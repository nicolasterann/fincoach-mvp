# M0.11A — continuidad anti-bot sin reejecutar dinero

Fecha: 2026-08-13  
Estado: **IMPLEMENTADO LOCALMENTE; ABIERTO HASTA APLICAR 115, RE-AUDIT Y 24/24**  
Commit/push/deploy: **ninguno**  
Muestra pagada del modelo en esta pasada: **no ejecutada (cero créditos)**

## 0. Sello entregado a Claude

Superficie ejecutable canónica:

```text
26e1e03d3e8a23ce3a5279f28ad00541787cb478c22b7d2e4b46a62555a03dda
493 archivos
```

Runtime esperado:

```text
m0-agent-eval-2026-08-13-antibot-continuity-m0-11a
```

El sello usa el comando canónico de
`docs/M0_FROZEN_INDEPENDENT_AUDIT_PROTOCOL_2026-08-09.md`. Incluye `src/`,
`supabase/sql/`, `scripts/qa/` y la configuración ejecutable; excluye docs y
secretos. Este informe, por tanto, no altera el sello.

## 1. Qué reportó Claude y por qué era una clase arquitectónica

El sello anterior cerró correctamente la contradicción de provenance de
`paidInFull`: el modelo produjo una acción sin `arguments.amount` y declaró
`register_card_payment.amount` desde el corte vivo. El bloqueo se desplazó a
dos superficies contiguas:

1. **ME3:** el plan era correcto y el executor rehusó el pago por faltar la
   cuenta de origen. La respuesta correcta era una pregunta. Tres preguntas
   naturales murieron en publicación porque
   `replyAcknowledgesPendingClarifications` exigía compartir un token material
   con el resumen interno del executor. Terminó en HTTP 500 aunque la pregunta
   era exactamente el comportamiento debido.
2. **ME16:** apareció `operation_manifest_not_authorized`. El análisis del
   lifecycle encontró una ruta general: una escritura podía ejecutarse y
   verificarse, fallar sólo al publicar, quedar `failed_retriable` y, en la
   entrega exacta de recovery, intentar comenzar otra vez un manifiesto que ya
   estaba `verified`.

La primera falla confundía **verdad** con **estilo léxico**. La segunda
confundía **publicación** con **ejecución**. Reparar una tarjeta, una pregunta o
una frase habría repetido el antipatrón que abrió M0. Esta pasada cambia las
invariantes centrales.

## 2. Tesis de la reparación

La arquitectura conserva tres autoridades separadas:

- el modelo decide intención, referencias, lifecycle y lenguaje natural;
- app/PostgreSQL verifican identidad, procedencia, CAS, álgebra, receipts y
  postcondiciones;
- la disponibilidad conversacional es una obligación propia: una barrera puede
  rehusar una escritura o una afirmación, pero nunca convertir ese rechazo en
  silencio, HTTP 500, jerga interna o un loop.

La continuidad server-owned añadida aquí **no es un cerebro alternativo**. No
elige tool, acción, entidad, monto ni significado. Sólo expresa uno de cuatro
speech acts que ya están probados por estado durable: repetir una pregunta
verificada, reconocer continuidad después de una escritura, declarar no-write
o declarar incertidumbre de lectura. Toda frase vuelve a cruzar
`finalizeAgentReply`; no adquiere autoridad por ser fallback.

La ruta normal sigue siendo el modelo: primera candidata + una reparación
dirigida. El fallback existe para que producción nunca calle, pero queda
persistido como `publicationRecovery`, y el E2E completo considera cualquier
recovery una **degradación roja**. Así no reemplazamos un 500 con copy
prefabricado y luego lo declaramos inteligencia.

## 3. Cambios implementados

### 3.1 Pregunta pura: semántica del modelo, no solapamiento léxico

En `src/lib/ai/agent/kipu-agent.ts`:

- `replyRequestsPendingClarification` verifica sólo el acto de
  pregunta/solicitud de una respuesta cuando `needsInfo=true` y `wrote=false`;
- esa rama ya no exige que las palabras de la respuesta coincidan con las de un
  resumen interno;
- un éxito parcial (`wrote=true` y todavía hay pending) conserva
  `replyAcknowledgesPendingClarifications`: debe nombrar materialmente cada
  pendiente durable y no puede esconder la parte que no aterrizó.

Esto no introduce frase routing. El executor ya decidió estructuralmente que
falta una respuesta; el modelo conserva libertad completa para formularla.

### 3.2 Último speech act truth-checked

`antiBotContinuityReply` produce únicamente:

- `server_pending_question`;
- `verified_write_continuity`;
- `safe_no_write_continuity`;
- `read_uncertainty_continuity`.

Para un pending, reutiliza solamente preguntas naturales que ya vienen en los
receipts verificados y filtra marcadores internos. Si no existe una pregunta
usable, formula una aclaración sin ids, cifras ni hechos financieros. El
caller la re-finaliza por las mismas barreras de voz determinista, mutation
claims, money grounding, calendar grounding y pendientes.

La ruta se usa sólo después de que la respuesta inicial, una reparación
dirigida y —cuando aplica— el template canónico hayan fallado. También cubre
ausencia/fallo de la API de respuesta y excepciones del loop. Un pre-plan
failure que no consigue prosa segura ya no devuelve `ok:false`; devuelve una
explicación no-write natural más su diagnóstico de intake.

### 3.3 Observabilidad: nunca esconder la degradación

`RunKipuAgentResult` y el resultado durable llevan:

```ts
publicationRecovery: {
  initialFailure,
  strategy,
  repairAttempted,
}
```

El replay recupera la misma metadata. `chat-transaction-handler.ts` la expone
como `agentPublicationRecovery` tanto en éxito como en el circuito de
emergencia. El handler no abre el pipeline financiero legacy ni lanza un 500 si
el agente falla: entrega una continuidad conservadora con `agentRunOk=false`,
sin afirmar que el dinero aterrizó cuando eso no está verificado.

El E2E del modelo ahora captura `publicationRecovery` en cada turno y añade una
invariante transversal. Aunque los 24 checks nominales pasaran, el proceso sale
rojo si cualquier turno termina con:

- respuesta vacía;
- error final de entrega;
- recovery degradado;
- jerga interna (`KIPU_*`, nombres de contrato, payload/schema, etc.).

### 3.4 Publicación fallida no vuelve a ejecutar

`beginAgentOperationManifest` acepta el outcome SQL `already_verified` y
devuelve `alreadyVerified` + la verificación durable. `runKipuAgent` guarda esa
evidencia en `recoveredVerifiedManifest`, omite los writers y, al settle, no
intenta verificar otra vez el mismo manifiesto. Sólo se recupera publicación.

Esta salida no confía en TypeScript: la migración 115 exige en PostgreSQL que el
manifiesto esté `verified`, `allow_incomplete=false` y
`verified_count=authorized_count`. Una verificación parcial nunca obtiene
reentrada.

### 3.5 Paridad app ↔ PostgreSQL del stored fact de tarjeta

El análisis encontró una deuda independiente pero en la misma frontera: el
runtime ya publicaba/probaba
`register_card_payment.amount <- debt_accounts:<id>:full_payment_due`, mientras
la RPC de registro del manifiesto de la 112 sólo conocía gastos fijos.

`supabase/sql/115_m0_antibot_manifest_continuity.sql` está **PREPARADA, NO
APLICADA** y agrega el verificador bajo lock. Exige a la vez:

- capability `register_card_payment`;
- path `amount`;
- `paidInFull=true` y ausencia de `arguments.amount`;
- `source_ref` con el id exacto de la tarjeta;
- tarjeta propia, tipo `credit_card`, ciclo no cubierto y due vivo positivo;
- card id/nombre seleccionado coherente;
- testigo exacto de id, estado de corte, monto, moneda, fecha y período, con
  tolerancia monetaria de 0,005.

Un id ajeno, otra tarjeta, corte cubierto, monto/moneda divergente, testigo
incompleto o derivación no registrada fallan cerrado. La rama de gasto fijo se
conserva.

### 3.6 Tests añadidos

- **IR310:** prueba que una pregunta natural sin overlap pasa en no-write, que
  la misma frase no puede esconder un pending después de una escritura, que
  los speech acts reentran a verdad y que el harness mide silencio/recovery.
- **IR311:** fija `already_verified`, el skip de ejecución/reverificación, los
  dos marcadores SQL y la nueva cobertura PostgreSQL.
- **M115.1:** manifiesto `paidInFull` con stored fact de tarjeta exacto pasa;
  el mismo witness con drift monetario falla.
- **M115.2:** simula write+verify + fallo de publicación + exact retry; exige
  recovery sin nueva ejecución y rechaza una verificación parcial.
- **M0M470–478:** nueve mutantes cortan libertad de pregunta, continuidad,
  metadata, circuit breaker, reentrada, skip de doble verificación, rechazo de
  parciales y stored-fact SQL.
- El mutante histórico M0M415 dejó de fijar el matcher léxico de v40 y ahora
  mata el bypass de la invariante anti-bot del E2E.

## 4. Seguridad que NO se relajó

- `user_stated` sigue ligado a la entrega durable exacta; el caso 552,77 sigue
  rehusado.
- Money/calendar/entity grounding, mutation receipts y completitud siguen
  bloqueando afirmaciones falsas.
- El modelo de respuesta sigue con `selectedToolSchemas=[]`; ningún fallback
  puede ejecutar.
- Una respuesta post-write todavía debe explicar todos los pendientes.
- Un manifiesto parcial no puede reentrar como verificado.
- `already_verified` sólo evita writers; no inventa un receipt ni cambia el
  manifest hash.
- El pipeline legacy no reinterpreta la misma entrega cuando M0 está activo.
- No se añadió ninguna rama por palabra del usuario, tarjeta, arriendo,
  préstamo, banco ni transcript.

## 5. Validación local ejecutada

Sobre el sello indicado:

| Gate | Resultado |
|---|---:|
| `npx tsc --noEmit` | limpio, exit 0 |
| `npm run lint` | limpio, exit 0 |
| capture | **790/790**, exit 0 |
| mutaciones M0 | **477/477**, exit 0, baseline verde y restauración completa |
| `git diff --check` | limpio, exit 0 |
| `npm run build` | **36/36**, compiló con red, exit 0 |

El primer build dentro del sandbox no pudo descargar Geist de Google Fonts; se
repitió una vez con acceso de red y compiló correctamente. No fue un defecto de
fuente.

No se ejecutó PostgreSQL porque la 115 todavía no está aplicada. La frontera
vigente de la 114 permanece en el **80/80×2** que Claude auditó. Tampoco se
ejecutó el modelo: cero créditos gastados.

## 6. Instrucciones exactas para Claude

Claude debe auditar este sello sin editar código, fixtures ni aserciones.

### 6.1 Congelación

1. Recalcular hash, conteo (**493**) y `git diff --check`.
2. Confirmar runtime
   `m0-agent-eval-2026-08-13-antibot-continuity-m0-11a`.
3. Declarar `NO_EDITS_DURING_AUDIT`.

### 6.2 Auditoría de fuente antes de DDL

Verificar explícitamente:

1. El no-write `needs_info` usa `replyRequestsPendingClarification`; la rama
   post-write sigue usando `replyAcknowledgesPendingClarifications`.
2. La candidata normal y una reparación dirigida conservan prioridad; el
   speech act anti-bot es último recurso.
3. Todo speech act vuelve por `finalizeAgentReply` y recibe cero tools/autoridad.
4. `publicationRecovery` persiste en operación, replay y assistant metadata.
5. El handler no abre legacy ni produce silencio/throw bajo `agentMode=on`.
6. Un `already_verified` nunca entra a los writers y no vuelve a llamar
   `verifyAgentOperationManifest`.
7. El E2E hace rojo ante error, vacío, recovery o jerga interna, además de
   exigir sus 24 checks.

### 6.3 Migración 115

Auditar primero el archivo completo. Confirmar:

- el patch self-modifying encuentra exactamente un anchor de la función
  vigente y es idempotente por marcador;
- la rama fija anterior queda byte-equivalente;
- el verificador de tarjeta exige todos los bindings enumerados en §3.5 y usa
  `FOR UPDATE` con `user_id` + `credit_card`;
- `already_verified` exige set completo, no parcial;
- `SECURITY DEFINER`, `search_path`, owner y grants quedan correctos; sólo
  `service_role` ejecuta ambas RPC.

Si la auditoría es verde, aplicar **únicamente**:

```text
supabase/sql/115_m0_antibot_manifest_continuity.sql
```

Después verificar por catálogo y reaplicación rollback/no-op. No aplicar otra
DDL.

### 6.4 Gates en orden

1. `git diff --check`
2. `npx tsc --noEmit`
3. `npm run lint`
4. capture: esperar **790/790**
5. mutaciones en serie: esperar **477/477**, cero anchor miss/residuo
6. PostgreSQL: esperar **82/82** dos veces, exit 0
7. borrar `.next` y ejecutar build con red: 36 páginas
8. levantar servidor limpio, verificar handshake archivo ↔ runtime
9. ejecutar **una sola** muestra pagada en background:

```bash
node --env-file=.env.local ./scripts/qa/run-m0-model-e2e-background.mjs m0-11a-antibot
```

Esperar el status del mismo proceso; un timeout del cliente no autoriza lanzar
otra muestra.

### 6.5 Criterio de la única muestra

Exigir simultáneamente:

- **24/24**;
- cero `FALL`, `BLOCKED`, `ABORT`;
- `Invariante anti-bot: verde`;
- cero respuestas vacías/jerga interna;
- cero `agentPublicationRecovery` en la ruta normal;
- **ME3:** pregunta natural sólo por la cuenta, cero escritura, cero recovery;
- **ME10c:** undo restaura caja+receivable y su reply publica normalmente;
- **ME16:** los cuatro pagos ordinarios aterrizan una vez bajo un manifiesto;
- **ME17:** una confirmación natural autoriza/cierra el manifiesto sensible
  completo una sola vez;
- ninguna operación queda `applying`.

Un recovery natural evita dañar al usuario en producción, pero **no** autoriza
aprobar el sello: capturar su `initialFailure`, `strategy`, operación y check.

### 6.6 Cierre

Verificar cleanup por identidad en todas las tablas del runner, cero disposable,
cero manifiestos/eventos residuales, founder/Diners sólo lectura, servidor
detenido y sello final idéntico.

## 7. Stopping rule

- Si la 115 o PostgreSQL quedan rojos, no gastar modelo.
- Si cualquier determinista queda rojo, no interpretar la muestra anterior.
- Ante el primer rojo real del modelo, detener la ronda y conservar el
  diagnóstico tipado; no repetir el mismo sello buscando verde.
- No ajustar una aserción por coincidir con lo observado sin probar antes que
  contradice el contrato económico/lifecycle.
- No commit, push ni deploy. Un verde completo vuelve a Codex/founder para esa
  autorización.

## 8. Qué significa esta pasada para la visión de producto

Este cambio no hace al servidor “más inteligente” que el modelo ni añade
respuestas por catálogo. Hace algo más básico: impide que la mecánica destruya
una interpretación correcta. Kipu todavía puede preguntar cuando existe
ambigüedad real, pero la pregunta pertenece al modelo; la base sólo asegura que
no se escriba dinero sin autoridad. Y si una capa secundaria falla, el usuario
recibe una conversación honesta mientras QA conserva una señal roja para
corregir la causa. Esa es la lógica anti-bot: seguridad como límite de efectos,
no como censor del diálogo.

