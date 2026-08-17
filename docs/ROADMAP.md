# Kipu — Roadmap vivo

**Este es el roadmap ACTIVO.** Acordado con el founder el 2026-07-16, después de
cerrar el Bloque H. Sustituye a cualquier "Next:" que quede en otro documento y a la
secuencia vieja ("engine refinement → chat-agent review → visual deep-dive → Bloque
E"), que está derogada. `docs/ROADMAP_MVP.md` es el plan ORIGINAL de 13 fases y hoy
es solo arqueología: no se ejecuta.

## El principio que ordena todo

**Primero el back y los features al 100%. El front entero, al final, como un stage
propio.**

No se pulen pantallas mientras un número pueda mentir. Cada bloque de abajo existe
para que el motor sea intachable; recién cuando eso esté cerrado se toca la interfaz
— y ahí se toca ENTERA (navegación, accesos, tableros, animaciones, UX), no a
parches. El estado visual de hoy es un intermedio conocido entre el diseño viejo y el
nuevo, y se asume así a propósito.

---

## Bloque I — Que ningún número pueda inflarse solo

**Estado: CERRADO (2026-07-19, veredicto del founder)** · commit final `7a575cf`
· migraciones 056–065

> **Qué garantiza el bloque, en una línea:** ninguna lectura caída, ninguna
> escritura a medias y ningún replay puede hacer que un número del motor se
> mueva a favor del usuario sin que el dinero real se haya movido.
>
> **Cómo se cerró:** seis pasadas de auditoría externa (11 → 10 → 7 → 6 → 7 → 7
> defectos, todos corregidos y verificados), más un panel adversarial propio que
> encontró 3 huecos antes de entregar. Cada defecto se cerró con el mismo
> estándar: cadena corregida, invariante nueva, prueba de TRAYECTO del caller
> real, mutación que rompe un test con nombre, y sonda RPC contra producción
> dentro de una transacción revertida. Gate `/dev/capture-test` 317 → **406**
> aserciones; 31 mutaciones verificadas con post-revert verde; sondas A–G.
>
> **El vocabulario que queda como doctrina permanente:**
> `MoneyReadStatus {ok, complete}` + `moneyReadPublishable()` —
> `readX()` devuelve el contrato (dinero), `loadXForDisplay()` colapsa el fallo y
> se llama así para que el mal uso se vea. «No pude leer» ≠ «no hay nada»; un
> guard que no pudo leer NO autoriza; un read-modify-write necesita CAS; «el
> write falló» ≠ «no aterrizó»; completitud PROBADA (cursor + CAP+1 posible), no
> asumida; y toda operación de dos mitades vive en UNA transacción con marca
> durable, no en dos escrituras encadenadas.
>
> Historial completo de las seis pasadas abajo (se conserva como registro de
> auditoría). Detalle de lo construido en `docs/BUILD_PROGRESS.md`.

> La auditoría externa encontró 11 defectos fuera de la cobertura de los gates. Los
> 11 están corregidos (commit de la re-auditoría: migraciones 056-057, ejecutor
> crash-safe con lease + intención durable, valuación FX condicional, uniones
> discriminadas, gate 317→356 con 9 mutaciones verificadas y sonda RPC en
> transacción revertida). El bloque NO se declara cerrado hasta que el founder
> re-audite.
>
> **Re-auditoría 2 (2026-07-17/18, segunda pasada del auditor): 10 defectos más,
> corregidos.** Migraciones 058-061 (intención durable con fidelidad
> NULL/cero/fila-inexistente; repago idempotente ante replay + sin mezclar monedas;
> household atómico por RPC con CAS por counts Y TOTALES + lock compartido).
> Recovery paginado y probado ANTES del main (el main ya solo reclama filas sin
> lease); uniones de TRES brazos (los datos completos solo existen en
> `{ok, complete}` — `partial` es display y se nombra); radio del fail-closed FX
> acotado a filas ACTIVAS que alimentan el Saldo; crons de dinero responden 5xx
> ante corrida incompleta, writes fallidos o infra caída a mitad de camino. Un
> panel adversarial propio (10 refutadores) encontró y cerró 3 huecos más ANTES de
> entregar (CAS ciego a montos, net_worth publicando total sin activos leídos,
> write fallido contado como «diferido y verde»). El bloque SIGUE sin declararse
> cerrado hasta la próxima auditoría.
>
> **Auditoría 3 (2026-07-18, tercera pasada): 7 defectos residuales, corregidos.**
> Migración 062. (1) La base de un repago legacy se PRUEBA o se rehúsa (lectura de
> perfil tipada + el gemelo en el applier general + la RPC valida base vs perfil).
> (2) El auto-book recurrente distingue bloqueo funcional de fallo de INFRA
> (`bookRecurring` unión discriminada), un fallo cuenta error ⇒ 5xx y la ocurrencia
> AUTO pending se REINTENTA (antes quedaba fuera del ledger para siempre, en verde).
> (3) La zona participa del fail-closed del materializador (error o IANA inválida ⇒
> usuario saltado esa noche, jamás Guayaquil por accidente); los sets por-usuario
> prueban completitud (CAP 300+1) y el descubrimiento pagina por keyset — el CAP
> 5000+1 era una prueba IMPOSIBLE con max-rows ~1000. (4) La obligación sobrevive a
> la membresía: el cuadre incluye a todo miembro REFERENCIADO por dinero (motor +
> 3 call sites) con aserción de conservación Σ=0 antes de escribir. (5) cancel y
> mark_paid pasan por RPC con el MISMO lock del settle; toda RPC household valida
> al ACTOR en la transacción. (6) finalize/releaseClaim fallidos dejan la corrida
> no-sana (5xx) conservando applied cuando el dinero está probado. (7) El update de
> gasto compartido valida el CONJUNTO PERSISTIDO: dup rechazado, cobertura exacta,
> y suma post-write verificada en la misma transacción. Gate 380→389, 5 mutaciones
> nuevas muerden, Sonda D en prod (revertida) prueba los 6 caminos DB. El bloque
> SIGUE sin declararse cerrado hasta la próxima auditoría.
>
> **Auditoría 4 (2026-07-18, cuarta pasada): 6 defectos, corregidos.** Migración
> 063. (1) `updateSharedExpense` estaba ROTO por la 062 (los dos payloads omitían
> `created_by` y el actor obligatorio rechazaba TODA edición): seam
> `updateSharedExpenseWith` con el actor en ambos calls, probado por el TRAYECTO
> del caller real; lectura del gasto caída ⇒ `no_disponible`, jamás
> «gasto_no_existe». (2) El corte de tarjeta ya no es terminal sin write probado:
> `resolveCardStatementOcc` (executor real de confirm/correct) — setDue fallido ⇒
> ok:false SIN transición (antes confirm devolvía ok:true con el write caído y
> correct marcaba corrected antes de fallar: jamás se reintentaba); el retry
> re-pone el MISMO corte (idempotente). (3) La moneda base es un HECHO probado:
> `readProfileBaseCurrency` tipada (error/fila ausente/base vacía ⇒ no write) en
> `bookAmount` + `bookInvestmentTransfer`, y `loadUserBundle` corta sin fila de
> perfil o sin base — el `?? "USD"` fabricaba la base ante una lectura caída.
> (4) El pago de tarjeta es ATÓMICO: `kipu_apply_card_payment` (063) aplica
> ledger + baja de `full_payment_due` en UNA transacción con CAS sobre el valor
> leído y replay idempotente por dedupe (sin re-reducir); cablea el cron
> (`bookRecurringWith`, seam probado) Y el gemelo del chat (fallback
> determinístico `chat:cardpay` para canales sin operationId);
> `reduceCardStatementDue` ELIMINADA — ningún caller nuevo puede resucitar las
> dos escrituras. (5) La zona del notifier se PRUEBA o el usuario se salta esa
> noche (`pickNotifierTimezone`: lectura caída o IANA inválida ⇒ error contado,
> sin envío y sin consumir askCount/lastAskedOn; fila ausente = default
> legítimo). (6) `kipu_apply_repayment` rechaza al usuario SIN fila de perfil
> (`v_pbase is null` ⇒ KIPU_VALIDATION; antes era permiso para continuar). Gate
> 389→398 (IR19–IR23, trayectos de los callers reales), 6 mutaciones nuevas
> (RM-20…RM-25) muerden su test nombrado con post-revert verde, Sonda E en prod
> (revertida): sano/replay/CAS-40001-revierte-el-ledger/sin-perfil. El bloque
> SIGUE sin declararse cerrado hasta la próxima auditoría.
>
> **Pasada 5 (2026-07-18, re-auditoría de la pasada 4): 7 bloqueantes en los
> puntos 2 y 4, corregidos.** Migración 064. (1) El corte va por RPC con lock
> (`kipu_set_card_statement`): `updated` / `safe_newer_exists` (un corte más
> nuevo aterrizó concurrente: NO se pisa, y el aviso viejo se cierra diciéndolo)
> / raise en cero filas o no-tarjeta — el UPDATE viejo daba éxito con cero filas
> y su read→write sin CAS podía pisar un statement más nuevo; IR20 recorre la
> dependencia REAL (resolver → setCardStatementDueWith → RPC mockeada).
> (2) TODO pago a una tarjeta con statement vigente está centralizado:
> `planCardPaymentStatement` es la decisión ÚNICA de chat,
> register_card_payment, log_movement (rutea a la RPC atómica con identidad
> `agent:cardpay`), el batch (REHÚSA la fila → register_card_payment aparte) y
> el cron; el prompt de aclaración PAGO_TARJETA manda register_card_payment y
> prohíbe log_movement. (3) Moneda no expresable en la de la tarjeta con
> statement vigente ⇒ `blocked`/`needs_info` en TODOS los callers — jamás el
> writer plano (ir22_e INVERTIDO: el gate codificaba ese fallback como
> correcto). (4) El replay se prueba con una MARCA durable:
> `card_payment_applications` (dedupe, card, tx, expected, paid) nace en la
> MISMA transacción que el ledger; un ledger genérico con el mismo dedupe SIN
> marca ⇒ KIPU_CONFLICT, jamás `replayed:true`. (5) RPC endurecida:
> type/effect_type = debt_payment, entry.debt = statement.debt, ownership +
> credit_card CON lock, coherencia de paid con el monto/moneda del entry.
> (6) Gate 398→401 (IR20 reescrito por la dependencia real + IR24/IR25/IR25b
> con 8 marcas vivas), mutaciones RM-26…RM-31 muerden su test nombrado,
> post-revert verde. Sonda F en prod (revertida): updated / safe_newer sin
> pisar / cero-filas / tarjeta-A-statement-B / monto manipulado / ledger
> genérico sin marca ⇒ conflicto / marca en la misma txn / replay / CAS 40001 /
> expense rechazado / préstamo rechazado. (7) AGENTS.md numera desde la 064.
> El bloque SIGUE sin declararse cerrado hasta la próxima auditoría.

> **Pasada 6 (2026-07-18, corrección local por Codex): 7 huecos de la máquina de
> tarjeta cerrados; migración 065 PREPARADA, todavía no aplicada.** (1) Se bloquea
> en TypeScript Y DB todo `debt_payment` donde cuenta, entry y deuda no compartan
> moneda nativa: el ledger 051 usa un solo `original_amount` para ambos deltas y
> no puede representar un pago cross-currency sin corromper uno. (2) El ciclo
> separa `statement_total_due`, remanente y `statement_covered`: un pago parcial
> conserva la reserva aunque exista `last_payment_date`; la cobertura se estampa
> dentro de la misma RPC que mueve el dinero. (3) Reintentar el mismo corte ya no
> repone el total: `safe_same_exists`; corregir el total conserva lo ya pagado.
> (4) Los writers declarativos de agente y Mis datos abandonan
> `full_payment_due` directo: RPC con lock+CAS; el formulario incluye ambos saldos
> en el CAS y los updates restantes del agente confirman fila afectada. (5) Un
> duplicado manual sin `card_payment_applications` no se acepta a ciegas ni queda
> atascado: `kipu_reconcile_existing_card_payment` valida la transacción y aplica
> solo statement+marca en una transacción. (6) La marca gana fingerprint completo,
> transaction unique y privilegios explícitos (`authenticated` SELECT únicamente,
> incluido revoke de TRUNCATE). (7) El scan del guard de duplicados usa CAP+1.
> Gate local 406/406; mutaciones de cobertura parcial, cross-currency, duplicado
> sin marca y defensa SQL muerden IR26/IR25+IR22/IR22/IR28 respectivamente. No
> desplegar hasta aplicar 065 y ejecutar una sonda RPC transaccional.
>
> **Auditoría de la pasada 6 (2026-07-18, Claude sobre el trabajo de Codex):
> APROBADA con un endurecimiento.** Verificación independiente: tsc/lint/build
> limpios, gates re-corridos (406/406 · 21/21 · 156/157 C19), 4 mutaciones
> propias (MA cobertura → IR26; MB cross-currency → IR22+IR25; MD borrar el
> CREATE del trigger → IR28). Hallazgo del auditor: la marca de IR28 era por
> SUBSTRING y el `drop trigger if exists` la satisfacía — borrar solo el CREATE
> dejaba la defensa muerta con el gate verde; el ancla ahora es la sentencia de
> instalación completa. Migración 065 APLICADA en prod y re-aplicada en
> transacción revertida (replay OK); Sonda G (revertida) probó los 13 casos
> exigidos: parcial 200→120 sin cobertura · final 170→0 cubierto · replay sin
> re-reducción · payload alterado ⇒ DEDUPE_MISMATCH · ARS→USD rechazado
> intacto · préstamo cross-currency parado por el trigger · reenvío del corte
> conserva 120 · corrección 200→250 ⇒ 170 · corte viejo no pisa · reconcile
> reduce SOLO el corte (balance intacto, marker reconcile:<tx>) · reconcile
> replay/revertido/pre-corte/cross-currency rechazados · CAS 40001 con ledger
> fantasma 0 · authenticated sin INSERT/UPDATE/TRUNCATE.
>
> **→ El founder dio el veredicto el 2026-07-19: Bloque I CERRADO.**

Un barrido de 6 agentes sobre todo el backend, con un refutador dedicado por hallazgo,
encontró **21 fail-opens confirmados** (de 32 reportados). Las cuotas eran la punta.

**El vocabulario único:** `src/lib/financial/money-read.ts` — `MoneyReadStatus
{ok, complete}` + `moneyReadPublishable()`. `ok` = la lectura no falló. `complete` =
puedo PROBAR que vi todo y pude valuarlo. Convención: `readX()` devuelve el contrato
(dinero); `loadXForDisplay()` colapsa el fallo y se llama así para que el mal uso se
vea. Ausencia legítima (sin filas) sigue siendo `ok:true`.

**El guard único** (coaching-signals.ts) enumera las 8 lecturas monetarias: feed,
cuotas, compromisos, FX, metas, planes de ahorro, pagos programados y la valuación FX
del contexto. **I.7 lee el código fuente del guard** y falla nombrando la lectura que
falte: es lo único que sujeta una lista que crece.

**Los tres peores:**
1. `loadMargenCommitments` no desestructuraba el `error` → un fallo decía "no ahorra
   nada" → el ahorro protegido del usuario financiando su propio Saldo. **Armado hoy.**
2. `loadFxRates` (raíz de 6 hallazgos) → sin tasas, toda obligación extranjera
   DESAPARECE (el código la descarta a propósito cuando no hay tasa; el loader hacía
   que "no pude leer" fuera lo mismo).
3. `scheduled-changes-store` leía el compromiso sin chequear el error y ESCRIBÍA 0
   encima: un blip **borraba** el ahorro del usuario.

También: CAS en el interés de tarjeta (un read-modify-write borraba una compra
concurrente), el materializador nocturno dejó de revertir a ciegas un movimiento que
sí commiteó, y los guards de duplicado (ingreso, gasto fijo) dejaron de apagarse solos
— un guard que no pudo leer NO autoriza.

## Bloque J — El agente al 100%

**Estado: CERRADO (2026-07-28, veredicto del founder y auditor externo)** ·
commit final `54311f6` · migraciones 066–092 · producción verificada

Abrir el chat REAL del founder en la beta y revisarlo mensaje por mensaje: ¿cada
respuesta tiene sentido? El founder ya tiene errores mapeados que se revisan aquí.
Objetivo: dejar el agente pulido, sin errores.

El bloque tiene DOS mitades y solo una es código:

### Cierre first-principles posterior a J-8 (2026-07-28)

J-8 ya fue desplegado en `21e9c4a`. Antes de declarar el bloque cerrado se
auditó el agente completo como sistema —no sólo los incidentes conocidos—:
identidad de cada delivery, autoridad de cada acción, replays/no-op, evidencia
numérica y por entidad, tool schemas en runtime, estado fresco después de un
write, fallbacks, reads completas y cada frontera de escritura.

El cierre encontró y corrigió familias transversales que una revisión del chat
no podía probar sola: redelivery sin identidad estable; evidencia adjunta que
podía narrarse como éxito aunque la escritura fallara; fallback legacy después
de una acción parcial; confirmaciones elegidas por el modelo; montos verdaderos
asociados a la entidad equivocada; resultados de tools inyectables en el prompt;
segundas acciones sobre estado stale; creates/household/merchant writes sin
identidad durable; transferencias FX de dos montos nativos; y selecciones
implícitas que confundían «única fila» con «la fila nombrada».

**Estado actual (2026-07-28):** auditoría independiente hecha; migraciones
**088, 089, 090, 091 y 092 APLICADAS**; sondas `scripts/qa/j-agent-088-probes.mjs`
en **61/61** con exit 0 y residuo cero; gate local **604/604**; `tsc`, lint,
`git diff --check` y `npm run build` (con red) limpios.

La auditoría encontró **tres P1 por ejecución**, ninguno visible leyendo SQL:
`create_account`/`create_card` estaban muertas (text→enum sin cast); una
redelivery tardía del turno que proponía cancelaba la propuesta viva; y el guard
nuevo de meta compartida convertía «borrar un hogar» en imposible. Además salió
un P1 anterior al bloque (`created_by` NOT NULL con ON DELETE SET NULL impedía
borrar usuarios) y varios huecos de gate donde la mutación sobrevivía: la barrera
de grounding monetario no estaba sujetada en su call site, el adaptador FX no
estaba cubierto por ningún lado, el segundo guard de autoría no se ejercitaba y
el «barrido de clase» era una regex por línea que no habría visto un FK
multilínea ni uno agregado por ALTER TABLE. La 092 mueve esa autoridad al
catálogo y fija la inmutabilidad de `created_by`.

**Cierre final:** una pasada independiente sobre el árbol congelado no encontró
defectos nuevos de producto. El commit `54311f6` quedó en `origin/main` y es el
SHA servido por producción; deployment READY y aliases promovidos; apex, www y
login respondieron 200; Vercel no reportó errores nuevos en ventanas de 30
minutos y 2 horas. Sondas 61/61 post-deploy con residuo cero; capture 604/604;
loop 21/21; wizard 161/161; J-2/J-3/J-4 17/17, 21/21 y 18/18; build, lint y tsc
limpios. Datos del founder y contrato del esquema intactos.

### J-8 — lo que encontró la revisión del chat REAL (2026-07-27)

La mitad humana del Bloque J (revisar la conversación real, mensaje a mensaje)
destapó **cinco defectos encadenados sobre un solo pago de tarjeta**, y con ellos
una lección que ordena todo el bloque: **una instrucción de prompt no es un
guard**. El prompt YA decía «Nunca inventes saldos ni montos». Pasó igual.

**El caso.** «Pagué el total con todo lo que tenía en Produbanco más un dinero
prestado de Alpaca con la diferencia» ⇒ Kipu escribió **552.77**, que era el
SALDO DE PRODUCBANCO, mientras el corte guardado de esa tarjeta decía **743.93**
—el mismo número que le había avisado al usuario el día anterior—. Al corregirlo
(«Pero el pago fue de $743.93, ¿de dónde sacaste el $552.77?») escribió un
SEGUNDO pago sin revertir el primero: la deuda bajó **1.296,70** cuando el pago
real fue 743,93, y quedó en **−552.77**. Después, al preguntarle cuánto había
cuadrado, RE-EJECUTÓ la herramienta de escritura y reportó el no-op («Fue 0$»)
como si fuera la respuesta.

**Radio medido, no estimado:** 15 tools escriben en el ledger y **sólo 1** tenía
la barrera de corrección de J-2 · **5 de 6** tools con monto no lo contrastan
contra el estado del motor · **4** devuelven `done` sobre un no-op · **2** se
tragan el fallo del refresh · **0** aceptan un pago repartido.

| | Defecto | Fix |
|---|---|---|
| D1 | El monto del LLM no se contrasta con lo que el motor sabe | `planStatedAmount` — «el total» + corte guardado distinto ⇒ pregunta |
| D2 | La barrera de corrección vivía en UN executor | `guardCorrectiveToolCall` en el chokepoint, `LEDGER_TOOLS` (15) |
| D2b | `correctivePhrasing` no veía la familia «afirmo mi cifra y cuestiono la tuya» | `challengedFigure` + `contrastiveRestatement` |
| D3+D5 | Un pago de dos fuentes se escribía a medias | `planMultiSourcePayment` — pregunta el reparto ANTES |
| D4 | Un write re-ejecutado respondía una pregunta | marca `noop` + instrucción de leer con `list_recent_movements` |
| D6 | El fallo del refresh era mudo | `withRefreshCaveat` — sin relectura no se citan saldos |

**Descartado tras medirlo** (casi los reporto): tarjeta equivocada (era la
correcta, la renombró 3 min después), desambiguación de instrumento (ya pregunta
con varias coincidencias), escrituras fire-and-forget (el applier lanza), deuda
negativa (decisión deliberada del ledger) y «dejé reportado el error» (`report_bug`
es real y la fila existe).

**Reparación del dato:** reversa append-only del pago de 552.77 + cuadre; deuda
en **0** y Produbanco en **0**, verificado. Ninguna fila borrada.

Gate 517→**521** (IR87–IR90) · **10 mutaciones, las 10 muerden** — y las 4 que
sobrevivieron en la primera pasada eran huecos de MIS tests (verificaban que la
línea existiera, no que su resultado se consumiera), no del producto.

**Estado de re-auditoría (2026-07-28).** La 084 fue aplicada manualmente y su
puente de fondos prestados resultó incompatible con el propio ledger
(`adjustment` no admite `debt_account_id`); la 085 corrige el cuerpo vivo sin
reescribir la aplicada. La 086 rehace el backfill de cuotas preservando tanto
`status='paid_off'` como `paid_off_at`. La auditoría posterior encontró un P1
restante: un draft `resolved` no guardaba qué operación lo consumió, por lo que
una identidad nueva podía volver a usarlo. La **087** —que en ese momento estaba
preparada y sin aplicar; hoy YA ESTÁ APLICADA, ver el estado final abajo— agrega
identidad durable `resolution_kind + resolved_dedupe_key +
resolved_operation_id`, replay exacto y exclusión de segundo consumo secuencial,
cruzado o concurrente. Las sondas J-8 se amplían con draft multivuelta/retract,
undo completo del grupo, pending+movimiento, metadata/cuotas y carrera por HTTP.
**La 087 quedó APLICADA (2026-07-28) y verificada por consulta**, no por el
`success` de la herramienta: 3 columnas, constraint de identidad, 2 índices únicos
parciales, y las 3 funciones SECURITY DEFINER con owner `postgres` y EXECUTE sólo
para `service_role`. Cero drafts `resolved` sin identidad antes de aplicar, así que
su migración de datos fue un no-op. Reaplicación segura comprobada en transacción
revertida (3/3 marcas vivas ⇒ el bloque detecta «ya aplicada» y no re-sustituye).
Sondas **45/45** con exit 0 y residuo cero.

**Estado histórico de ese momento:** J-8 quedaba pendiente sólo del deploy. Ese
deploy ocurrió en `21e9c4a`; después vino la re-auditoría first-principles con
088–092 y el cierre final desplegado en `54311f6`. El estado vigente es
**CERRADO**, según la cabecera de este bloque.

### Mapa J-1…J-7 (orden ORIGINAL del founder — ésta es la lista autoritativa)

La numeración se me había corrido en sesión: lo que cerré como «J-3» es en
realidad **J-5**. Queda fijada acá para que no vuelva a pasar.

| # | Qué es | Estado |
|---|---|---|
| **J-1** | La moneda manda la cuenta (Error 1) | **CERRADO** · migraciones 066–074, 8 re-auditorías |
| **J-2** | «No era X, era Y» = corrección, jamás gasto nuevo (Error 2) | **CERRADO** · `correctivePhrasing` + `movementCorrectionTargets` + interlock legacy |
| **J-3** | «Ya la pagué» del onboarding significa CUBIERTA (Error 3) | **CERRADO** · predicado `cardStatementSettled` cableado en las 3 superficies |
| **J-4** | Un digest, no una ametralladora (Error 4) | **CERRADO** · migraciones 076–077 aplicadas y auditadas |
| **J-5** | Responder por chat CIERRA la pregunta (Error 5) | **CERRADO** · migración 075 (lo que llamé «J-3») |
| **J-6** | Barrido de vocabulario retirado (H2) | **CERRADO** · marca en 0, prohibición dura (IR65), 13 correcciones semánticas |
| **J-7** | Harness de observación + 3 barridos + persona desechable E2E | **CERRADO** · 078–083 aplicadas; rollout y E2E 38/38 verificados |

> **J-7 (2026-07-26) — los tres barridos refutadores: 5 defectos, ninguno
> teórico.** El comentario de la 066 decía, textual, «transfer y refund (reglas
> propias — J-7 los audita aparte)». Nunca se escribieron.
>
> **Barrido 1 (multi-moneda).** El efecto `transfer` del ledger resta `v_eao` del
> origen y suma EL MISMO `v_eao` al destino: un solo monto para dos patas. Con
> origen ARS y destino USD la resta es correcta y la suma **inventa dólares** — el
> bug de J-1 exacto (corrupción real en prod del 06 al 10 de julio) por la única
> puerta que J-1 dejó abierta a propósito. `refund` igual: acredita el ORIGINAL al
> destino sin mirar su moneda. De los CINCO constructores de `TransferIntent`,
> sólo el tool del agente lo rehusaba; el applier —chokepoint del fallback legacy,
> del parser y de la corrección por recovery— no miraba moneda, y
> `refuseCurrencyMismatch` cubría exactamente las ramas de J-1 (ingreso, pago,
> aporte ×2, gasto ×2) y ninguna de estas dos. **En prod: 0 filas transfer/refund
> (nada que reparar) pero 1 usuario con cuentas ARS+USD — el combo exacto que
> produjo la corrupción original.** Arma cargada, no herida.
> Fix en tres capas: decisión pura `planMovementLegsCurrency` (exchange vs
> mismatch), cableada en las dos ramas del applier, + migración **078** (extiende
> el trigger vivo 070 a `transfer` y `refund`; el bucle ya recorría las dos patas
> con `for no key update`, así que no hay lógica nueva). Y la contracara del
> cerrojo: el mensaje viejo del tool pedía «un tipo de cambio confiable» que ese
> camino **no puede usar** — el usuario lo daba y no pasaba nunca. Ahora las tres
> capas dicen la verdad: cambiar de moneda es una capacidad faltante y el write
> se rehúsa. Ya no sugiere fingirla como gasto+ingreso, porque eso alteraría el
> Saldo aunque los balances de cuenta parecieran cuadrar.
>
> **Barrido 2 (emisores proactivos).** Tres emisores mandan a Telegram; sólo dos
> reclamaban asiento. El **cierre mensual de objetivos** lo esquivaba — y corre en
> el MISMO cron que el digest (21:00 BA), así que los días 1-3 el «techo de 2/día
> compartido» de J-4 no era un techo. Ahora reclama carril `coach` con el tope
> TOTAL compartido y **libera el asiento** ante un fallo pre-entrega (quemar el
> intento por una copia que nunca salió dejaría el reporte del mes sin mandar).
> Además: el coach ambient era el único emisor que **no dejaba procedencia** —
> metadata vacía. En la beta real eso son **8 de los 56 turnos del asistente sin
> autor**, y un turno de dinero que no se puede atribuir no se puede auditar
> después.
>
> **Barrido 3 (ciclo de vida de las 6 ocurrencias).** `updateOccurrence` devuelve
> `| null` y se traga la excepción, así que un `await` suelto convertía una
> escritura FALLIDA en éxito narrado: Kipu decía «ok, no te pregunto más por esto»
> y al día siguiente lo volvía a preguntar. Es el defecto de J-5 **en los caminos
> que J-5 no tocó** (J-5 sólo cubrió `card_statement`); los sitios que escriben
> dinero ya verificaban, los que sólo marcan estado no. Seis salidas —snooze,
> dismiss, skip, confirm-sobre-booked, reserva confirm, reserva correct— pasan por
> `markOccurrence`, que devuelve el resultado tipado para que la marca sin
> verificar no se pueda volver a escribir por descuido.
>
> **El harness `/dev/chat-review`.** Lee con el cliente de SESIÓN (RLS, jamás
> admin: cada quien ve sólo su conversación, la misma que ya ve en la app), así que
> es inofensivo en producción — que es donde vive el chat real. Muestra cada turno
> con su PROCEDENCIA y sus tools, y arriba la cobertura de atribución, que es su
> propia prueba de salud. Una lectura caída se dice como lectura caída, nunca como
> «no hay nada que revisar».
>
> Gate 504→**505** (IR72–IR75), **10 mutaciones, las 10 muerden** un test nombrado.
> Lint, build y tsc limpios; loop 21/21, wizard 161/161, harnesses 17/21/18.
>
> **El E2E de persona desechable** (`scripts/qa/j7-persona-e2e.mjs`) responde lo
> único que ningún gate estático puede: si el dinero se movió —o NO— como decimos.
> Escribe contra el Postgres real con el writer REAL y mira los balances, y separa
> las dos capas: el applier rehúsa (TS) y un INSERT CRUDO con service_role,
> saltándose TypeScript entero, tiene que ser rechazado igual (DB). **11 verdes /
> 2 rojos**, y los 2 rojos son exactamente los brazos E4/E5: el script INTERROGA
> al trigger en vez de asumirlo, y hoy reporta «la 078 NO está aplicada». Residuo
> cero verificado en prod tras cuatro corridas.
>
> **Migración 078 APLICADA (2026-07-27).** Verificada en la DB, no en el `success`
> de la herramienta: el cuerpo vivo cubre `transfer`/`refund`, los **4 locks
> `for no key update` de la 070 siguen ahí**, el trigger sigue BEFORE INSERT y
> habilitado, la ACL es `postgres=X/postgres` (revocada de public/anon/
> authenticated) y sigue SECURITY DEFINER con owner postgres. La prueba falsable:
> **E4 y E5 pasaron de rojo a verde sin tocar una línea de código**. El E2E creció
> a **17/17** con los brazos de regresión E8/E9 (`reversal` seguía exento y
> `adjustment` todavía dependía del caller), E10 (patas coherentes pero movimiento
> en una tercera moneda) y E11
> (la base se sigue validando contra el perfil). Data del founder intacta (25
> txns, 10 cuentas, balances sin cambio) y residuo cero.
>
> **Re-auditoría externa de J-7 (Codex, 2026-07-27; migraciones 079–080) —
> APROBADA con un defecto propio.** Nueve hallazgos suyos, todos reales y todos
> verificados por ejecución: el cierre mensual no era atómico (tres hechos
> independientes, y `appendChatMessage` devuelve `null` sin lanzar, así que podía
> congelarse un cierre SIN mensaje durable); la inversión recurrente era una saga
> cuya compensación no era idempotente (un replay descontaba el activo dos veces y
> el intento siguiente reutilizaba el dedupe de una transacción ya revertida);
> `adjustment` seguía siendo puerta cross-currency —**mi 078 lo dejó exento «por
> construcción», que es proteger una invariante con una convención, y mi E9
> encodeó esa convención como si fuera garantía**—; las reservas puras decían
> haber anotado un monto que no se persistía; y `/dev/chat-review` certificaba
> cobertura de atribución sobre una muestra truncada a 400 mensajes.
>
> **Mi hallazgo sobre su corrección: `40001` no es un conflicto, es un reintento.**
> Sus RPC usaban `errcode = '40001'` también para rechazos DETERMINISTAS. `40001`
> es `serialization_failure` y **PostgREST reintenta ese SQLSTATE**: como el
> rechazo no puede cambiar, reintentaba hasta agotarse y el cliente recibía
> **HTTP 504 «upstream request timeout»**, que el store clasifica como
> `write_failed` — o sea fallo de infraestructura — y entonces
> `publishObjectiveMonthCloseReliably` lo REINTENTA otra vez: dos timeouts
> completos por cada rechazo determinista. Es la conflación que el Bloque I
> prohíbe y la misma lección de J-3. La prueba interna: en la MISMA corrida, el
> fingerprint de inversión (`KIPU_DEDUPE_MISMATCH`, errcode 22023) llegaba
> perfecto y su test pasaba en verde, mientras los de 079 daban 504.
> La **081** baja los 10 deterministas a `22023` y en esa pasada se creyó que
> conservaba 40001 en 3 CAS transitorios; la re-auditoría 082 demostró después que
> ocurrían post-lock y también eran deterministas. Re-crea de forma explícita las
> tres RPC; la verificación correcta
> es comparar los cuerpos normalizados con 079/080 y exigir que la única diferencia
> semántica sean esos SQLSTATE (no existe el `regexp_replace` que decía el informe
> inicial). E2E **26/28 → 28/28**. IR76 lo blinda y muere con la mutación.
>
> **ROLLOUT COMPLETO (2026-07-27).** Commit `bf7d7d4` → deploy verificado por una
> prueba falsable (`/dev/chat-review` es una ruta que NO existe en `bbe108b`: pasó
> de 404 a 200, con una ruta inexistente como control negativo aún en 404) → **083
> APLICADA** → E2E **35/38 → 38/38**.
>
> Dos cosas que salieron mal y cómo se resolvieron, porque importan:
> **(1)** El conector MCP falló DOS veces en medio de la 083 («server isn't
> responding», 502 de Cloudflare). Un `success` ausente no dice si el write
> aterrizó: verifiqué el estado por una vía INDEPENDIENTE (llamar los cores como
> `service_role` vía PostgREST — un core cerrado responde permission denied, uno
> abierto ejecuta y devuelve su propia validación) y confirmé 0/15 cerrados, sin
> estado parcial. Recién entonces reintenté, en piezas pequeñas.
> **(2)** `information_schema.role_table_grants` SUB-REPORTA: sólo muestra grants
> visibles al rol de la conexión, y llegó a decir «(ninguno)» sobre tablas que sí
> tenían SELECT. La fuente autoritativa es `has_table_privilege` /
> `has_function_privilege`. Con ella: `savings_plans` conserva SELECT y perdió
> INSERT/UPDATE/DELETE; `recurring_occurrences` y `objective_month_closes` igual;
> los 15 cores legacy sin EXECUTE y sus 15 v2 con EXECUTE.
>
> **Corrección del founder a mi reporte anterior:** el HEAD desplegado usaba DOCE
> cores legacy, no tres. Yo había comprobado cuatro nombres y afirmé sobre esa
> muestra — el mismo error de aserción débil que vengo persiguiendo. Verificado
> ahora sobre los quince: 12 en `HEAD`, 0 residuales en el árbol nuevo.
>
> **Cierre de re-auditoría (Codex, 2026-07-27; migraciones 082–083).** Doce
> hallazgos más, estructurales: una lectura fallida de `savings_plans` se volvía
> «reserva pura»; `scope=from_now` no actualizaba el plan futuro; el scalar de
> capacidad podía separarse de sus planes; Mis Datos podía reexpresar un plan; el
> loop ambient seguía confundiendo fallo con ausencia; publicación/cooldown/
> recordatorios no eran un solo hecho; y quedaban fronteras del Bloque I donde un
> rechazo determinista salía como `40001` — la generalización de lo que encontré
> en la 081, ahora cerrada con **15 wrappers v2**.
>
> **Auditoría de Claude: APROBADA. 082 APLICADA y verificada contra Postgres
> real** (él sólo la había validado localmente): 15 v2 creadas, todas SECURITY
> DEFINER + owner postgres + EXECUTE sólo `service_role`, ninguna expuesta a
> authenticated/anon; los 2 writers de plan igual; **los 15 cores legacy siguen
> vivos**, así que la ventana de rollout está intacta; los guards de la 083 NO
> están activos. E2E **35/38**, y los 3 rojos son EXACTAMENTE la familia E17 —el
> harness reporta el estado del rollout en vez de fingir verde—.
>
> Verificado además: el aislamiento por defecto es `read committed`, así que el
> motor no emite un `40001` genuino por su cuenta (los deadlocks son `40P01`, otro
> handler) — la conversión `serialization_failure → 22023` de los wrappers no se
> traga ningún reintentable. Y su afirmación sobre el test débil se comprobó
> reproduciendo su mutación exacta: renombrar sólo el `CREATE TRIGGER` (dejando el
> `DROP`) ahora mata IR84.
>
> **Corrección a mi propia 081:** sus wrappers reclasifican como deterministas los
> 3 que yo dejé como «CAS transitorio», porque el core toma `FOR UPDATE` ANTES, de
> modo que un row_count final distinto de uno es una invariante rota, no una foto
> stale que el mismo payload pueda curar. Su lectura es mejor que la mía.
>
> **BLOQUEO de la 083 (verificado, no supuesto):** el código DESPLEGADO (HEAD)
> llama directo a `kipu_apply_card_payment`, `kipu_apply_repayment` y
> `kipu_settle_household`. Aplicar la 083 antes del deploy rompería pagos de
> tarjeta, repagos y household al instante. Orden obligatorio: **deploy → 083 →
> E2E 38/38**.
>
> **Fix 6 (hallado al verificar): un fixture anclado a una fecha literal es un
> test que CADUCA solo.** Al correr el barrido posterior a la migración, IR53 y dos
> checks del harness J-2 pasaron a rojo sin que cambiara una línea de producto: sus
> fixtures usaban `createdAt: "2026-07-25T…"` y la ventana correctiva se mide
> contra AHORA (`createdGap <= 2` en `capture-matching`). Pasaban el 26 y morían el
> 27. La dirección del fallo fue la buena —rojo, no verde silencioso— pero la
> lección es la misma de siempre: la aserción tiene que probar lo que dice probar
> el día que corra. Los anclajes de RECENCIA pasan a ser relativos al reloj
> (`Date.now() - 61min`, ventana de lectura `now - 5d`); el `occurredAt` histórico
> se queda VIEJO a propósito, porque es justo lo que demuestra que `created_at`
> gobierna la recencia. Verificado con mutación: romper `dateNear` mata tests
> nombrados, así que el fixture nuevo conserva los dientes.
>
> **Pendiente:** capacidad
> declarada faltante, no defecto: **cambiar de moneda** (comprar dólares) no se
> puede representar mientras el ledger mueva un solo monto en las dos patas —
> necesita dos patas con montos distintos en UNA transacción.
>
> **Re-auditoría externa J-7 (079–081 aplicadas).** El barrido encontró tres sagas
> que aún podían mentir: (1) cierre de objetivos escribía chat, Telegram y filas
> por separado; `appendChatMessage` devuelve `null` en vez de lanzar, por lo que
> el cron podía congelar un cierre sin mensaje. (2) inversión recurrente hacía
> ledger→activo→ocurrencia con reversa compensatoria; el replay podía decrementar
> el activo dos veces o reutilizar una transacción ya revertida. (3)
> `adjustment` seguía fuera del guard por convención y podía restar ARS de una
> cuenta USD. Las migraciones **079–080** convierten los dos primeros en RPC
> atómicas con replay durable y agregan `adjustment` al guard; además guardan
> `resolved_amount/currency` para reservas puras, prueban completitud en
> `/dev/chat-review` y revocan writes directos de las tablas que ahora sólo
> pueden mutar por esos caminos. La misma pasada cerró una cuarta fuga: el coach
> ambient agregaba metadata a un `appendChatMessage` best-effort DESPUÉS de
> Telegram, así que un mensaje realmente entregado podía seguir ausente de
> `/dev/chat-review`; la 079 publica y atribuye primero el turno durable, con
> replay, y sólo entonces toca el efecto externo at-most-once. Las tres
> migraciones quedaron aplicadas y el E2E llegó a **28/28** con residuo cero.
>
> **Re-auditoría de cierre J-7 (Codex, 2026-07-27; 082–083 PREPARADAS, NO
> APLICADAS).** Encontró siete fugas restantes: lectura fallida de `savings_plans`
> se confundía con reserva pura; `scope=from_now` no actualizaba ahorro/inversión;
> cuatro conflictos deterministas de la 077 seguían en `40001`; el cierre mensual
> no ligaba el mes al claim; el coach ambient publicaba mensaje y después escribía
> cooldown/consumo de recordatorios best-effort; preferencias, pausa, recencia,
> cooldown y recordatorios fallaban abiertos; y una excepción por usuario se
> contaba como `skipped`, dejando el monitor verde. La 082 agrega fronteras
> atómicas/privadas y el código usa lecturas tipadas fail-closed. La autoauditoría
> encontró además que los tres supuestos CAS restantes de la 081 ocurrían
> post-lock, dos rechazos household eran deterministas, y varias ramas de
> integridad de tarjetas/inversión conservaban el mismo riesgo de 504. Siete
> wrappers v2 reclasifican esas ramas. La revisión final extendió la misma regla a
> los CAS con `expected_*`: para el payload idéntico que reintenta el proxy también
> son deterministas, así que conservar 40001 sólo ocultaba el conflicto tras un
> timeout; cinco fronteras v2 adicionales lo devuelven como 22023 para que el
> caller relea. La edición,
> pausa y cancelación de planes ahora preserva el residual agregado sin plan,
> recalcula exactamente los planes activos y no permite planes activos de monto
> cero. El rollout se
> separa para no romper el código viejo: aplicar 082 (crea v2) → desplegar → 083
> (revoca los quince cores legacy y el UPDATE autenticado de `savings_plans`) →
> E2E ampliado (plan+scalar, residual, claim→mes, ambient
> mensaje+cooldown+nota, SQLSTATE del digest y ACL legacy).
> La autoauditoría final cerró además los fallos que todavía podían quedar
> verdes: cola global del coach, timezone/gate permanente del cierre,
> liberación fallida del asiento y lectura de la decisión posterior; inventario
> completo de cuentas/fuentes para resolver ocurrencias; lectura por id que
> distingue caída de ausencia; y matching de evidencia paginado + nombres de
> cuentas completos. La 083 instala dos guards sobre `savings_plans`: ningún
> UPDATE monetario/de estado saltea los writers atómicos y ningún plan puede
> nacer o reactivarse activo con monto cero. E17c/d lo prueban contra DB.

**Deuda heredada de J-5: RESUELTA en J-4.** De los tres avisos agotados del
founder, Diners NT fue revivida (era la única con pago pendiente) y las dos MV
se cerraron como `dismissed` porque sus ciclos ya estaban cubiertos.

> **J-4 (2026-07-26; migración 076).** El día 15 del founder tiene **11 eventos**
> (3 cortes + pagos + fijos + un ingreso) y el notifier mandaba **un mensaje por
> cada uno**, sin ningún tope, todos a las 21:00. Ambient ya estaba disciplinado
> (1/día); la ametralladora era el notifier.
>
> Y había algo peor que el ruido: preguntaba el corte **el mismo día del corte**,
> cuando el banco todavía no emitió el estado. La pregunta era incontestable, se
> repetía 3 días seguidos y al tercero la ocurrencia moría para siempre. Preguntar
> antes de tiempo no solo molesta: **FABRICA** los pendientes eternos.
>
> Ocho arreglos: (1) gracia de 3 días desde el corte, con tope «nunca después de
> vencimiento−4» — en las 7 tarjetas con corte del founder el tope no se activa
> (14–19 días de margen); (2) **un digest** por corrida en vez de N mensajes;
> (3) techo de 2 proactivos/día **compartido** con el coach vía `ambient_nudges`,
> con asiento reclamado (dos corridas no mandan dos veces); (4) backoff 0→+3→+7 en
> vez de tres días seguidos; (5) la agotada **no muere**: baja a una línea del
> resumen; (6) el re-ask deja de decir «hoy corta» cuando ya no es hoy; (7) el
> prompt resuelve **varios avisos de una sola respuesta** y distingue «todavía no
> sé» (snooze) de «no pasó» (skip) — confundirlos cerraba en falso algo que sí iba
> a pasar; (8) `statement_due_date` (076): la fecha de un estado es un hecho del
> CICLO, no la regla mensual — diferencia chica ⇒ se anota y se DICE, grande ⇒
> pregunta, sin regla previa ⇒ recién ahí la aprende. Nunca reescribe `due_day` en
> silencio.
>
> Limpieza de datos (la deuda que arrastraba J-5): la Diners NT **revivida**
> (`ask_count` 0, es la única que todavía debe 50,60) y las dos MV **cerradas**
> (`dismissed`: su ciclo ya está cubierto, preguntarlas sería ruido nuevo).
>
> Gate 470→**476** (IR61 a–d cadencia y prioridad · IR62 fecha del ciclo · IR63
> cableado). 13 mutaciones, todas muerden — **D6 sobrevivió** la primera vuelta
> porque el fixture no tenía con qué competir y «lo que mueve plata primero» salía
> por default; se agregó un ask más viejo y no-monetario y ahí muerde.
>
> **Hueco DECLARADO, no tapado:** el aviso del calendario todavía sale por la regla
> mensual aunque el ciclo tenga fecha propia. Moverlo cambia la FECHA de la
> ocurrencia, que es su identidad (índice único user+deuda+fecha), y un ciclo
> corrido crearía un segundo aviso del MISMO ciclo. Cerrarlo bien pide dedupe por
> ciclo, no por fecha.

> **J-6 — barrido de vocabulario retirado (2026-07-26, primera pasada).** El
> escáner por LÍNEA sobre `src/` (saltando comentarios de inicio Y de final de
> línea, para ver también texto JSX y templates multilínea) mide el tamaño real:
> **46 líneas con la marca `Margen`** en 10 archivos, **32 con framing semanal**
> en 15, y **5 con «colchón»**.
>
> Cerrado ahora, sin ambigüedad: las 3 violaciones reales de «colchón» — el texto
> de `/app/cuentas`, los facts del prompt de Tesorería (el modelo aprendía la
> palabra prohibida) y el nombre de meta «Colchón de emergencia» que ve el
> usuario. Las 2 restantes son legítimas y quedan en allowlist explícita: la
> INSTRUCCIÓN de no usarla y el regex `SALDO_FAMILY` que la DETECTA.
>
> **Pendiente de decisión del founder, no de código:** `Margen` ≠ `Saldo`. El
> Margen era la holgura semanal/mensual; el Saldo Kipu es el tanque diario.
> Cambiar «los pagos mínimos superan tu margen mensual» por «tu Saldo» haría que
> la frase MIENTA. Cada una de las 78 líneas necesita su reemplazo correcto
> («tu plata libre del mes», «tu capacidad», o reescribir la idea), y eso es una
> decisión de producto. Mientras tanto **IR65-b es un trinquete**: el conteo no
> puede crecer.
>
> Gate 483→**485** (IR65 a–b), 3 mutaciones muerden.
>
> **Segunda pasada (2026-07-26, con la decisión del founder: a/b/c aprobadas y
> «todo debe estar actualizado al nuevo sistema», incluido el fallback legacy).**
> 90 strings reescritos por CONTEXTO, no por find/replace — porque el reemplazo
> correcto depende de qué decía cada frase:
> · la MARCA `Margen` → **«Saldo»** (afino tu Saldo, ya no la cuento en tu Saldo…)
> · la CAPACIDAD del mes → **«tu plata libre del mes»**, nunca «Saldo»: «los pagos
>   mínimos superan tu margen mensual» con «Saldo» habría MENTIDO, porque el Saldo
>   es el tanque diario y eso hablaba de la capacidad mensual.
> · el FRAMING semanal → diario o mensual según la superficie.
> Cubre UI (incluido el `short_name` del PWA, que decía «Margen»), los ~20
> resúmenes de tools, el prompt del agente, el fallback legacy completo y las
> notas que genera el motor (metas, deuda, asignación, mini-metas).
>
> **La marca queda en CERO fuera de comentarios e identificadores**, así que
> IR65-b deja de ser trinquete y pasa a **prohibición dura**. El framing semanal
> baja de 32 a 14 y los que quedan son legítimos (la cadencia de una meta, la
> pregunta del propio usuario «¿cuánto puedo gastar esta semana?», la definición
> del Saldo); IR65-c los deja con trinquete. Gate 485→**486**, 4 mutaciones nuevas
> muerden (devolver la marca a un resumen, a la UI de deuda, al manifest, y el
> framing semanal al fallback). **J-6 CERRADO.**
>
> **Re-auditoría integral de Codex sobre J-6 (2026-07-26; sin migración).** Fue
> mucho más allá del vocabulario: 13 correcciones de SEMÁNTICA. Las importantes:
> (1) `allocation-engine` recibía una cifra SEMANAL y la explicaba como `/mes`;
> (2) advisory, coach y fallback reusaban `weeklyRemaining`/`dailySuggested` como
> si fueran el Saldo del hero — ahora el contrato separa `saldoAmount` /
> `saldoFillDaily` de `projectedSafeToday` / `projectedSafeThisWeek`;
> (3) **una compra con tarjeta no drenaba el Saldo**: ahora `amount` (efectivo o
> deuda) y `saldoCost` (lo que realmente drena, después del objetivo) son
> magnitudes independientes — tarjeta ⇒ efectivo 0, deuda +amount, Saldo −saldoCost;
> (4) **cruzar capa protegida podía volverse prohibición** — es el aviso de cruce
> determinista que el ROADMAP pedía como mitad de código del bloque;
> (5) `evaluate_purchase_as_goal` ignoraba el Saldo actual; (6) el briefing
> degradado heredaba proyecciones que parecían un Saldo válido; (7) las
> confirmaciones post-write afirmaban «tu Saldo subió» y de qué capa salió, sin
> conocer el Saldo anterior; (8) `get_proactive_briefing` seguía enviando las
> métricas retiradas; (9)(10) `cashflow_outlook` y la atribución afirmaban
> causalidad sobre el Saldo; (11) formato monetario; (12) `coach-context-builder`
> muerto eliminado; (13) `run-static-gate.mjs`.
>
> **Auditoría de Claude: APROBADA con un P2 propio.** Certificado lo que su
> sandbox no puede: `npm run build` VERDE. Gates 493/493 · 21/21 · 161/161 ·
> 17/17 · 21/21 · 18/18. Verifiqué por EJECUCIÓN los cuatro escenarios que pidió
> más tres adversariales: cuenta 150 con objetivo 100 ⇒ efectivo −150 y Saldo
> −50 · **tarjeta 150 ⇒ efectivo 0, deuda +150, Saldo −50** · tarjeta totalmente
> cubierta ⇒ Saldo intacto y deuda +150 · `saldoCost` inflado y Saldo NaN ⇒
> rehúsa. Confirmado además que `currentSaldo` se alimenta de `mk.saldo.saldo` y
> nunca de `weeklyRemaining`, que `metrics` salió del payload y que
> `coach-context-builder` no tenía un solo consumidor.
>
> **[P2] Hallazgo mío — el cruce de capa INVERTÍA el consejo.** La rama hacía
> short-circuit ANTES de mirar la deuda: gastar 120 de 200 con deuda crítica daba
> `wait`, y gastar **3000** de 200 —15 veces el Saldo, cruzando la capa, con la
> MISMA deuda crítica— daba el consejo más SUAVE (`caution`). El peor caso recibía
> la menor advertencia, y contradecía su propio informe («solo puede recomendar
> wait/no si existe una causa independiente»). Corregido: con causa independiente
> el cruce escala a `wait`; sin ella se queda en `caution`, así la doctrina «avisa
> siempre, nunca bloquea» queda intacta — y TypeScript DEMUESTRA que esas ramas no
> pueden devolver `no` (comparar contra `no` es error de compilación). Gate
> 493→**494** (IR68); 5 mutaciones muerden (2 sobre mi fix, 3 sobre las suyas).
>
> **Consistencia del consejo de compra (2026-07-26, Codex; sin migración).** Ocho
> hallazgos más, todos reales: (1) **[P1] una compra hipotética en moneda
> extranjera entraba al motor como base** — el mismo bug de J-1 pero en el camino
> HIPOTÉTICO, que J-1 no tocó: `33000 ARS` se comparaba como `33000 USD` en tres
> consumidores. Nace `planHypotheticalPurchase`: monto original → FX PROBADO →
> objetivo → costo real de Saldo, y sin tasa devuelve `fx_required` en vez de
> inventar; (2) el fallback advisory ignoraba el objetivo de comida/transporte;
> (3) **pagar con tarjeta SUAVIZABA el consejo** pese a drenar el mismo Saldo y
> sumar deuda; (4) el copy atribuía el «esperá» al cruce de capa cuando la causa
> era la deuda; (5) los follow-ups recuperaban **cifras que Kipu mismo había
> escrito** («¿y si lo pago con Visa?» tomaba el Saldo 87 como precio nuevo);
> (6) el precio original desaparecía de la respuesta; (7) monedas y categorías
> fragmentadas; (8) **mi IR68 estaba mal tipado**: usé `itemKind:"discretionary"`
> —valor inexistente— con doble cast, y sobre ese cast afirmé que «TypeScript
> demuestra que no puede ser `no`». Las dos cosas eran falsas y la crítica es
> correcta.
>
> **Auditoría de Claude: APROBADA con un hueco de cobertura propio.** Certificado
> el build VERDE. Gates 500/500 · 21/21 · 161/161 · 17/17 · 21/21 · 18/18.
> Verificado por EJECUCIÓN: `33000 ARS × 0.000676 = 22.31 USD`; sin tasa ⇒
> `fx_required`; objetivo 500 con 480 gastado ⇒ absorbe 20 y drenan 30; y la
> COMPOSICIÓN correcta (el objetivo se aplica sobre lo CONVERTIDO: 22.31 base,
> absorbe 10, drenan 12.31). Confirmado que el `?? intent.amount` solo actúa
> cuando NO hay monto, así que ningún monto extranjero crudo llega al motor.
>
> **Hueco mío-de-cobertura:** de mis 6 mutaciones, **2 sobrevivieron** — y eran
> justo dos titulares suyos. IR70-b cubre el camino del AGENTE, no el del
> ADVISORY fallback: pasarle al motor el `amountOriginal` (el P1 exacto) y dejar
> que la categoría del MODELO le gane a la evidente del mensaje no rompían nada
> ahí. **IR71** cierra ese consumidor con trayecto real + marca anclada a la
> sentencia viva; las 6 muerden. Gate 500→**501**.
>
> **Re-auditoría de Codex sobre J-6 (2026-07-26; sin migración, pendiente de
> auditoría externa).** El barrido de vocabulario había cambiado etiquetas pero
> no todos los contratos: una cifra semanal se imprimía como `/mes`; el advisory,
> el coach general y el fallback legacy llamaban `Saldo` a proyecciones
> semanales; el fallback determinista todavía decía «flexibles esta semana»; un
> ingreso prometía que el Saldo había subido; y el briefing seguía entregando las
> métricas retiradas Readiness/Flexibilidad/Precisión/Realidad al modelo. Se
> separaron por tipo `saldoAmount`/`saldoFillDaily` de las proyecciones de
> cashflow, se migró el motor de compra a Saldo real, se endurecieron los
> validadores contra una proyección etiquetada como Saldo y se quitó el contexto
> retirado. Auto-auditoría adicional: cruzar de capa ahora produce `caution` +
> aviso, nunca una prohibición, como exige la doctrina del producto; y la
> atribución de categorías se presenta como ritmo de gasto, no como historia
> exacta del Saldo. IR65 pasa de conteos débiles a prohibiciones semánticas e
> IR67 prueba unidades, contratos, fallbacks, advisory, coach y cruce de capa.
>
> La pasada adversarial encontró cuatro fugas adicionales y las cerró en el
> mismo diff: (1) tarjeta y Saldo se habían confundido — una compra con tarjeta
> no baja el banco, pero SÍ drena el Saldo por el gusto y sube la deuda por el
> precio completo; el objetivo mensual solo puede reducir la primera magnitud;
> (2) `evaluate_purchase_as_goal` saltaba el Saldo y podía aprobar por cashflow
> una compra que cruzaba una capa; (3) el placeholder de briefing fallido
> reciclaba números legacy plausibles y ahora es numéricamente neutro bajo
> `saldoAvailable=false`; (4) `get_proactive_briefing` todavía filtraba al modelo
> los scores 0–100 retirados en su `data`, aunque ya no estaban en el digest.
> También se eliminó un ejemplo del prompt post-write que afirmaba Reserva sin
> tener estado pre-write, se separó explícitamente `cashflow_outlook` del Saldo y
> todo el copy tocado delega en `formatKipuMoney`.
>
> **Estado de ESE MOMENTO: J-6 en re-auditoría, sin migración.** (J entero quedó
> CERRADO el 2026-07-28 en `54311f6`; lo de abajo es la cronología de entonces,
> con sus cifras de entonces — el gate vive hoy en 604/604.) Gate esperado
> entonces:
> capture 493/493 · loop 21/21 · wizard 161/161 · harnesses J-2/J-3/J-4
> 17/17, 21/21 y 18/18; TypeScript y lint limpios. El build local necesita
> certificación en un entorno con red porque `next/font` intenta descargar
> Geist/Geist Mono de Google Fonts.
> La autoauditoría final encontró además que `emptyBriefing` aún rellenaba el
> placeholder no publicable con una proyección semanal; ahora todos sus valores
> monetarios son cero y el único veredicto es `saldoAvailable=false`.
> Gate **492/492**, loop **21/21**, wizard **161/161**, harnesses J-2 **17/17**,
> J-3 **21/21**, J-4 **18/18**; lint y `tsc` limpios. Se agregó un runner estático
> para los gates de onboarding, sin servidor ni fuentes remotas.
>
> **Re-auditoría de Codex sobre J-4 (2026-07-26; migración 077, APLICADA).**
> Siete defectos: (1) **mío y grave** — `statementDueDate` reusaba
> `validOccurredAtISO`, que **rechaza fechas futuras**, y una fecha de vencimiento
> es futura por definición: el fix del punto 8 nacía muerto y en silencio.
> `validCalendarDateISO` lo separa y una fecha inválida ahora devuelve needs_info
> ANTES de escribir. (2) el techo era `count → insert`, vulnerable a carrera y con
> el conteo fallando abierto ⇒ la 077 serializa por `pg_advisory_xact_lock` sobre
> (usuario, día) con lanes `coach`/`calendar` y tope total 2. (3) mensaje, claim y
> ocurrencias podían divergir ⇒ `kipu_publish_calendar_digest` hace TODO en una
> transacción, es idempotente y el orquestador reintenta una vez. (4) recuperar un
> claim de Telegram podía reenviar un mensaje ya entregado ⇒ el lane coach es
> at-most-once (`already_attempted` incluso con lease vencido); el calendar sí se
> recupera porque su mensaje web vive en nuestra RPC. (5) nombres y días de pago
> eran best-effort ⇒ lecturas tipadas, y una identidad no probada detiene el
> resumen. (6) el re-ask de gasto fijo seguía diciendo «hoy vence». (7) ternarios
> SQL que dejaban pasar payloads incompletos ⇒ `IS DISTINCT FROM`, payload vacío
> rechazado, `today` = `day_bucket`, rango de `expectedAskCount`, ids duplicados.
>
> **Auditoría de Claude: APROBADA con un hallazgo propio.** Certificado lo que su
> sandbox no puede: `npm run build` VERDE, capture **482/482** por HTTP **y** por
> su runner nuevo (coinciden, no es un subconjunto), harnesses 18/18 · 21/21 ·
> 17/17, loop 21/21, wizard 161/161.
> **077 APLICADA.** Las tres RPC: `SECURITY DEFINER`, owner `postgres`, EXECUTE
> solo `service_role`; `authenticated`/`anon` verificados sin acceso.
> **Sondas R y S (revertidas, contra las funciones instaladas), 13 brazos:** coach
> toma asiento · calendar toma el segundo · el tercero ⇒ `cap_reached` · re-claim
> del coach ⇒ `already_attempted` · publicación sana deja mensaje + ask 1→2 +
> `last_asked_on` + confirmación, todo junto · replay ⇒ mismo `web_message_id` sin
> re-consumir el ask · ocurrencia cambiada ⇒ 40001 y CERO mensajes · día distinto,
> payload vacío y `expectedAskCount` fuera de rango ⇒ 22023 · token ajeno ⇒ 40001 ·
> lease de calendar vencido ⇒ se recupera. Residuo cero.
>
> **[P3] Hallazgo mío:** el tope de intentos vivía en DOS idiomas —
> `ASK_BACKOFF_DAYS.length` en TS y un `>= 3` literal en la 077— sin nada que los
> atara. Un cuarto intento en TS haría que la RPC rechazara con 22023 y el resumen
> fallara **todos los días en silencio** (el notifier solo cuenta un error). El
> compilador no puede ver ese cruce: IR64 lo pina. Gate 482→**483**; 3 mutaciones
> nuevas muerden (V1 divergencia, V2 el validador vuelve a rechazar futuros, V3 la
> fecha inválida vuelve a ignorarse).
>
> **Re-auditoría externa J-4 (2026-07-26; migración 077 PREPARADA, NO
> aplicada).** El primer arreglo todavía tenía cinco fugas: (1)
> `statementDueDate` pasaba por el validador de fechas de movimientos, que
> rechaza futuros; (2) el techo era `count → insert`, por lo que dos productores
> podían superar 2 y un error de count parecía cero; (3) web message,
> `ask_count`/`notified` y el claim aterrizaban por separado e ignoraban errores;
> (4) nombres y días de pago eran best-effort, así que una lectura truncada podía
> consumir un ask con identidad o ventana inventada; (5) el re-ask de gasto fijo
> seguía diciendo «Hoy vence».
>
> La 077 prepara un claim serializado por usuario+día y lane (`coach|calendar`),
> con tope total 2; el publish del calendario hace mensaje web + CAS de todas las
> ocurrencias + finalización del claim en UNA transacción y es idempotente ante
> respuesta perdida. Los claims de Telegram son at-most-once tras adquirir el
> asiento (un timeout externo no prueba que no llegó); solo un fallo conocido
> antes del envío libera el cupo. El notifier exige lecturas completas de nombres
> y vencimientos, usa un validador calendario que admite futuro, y corrige el
> copy del fijo. Gate ampliado con IR64–IR69 y harness local J-4 18/18. Falta que
> el auditor aplique/sondee la 077 antes de desplegar.

> **J-3 (2026-07-26; sin migración — la 065 ya guardaba el dato, nadie lo leía).**
> El founder declaró «pago del mes = 0» con 55.60 acumulados y Kipu le reclamó
> «¿ya la pagaste?» citando esos 55.60. Causa: el gate del estado de tarjeta es
> `if (balance <= 0.005)` sobre el saldo ACUMULADO — que incluye lo que corrió
> DESPUÉS del corte y pertenece al ciclo siguiente. `statementCovered` aparecía
> **cero veces** en `debt-health.ts` pese a existir en DB desde la 065 y llegar al
> contexto por `supabase-mappers.ts:105`.
>
> Fix: predicado puro `cardStatementSettled` en `card-cycle.ts` — cubierta o cero
> DECLARADO cierran; `fullPaymentDue == null` es DESCONOCIDO y NO cierra (que Kipu
> pregunte es lo honesto). Cableado en las TRES superficies que reclaman:
> (1) `debt-health` deja de emitir `overdue`/`needs_payment_confirmation` con el
> ciclo saldado; (2) la señal `card_due_soon` excluye lo saldado y cita el PAGO DEL
> MES — cuando no consta lo dice, en vez de disfrazar el acumulado; (3) el
> onboarding escribe `statement_covered = true` con el cero declarado.
> `deriveCardCyclePhase` conserva su condición propia a propósito: decide cuánto
> RESERVAR, no si reclamar. El ask de pago del calendario ya estaba bien gateado
> (`if (isCard && !(expected > 0)) continue`).
>
> Gate 467→**470** (IR60 a–c, trayecto del motor con y sin cobertura), 6 mutaciones
> todas muerden, sonda revertida (cero declarado ⇒ covered en DB; la cobertura
> sobrevive a un update ajeno; residuo cero). **9 de las 14 tarjetas del founder ya
> tienen `covered = true`**, así que el gate silencia esos reclamos falsos de
> inmediato. Harness J-3 21/21 y J-2 17/17, loop 21/21, wizard 161/161, lint y
> build limpios.

- **Observación (la conduce el founder):** el chat real, sobre datos reales. Sin
  esa conversación el bloque es adivinar — Claude no la tiene. El founder entregó
  los primeros 5 errores mapeados el 2026-07-19; el plan J-1…J-7 vive en la
  sesión y se ejecuta por partes con veredicto del founder por cada una.
- **Cableado determinista (código):** el aviso de cruce de capa, detallado abajo.

> **J-1 — La moneda manda la cuenta (2026-07-19, migración 066): HECHO, en
> re-auditoría del founder.** El error real: «gasté 33000 ars» aterrizó en la
> cuenta USD que eligió el LLM y el ledger (019/051, resta original-sobre-
> original) le quitó 33000 DÓLARES al balance — corrupción real en prod del
> 06 al 10 de julio (reparada por la reversa; hoy cero filas vivas). Fix en
> tres capas: (1) decisión pura `planCashAccountForCurrency` cableada en las
> 4 ramas de `buildMovementEntry` (caller real del agente) — instrumento en la
> moneda ⇒ ok; única cuenta en esa moneda ⇒ re-elige Y LO DICE; cero o varias ⇒
> pregunta, jamás asume; (2) guard `refuseCurrencyMismatch` en los 4 branches
> del applier legacy; (3) trigger 066 `transactions_cash_movement_currency_guard`
> (expense/income/goal_contribution: toda pata de cuenta en la moneda del
> movimiento + base = perfil; reversal exento para poder corregir filas legacy).
> El cron BLOQUEA (`account_currency`, pending → chat) en vez de fallar cada
> noche — cierra también la trampa del préstamo extranjero (observación pasada
> 6). Gate 406→410 (IR31–IR33b), mutaciones RM-36…39 muerden su test nombrado,
> Sonda H revertida (7 brazos: el bug exacto rechazado con balance intacto,
> mismatches de ingreso/tarjeta/meta/base rechazados, reversa legacy viva).
>
> **Re-auditoría J-1 (2026-07-25, veredicto del founder: 2 P1 + 1 P2,
> corregidos — migración 067):** (1) la META también acumula en SU moneda:
> `goals.current_amount += ORIGINAL`, así que un aporte ARS a una meta USD sin
> `goal_account_id` atravesaba la 066 y sumaba 5000 «USD» — TS valida la moneda
> NATIVA de la meta (`originalCurrency` cuando el contexto la re-expresó a base)
> en tools y applier legacy, y la 067 añade la pata de la meta al trigger.
> (2) ELECCIÓN ≠ OMISIÓN: un instrumento ELEGIDO en otra moneda se PREGUNTA —
> jamás se sustituye en silencio («gasté 100 EUR con mi Visa USD» no puede
> terminar en la Mastercard EUR sin preguntar); el auto-assign existe SOLO con
> instrumento omitido, sobre cuentas ORDINARIAS (ni de meta ni no-líquidas; la
> única compatible protegida ⇒ pregunta); el prompt ordena OMITIR cuando el
> usuario no nombró instrumento y no hay preferencia aprendida. (3) El caso
> `chosen:null` ahora corre en el CALLER real (el short-circuit «falta cuenta»
> lo mataba): gasto/ingreso/pago/aporte sin instrumento + moneda explícita ⇒
> auto-assign o pregunta. Gate 410→411 (IR31/IR32 reescritos con los 6 trayectos
> del auditor + IR34); RM-40…43 muerden (y RM-43 encontró una marca débil de
> IR34 — anclada al IF vivo, patrón pasada 6); Sondas I revertidas (meta USD
> intacta ante el rechazo, meta ARS suma en su moneda).
>
> **Re-auditoría 2 de J-1 (2026-07-25, veredicto del founder: 2 P1 + 2 P2,
> corregidos — migración 068):** (1) una elección en la MISMA moneda exige
> EVIDENCIA computada por el EXECUTOR (jamás un booleano del LLM): «mentioned»
> (el nombre/token distintivo del instrumento aparece en el mensaje) o
> «learned» (`accounts.is_currency_default`, preferencia ESTRUCTURADA única por
> moneda, declarada con `update_account makeCurrencyDefault` por RPC atómica);
> sin evidencia y con varias compatibles ⇒ `unproven_choice`, pregunta. (2) el
> cambio de moneda es ATÓMICO: `kipu_change_account_currency` con lock + CAS de
> moneda/balances + re-conteo de movimientos DENTRO de la transacción (el
> check-then-update viejo perdía la carrera contra el primer movimiento y
> PISABA balances), más trigger `accounts_currency_change_guard`: la moneda de
> una cuenta con historia es INMUTABLE para cualquier writer. (3) la
> description de `log_movement` ya permite llamar con instrumento OMITIDO +
> moneda declarada (contradecía el prompt y mataba el auto-assign). (4) cuenta
> Y tarjeta simultáneas ⇒ aclaración INMEDIATA («¿salió de la cuenta o fue con
> la tarjeta?»), no un error tardío del ledger. Gate 411→415 (IR35 evidencia ·
> IR36 ambos-instrumentos · IR37/IR37b cambio atómico con 8 marcas vivas);
> RM-44…47 muerden su test nombrado; Sondas J revertidas: sano · LA CARRERA
> (primer movimiento aterriza tras la foto ⇒ rechazo, moneda y balance
> intactos) · CAS 40001 · UPDATE directo parado por el trigger · cuenta vacía
> sigue editable · preferencia única (segundo set desplaza al primero, exacto
> 1) · J7: balance neto CERO con movimientos ⇒ lo para el RE-CONTEO bajo lock
> (el brazo exacto).
>
> **Re-auditoría 3 de J-1 (2026-07-25, veredicto del founder: 3 P1 + 3
> endurecimientos — migración 069):** (1) el default estructurado era WRITE-ONLY
> en el camino real: con dos cuentas ARS y una marcada default, el instrumento
> omitido devolvía `multiple` porque el planner nunca lo miraba (y el test lo
> tapaba precargando `sourceAccountId`) — ahora el único default ordinario
> DECIDE, con el trayecto omitido probado de verdad. (2) la CARRERA de dos
> conexiones seguía abierta: el validador leía las monedas SIN lock, así que un
> `BEFORE INSERT` concurrente validaba contra la versión vieja, esperaba en el
> FK y aterrizaba DESPUÉS del cambio — los validadores (efectivo y deuda) toman
> `for key share` sobre cuentas (orden determinista), tarjeta, meta y perfil
> ANTES de validar; `change_base_currency` pasa a RPC atómica con lock del
> perfil. (3) `instrumentMentioned` fabricaba evidencia por substring («visado»
> probaba «Visa»): ahora exige PALABRA ENTERA + contexto de instrumento («con»,
> «desde»…), con batería adversarial. Endurecimientos: sin reinterpret los
> balances nuevos deben ser CERO (un caller service-role no puede crear dinero
> al cambiar moneda), el default solo admite cuentas ordinarias ACTIVAS, y
> `already_changed` hace idempotente la respuesta perdida (antes se reportaba
> como rechazo un cambio que SÍ aterrizó). Gate 415→418 (IR35 ampliado con el
> camino omitido+default · IR38 léxico adversarial · IR39 base+idempotencia ·
> IR40 locks con 11 marcas vivas); RM-48…52 muerden; Sonda K revertida (8
> brazos). La carrera se prueba por locks desplegados + mutación; el harness de
> DOS SESIONES queda escrito en `supabase/sql/probes/race_currency_change.md`
> para ejecutar con credenciales de base (Claude no tiene conexión directa).
>
> **Re-auditoría 4 de J-1 (2026-07-25, veredicto del founder: 2 P1 + 1 P2 —
> migración 070):** (1) `FOR KEY SHARE` protegía contra las RPC nuevas (que
> toman FOR UPDATE) pero NO contra un `UPDATE` directo, que toma
> FOR NO KEY UPDATE y es COMPATIBLE con él — y `authenticated` conserva UPDATE
> sobre accounts/debt_accounts/goals/profiles por RLS: la puerta lateral seguía
> abierta (cuenta vacía + primera captura concurrente). Los dos validadores
> suben a `for no key update` (mismo orden determinista; serializa lo que el
> UPDATE de balance ya serializaba, sin deadlock) y se agregan los guards de
> inmutabilidad que faltaban: `profiles.base_currency`, `debt_accounts.currency`
> y `goals.currency` (la 068 solo cubría accounts). (2) «sin datos en base»
> pasa a ser UNA definición completa — `kipu__user_base_data_witness` enumera
> las 19 tablas con montos en base (activos, planes de ahorro, cuotas,
> objetivos versionados, snapshots y preferencias monetarias: la 069 solo
> miraba 3, así que un activo o un plan de ahorro dejaban cambiar la base y
> quedaban reinterpretados en silencio) y la usan la RPC Y el trigger del
> perfil, más pre-onboarding obligatorio como cinturón. (3) La confirmación
> dejó de mentir: el plan devuelve `basis: "unique" | "default"` y el copy dice
> «la cuenta que dejó fijada» cuando hay varias. Gate 418→421 (IR41 puerta
> lateral · IR42 witness de 19 tablas · IR43 basis); RM-53…57 muerden; Sonda L
> revertida (7 brazos: UPDATE directo de base parado por el trigger, tarjeta con
> historia y meta con saldo inmutables, meta vacía todavía editable, witness
> nombrando la tabla, RPC exigiendo pre-onboarding).
>
> **Re-auditoría 5 de J-1 (2026-07-25, veredicto del founder: 2 P1 —
> migración 071):** (1) los guards confundían «sin transacciones» con «sin
> dinero»: una cuenta del onboarding con saldo 500 y CERO movimientos pasaba a
> 500 ARS con un UPDATE directo; una tarjeta con deuda/pago del mes cargados a
> mano y sin ledger, también; y una meta «vacía» ya tiene `target_amount`,
> `weekly_required_amount` y `contribution_amount` denominados — peor, el guard
> miraba `new.current_amount`, así que el MISMO UPDATE podía poner el saldo en
> cero para esconderlo. Ahora: tarjeta y meta con moneda INMUTABLE tras el
> INSERT (no hay caller que la cambie; se cierra y se crea otra), el guard de
> meta mira OLD, y la cuenta exige balances viejo Y nuevo en cero — la
> reinterpretación con saldo vive SOLO dentro de la RPC, que se identifica con
> una marca transaccional (`kipu.sanctioned_currency_change`, transaction-local:
> distingue el camino sancionado de un write accidental de la app, no pretende
> defender contra service_role). (2) el witness de 19 tablas seguía siendo una
> lista a mano — que por definición no detecta sus propias omisiones (faltaban
> `recurring_investment_plans`, `goal_allocation_revisions`,
> `card_payment_applications`, `debt_statement_cycles`, `kipu_reconcile_ops`,
> `recurring_occurrences`, `scheduled_changes`, `spending_alert_rules`): ahora se
> DERIVA del catálogo (`kipu__base_data_tables` — toda tabla con user_id +
> columna monetaria, 26 en prod) y exige algún monto ≠ 0 CAMPO POR CAMPO (la suma
> escondía negativos o montos que se compensan). El trigger del perfil también
> rechaza directo con `onboarding_completed`. Gate 421→422 (IR42 reescrito para
> el witness dinámico + IR44 guards por valor); RM-58…62 muerden; Sonda M
> revertida (8 brazos: los 4 casos exigidos + cuenta vacía todavía editable +
> la RPC sí reinterpreta + 26 tablas cubiertas).
>
> **Re-auditoría 6 de J-1 (2026-07-25, veredicto del founder: 1 P1 + 1 P2 —
> migración 072):** (1) SOBRECLAIM CORREGIDO. La 071 afirmaba que el catálogo
> «detecta automáticamente toda columna monetaria»; es falso: era una regex
> sobre el NOMBRE, y en prod `budget_categories` resolvía a `{amount}` sin ver
> `mtd_seed` — que el onboarding declara como dinero congelado en base (mismo
> caso: `daily_financial_snapshots.saldo_kipu`). Trayecto abierto: onboarding
> parcial con `amount=0, mtd_seed>0`, usuario con `onboarding_completed=false`,
> cambia la base y ese monto queda reinterpretado. Ahora la regla NO adivina:
> EXISTENCIA DE FILA sobre una lista EXPLÍCITA de 26 tablas financieras (más
> estricta a propósito — una fila en cero también bloquea; el cambio de base es
> una corrección de onboarding rarísima y ante la duda se rehúsa), el catálogo
> queda como red SECUNDARIA para tablas no listadas, y
> `kipu__base_data_coverage_gaps()` expone la deriva en vez de que se asuma (hoy
> reporta 1: `fx_rates.rate`, una tasa entre monedas nombradas, correctamente
> fuera). (2) Cambiar la moneda de una cuenta VACÍA rompía configuración
> cableada: una cuenta de meta USD pasaba a ARS mientras la meta seguía USD e
> inmutable — sin corromper dinero (los guards fallan cerrado) pero con un
> «listo» mentiroso y el próximo aporte rechazado. La RPC ahora rechaza si hay
> meta, ingreso, plan de ahorro, cuenta de pago de deuda o gasto fijo apuntando
> a esa cuenta. Gate 422→424 (IR45 witness por fila + IR46 dependencias);
> RM-63…66 muerden (RM-63 es la mutación exigida: sacar budget_categories del
> contrato); Sonda N revertida sobre usuario DESECHABLE pre-onboarding (6
> brazos: el caso exacto `amount=0, mtd_seed=400` visto por el witness y
> rechazado por la RPC y por el UPDATE directo · sin filas financieras el cambio
> SÍ procede · cuenta de meta cableada rechazada · 1 gap de cobertura visible).
>
> **Re-auditoría 7 de J-1 (2026-07-25, veredicto del founder: 2 P1 + 1 P2 —
> migración 073):** (1) el `UPDATE` directo seguía saltándose las dependencias:
> solo la RPC consultaba el helper, el trigger de cuentas miraba movimientos y
> balances — la invariante dependía del caller, no de la base. Ahora el trigger
> llama al MISMO helper y lo evalúa ANTES del bypass sancionado (la RPC tampoco
> procede con dependencias, así que no pierde capacidad). (2) CARRERA al crear
> la dependencia — misma clase que la 069, en sentido inverso: A bloquea la
> cuenta y no ve dependencias, B inserta una meta USD que espera en la FK, A
> cambia a ARS y commitea, B despierta y confirma la meta contra una cuenta ya
> ARS. Se cierra con triggers INVERSOS: todo writer que vincule una cuenta la
> BLOQUEA (`for no key update`) y valida la moneda dentro de su transacción, así
> el orden deja de importar — el segundo lee el estado commiteado del primero.
> Cubre metas, ingresos, pagos programados, gastos fijos, la cuenta de pago de
> una deuda y planes de ahorro. (3) Faltaban `scheduled_payments` (lleva su
> propia moneda) y `spending_alert_rules` (su `threshold_amount` NO declara
> moneda: la hereda de la cuenta, así que cambiarla resignifica el umbral).
> Efecto colateral corregido en la raíz: el onboarding creaba vínculos que la DB
> ahora rechazaría (meta USD sobre cuenta ARS), así que la moneda de meta,
> ingreso y gasto fijo se DERIVA del instrumento vinculado y la deuda no
> preselecciona una cuenta de pago en otra moneda. Gate 424→425 (IR47 con 16
> marcas vivas); RM-67…70 — **RM-67 y RM-68 SOBREVIVIERON la primera vuelta**
> porque mis marcas eran laxas (una anclaba la asignación en vez del `if` vivo;
> la otra matcheaba con la función gemela de deuda): anclado y re-verificado con
> RM-67b/RM-68b, la misma debilidad que esta auditoría le encontró antes a
> Codex. Sonda O revertida sobre usuario desechable (8 brazos: UPDATE directo con
> meta · RPC con el mismo mensaje · pago programado · regla de alerta · los dos
> inversos rechazados · vínculo coherente sigue funcionando · tarjeta USD con
> cuenta de pago ARS).
>
> **Re-auditoría 8 de J-1 (2026-07-25, veredicto del founder: 2 P1 + 1 P2 + 1
> procedimental — migración 074):** (1) MI PROPIO FIX DE LA 073 ERA LA
> CORRUPCIÓN QUE J-1 IMPIDE: al derivar la moneda del instrumento vinculado, una
> meta declarada «10.000 USD» sobre una cuenta ARS se guardaba como «10.000 ARS»
> — cambiar la etiqueta conservando el número. Corregido: la moneda DECLARADA
> manda siempre; sin declarar, se hereda; si difiere, se guarda el monto y su
> moneda INTACTOS y el vínculo se cae (el esquema ya admite fuente nula), para
> que el chat lo rearme preguntando. (2) `savings_plans` se validaba contra
> `base_currency` — la equivalencia CONTABLE — cuando lo que sale de la cuenta es
> `original_amount`/`original_currency`: rechazaba el caso legítimo «base USD,
> plan de 50.000 ARS desde Supervielle ARS» y aceptaba una cuenta USD para un
> movimiento ARS que fallaría al materializarse; ahora valida
> `original_currency ?? base_currency` y el trigger escucha esa columna.
> (3) `spending_alert_rules` estaba protegido solo desde el lado de la cuenta:
> gana su trigger inverso — su `threshold_amount` NO declara moneda, así que no
> hay nada que comparar pero sí que SERIALIZAR. (4) VOLATILIDAD: los guards
> estaban `STABLE`, y una función STABLE usa el snapshot de la consulta que la
> llama — un guard que espera un lock y necesita ver lo commiteado durante la
> espera debe ser VOLATILE. Gate 425→426 (IR47 actualizado + IR48); RM-71…74
> muerden; Sonda P revertida (6 brazos: meta USD→cuenta ARS rechazada por la DB ·
> la misma meta SIN vínculo se guarda intacta como «USD 10000.00» · el plan ARS
> desde cuenta ARS con base USD ahora SÍ entra · el plan ARS desde cuenta USD se
> rechaza · cambiar solo `original_currency` dispara la validación · la cuenta con
> dependencias se rehúsa). El script de dos sesiones suma la variante del ORDEN
> INVERSO (dependencia primero, cambio esperando), que es la que ejercita la
> volatilidad.
>
> **Endurecimiento posterior de J-1 (2026-07-25, Codex; sin migración, pendiente
> de auditoría externa):** la pasada 8 dejó dos contratos divergentes en el
> onboarding: una meta sin moneda heredaba ARS para la fila, pero su aporte
> mensual seguía convertido como USD, y los vínculos incompatibles se eliminaban
> sin avisar. `planOnboardingCurrencies` pasa a ser la fuente única para deuda,
> meta, ingreso y gasto fijo: decide moneda+vínculo ANTES del retry-wipe y de
> todo write, alimenta el preflight FX (incluida una cuenta extranjera en cero),
> la conversión del aporte, la fila y `noteForAction`. Un mismatch o vínculo
> inexistente vuelve a la revisión con una explicación concreta; no se guarda
> parcialmente ni se pierde configuración en silencio. IR49 suma 7 trayectos
> puros y de cableado; tres mutaciones verificadas hacen fallar respectivamente
> conversión, mismatch y preflight FX.
>
> **Auditoría de Claude sobre ese endurecimiento (2026-07-25): APROBADO con dos
> correcciones.** El P1 está genuinamente cerrado — `goalCurrency` es una sola
> decisión y alimenta fila, conversión, nota y vínculo; el preflight corre antes
> del retry-wipe y de todo write; `usedCurrencies` nace del plan. Certificado lo
> que Codex no pudo: `npm run build` VERDE (su sandbox no llegaba a Google
> Fonts). Dos hallazgos propios: (1) [P2] los PLANES DE AHORRO también vinculan
> cuentas y la 074 valida esa moneda en DB, así que un reserve de 100 USD con
> cuenta de origen ARS era rechazado por el trigger y se perdía por el camino
> best-effort con una nota genérica de «error técnico» — ahora entran al mismo
> preflight y se rehúsan antes de escribir (IR50; el destino que es ACTIVO no se
> valida). (2) CUATRO de mis seis mutaciones adversariales SOBREVIVÍAN: IR49
> probaba el planificador PURO y anclaba el cableado con substrings que otra
> línea del archivo también satisfacía — la fila de la meta volviendo a decidir
> sola, el preflight sin actuar, `usedCurrencies` sin nacer del plan y `toBase`
> degradando pasaban en verde. Marcas ancladas a la sentencia viva; las seis
> muerden. Es la MISMA debilidad de marca que este bloque ya encontró en la
> pasada 6 (a Codex) y en la re-auditoría 7 (a Claude): tercera repetición, y la
> lección queda escrita — una marca de fuente solo vale anclada a la sentencia
> que ejecuta. Gate 433→434. J-1 queda APROBADO para pasar a J-2.
>
> **Microfix posterior de Codex (2026-07-25; sin migración, AUDITADO por Claude —
> aprobado con una corrección P1 encima):** la ampliación anterior confundía
> cualquier `draftId` que no fuera
> cuenta con «quizá es un activo». Era alcanzable: el wizard permite borrar una
> cuenta después de elegirla en una reserva y no limpia ese vínculo; el save lo
> convertía en `source_account_id=null`/destino null sin error. El preflight ahora
> recibe el inventario real de activos: `sourceDraftId` debe existir como cuenta;
> `destinationDraftId` debe existir como cuenta o activo probado; solo una cuenta
> de destino se compara por moneda. IR50 suma origen eliminado, destino eliminado,
> activo real y cableado del inventario antes de todo write. Cuatro mutaciones
> verificadas hacen fallar cada defensa por separado y el módulo real vuelve a
> 4/4 tras revertirlas.
>
> **Auditoría de Claude del microfix (2026-07-25): el diagnóstico es correcto y las
> ocho defensas muerden (verifiqué cuatro de Codex por mi cuenta: MM, MN2, MO, MP;
> su MN original no era válida — `if (false)` dejaba `source` posiblemente
> undefined, el gate no compilaba y "romper el build" no es "romper un test").
> Pero el fix, tal cual, abría un P1 NUEVO: un rechazo cuyo remedio no está en la
> pantalla no es un guard, es un CERROJO.**
>
> Trayecto: el usuario liga su aporte de inversión a un activo (paso Patrimonio) y
> después BORRA el activo. `onboarding-wizard.tsx` quita el activo del estado pero
> deja el `destinationId` de la reserva intacto, y el bloque entero del vínculo
> desaparece de la pantalla — `if (namedAssets.length === 0 || investmentReserves
> .length === 0) return null`. Con el microfix, ese id colgado pasa a
> `missing_instrument` y `redirectOnError` aborta el onboarding COMPLETO, pidiéndole
> al usuario que "quite ese vínculo" con un control que ya no existe. El draft vive
> en `localStorage`, así que recargar no lo salva: onboarding imposible de terminar.
> El mismo patrón, más leve, afectaba a cuentas borradas: un `<select>` cuyo `value`
> no está entre sus opciones se dibuja EN BLANCO, así que el mensaje pide quitar
> algo que la pantalla ya muestra como vacío.
>
> Corrección (`wizard-model.ts`, `buildDraftFromState`): **un vínculo muere con lo
> que apuntaba.** El draft solo emite `defaultPaymentAccountDraftId`,
> `destinationAccountDraftId`, `paymentSourceDraftId`, `sourceDraftId` y
> `destinationDraftId` cuando el objetivo sigue existiendo, medido con los MISMOS
> predicados que usa el save (`accountReviewable`/`debtReviewable`, activo con
> nombre). No es pérdida silenciosa: es que el draft diga lo mismo que la pantalla.
> El preflight de Codex queda intacto y pasa a ser lo que debe ser — la red para un
> draft que no armó este wizard; `currency_mismatch` (el único caso donde AMBOS
> valores son visibles y el trigger de la 074 rechazaría) sigue bloqueando igual.
>
> De paso, C19 llevaba tiempo en ROJO por un fixture equivocado (base ARS con
> aportes USD sin tasa ⇒ S38 tira el plan entero y la aserción medía un plan
> inexistente). Mis dos primeras C20 cayeron en la misma trampa y pasaron sobre
> `undefined` — cuarta aparición de la misma debilidad en este bloque. Corregidos
> los tres fixtures, el gate del wizard queda VERDE COMPLETO por primera vez.
> Gates: capture 434→439, wizard 156/157→**161/161**, loop 21/21, lint y build
> limpios. Nueve mutaciones válidas, todas muerden. **J-1 CERRADO — vamos a J-2.**
>
> **J-2 — Una corrección no es un movimiento nuevo (2026-07-25; sin migración,
> PENDIENTE de auditoría externa).** El error real del founder: «no era con
> Pichincha, era Supervielle» registró un gasto NUEVO en vez de corregir el que ya
> existía — el mismo dinero contado dos veces y el Saldo bajando el doble.
>
> Dos causas, y ninguna era «el LLM se equivocó»:
> 1. **El prompt nunca ruteaba esa frase.** La ÚNICA aparición de «no era Visa, era
>    Pichincha» en todo el system prompt estaba en la línea de APRENDE y rutea a
>    `remember_fact` — la acción principal quedaba sin definir. Los gastos
>    COMPARTIDOS sí tenían su línea («ese gasto compartido no era 40, era 30» →
>    `edit_shared_expense`); los movimientos personales, no.
> 2. **Las dos defensas de duplicado son estructuralmente ciegas a una corrección.**
>    `recentExactDuplicate` exige el MISMO `sourceId`, y corregir la cuenta lo
>    cambia por definición ⇒ no puede dispararse nunca. `recentNearDuplicate` solo
>    cubre `expense` CON token de comercio ⇒ corregir la cuenta de un ingreso, un
>    pago de deuda o un aporte a meta no tenía NINGUNA defensa.
>
> La mitad determinista (no una pista al LLM): `correctivePhrasing` +
> `movementCorrectionTargets` en `capture-matching.ts` — reformulación correctiva
> del usuario (calculada por el EJECUTOR sobre `ctx.rawMessage`, como
> `instrumentMentioned`) **y** un movimiento reciente compatible, emparejado por lo
> que la corrección NO cambia (mismo monto ⇒ cambió la cuenta/categoría/fecha; mismo
> comercio ⇒ cambió el monto). Cableado en `executeLogMovement` y en el LOTE, ANTES
> de escribir: devuelve `needs_info` nombrando `correct_movement` y el
> `transactionId`. **`confirmedNew` no lo abre** — ese flag responde «fueron dos
> compras distintas», no «me refiero a la que ya registraste».
>
> Asimetría deliberada de fallo, que es la doctrina del Bloque I aplicada aquí: el
> guard de duplicado sigue fallando ABIERTO (una captura normal es intención
> explícita y un blip de DB no puede bloquearla), pero la corrección falla CERRADO
> —si no puedo leer qué corrige, una fila nueva cobra dos veces—. El fail-closed
> cuelga de `correctivePhrasing`, no de un `else` pelado: si no, una lectura rota
> impediría registrar cualquier gasto, y eso sería un cerrojo (lección de J-1).
>
> Gate 439→446 (IR52 a–g: el caso exacto del founder, el ingreso sin defensa, el
> monto corregido, cuatro negativos adversariales, sin-target, ventana, y el
> cableado con 11 marcas vivas). **14 mutaciones, todas muerden — pero N5, N11 y
> N12 SOBREVIVIERON la primera vuelta** porque la cadena que buscaba `includes`
> existe en los DOS caminos (individual y lote) y una marca verificaba el `if`
> interno sin anclar la PUERTA externa: sexta aparición de la misma debilidad en
> este bloque. Se ancló la puerta y se cambió la presencia por CONTEO estructural
> de las dos ramas. Verificado además que `ctx.rawMessage` es literalmente el
> mensaje del usuario (`chat-transaction-handler.ts` → `runKipuAgent`), sin lo cual
> el guard no dispararía en producción.
>
> **Auditoría de Codex sobre ese J-2 (2026-07-25): 9 fugas, corregidas por él.**
> Lectura fallando abierta (`loadRecentTransactions` convertía un error PostgREST
> en `[]`), tope de 40 filas sin probar completitud, una evidencia pendiente
> apagando el guard, detector demasiado ancho, guard y executor mirando universos
> distintos, `correct_movement` sin `newOccurredAtISO` aunque el prompt lo
> prometía, corrección sin target volviendo a autorizar el write, ventana por
> `occurred_at` en vez de `created_at`, y correcciones de MONTO sin identidad para
> ingresos/pagos/aportes. Cierre: `CompleteRecentTransactionsRead` (cursor total
> `(created_at,id)`, dedupe por id, página corta = atómica, multipágina con conteo
> exacto), `guardMovementWritesWith` como barrera ÚNICA de ambos writers antes del
> dedupe, `correctionIdentityToken`, `readTransactionById` exacto y tipado, y el
> executor endurecido (lectura fallida ≠ inexistente ≠ ya revertido; cuenta y
> tarjeta simultáneas, ids inexistentes y montos inválidos rechazados con cero
> writes). Harness nuevo `scripts/qa/j2-correction-audit.mjs`.
>
> **Auditoría de Claude sobre esa corrección (2026-07-25): APROBADA con tres
> hallazgos propios.** Certificado lo que su sandbox no pudo: `npm run build`
> VERDE y los tres gates (450/450 · 21/21 · 161/161 con su trabajo tal cual).
> Verifiqué 8 de sus defensas por mutación en vez de creerle al informe: 7
> muerden. Hallazgos:
> (1) **[P1] `redirect` es un ToolStatus NUEVO y NADIE lo maneja** — un solo sitio
> en todo el repo ramifica por `ToolStatus` (`kipu-agent.ts:871`) y solo conoce
> done/error/needs_info/refused. El caso EXACTO del founder (target único) dejaba
> los tres flags del outcome en false, así que con el Saldo no disponible la
> barrera reemplazaba la instrucción de corrección por «no puedo calcular tu
> Saldo» — el camino que un `needs_info` sí atraviesa intacto (línea 553).
> Corregido contándolo como needs_info, PEGAJOSO a propósito: limpiarlo con un
> write posterior cerraría una evidencia que puede estar a medias.
> (2) **[P1] la puerta trasera del pipeline legacy.** Con la corrección sin target
> fallando cerrada, si el salvage no da texto usable `finalizeAgentReply` devuelve
> `ok:false` y `chat-transaction-handler` corre `runChatPipeline` sobre el MISMO
> mensaje — y el legacy no tiene NI UNA referencia a la corrección: escribiría el
> duplicado que el guard acababa de impedir. Es el mismo razonamiento que el
> comentario de la línea 572 ya aplicaba a `wrote`, extendido al write que NO
> ocurrió: marca `correctionBlocked` emitida por las 4 ramas correctivas del
> guard, propagada al outcome y respetada antes del `ok:false`.
> (3) **[P2] falso positivo del detector**, que desde el cambio de Codex ya no
> cuesta ruido sino rehusar un gasto legítimo: «no en serio, gasté 500 hoy»
> entraba por la negación seca. Excluido por lista de locuciones adverbiales y NO
> exigiendo determinante — «no desde Pichincha» sin artículo tiene que seguir
> contando, y perder recall ahí reabre el duplicado. Batería de 28 frases
> (12 correcciones reales + 16 capturas normales): 28/28.
>
> Además, su mutación C1 (quitar `page.failed ||`) **SOBREVIVIÓ**: su reader falso
> devuelve `rows: null` siempre que falla, así que el contrato nunca era lo único
> que decidía. El seam es público y acepta cualquier reader ⇒ IR55-c lo pina con
> una página que trae filas Y declara fallo. Gate 446→**454**; 15 mutaciones
> propias, todas muerden; harness 15/15; los tres gates y el build verdes.
> **Pendiente declarado: el E2E con usuario desechable NO se corrió** — prueba la
> ELECCIÓN del modelo (no determinista, consume presupuesto de API), mientras que
> lo que endurecimos es el guard, que sí queda cubierto determinísticamente.
>
> **Re-auditoría de Codex (2026-07-25): 2 fugas + 1 debilidad de pruebas mías,
> corregidas por él.** (1) [P1] `correctionBlocked` solo nace DESPUÉS de que el
> agente ejecuta una tool: un fallo PRE-tool (sin API key, timeout, excepción,
> respuesta vacía) dejaba `result` vacío y el handler reenviaba el mensaje al
> legacy igual. Interlock `resolveLegacyFallbackSafely` en
> `chat-transaction-handler.ts`, ANTES del legacy: una corrección devuelve
> aclaración y no escribe; una captura normal conserva intacto su fallback de
> emergencia. (2) [P2] mi blacklist de locuciones era inenumerable («no en
> realidad», «no por mucho», «no con ganas»…): sustituida por señales
> ESTRUCTURALES (corrección explícita, contraste de dos montos, de dos
> categorías/fechas, o de dos instrumentos en cualquiera de los dos órdenes).
> (3) Mi «batería de 28 frases» NO estaba en el gate — la corrí en un script y la
> reporté como evidencia. Sobreclaim mío del mismo tipo que vengo señalando;
> ahora IR55-a es una matriz real.
>
> **Auditoría de Claude sobre esa re-auditoría (2026-07-25): APROBADA, con una
> REGRESIÓN suya que los gates atraparon.** Certificado lo que su sandbox no
> puede: build verde y los tres gates. Sus 5 mutaciones pedidas + 3 mías: 8/8
> muerden (una suya, K3, hubo que rehacerla: no compilaba, y un gate que no
> renderiza no es una mutación válida).
> **Hallazgo P1: su detector estructural dejó IR52-b en ROJO** — «no fue a
> Pichincha, entró a Supervielle», la corrección de la cuenta de un INGRESO, que
> es justo el caso SIN ninguna otra defensa (la cercana solo mira gastos). Su
> `correctedInstrumentFirst` exigía ser/ir en la segunda cláusula. La distinción
> correcta no es el verbo sino que la segunda cláusula nombre OTRO DESTINO: ser
> admite preposición opcional («era Supervielle»), todo verbo de movimiento la
> EXIGE — así «no era con ganas, gasté 500» (su caso guardado) sigue siendo una
> captura. Medido con matriz, no con opinión: recall 15/18 → 20/20, precisión
> 21/21 intacta. Restauré además tres formas que su narrowing perdió (un `de`
> opcional entre verbo y valor: «no era de comida, era de transporte», «no era de
> 200, era de 250»; y el imperativo con enclítico «corrígeme»). Gate 454→**455**,
> IR55-a pasa a 24 capturas + 20 correcciones con las frases FRONTERA pinchadas a
> ambos lados. Harness 17/17.
> **Límite declarado:** «no fue a Pichincha, lo depositaron en Supervielle»
> (pronombre + tercera persona) NO se detecta; cubrirlo exige aflojar la segunda
> cláusula a «1-2 palabras + preposición» y eso reabre falsos positivos. Se deja
> fuera a propósito: el prompt sigue ruteando esa corrección, el guard es la red.
>
> **J-3 — El corte que ya respondiste y te volvió a preguntar (2026-07-25; sin
> migración, PENDIENTE de auditoría externa).** El plan J-1…J-7 solo vivía en la
> conversación y se renumeró sola; queda escrito acá: **J-1** moneda→cuenta ✓,
> **J-2** corrección ≠ movimiento nuevo ✓, **J-3** la repregunta del calendario,
> **J-4** Diners ya pagada volviendo a pedir 55,60, **J-5** el bombardeo del 15,
> J-6 y J-7 por definir con la observación del founder.
>
> La ocurrencia solo deja de preguntarse cuando alcanza un estado terminal
> (`OPEN_STATUSES = pending|booked`, verificado), y eso solo pasa si el agente
> puede RESOLVERLA. El índice único por (user, fuente, fecha) está bien y no había
> filas duplicadas: el problema era que el agente perdía la capacidad de resolver.
>
> `readOpenOccurrences` YA tenía el contrato de Bloque I —y el notifier lo respeta,
> falla cerrado—, pero la misma lectura se colapsaba en TRES capas del lado del
> chat: (1) `listOpenOccurrences` devolvía `[]` ante un fallo «porque el flujo
> conversacional reintenta solo» — ese reintento ERA la repregunta del día
> siguiente; (2) el bloque «FLUJOS DEL CALENDARIO SIN CONFIRMAR» quedaba vacío,
> indistinguible de «no tenés pendientes», así que el agente se quedaba sin
> `occurrenceId` y la respuesta del usuario («ya la pagué») podía irse a
> `log_movement`; (3) un `.catch(() => "")` en el call site borraba incluso el
> aviso. Y `matchOpenOccurrence` devolvía `null` para TRES cosas distintas: no
> pude leer, no hay, y es ambiguo — al usuario le llegaba «¿a cuál te referís?»
> sobre algo que acababa de responder.
>
> Cierre: `matchOpenOccurrence` pasa a unión discriminada
> (`{ok:true,id}` | `{ok:true,id:null}` | `{ok:false}`) con seam
> `matchOpenOccurrenceWith` para poder probarla sin DB, y con una distinción que
> es la doctrina en una línea: **la evidencia por PRESENCIA sobrevive a una lista
> topada (un match por nombre), la inferencia por AUSENCIA no** («hay exactamente
> una» sobre una lista cortada puede ser una de cinco, y resolver la equivocada
> registra el pago de otra tarjeta). El bloque avisa explícitamente que no pudo
> leer y PROHÍBE registrarlo como movimiento nuevo; el `.catch` propaga ese mismo
> aviso; el executor distingue «no pude leer» de «¿cuál?». `listOpenOccurrences`
> se ELIMINA en vez de quedar exportada sin usar, para que un caller nuevo tenga
> que enfrentar el contrato. Gate 455→**459** (IR56 a–d), 7 mutaciones, todas
> muerden. Harness 17/17, loop 21/21, wizard 161/161, lint y build limpios.
>
> **Declarado, no tapado:** J-4 (la tarjeta ya pagada que vuelve a pedir el pago)
> es de OTRA familia — `full_payment_due` que no baja tras un pago hecho fuera de
> Kipu — y no se toca aquí. Y sin la conversación real del founder no puedo
> afirmar que ESTE haya sido el mecanismo exacto de su repregunta: lo que sí está
> probado es que estos tres colapsos la producen y ya no pueden.
>
> **Re-auditoría Codex de J-3 (2026-07-25; migración 075 propuesta, NO
> aplicada).** El fix inicial cerraba los colapsos de lectura, pero dejaba cuatro
> fugas: (1) el camino real del founder (`update_card_obligations`) guardaba el
> corte sin resolver la ocurrencia; (2) el matcher usaba `.find()` y «Visa»
> elegía silenciosamente la primera entre Visa Pichincha/Visa Produbanco; (3) la
> prohibición de escribir ante calendario ilegible vivía solo en el prompt; (4)
> una lista topada se publicaba como si fuera completa. La autoauditoría encontró
> dos bordes adicionales: las tablas de nombres se leían enteras (otro cap podía
> fabricar una falsa unicidad) y una caída de nombres publicaba ids anónimos para
> que el modelo adivinara.
>
> Cierre: lectura y nombres son contratos tipados; parcial/error/nombres
> ilegibles vuelven indisponible el bloque; el matcher exige set completo y un
> único match; los nombres se consultan únicamente por los ids del set acotado.
> La procedencia `metadata.source=recurring` viaja desde el mensaje durable hasta
> `AgentContext`, y los writers genéricos rehúsan una respuesta cuyo calendario
> no pudo probarse. El notifier persiste esa procedencia por canal antes del push
> y elimina el turno Telegram fantasma si el envío falla.
>
> La 075 envuelve `kipu_set_card_statement` y `kipu_override_debt_due` sin cambiar
> sus nombres públicos: corte/remanente y cierre de `card_statement` ocurren en
> la MISMA transacción. `occurrence_id` explícito manda; sin él, fecha exacta o
> único pendiente prueban identidad; varios pendientes abortan y revierten todo.
> Un statement viejo nunca cierra por fallback el ask nuevo. Harness local
> `scripts/qa/j3-calendar-reply-audit.mjs`: **20/20**. La migración requiere
> auditoría, aplicación y sonda DB revertida antes del deploy.
>
> **Auditoría de Claude sobre esa re-auditoría (2026-07-25): APROBADA con un P1
> propio.** Certificado lo que su sandbox no puede: build verde y los tres gates
> (**465/465** exacto como predijo · 21/21 · 161/161) más ambos harnesses.
> Verifiqué 5 de sus defensas por MUTACIÓN en vez de creerle al informe: las 5
> muerden.
>
> **[P1] AMBIGÜEDAD ≠ CONFLICTO.** «Varios pendientes abortan y revierten todo»
> revierte también el CORTE que el usuario acababa de dictar. Tres cosas mal a la
> vez: se pierde su dato; `40001` es `serialization_failure`, el código canónico
> de «reintentá», pero esta ambigüedad es DETERMINISTA y el reintento falla
> igual; y el copy dice «cambió mientras lo editaba», que es falso. Y es
> alcanzable — medido en prod, no supuesto: hoy hay 3 avisos abiertos, uno por
> tarjeta, **todos con `ask_count = 3`** (el máximo) y fechas del 15-16 de julio.
> Tras MAX_ASKS la pregunta vieja queda `pending` para siempre, así que el
> próximo corte deja DOS abiertos por tarjeta y el camino se activa para las
> tres; además `kipu_override_debt_due` pasa `statement_date = null` siempre, o
> sea que va derecho a esa rama. No hay invariante que exija atomicidad entre las
> dos mitades: no cerrar ninguna ocurrencia ES el estado previo. Ahora devuelve
> `'ambiguous'`, el corte se guarda y el agente pregunta cuál en el MISMO turno.
> El `40001` sobrevive donde sí es un conflicto real (la fila cambió bajo el lock).
>
> **Sonda Q (revertida, contra prod)** sobre el cuerpo REAL del resolver, 7
> brazos: dos candidatos ⇒ `ambiguous` con la vieja intacta · fecha exacta cierra
> SOLO la suya · única abierta ⇒ `resolved` · replay ⇒ `already_resolved` sin
> reetiquetar el monto · id de otra tarjeta ⇒ rechazado · sin fallback ⇒ `none`.
> Residuo cero; los 3 avisos reales del founder intactos. Gate 465→**466**
> (IR58), 8 mutaciones + 1 sobre el harness (21/21), todas muerden. IR57-c y el
> harness fijaban el `raise` que quité: se ACTUALIZARON para fijar la conducta
> nueva, no para borrar la marca.
>
> **La 075 NO se aplicó desde la sesión.** Renombra RPCs ya desplegadas y eso cae
> en el límite de `CLAUDE.md` («never drop/rewrite applied objects»): la aplica el
> founder. El código tolera su ausencia (`occurrence_resolution` ausente ⇒
> `none`), así que el orden de deploy es libre. **J-3 NO se declara cerrado hasta
> que la 075 esté aplicada y sus sondas corran contra la función desplegada.**
>
> **Cierre de J-3 (2026-07-26).** El founder autorizó aplicar la 075 y el auditor
> encontró un P1 REAL en mi propio consumo de `ambiguous`: la aclaración solo
> salía en la rama con `patch` vacío. En el caso real —«el corte fue 50.60 y vence
> el 3»— `dueDay` queda en `patch`, se toma la rama FINAL y el array `notes` no la
> incluía: el corte se guardaba y Kipu podía no preguntar nada, con los dos avisos
> colgados. O sea que mi «pregunta cuál en el mismo turno» era falso justo en el
> caso que motivó el fix. Corregido centralizando el copy en un único
> `calendarNote` que TODA rama post-write consume, y con seam de deps
> (`executeUpdateCardObligationsWith`) para probar el TRAYECTO REAL —
> `overrideDue → ambiguous` + `dueDay` en el patch — en vez de una marca de fuente
> (IR59). Corregido también el comentario obsoleto de cabecera de la 075.
>
> **075 APLICADA.** ACL verificada: los tres helpers privados quedan solo con
> `postgres` (sin service_role/authenticated/anon) y los dos wrappers públicos con
> `service_role`. Re-aplicación idempotente probada (el bloque de rename no
> renombra nada la segunda vez y el wrapper público sigue vivo).
> **Sonda Q2 (revertida) contra la función INSTALADA, por el wrapper público:**
> (A) el caso del founder —dos avisos abiertos, fecha que no coincide— devuelve
> `ambiguous`, `outcome: updated`, **el corte se guarda (50.60)** y los dos avisos
> quedan `pending`; (B) con `occurrence_id` explícito cierra ese y solo ese;
> (C) con uno solo abierto el fallback lo cierra; (D) `override_debt_due` sin
> abiertos ⇒ `none`. Residuo cero; las 14 tarjetas del founder con `updated_at`
> del 19-07 (intactas). Gate 466→**467**, 4 mutaciones nuevas (Z1–Z4) muerden,
> harness J-3 21/21 y J-2 17/17, loop 21/21, wizard 161/161, lint y build limpios.
> IR29 fijaba los call sites que el seam movió: se actualizó para fijar el
> CABLEADO DE PRODUCCIÓN, que es más fuerte.
>
> **J-3 CERRADO.** Queda dicho, no tapado: los 3 avisos reales del founder siguen
> con `ask_count = 3` y nadie los va a volver a preguntar — ninguna de estas
> defensas los resucita, y ahí está probablemente el origen de J-4 (la Diners que
> vuelve a pedir un pago con un `full_payment_due` viejo).
>
> **Re-auditoría Codex de J-2 (2026-07-25; pendiente de auditoría externa).**
> El fix inicial bloqueaba el caso feliz del founder, pero todavía tenía siete
> fugas reales: (1) `loadRecentTransactions` colapsaba `{data:null,error}` a
> `[]`, así el `try/catch` correctivo nunca veía el fallo; (2) `.limit(40)` no
> probaba completitud; (3) cualquier `evidenceId` —incluida una aclaración vieja
> y no relacionada— apagaba el guard; (4) `correctivePhrasing` aceptaba opiniones
> como «no fue caro»; (5) el guard podía encontrar una fila que
> `correct_movement` perdía al re-leer solo 25; (6) el prompt prometía corregir
> fecha pero la tool no tenía ese campo; (7) vacío de targets dentro de una
> corrección volvía a autorizar `log_movement`. La autoauditoría añadió otros dos
> bordes del mismo defecto: la ventana debe ser por `created_at`, no
> `occurred_at` (una captura nueva puede declarar una fecha antigua), y un cambio
> de monto en ingreso/pago/aporte necesita identidad descriptiva, no el
> `merchantToken` exclusivo de gastos.
>
> Corrección: `CompleteRecentTransactionsRead` + keyset total
> `(created_at,id)`, dedupe, tope visible y conteo exacto para probar lecturas
> multi-página; `guardMovementWritesWith` compartido por individual/lote y
> fail-closed solo para reformulaciones; estado interno `redirect` para entregar
> el id sin dejar `needsInfo` pegajoso; `readTransactionById` exacto y tipado;
> executor inyectable `executeCorrectMovementWith`; `newOccurredAtISO` llega a la
> operación atómica de reversa+reemplazo. `correctivePhrasing` se estrechó y
> `correctionIdentityToken` cubre cambios de monto no-expense. Gate esperado
> 446→450 (IR53/IR54) y harness aislado `scripts/qa/j2-correction-audit.mjs`
> 15/15. Ocho mutaciones manuales revirtieron error de página, tope,
> `evidenceId`, target ausente, identidad, recencia, filtro lingüístico y fecha;
> cada una rompió su check nombrado y el post-revert volvió a 15/15.
>
> **Última re-auditoría Codex de J-2 (2026-07-25; pendiente de auditoría
> externa).** Quedaba una puerta P1 anterior a todas las defensas de tools:
> `correctionBlocked` solo se crea después de una tool, por lo que un fallo,
> timeout o resultado vacío PRE-tool dejaba `result` vacío y
> `chat-transaction-handler` reenviaba el mismo texto al pipeline legacy. Ese
> pipeline no entiende correcciones y podía crear el duplicado que J-2 acababa
> de impedir. `resolveLegacyFallbackSafely` es ahora el interlock explícito en
> esa frontera: una corrección no baja al legacy y devuelve una aclaración sin
> writes; una captura normal sí conserva el fallback de emergencia.
>
> El detector lingüístico también seguía dependiendo de un blacklist incompleto:
> «no en realidad», «no por mucho», «no con ganas», «no a propósito» y «no de
> nuevo» todavía bloqueaban capturas legítimas. Se reemplazó por evidencia
> estructural: corrección explícita, contraste completo de monto/categoría/fecha,
> o dos instrumentos expresados en ambos lados. La batería ahora contiene
> exactamente 12 correcciones y 16 capturas normales. Gate esperado
> **454→455**; harness local **17/17**. Cinco mutaciones adversariales sujetan:
> interlock apagado, interlock sobre-bloqueando todo, cableado real vuelto al
> legacy directo, regex amplia restaurada y orden founder desactivado.

**NO es** "revisar la tabla de fallos guardados" (esa lectura fue un malentendido de
Claude). Es observación directa del comportamiento real sobre datos reales.

Incluye el **aviso de cruce de capa determinista**: `/app/saldo` promete en pantalla
"Kipu te avisa siempre antes de cruzar a una peor", y hoy ese "siempre" lo sostiene un
prompt, no el motor. El motor YA calcula las capas (`margen-kipu.ts`), pero solo
`evaluate_purchase` (el camino hipotético) mira el cruce, y devuelve un string de
instrucción al LLM en vez de un hecho tipado. `executeLogMovement` — la captura REAL —
no toca capas. Va en este bloque porque es comportamiento del agente, no de la
interfaz.

## Bloque K — Que Kipu aprenda tus fijos variables

**Estado: CERRADO (2026-07-29, veredicto del founder)** · producción sirve
`a7f99bb`, que contiene el commit funcional `36ed895` ·
migraciones 093–095 · E2E real 79/79 exit 0 · producción verificada ·
Prioridad 3

> El diagnóstico de datos que sigue es la foto **anterior a aplicar la 093**.
> El estado vigente está en “Implementación preparada para auditoría”: la 093
> ya plantó cuatro forecasts baseline sin inventar observaciones; la primera
> sonda real encontró el defecto de corrección pagada que corrigió la 094.
> K7 pasa contra PostgreSQL, el harness ejecuta sus **79/79 con exit 0 y residuo
> cero**, y el fix de `operationId` ya está desplegado: producción sirve
> `a7f99bb`, que contiene el commit funcional `36ed895`.

Los fijos de monto variable (luz, gas, internet) ya están marcados `is_variable` y
Kipu crea una ocurrencia mensual en modo `ask`. Pero el sistema todavía usa una
sola columna, `fixed_expenses.amount`, para tres hechos distintos:

1. el monto declarado/configurado del plan;
2. el monto real que llegó un mes;
3. un cambio permanente decidido por el usuario.

Eso no es sólo una limitación estadística. Hoy hay rutas contradictorias:

- el notifier del calendario pregunta por la ocurrencia en su fecha y
  `resolve_recurring_occurrence(scope='once')` registra el pago real sin cambiar
  el plan;
- el prompt también manda la respuesta mensual a `update_fixed_expense`, que
  **sobrescribe** `amount` y estampa `last_confirmed_month`, aunque el usuario no
  haya dicho que el cambio es permanente;
- `scope='from_now'` vuelve a sobrescribir el mismo `amount`;
- el pipeline legacy registra el pago ligado por `recurring_expense_id`, pero no
  cambia el plan;
- el topic ambient `variable_expense_confirm` pregunta desde el día 3 sin mirar
  la ocurrencia, mientras el notifier vuelve a preguntar en la fecha del gasto.
  Una respuesta por `update_fixed_expense` no cierra la ocurrencia; una respuesta
  por el resolver no estampa `last_confirmed_month`. Los dos sistemas pueden
  preguntar por el mismo recibo.

El histórico canónico **NO existe todavía**. En producción hay 4 fijos variables,
pero 0 ocurrencias y 0 filas de ledger ligadas a ellos; además
`resolved_amount` está vacío en las 14 ocurrencias existentes de cualquier clase.
Tres de los cuatro todavía no llegaron a su primer ciclo desde que existe el
materializador. El cuarto (Internet, esperado el 7 de julio) cayó antes de que el
cron/ruta del Bloque C existieran — se desplegaron el 10 — y quedó para siempre
fuera de su lookback de 2 días. Su `last_confirmed_month = 2026-07-01` solo
demuestra que el writer de `update_fixed_expense` estampó el bucket mensual; no
prueba fecha, canal ni monto observado. Hoy ese writer sobrescribe el plan y
descarta el hecho mensual que un estimador necesitaría.

Por eso K no puede empezar fingiendo que «abre» una historia previa. Primero
debe crear el contrato canónico y registrar cada observación —incluido el monto
nativo cuando no hay FX—; recién entonces el estimador puede aprender de datos
reales. El backfill prudente solo planta la proyección declarada: no convierte
filas ambiguas en observaciones.

El radio es financiero: `fixed_expenses.amount` alimenta directamente
`estimatedMonthlyFixedExpenses`, `monthlyFixed`, el calendario, cashflow,
Tesorería, factibilidad de metas, la recarga/cap del Saldo y el contexto del
agente. Un pico aislado deja el Saldo demasiado bajo; un mes anormalmente barato
puede **inflarlo**, que es la dirección peligrosa del Bloque I.

Esto rompe la promesa general del producto: el onboarding planta una primera
foto que Kipu refina con datos reales, y los montos finos se aprenden después
(`docs/PRODUCT_SPEC.md`, sección de onboarding). No aplica la excepción de
comida/transporte: aquí el usuario sí marcó el fijo como variable.

### Contrato de K (antes de implementar)

1. **Separar plan, observación y estimación.** `amount` sigue siendo la base
   declarada por el usuario. Un recibo mensual es una observación; no lo
   sobrescribe. Un cambio explícitamente permanente abre un nuevo régimen de
   aprendizaje y no se mezcla ciegamente con los meses anteriores.
2. **Una sola identidad por ciclo.** Saber cuánto vino y haberlo pagado son
   hechos distintos. La observación, el pago (si ocurrió), el cierre de la
   ocurrencia y la actualización del estimador deben quedar ligados e
   idempotentes; nunca se registra caja sólo porque el usuario informó el monto
   de la factura.
3. **Una sola pregunta.** El calendario es dueño de la ocurrencia. Ambient puede
   priorizarla, pero no crear un segundo ciclo de confirmación basado sólo en
   `last_confirmed_month`. Cualquier camino que capture el monto debe resolver la
   misma ocurrencia.
4. **Aprendizaje robusto y prudente.** La estimación usa observaciones canónicas
   en la moneda nativa y por la misma cadencia/régimen; excluye reversiones,
   duplicados y cargos aparte. Con poca muestra se declara baja confianza y usa
   el monto configurado como respaldo. Un promedio simple no alcanza: outliers y
   estacionalidad no pueden hacer saltar el Saldo.
5. **Misma cifra en todo el producto.** El `planningAmount` resultante debe
   alimentar contexto, Margen/Saldo, calendario/cashflow, Tesorería, metas,
   agente y superficies. Nadie vuelve a leer `amount` como si ya fuera lo
   aprendido.
6. **Money-read completo.** “No hay historia” es un fallback legítimo; “no pude
   leer/calcular la historia” no autoriza publicar un Saldo potencialmente
   inflado. El reader/estado aprendido debe tener contrato `ok/complete` o una
   proyección durable leída junto con el plan.
7. **Frontera de escritura protegida.** Los campos aprendidos no quedan
   editables por el cliente `authenticated`; los writers del agente, calendario,
   Mis Datos, onboarding y cambios programados conservan semánticas explícitas y
   convergen en los mismos invariantes.

### Orden de ejecución previsto

K-1 · modelo de observación **y writer atómico** diseñados juntos: identidad,
moneda nativa, factura/pago/ocurrencia/proyección e idempotencia → K-2 ·
estimador puro y sus invariantes (muestra, confianza, outliers, cambio de
régimen, moneda/cadencia), alimentado exclusivamente por observaciones
canónicas → K-3 · unificar
`resolve_recurring_occurrence`, `log_movement`, `update_fixed_expense`, legacy,
ambient y notifier → K-4 · cablear `planningAmount` en todos los consumidores de
dinero con fail-closed → K-5 · backfill prudente, persona desechable, mutaciones y
sondas contra PostgreSQL real.

### Implementación preparada para auditoría

- **K-1/K-2 — contrato durable + estimador.** La 093 añade forecast, observación
  y marca de operación; una factura conocida queda `observed` y abierta hasta
  que el usuario afirme el pago. El writer atómico valida propiedad, moneda,
  snapshot/CAS, dedupe y replay; corrige pagos append-only, permite retirar una
  observación impaga y recalcula el forecast dentro de la misma transacción.
  El estimador TS/SQL comparte: últimas 24 observaciones actuales del régimen,
  misma moneda/cadencia, p75, fence MAD/150% suficientemente ancho para
  estacionalidad, plan declarado con menos de 3 muestras y piso de 85% hasta la
  sexta. Un `from_now` explícito abre régimen; un mes distinto no pisa el plan.
- **K-3 — una sola ruta.** `resolve_recurring_occurrence` observa o paga; una
  factura temprana abre la fecha canónica del plan para que el cron no duplique;
  fuente y fecha reales de pago pueden sobreescribir solo ese ciclo. Cualquier
  ledger seguro con `recurring_expense_id` converge mediante trigger. El legacy
  liga por nombre único; `update_fixed_expense` queda reservado al plan
  permanente; el topic ambient duplicado fue retirado. `observed` entra al
  descubrimiento del notifier, pero una factura reportada antes del vencimiento
  no pregunta por pago esa misma noche.
- **K-4 — una cifra.** El contexto y materializador exigen el forecast completo,
  y todos los motores reciben `planningAmount`; si la lectura falla, el agente
  permanece disponible para registrar el hecho nativo pero el Saldo queda no
  publicable. Mis Datos/Ajustes distinguen “aún sin estimación” de “no pude
  leerla”; nunca presentan el declarado como aprendido.
- **K-5 — backfill y verificación.** El backfill crea solo baseline; no inventa
  observaciones a partir de `last_confirmed_month`. Gate local final
  **689/689 en ese momento** (694 tras el micro-fix de L; el total vigente tras
  Pre-M es **701/701**) y auditoría adversarial **281/281** sobre
  el árbol preparado. El
  E2E `scripts/qa/k-variable-fixed-e2e.mjs` es falsable y debe dar **79/79**
  después de aplicar 093–094: moneda nativa sin FX, observe/pay/correct/retract,
  replay y respuesta perdida, cambio de régimen, ledger genérico, reversa,
  fuente/fecha corregidas, categoría, ACL, paginación/completitud, ciclos
  únicos, coherencia usuario↔plan y residuo cero. Hasta esa ejecución contra
  PostgreSQL real, K no se declara cerrado.
- **K-6 — re-auditoría ejecutable post-093.** La sonda real probó que corregir
  80 pagados a 90 abortaba: la 093 mandaba una marca `external_ref` en su
  reversa interna, pero el ledger deriva las reversas desde la original y
  persiste esa columna como NULL. El trigger genérico creaba entonces una
  observación impaga actual antes de que el writer insertara la corregida, y el
  índice único abortaba. El mismo mecanismo cerraba de hecho `paid → zero` y
  `paid → retract`. La 094 no abre procedencia al caller: bajo los locks ya
  adquiridos retira el hecho actual antes de la reversa, de modo que el trigger
  solo proyecta las reversas realmente genéricas; cualquier fallo posterior
  revierte toda la transacción. El E2E separa trigger y CHECK en K57/K57b,
  prueba rechazo+caja+ledger en K11, no aborta el resto por el prerrequisito K7
  y exige un total fijo de 79 para no presentar una cobertura parcial como
  batería completa. La segunda ejecución mostró tres defectos del propio
  harness: una fila “pre-K corrupta” se intentaba fabricar después de activar
  el guard que justamente la prohíbe, y una lectura pedía `.maybeSingle()`
  sobre toda la historia del plan. Esos dos quedaron corregidos y cada fallo
  se asocia a su check en vez de abortar el resto. K13, en cambio, confirmó un
  defecto de producto: la observación incluía `operationId` pero el ledger
  derivaba su dedupe solo de ciclo+monto+cuenta+fecha; tras undo, una orden
  nueva reusaba el id de la transacción revertida. La clave del ledger incluye
  ahora la identidad de operación, por lo que redelivery sigue idempotente y
  redo crea una transacción nueva. Una primera corrección del fixture divergente
  de K56 siguió abortando porque pagaba por el writer canónico: esa llamada ya
  crea una observación, y la observación mantiene el guard K activo aunque el
  plan pase temporalmente a estable. El fixture fiel a pre-K nace estable, paga
  por el ledger genérico, verifica cero observaciones, pierde el vínculo y solo
  entonces activa variabilidad. K56/K58 están además encapsulados: una
  preparación rota produce sus dos checks rojos pero no oculta K59–K79.
  IR252–IR253 y KM261–KM269 fijan estas propiedades. Falta la ejecución
  PostgreSQL completa **79/79** para declarar K cerrado.
- **K-7 — ejecución 63/79 y frontera final.** La corrida real confirmó K13 y
  el fixture legacy, pero encontró dos caminos de producto: retract pagado
  armaba su reversa sin `sign=-1`, y una factura histórica descartada bloqueaba
  para siempre todos los ciclos posteriores después de volver el plan fijo.
  También mostró que bloquear una reversa legacy por el vínculo perdido sería
  un cerrojo: si existe un único ciclo pre-K inequívoco, hay que devolver caja
  y conservar el monto como factura observada impaga. La 095 (APLICADA) deriva
  los cuerpos vivos 093→094 con conteos/markers: iguala el contrato de ambos
  payloads internos, hace el bloqueo histórico sensible al ciclo y repara solo
  el candidato legacy único. K56/K58 prueban reparación+repago canónicos; K51
  conserva el bloqueo del mismo ciclo pero permite el siguiente; K59 exige
  caja, ocurrencia y observación atómicas. El `ReferenceError` que ocultaba los
  checks finales se eliminó releyendo el transaction id de K13 dentro del scope
  que lo consume. IR254 y KM270–KM275 sujetan la frontera. Falta aplicar 095 y
  ejecutar 79/79 con residuo cero.
- **K-8 — 095 aplicada y harness honesto.** PostgreSQL certificó 2/2 reversos
  internos con signo negativo, los tres markers K-095, ACL/owner e
  idempotencia; K13/K46/K54/K56/K58/K59 y los 16 casos antes ocultos quedaron
  verdes. Los dos rojos restantes eran expectativas del harness: K51 trataba
  el UUID escalar devuelto por `applyLedgerEntry` como `{id}`, y K60c fijaba
  cuál de dos guards válidos debía rechazar primero. Se corrigen por contrato:
  id no vacío; rechazo + fotografía final intacta. El barrido de clase elimina
  pins de mensajes privados cuando saldo/ledger/occurrence ya prueban la
  invariante, conservándolos cuando el mecanismo ES la prueba (CHECK frente a
  trigger, ACL o validación aislada). La limpieza deja de consultar
  `profiles.user_id` —columna inexistente— y usa `profiles.id`; toda lectura
  fallida sigue siendo exit 1. IR255 y KM276–KM280 sujetan los tres arreglos.
  Claude demostró que estos cambios exclusivamente de harness alcanzan 79/79;
  falta correr el árbol exacto final y obtener exit 0/residuo cero para cerrar.

## Bloque L — Compartidos y reembolsos

**Estado: NO SE CONSTRUYE (decisión del founder, 2026-07-30). Sólo se hizo su
micro-fix de reembolsos, ya cerrado.** Prioridad BAJA · nicho

Datos de producción al 2026-07-16, reverificados el 2026-07-30: **0** gastos
compartidos, **0** reembolsos, **0** hogares, **0** préstamos — y 21 de las 115 tools
del agente ya están construidas para esto. Está sobreconstruido para uso cero, así
que el bloque se salta y se va directo al front (M).

### micro-L · el fail-safe de reembolsos (CERRADO, sin migración)

Era el único fail-safe barato que valía la pena antes del front, y era real:
`record_person_payment` declaraba `category` sin enum y el ejecutor caía a
`category(args.category, "other")`. El contrato del Bloque H —«un reembolso hereda el
registro de su original»— vivía **sólo como instrucción del prompt**, y una
instrucción de prompt no es un guard: el reembolso no neteaba el objetivo ni
restauraba el tanque. Una categoría `food` INVENTADA sobre un original
extraordinario-desde-Saldo netea el objetivo cuando no debe, que es la dirección
peligrosa del Bloque I.

Contrato final, por precedencia — **el HECHO manda sobre la conjetura del modelo**:

1. lectura completa + original único compatible ⇒ hereda los hechos PERSISTIDOS:
   categoría, `budget_treatment` **literal** (incluido `NULL`, que significa
   tratamiento normal por objetivo y no puede ser sustituido por un `saldo`
   propuesto), `related_transaction_id`, y la marca `recurring_expense_id` /
   `external_ref` de fijos y cuotas — un fijo nunca drenó el tanque, así que su
   reembolso tampoco puede restaurarlo;
2. ambigüedad ⇒ devuelve los candidatos CONCRETOS de la misma lectura completa de
   60 días (id, descripción, importe, fecha) y pregunta; el turno siguiente resuelve
   por `originalTransactionId`. No manda a una segunda lectura de ventana más corta,
   que era un cerrojo;
3. id explícito ⇒ sólo si coincide con un candidato compatible; incompatible o con el
   remanente agotado ⇒ `invalid_id`, **jamás** degrada a la excepción de «nunca lo
   registré»;
4. lectura fallida o incompleta ⇒ cero writes («no pude leer» ≠ «no existe»);
5. sin original ⇒ `other` sin objetivo ni Saldo y sin vínculo, **sólo** si el usuario
   afirma inequívocamente en el mensaje actual que nunca lo registró («nunca lo
   anoté»); una corrección de categoría («no lo registré como comida») NO cuenta;
6. un reembolso parcial previo acota el remanente: un segundo reembolso sólo puede
   usar lo que queda, y nunca se sobre-reembolsa.

Además: los **once** schemas `category`/`newCategory` declaran su enum (las seis
superficies que sólo describen compras excluyen `income` a propósito, porque un
`expense` marcado históricamente como `income` no puede ser autoridad de un refund),
`correct_movement.newCategory` dejó de ser texto libre, y
`applyChatTransactionIntent` cierra la puerta lateral: un parser legacy o un modelo
sin procedencia probada (`derived_original` + vínculo válido, o
`confirmed_unrecorded` sin vínculo) recibe aclaración y cero writes.

Redes de esa pasada: capture **700/700** (L-1a…L-1e; el total vigente tras
Pre-M es **701/701**) y runner adversarial
`scripts/qa/l-refund-mutation-audit.mjs` con **24/24**, cada mutación muriendo por su
aserción nombrada. Persona desechable contra PostgreSQL real **9/9**: comida normal,
extraordinario, parcial + remanente, fijo, cuotas, ambigüedad, id inventado, lectura
incompleta y «nunca lo registré».

Dos correcciones de la auditoría que valen como lección repetida: una aserción que
fijaba `includes` de la condición del guard **sobrevivía** a envolverla en
`if (false && …)` —el substring seguía ahí—, y otra exigía `none` donde el contrato
del id explícito manda `invalid_id`. Sexta y séptima aparición del mismo patrón en
el ciclo J–K–L: **fijar la invariante, no la ortografía**.

## Cierre Pre-M — integridad de back antes del front

**Estado: CERRADO (2026-07-31). Migraciones 096, 097, 098 y 099 APLICADAS y
sondeadas contra PostgreSQL real. Después del cierre apareció el bloqueo de
inteligencia conversacional M0; M visual ya no está activo hasta cerrarlo.**

**Operación de rollout pendiente de confirmación (no reabre Pre-M):** ejecutar
una vez el cron diario de FX tras el deploy y confirmar que USD/ARS avanza desde
`as_of=2026-07-27`. Sin esa corrida, al pasar a 2026-08-01 la tasa supera el TTL
de 4 días y Saldo falla cerrado hasta el cron de las 13:00 UTC.

Tres rondas de auditoría externa posteriores a la preparación encontraron, cada
una, un defecto REAL con todos los gates en verde:

1. El guard de 096 habría bloqueado al PROPIO ledger: `kipu_apply_ledger_entry`
   es SECURITY INVOKER y los tres formularios web lo llamaban bajo la sesión del
   usuario, así que su UPDATE interno de saldos corría como `authenticated`.
   Probado contra producción en transacción revertida antes de aplicar.
2. El barrido de residuo nativo de 097/098 se acotaba por CANTIDAD DE UNIDADES
   (`abs(nativo) <= 1000`), no por valor: barría 1000 ARS (0,65 USD), 5 EUR
   (5,50 USD) y 500 USD en una cuenta de moneda base, y estampaba una tasa
   fabricada de 1 en su propia marca auditable. La **099** fija la regla
   permanente: *un umbral sobre dinero se expresa en la unidad de cuenta* —
   barrer sólo si `|nativo × tasa vigente| < 0,005`, con la tasa suministrada por
   el caller y rechazo explícito cuando no hay ninguna.
3. Los dos callers reales derivaban esa tasa de `convert(1, …).baseAmount`, que
   redondea a centavos: ARS→USD daba 0,00 y ambos concluían «no hay tasa» con
   una vigente en la mano — lo que además ya rompía toda edición de saldo ARS.
   El helper puro compartido `rateToBase` (`fx-rates.ts`) es ahora la única
   fuente, y el E2E DERIVA la tasa en vez de recibirla hardcodeada.

La lección transversal, que M hereda: **los tres defectos vivían en la frontera
entre el writer y sus callers**, la misma que produjo los cinco de Bloque K, y
ningún gate verde los vio. Un gate debe DERIVAR lo que el caller deriva.

El barrido first-principles posterior a L encontró cuatro fronteras de lógica que
los gates anteriores no recorrían:

1. **Mis Datos tenía writers laterales:** editar un saldo reescribía
   `current_balance_*`, cerrar una cuenta borraba ambos saldos y cerrar una deuda
   ignoraba la negativa del agente cuando quedaba obligación. La 096 prepara
   reconciliación nativa auditable (ledger + marca + replay), cierre de cuenta v3
   atómico y guards que impiden a `authenticated` alterar dinero/status fuera de
   typed writers. El cierre de deuda reutiliza su RPC v2 y conserva el rechazo con
   deuda. La última pasada encontró además que «Agregar cuenta» seguía con
   `INSERT` crudo y ofrecía `checking/savings`, valores que ni existen en el enum
   de PostgreSQL: ahora consume el alta idempotente ya desplegada, con identidad
   estable del formulario y los únicos tipos reales (`bank/cash/wallet`); el
   renombre sin saldo también cruza una frontera tipada de metadata.
   La primera auditoría externa de 096 encontró dos lock-outs antes de aplicar:
   el ledger canónico es SECURITY INVOKER y los tres formularios web todavía lo
   llamaban como `authenticated`, por lo que el nuevo trigger habría matado
   gastos/ingresos/aportes legítimos; ahora autentican con sesión, derivan de ella
   el `user_id` y ejecutan el ledger por service-role. También una cuenta foránea
   drenada con residuo base-only (caso real 0,00 ARS / 0,18 USD) quedaba imposible
   de cerrar. V3 absorbe únicamente hasta 1 unidad base de drift con marca durable
   y snapshot reversible; discrepancias materiales siguen rehusadas. Reopen pasa
   a v3 y la RPC legacy de reconciliación pierde el grant autenticado.
2. **El calendario olvidaba todo hueco mayor a dos días.** Gana cursor local
   durable, chunks de máximo 31 días y catch-up conservador: todo ciclo fuera de
   la ventana normal materializa como `ask`, **jamás auto**, incluso si quedó una
   ocurrencia auto pendiente de una corrida vieja. Un cursor ausente arranca en la
   ventana histórica de dos días para no resucitar años al aplicar la migración.
3. **Las tasas no caducaban.** Una tasa current dura cuatro días calendario y el
   refresh pasa de semanal a diario en el mismo rollout. `manual` significa
   «provider no la pisa», no «valuación eterna»: al vencer sigue visible en
   Monedas/Ajustes para renovarla, pero no publica Saldo ni otras sumas actuales.
4. **El cierre mensual expiraba el día 3.** Un cursor por usuario procesa un solo
   mes pendiente por corrida hasta alcanzar el último cerrable; errores, tope
   proactivo o copia fallida no lo avanzan.

Deuda H saldada: H.44 ahora inyecta el fallo en
`buildCoachingBriefingWith` y prueba que el builder real lo consume antes de
publicar; H.46 recorre los executors reales de create/close cuotas y sus writers,
demostrando que un Saldo ilegible degrada el copy pero no anula la operación.

Redes locales: capture **701/701** · mutaciones Pre-M **28/28** con residuo cero.
La sonda `scripts/qa/pre-m-backend-e2e.mjs` corre **sólo después de aplicar
096–099**; exige **40/40** y cubre alta idempotente de cuenta,
RLS/guards con control positivo del ledger, ledger+marca+replay,
close/reopen normal y base-only, hueco de cron, cursor mensual, TTL FX,
revocación de la RPC legacy y H.44/H.46 con persona desechable.

**Diferidos explícitos (no se mezclan con esta migración):**

- `statement_due_date` como identidad de calendario: corrige una fecha mostrada,
  pero requiere migrar el dedupe fecha→ciclo sobre una frontera que usan J-3 y K;
  merece ciclo propio, no viajar con integridad monetaria.
- paginación del ambient queue a >100 usuarios: defecto real, exposición actual
  cero (2 usuarios); se agenda cuando haya escala.
- gamificación/streaks: fuera del MVP; la spec ya lo declara explícitamente y
  M no construye un recovery engine ni recompensas.

## Bloque M0 — Inteligencia operacional general del agente

**Estado: ACTIVO (2026-07-31). Bloque M queda BLOQUEADO hasta cerrar M0.**

### Por qué existe

El cierre de J probó muchas fronteras financieras y conversacionales, pero una
revisión posterior del chat real del founder demostró que el producto todavía
puede sentirse como un bot frágil aun con todos esos gates verdes:

- El 16 de julio el founder informó: «Ya me llegó el corte de la Diners NT,
  tengo que pagar 50,60$ hasta el 3 de agosto». Kipu confirmó el corte, pero el
  26 y el 30 de julio volvió a preguntar cuánto venía el mismo estado de cuenta.
  El hecho durable y la pregunta del calendario seguían siendo dos verdades.
- En otra conversación el founder informó tres pagos de tarjeta y después que
  todo salió de Produbanco, usando el sueldo del día y 83,86$ adicionales. Kipu
  escribió una parte y cayó en un bucle de «me falta un dato o tu confirmación»;
  ante «¿qué dato?» repitió la misma frase sin poder inspeccionar su propio
  trabajo pendiente.
- El copy usó voseo y expresiones de personaje («de una», «ojito ninja», «ojo
  suave») que el founder no quiere. Las respuestas normales deben ser redactadas
  por el agente en español latino neutro, no elegidas de una colección de
  muletillas.
- La aclaración posterior cambió la semántica del caso de 83,86$: «un préstamo
  que ya me pagaron» significa que el founder HABÍA PRESTADO dinero y hoy se lo
  devolvieron; no significa que hoy pidió prestado. El endurecimiento provisional
  de `statesBorrowedInflow` puede clasificar esa frase como una obligación nueva.
  Fallar cerrado evita corrupción, pero una pregunta equivocada sigue siendo un
  agente que no comprendió.

La conclusión no es agregar cuatro frases al prompt. Es que el agente necesita
un ciclo operacional durable que pueda investigar, planificar, ejecutar,
verificar y continuar una conversación usando el contexto financiero completo.

### Vara de producto fijada por el founder

Hablar con Kipu debe sentirse como hablar con un agente de razonamiento de
primer nivel que ya tiene el código, las tablas y la historia financiera del
usuario disponibles, con una diferencia: Kipu sólo actúa mediante herramientas
tipadas y writers deterministas.

En concreto:

1. Puede recibir lenguaje nuevo y desordenado sin depender de que exista una
   regex para esa frase.
2. Investiga el estado vivo, el calendario, los movimientos, los hechos
   aprendidos, la conversación relevante y cualquier operación pendiente antes
   de concluir qué quiso decir el usuario.
3. Distingue afirmaciones, inferencias y datos derivados; nunca presenta una
   inferencia como hecho ni convierte una duda en dinero.
4. Antes de escribir, construye y valida un plan completo. Una acción compleja
   no aterriza a medias para descubrir después que faltaba un dato dependiente.
5. Si falta algo, pregunta una vez, de forma concreta. «¿Qué falta?» se responde
   leyendo el trabajo durable, no reconstruyendo una plantilla desde el último
   mensaje.
6. Un hecho ya conocido satisface su pregunta de calendario correspondiente y
   no se vuelve a pedir en otro canal o en otra corrida.
7. Después de actuar, relee lo afectado y compara el resultado contra lo pedido.
   La respuesta describe lo que ATERRIZÓ, no lo que el modelo intentó hacer.
8. Puede responder preguntas generales sobre la vida financiera del usuario sin
   mutar nada, y puede retomar el hilo después de temas intermedios, reinicios o
   cambio de canal.
9. Habla normal, claro y en español latino neutro. El modelo redacta el lenguaje;
   las plantillas se reservan para fallos técnicos mínimos donde generar texto no
   sea seguro o posible.
10. No se promete infalibilidad semántica. Se garantiza algo comprobable: una
    ambigüedad produce una pregunta útil y un error de interpretación no puede
    corromper dinero, duplicar movimientos ni esconder trabajo parcial.

### Diagnóstico first-principles inicial (histórico)

> Este apartado registra el estado al ABRIR M0. Ya no describe el árbol local
> actual: su sustitución está implementada y resumida más abajo, pero todavía no
> está aplicada ni certificada contra PostgreSQL/modelo reales.

- `runKipuAgent` entrega al modelo sólo los últimos **8 mensajes**. No existe
  recuperación contextual por entidad, ciclo, hecho o conversación histórica.
- El endurecimiento provisional de «¿qué falta?» lee metadata de la última
  respuesta del asistente. No hay una operación conversacional durable con
  plan, campos faltantes y pasos completados.
- El loop permite hasta 12 turnos de tools, pero el modelo llama writers mientras
  todavía interpreta la solicitud. La seguridad es tool-por-tool; no existe un
  preflight transversal ni atomicidad por intención del usuario.
- La superficie ronda 115 tools expuestas en el prompt. Un tool nuevo hereda
  algunos guards del chokepoint, pero el modelo sigue eligiendo sobre una
  superficie demasiado amplia sin una fase previa de selección de capacidades.
- Hay memoria aprendida y un contexto financiero amplio, pero no una capa que
  recupere los hechos RELEVANTES, su procedencia y la operación pendiente de un
  turno antiguo.
- Los writers individuales son progresivamente seguros; la frontera que falta
  es plan → argumentos del caller → conjunto de writers → postcondición. K y
  Pre-M ya demostraron que esa frontera puede estar rota con el writer y el
  caller verdes por separado.
- La reconciliación hecho↔calendario sigue siendo por dominio. Reparar sólo
  `card_statement` cierra el transcript de Diners, no la clase completa.
- La política de voz provisional también fijó instancias: una blacklist nombra
  exactamente «de una», «ojito ninja», «ojo amable» y «ojo suave». Sirve como
  red temporal, pero no prueba la clase «no sonar como un personaje/bot»; la
  próxima muletilla inventada no está cubierta.
- El primer árbol local contenía una reparación PROVISIONAL y una migración 100
  específica por caso (paid-in-full/card_statement y clasificación léxica de
  préstamo). Ese borrador fue reemplazado antes de cualquier apply por la
  operación durable, álgebra, coordinador genérico y satisfacción universal que
  exige este bloque. Esta viñeta se conserva como diagnóstico histórico, no como
  descripción del archivo 100 actual.

### Arquitectura objetivo de M0

```text
delivery autenticada e idempotente
  → recuperar contexto relevante y operaciones abiertas (sólo lectura)
  → PLAN tipado del LLM, con evidencia y dependencias (cero writes)
  → PREFLIGHT determinista contra el estado vivo
  → si falta algo: persistir la pregunta exacta y esperar
  → si está completo: ejecutar grupos atómicos mediante tools/writers tipados
  → releer filas afectadas y verificar postcondiciones
  → reconciliar hechos, calendario y memoria
  → respuesta natural generada únicamente desde resultados verificados
```

El LLM conserva la inteligencia flexible. El plan, el preflight, la identidad,
los writes y la verificación son deterministas y auditables.

### M0.1 — Álgebra de hechos financieros, no taxonomía de frases

La ontología se define por la invariante, no por una lista cerrada de nombres:
todo hecho financiero declara **qué recurso cambia, de quién es, en qué
dirección, por qué importe/moneda, cuál es su contraparte y cuál es su
procedencia**. El modelo puede expresar una combinación no anticipada con esas
dimensiones; si una dimensión indispensable no está probada, el plan pregunta.

La descripción de efectos NO concede permiso para mover saldos. Es evidencia
para el planner/preflight; el compilador sólo puede convertirla a capabilities
financieras tipadas cuyos invariantes ya existen. Un vector arbitrario nunca se
convierte en un ledger genérico.

Ejemplos mínimos que esa álgebra debe poder representar:

- dinero que el usuario pidió prestado: caja ↑ + obligación ↑;
- dinero que el usuario prestó: caja ↓ + cuenta por cobrar ↑;
- devolución recibida de un préstamo registrado: caja ↑ + cuenta por cobrar ↓;
- devolución de capital cuyo préstamo original nunca se registró: caja ↑, sin
  ingreso/P&L, sin crear un receivable artificial y con procedencia durable;
- pago de una deuda del usuario: caja ↓ + obligación ↓;
- ingreso esperado vs. ingreso que el usuario afirma que ya ocurrió;
- corte, pago parcial y pago completo de tarjeta;
- reembolso, refund, transferencia propia y transferencia de otra persona.

El LLM propone sujetos, recursos, efectos y procedencia, adjuntando evidencia
textual. Los executors comprueban que los argumentos, el estado y la evidencia
sean compatibles. Regexes pueden servir como última red adversarial, nunca como
router primario ni como definición del hecho.

`capital_return_unrecorded` es procedencia explícita, no `income`: aumenta caja,
no alimenta P&L/ingresos ni Saldo, no fabrica una cuenta por cobrar y queda
auditable para que una reconciliación futura no intente «corregirla».

### M0.2 — Operación conversacional durable

Agregar un modelo durable (nombres finales sujetos a diseño) equivalente a
`agent_operations` + `agent_operation_steps`:

- identidad primaria por `(channel, delivery_id, user_id)` y una identidad de
  continuación explícita —qué respuesta completa qué operación—; nunca se
  decide por similitud semántica solamente;
- `user_id`, conversación, canal, delivery/request id y mensaje original;
- plan versionado y fingerprint;
- hechos afirmados/derivados con procedencia;
- acciones, dependencias y grupos atómicos;
- campos faltantes y pregunta exacta;
- ciclo de vida explícito: planning / awaiting_input / ready / applying /
  verifying / completed / refused / failed_retriable / superseded / abandoned /
  expired;
- pasos pending/running/applied/verified/refused/failed;
- ids de movimientos, ocurrencias y entidades tocadas;
- resultado verificado y error tipado;
- replay exacto, reanudación, supersesión, abandono y caducidad;
- `state_version`, lease/CAS y `expires_at` para que dos canales o dos respuestas
  concurrentes no consuman el mismo pendiente sobre una foto vieja.

Un redelivery recupera la misma operación. Una respuesta posterior completa sus
campos; no crea un trabajo paralelo. «¿Qué dato falta?» consulta esta fila y
nombra los campos concretos. El estado sobrevive a más de ocho mensajes,
reinicios y cambio web↔Telegram. Una operación abandonada no queda pendiente
para siempre: puede expirar o ser reemplazada, y una corrección posterior enlaza
la operación original en vez de fabricar otra historia.

### M0.3 — Recuperación contextual general

Reemplazar la ventana ciega de ocho mensajes por un ensamblador con presupuesto:

- estado financiero actual completo y lecturas tipadas/completas;
- operaciones abiertas de la conversación y del usuario;
- mensajes recientes más mensajes históricos relevantes por entidades, fechas,
  ciclos, comercios/personas y similitud semántica;
- hechos aprendidos, aliases, preferencias y correcciones con procedencia;
- ocurrencias de calendario y ledger relacionados;
- resultados de tools del trabajo que se está retomando.

No se vuelca toda la base al prompt ni se permite SQL del modelo. El agente pide
lecturas adicionales mediante tools read-only cuando la recuperación inicial no
alcanza. Toda recuperación devuelve cobertura explícita (`ok`, `complete`,
`asOf`, fuentes consultadas, fuentes fallidas y truncamiento). Una lectura
incompleta jamás significa ausencia, y el agente no puede afirmar que conoce
«todo» si una fuente relevante quedó ilegible.

### M0.4 — Planner tipado y selección de capacidades

Antes de cualquier writer, el modelo produce un `AgentPlan` validable con:

- objetivo del usuario;
- afirmaciones y evidencia exacta del mensaje;
- hechos derivados y su fuente estructurada;
- entidades candidatas y ambigüedades;
- lecturas adicionales requeridas;
- acciones propuestas con dependencias;
- grupos que deben ser atómicos;
- campos faltantes;
- postcondiciones esperadas.

Una primera fase expone herramientas generales de lectura/planificación al
modelo. El MODELO produce primero el plan; recién después el sistema deriva de
ese plan el subconjunto mínimo de capabilities de ejecución. Un clasificador
previo que seleccione tools antes del plan sería el router antiguo con otro
nombre y queda prohibido. `PlanAction` describe efectos/intención, no crece una
variante nueva por cada frase del usuario.

### M0.5 — Preflight transversal antes de escribir

El preflight resuelve y congela:

- identidad/ownership de personas, cuentas, tarjetas, deudas, planes y metas;
- fechas y zona horaria;
- importes, monedas, tasas vigentes y monto nativo/base;
- saldo/corte/obligación vigente cuando el usuario dice «full» o «la diferencia»;
- procedencia de fondos y compatibilidad de instrumentos;
- duplicados, correcciones, reversas y replay;
- hechos u ocurrencias ya satisfechos;
- liquidez y dependencias entre entradas y pagos del mismo pedido;
- qué dato realmente falta y si su remedio es alcanzable para el usuario.

Si una acción dependiente no está lista, ninguna acción de ese grupo escribe.
Acciones independientes sólo pueden completarse parcialmente si el plan las
marca como tales y la respuesta enumera con precisión qué aterrizó y qué no.

### M0.6 — Ejecución segura por intención

Cada paso sigue usando tools tipadas; no se introduce SQL del LLM ni un writer
genérico sin invariantes. La pieza de infraestructura explícita es un
`kipu_apply_operation(jsonb)` versionado: recibe una lista ordenada de PASOS
DISCRIMINADOS, valida ownership/moneda/fingerprint/dependencias y despacha sólo a
cores financieros permitidos dentro de una transacción, dejando una marca
durable de operación.

No acepta nombres de función, SQL, tablas ni vectores arbitrarios enviados por
el modelo. Agregar un tipo de paso requiere migración/contrato/prueba igual que
cualquier writer. Su objetivo es componer capabilities existentes sin crear una
RPC distinta por cada combinación conversacional, no convertirse en un
mega-ledger que debilite invariantes.

Inmediatamente antes de aplicar, cada paso revalida bajo lock los testigos de
estado usados en el preflight. Un plan validado el martes no ejecuta el viernes
contra saldos, cortes o ownership distintos. Si no existe una forma atómica
segura para un grupo dependiente, se rehúsa antes del primer write.

El plan separa grupos independientes de dependencias reales. Puede completar
pagos independientes aunque una devolución no esté lista, pero sólo si ese
desacople fue probado por el preflight. Todo resultado parcial permitido se
enumera y verifica paso por paso, nunca se resume como «una parte quedó
guardada».

**Límite real del álgebra de grupos (auditoría externa 2026-08-02).** Una
versión anterior de este párrafo decía que «una fuente necesaria para financiar
un pago los vuelve el mismo grupo». Eso NO es expresable y la afirmación era
falsa: el único `log_movement` admitido dentro de un grupo atómico es el
reemplazo de una corrección (`prepareAtomicAgentAction` rehúsa cualquier otro, y
desde esta auditoría `canPrepareAtomicAgentAction` lo declara igual), así que un
grupo `[ingreso, pago de tarjeta]` se RECHAZA en la validación del plan. La
consecuencia práctica es correcta —ninguna mitad aterriza— y el prompt empuja a
tratar pagos con cuenta y monto probados como acciones independientes, que es el
caso del transcript del founder. Pero si alguna vez hace falta atomicidad real
entre una entrada de caja y los pagos que financia, hay que agregar un tipo de
paso al coordinador (`kipu_apply_operation`) con su migración y su prueba, no
confiar en que el planner ya sabe hacerlo.

Toda ejecución usa identidad estable de delivery + operación:

- misma entrega ⇒ replay exacto;
- nueva orden ⇒ nueva identidad;
- una operación no consume dos veces un draft, ocurrencia o movimiento;
- un fallo deja un estado durable reanudable, nunca una respuesta vaga.

### M0.7 — Verificación y reconciliación universales

Después del write, el executor relee las superficies afectadas y comprueba las
postcondiciones declaradas. No basta con `status: done` de una RPC.

Además, hecho y calendario comparten identidad de fuente/ciclo: registrar un
corte, ingreso, factura, pago, reserva o deuda satisface atómicamente la
ocurrencia correspondiente. El notifier pregunta por **hechos no satisfechos**,
no por una fila pending aislada. Un hecho ya conocido nunca vuelve a preguntarse
por Telegram, web o una corrida posterior.

La primitiva es guiada por datos: una ocurrencia declara el requisito
`kind + entity + cycle`; un hecho durable declara la misma identidad y crea una
satisfacción. No se agrega una función `reconcile_<kind>` por dominio. Esta
satisfacción universal es requisito duro de cierre, no una mejora posterior.

### M0.8 — Conversación natural y continuidad

- El modelo redacta todas las respuestas normales desde el plan y resultados
  verificados; no hay strings de producto que simulan conversación.
- Sólo los fallos de infraestructura donde el modelo no puede responder usan un
  fallback mínimo, honesto y accionable.
- Español latino neutro: sin voseo ni personaje forzado. La política se evalúa
  por dimensiones de estilo (claridad, neutralidad, ausencia de etiquetas
  inventadas/chistes forzados), con repair generado y pruebas adversariales; no
  se declara resuelta porque una blacklist contenga las cuatro frases ya vistas.
- Preguntas generales son read-only por defecto. El agente puede explicar qué
  sabe, de dónde lo sabe, qué falta, qué cambió y por qué.
- Una aclaración, corrección o cambio de tema no destruye el trabajo abierto.
  El usuario puede volver con lenguaje natural y continuar.

### M0.9 — Fallback, observabilidad y cobertura de tools

- El fallback legacy nunca reprocesa un mensaje cuyo write fue bloqueado o cuya
  operación está abierta; no puede duplicar lo que el agente evitó.
- `/dev/chat-review` muestra por turno: contexto recuperado, operación, plan,
  evidencia, tools, writes y verificación, sin exponer secretos.
- Inventario completo de capabilities: cada acción de producto debe tener una
  tool alcanzable; cada tool mutante, control positivo, rechazo, replay y
  read-after-write. Las tools huérfanas o solapadas se eliminan/agrupan.
- Toda lectura paginada declara `ok/complete`; error o tope nunca se transforma
  en «no existe».

### M0.10 — Batería de aceptación (la vara de OK)

M0 NO cierra por tener un prompt mejor ni por un gate estático verde. Debe pasar,
contra PostgreSQL real y con el modelo de producción, al menos:

1. **Transcript Diners:** informar corte 50,60$ con vencimiento 03/08 satisface
   su ciclo. Notifier y chat no vuelven a preguntarlo en ninguna fecha/canal.
2. **Caso founder completo:** hoy llega el sueldo esperado a Produbanco; entran
   83,86$ como devolución de un préstamo que el usuario había hecho y cuyo
   original no registró; paga Diners en full, 22,14$ de Produbanco MV y 201,25$
   de Titanium MV desde Produbanco. El agente deriva calendario/cortes, distingue
   devolución a favor de deuda nueva, preflighta todo y no deja una mitad.
3. **«¿Qué falta?»** nombra exactamente los datos pendientes y por qué. Dos
   preguntas consecutivas no repiten una fórmula ni pierden el contexto.
4. **Cinco clases de préstamo:** cada una mueve las dos patas correctas; las
   paráfrasis adversariales no intercambian deuda y receivable.
5. **Contexto largo:** después de >8 mensajes y un cambio de tema, el agente
   recupera y completa la operación correcta.
6. **Canal cruzado:** inicia en Telegram y continúa en web (y al revés) sin
   duplicar ni olvidar.
7. **Replay/concurrencia:** redelivery y dos respuestas concurrentes producen
   exactamente un resultado coherente.
8. **Fallo de lectura/write:** cero dinero parcial; la operación queda durable y
   la respuesta indica el dato o sistema concreto que impide continuar.
9. **Preguntas abiertas:** batería de preguntas financieras no anticipadas que
   requieren combinar calendario, cuentas, deudas, movimientos, metas y memoria;
   respuestas correctas y sin writes.
10. **Lenguaje:** cero copy prohibido/voseo y cero plantillas conversacionales en
    las respuestas normales.
11. **Paráfrasis no vistas:** un evaluador genera variaciones que no aparecen en
    el prompt ni en fixtures. Se juzga intención, plan, estado final y respuesta,
    nunca coincidencia textual.
12. **No side doors:** legacy, batch, evidencia, Telegram y web llegan a las
    mismas barreras y writers.
13. **Preguntar es lo correcto:** casos generados donde falta contraparte,
    moneda, identidad o dependencia; pregunta concreta, cero writes y reanudación
    posterior.
14. **No hacer nada es lo correcto:** preguntas, comentarios, hechos ya
    aplicados y contradicciones no probadas no producen movimientos.
15. **Corrección de operación:** «lo que te dije ayer estaba mal» corrige/rehace
    la operación completa o sus pasos afectados, con historia append-only; no se
    limita a J-2 sobre una sola transacción.
16. **Afirmación contra sistema:** «esa Diners ya la pagué» se trata como nueva
    evidencia que debe reconciliarse, no como permiso para sobrescribir el estado
    ni como motivo para ignorar al usuario.
17. **Tiempo, abandono y supersesión:** una operación abierta se revalida,
    expira/abandona sin loop y puede ser reemplazada de forma explícita.
18. **Autoridad compartida:** operaciones household respetan actor/owner y nunca
    heredan autoridad del canal o del planner.

La batería incluye unit tests del plan/preflight, mutaciones ancladas a la
sentencia viva, persona desechable con PostgreSQL, harness de dos conexiones,
E2E Telegram/web y E2E con modelo real. Las paráfrasis y contraejemplos se
generan en tiempo de prueba por un modelo evaluador, con seeds reproducibles y
casos retenidos sólo después de descubrir una clase; no son otra lista manual de
frases. Cada fixture prueba estado final y residuo, no sólo copy o `ok:false`.

### Orden de implementación

1. Retirar del parche provisional las decisiones semánticas/voice por instancia
   y reemplazar por contratos; mantener únicamente redes que sigan siendo
   verdaderas bajo M0.
2. Construir M0.2 (operación durable) y M0.7 (satisfacción universal) primero:
   son independientes, acotadas y habrían prevenido directamente los dos
   incidentes observados.
3. Construir la álgebra M0.1 y el planner/contexto M0.3–M0.5 sobre esas
   identidades durables.
4. Implementar el coordinador transaccional M0.6 y la verificación post-write.
5. Cerrar conversación/voz/fallback/observabilidad M0.8–M0.9.
6. Ejecutar M0.10 por sección y luego como batería congelada completa. Ninguna
   sección se declara por lectura si tiene frontera ejecutable con PostgreSQL.

### Estado de implementación local — 2026-08-01

Los puntos 1–5 están implementados en el árbol sin commit. La migración
`100_agent_conversation_integrity.sql`, la 101 y la 102 están **APLICADAS**
(2026-08-02/03). La 101 corrige la llamada muerta `jsonb_object_length` que
mataba todo claim; la 102 serializa la reapertura y restaura el predecesor
bancario exacto, no un empate por UUID. PostgreSQL pasó **59/59 dos veces** sobre
esa cadena. La ejecución del modelo encontró luego que el finalizador exigía
monto y todos los roles dentro de una sola ventana, por lo que una respuesta
normal que juntaba importe y vencimiento nunca podía publicarse. La corrección
mantiene el monto ligado a su entidad y prueba sus roles en el conjunto de
evidencia de ESA entidad, nunca en otra.

La re-auditoría posterior cerró además: asociación individual de varios montos
en una misma frase; fechas de calendario por entidad+rol; timestamps genéricos
que ya no prueban vencimientos; fechas relativas resueltas en la zona del
usuario; recibos históricos de escritura sólo desde operaciones completadas y
verificadas; reparación acotada del planner con el error determinista exacto;
dirección explícita de préstamos/devoluciones; retorno de capital no registrado
sin contraparte ficticia; y autoridad de entidad acumulada desde TODAS las
entregas de una operación multivuelta, incluida recuperación de worker.

Las **103–106 están APLICADAS (2026-08-03)**. La 103 hace el cast de un monto
legacy seguro por CASE —el orden de predicados SQL no evita un cast inválido—.
La 104 conserva la pregunta exacta de un plan READY con writes independientes y
rechaza en PostgreSQL cualquier `missing_fields` sin pregunta, también para un
caller futuro que eluda TypeScript. La 105 mueve el límite temporal de las
lecturas de operación al reloj de PostgreSQL; PostgreSQL volvió a **62/62 dos
veces**, incluso con el proceso atrasado 24 h. La corrida externa siguiente
llegó a **21/22** y aisló ME10aa antes del writer: el planner persistió
`account:<uuid>` mientras el preflight de la 100 comparaba sólo con el UUID
desnudo. La **106 está APLICADA**; acepta la forma desnuda o la
forma tipada únicamente cuando clase+id coinciden, y el E2E PostgreSQL usa ya
el mismo `account:<uuid>` del plan real. La siguiente corrida real aisló la
frontera espejo en TypeScript: el adapter agrupado exigía `args.amount` antes
de permitir que `paidInFull=true` derivara 50,60 del corte probado. El guard
ahora sólo aplica a entradas user-stated y el fixture PostgreSQL omite el monto
exactamente como el modelo. La primera ejecución DB sobre ese árbol encontró el
P1 simétrico: la comparación SQL de la 100 también era condicional al `amount`
opcional, de modo que omitirlo apagaba la barrera y un payload resuelto podía
falsificar el monto. La **107 está APLICADA**: un helper privado
bloquea la tarjeta, deriva el full desde `full_payment_due`/`statement_total_due`,
usa el plan sólo para un parcial y liga también el `expected_due` y
`paid_in_card_currency`. Los cuatro callers TypeScript usan la misma expectativa
nativa, incluida la caída a `statement_total_due`. PostgreSQL quedó en
**64/64×2**. El primer modelo v10 ejecutó ME10aa completo y correctamente, pero
el harness consultaba la columna inexistente `transactions.reversed_by_transaction_id`;
la corrección local mide ahora las reversas append-only por
`related_transaction_id`, el marcador exacto, delta local y reemplazos 12/19.
Batería local en ese punto: capture **738/738**, mutaciones M0 **255/255**, K **280/280**, L
**24/24**, Pre-M **28/28**; loop
**22/22**, wizard **161/161**, J-2/J-3/J-4 **17/17 · 21/21 · 18/18**; `tsc`,
lint y `git diff --check` limpios. El build local sólo falla al descargar Geist
por la red del sandbox; debe certificarse externamente. Una corrida posterior
con servidor limpio y contrato coincidente aisló ME2 en la evidencia financiera:
el snapshot oficial era un string JSON dentro de otro JSON, dejando las claves
monetarias escapadas. El boundary de lectura ahora convierte sólo el tag oficial
exacto en evidencia estructurada y el snapshot de tarjeta incluye monto de corte,
due/cutoff y fechas con roles tipados. La autoauditoría cerró además dos bugs del
parser: `16` ya no se reparsa como `1` y `07-06` dentro de un ISO no se fabrica
como otra fecha. Las notas/memoria del usuario ya no pueden convertirse en
evidencia monetaria/calendario por aparecer dentro del snapshot: el grounding
lexical las enmascara y los avisos abiertos se proyectan como hechos tipados por
ocurrencia. El handshake v10 impide que un runtime anterior certifique el arreglo
y añade el contrato económico de repagos/correcciones completas.
La regresión reproducible 62→59 resultó ser deriva de reloj: PostgreSQL
escribe `updated_at/completed_at/expires_at`, pero el reader los acotaba con el
reloj del proceso. La 105 expone un reloj DB service-role-only y el E2E prueba
continuidad con el proceso atrasado 24 h.

La primera corrida de modelo que atravesó ME2 expuso la siguiente frontera.
ME9 y ME10 medían contra un undo nunca confirmado; ME10a trataba metadata
opcional como faltante y después exigía confirmación sólo porque un batch tenía
dos importes, aunque el usuario hubiera ligado monto, descripción y cuenta de
cada fila. Undo/destrucción sigue separado en propuesta+confirmación; una
captura ordinaria explícita no. Además, receipts `verified` de
una operación todavía abierta entran como evidencia estructurada de lo ya
escrito, el repair recibe el `publicationFailure` exacto y un fallo terminal de
un turno deja su check rojo sin abortar los restantes.

La pasada v11 cierra los tres rojos de la corrida externa 19/22 sin gastar otra
muestra: (1) `log_movements_batch` omite el challenge únicamente cuando un
matcher determinista prueba en la misma cláusula cada monto↔descripción y el
guard de entidad prueba las cuentas/tarjetas/metas anidadas; (2) el planner
recibe `CURRENT_LOCAL_DATE` derivado en la zona del usuario y rehúsa una fecha
real futura o inválida antes de guardar el plan; (3) si el usuario pregunta por
cada monto de una operación, los receipts `verified` producen la lista completa
y la publicación rehúsa una respuesta que omita cualquiera. El harness de ME10a
ahora mide el write directo y ahorra un turno de modelo. Capture **739/739** y
mutaciones M0 **264/264**, todas muriendo por test nombrado; contrato
`direct-expense-v11`.

La pasada v12 cierra los dos defectos reales de la siguiente muestra 16/22 sin
perseguir los cuatro rojos en cascada. ME6 emitía una acción completa
`capital_return_unrecorded` (dirección, monto, cuenta y las tres patas
económicas) pero inventaba un `missing_field` por el nombre opcional de la
contraparte. El validador ahora rehúsa cualquier missing dirigido a esa acción
ya ejecutable; no depende de palabras del usuario. ME10b conservaba bien la
confirmación durable, pero su resumen interno dictaba «responde solo» y el
juez semántico lo rechazaba; el finalizador convertía ese rechazo en el mismo
`reply_structure_or_voice` usado por tres causas distintas. Ahora la propuesta
pide confirmación explícita de forma natural y la frontera tipa por separado
`reply_empty`, `reply_structure_markers`, `reply_voice_backstop` y
`semantic_voice_rejected`, conservando fail-open sólo cuando el juez no pudo
correr (el backstop determinista ya pasó). Capture **740/740**, mutaciones M0
**271/271**, contrato `planner-voice-v12`.

La pasada v13 cierra el defecto que apareció detrás de ME6: el planner emitía
`occurredAtISO`, pero `record_person_payment` no publicaba ninguna fecha y su
adaptador atómico leía el alias `date`. Ahora schema, planner, writer individual
y grupo atómico comparten `occurredAtISO`; una fecha explícita inválida rehúsa
antes de escribir y la omisión usa el día local probado. La validación de
argumentos conserva causas tipadas: sólo un required ausente puede ser
`needs_info`; una propiedad, tipo o enum inventado se devuelve al bucle acotado
del planner y nunca se convierte en una pregunta imposible para el usuario.
Capture **741/741**, mutaciones M0 **281/281**, contrato
`person-date-v13`. No hubo muestra de modelo en esta pasada.

La pasada v14 separa tres rojos que una lectura superficial mezclaba. ME10a era
un falso positivo del harness: la regla destinada a la interjección regional
`de una` también rechazaba el castellano normal `de una sola operación`. ME4 ya
había nombrado el préstamo pendiente en el log real, pero el test exigía unas
variantes léxicas concretas; ahora consume `agentPendingClarifications` y usa la
misma prueba semántica que producción. Aun así había una clase real sin guard:
un turno que escribe una parte podía publicar sólo `Listo` y esconder lo que no
aterrizó. La barrera exige un marcador no resuelto y evidencia material de cada
aclaración durable. ME12c se cierra sin aflojar el álgebra: en
`record_person_payment` todas las superficies financieras pertenecen al usuario
porque eso es exactamente lo que modifica el writer; la contraparte es sólo
identidad contextual. Capture **742/742**, mutaciones M0 **286/286**, contrato
`partial-truth-v14`. No hubo muestra de modelo ni gasto de API en esta pasada.

La pasada v15 corrige el último rojo 21/22 sin acomodar vocabulario observado.
ME10c había restaurado caja, receivable y marcador correctamente; sólo fallaba
porque el harness exigía el infinitivo `deshacer` y el modelo conjugó `deshago`.
El barrido encontró la misma deuda en ME5, ME9 y ME10b. Los cuatro ahora exigen
el contrato durable completo: `agentOutcome.wrote=false`, operación
`awaiting_input`, challenge ligado al `toolName` esperado y una respuesta que
reconoce la aclaración durable. ME10a prueba el inverso: write confirmado,
operación completed y cero pendientes. No queda ningún regex de
`confirmar/deshacer/devolv...` en esos conyuntos. Capture **743/743**, mutaciones
M0 **295/295**, contrato `durable-proposals-v15`; cero muestras del modelo.

La primera ejecución externa de v15 quedó 21/22 porque ME5 exigía
`toolName=record_person_payment`. Ese valor describe al autor sólo para un
challenge del executor; un missing-field preventivo correcto nace en
`agent_plan` y apunta a la acción bloqueada mediante `appliesToActionIds`. La
v16 resuelve la capacidad objetivo por ambas formas, compara los IDs con las
acciones del plan durable y rehúsa ID ajeno o capacidad distinta. El helper del
E2E ya no repite la misma barrera de prosa de producción —que no podía fallar de
forma independiente—: mide únicamente `wrote=false`, `awaiting_input` y vínculo
durable a la capacidad. IR263 conserva la garantía textual. El detalle rojo de
ME5 ahora incluye metadata, no sólo copy. Capture **743/743**, mutaciones M0
**296/296**, contrato `pending-capability-v16`; cero muestras del modelo.

La auditoría externa de v16 encontró que ese vínculo seguía siendo imposible en
ME5: la dirección económica desconocida prohíbe crear una action/effects y el
`missing_field` correcto apunta a `appliesToActionIds=["$response"]`. La v17
trata ese scope de respuesta como identidad durable de primera clase, sin
convertirlo en excepción por autor ni inventar una acción financiera. ME5 exige
`wrote=false`, operación `awaiting_input`, la misma identidad de operación y el
scope literal `"$response"`; ME9/ME10b/ME10c conservan el vínculo exacto a su
capability. IR264 prueba positivos y cruces inválidos, y M0M297 mata la regresión
que vuelve a exigir una acción inexistente. Capture **743/743**, mutaciones M0
**298/298**, contrato `pending-scope-v17`; cero muestras del modelo.

La primera ejecución externa de v17 confirmó que el scope funcionaba, pero
encontró fragmentación de lifecycle: «¿qué dato te falta?» creaba una nueva
operación vacía `awaiting_input` mientras el `intentKey` seguía señalando el
pendiente propiedad de la operación anterior. La v18 decide el contrato en vez
de acomodar ME5: una consulta de estado no consume la operación observada ni
copia sus missing-fields. `plan.observed_operation_ids` liga por identidad el
turno read-only; su propia operación termina `completed`; la original sigue
`awaiting_input`; y el pending observado entra sólo a la barrera de publicación,
no al settlement del turno nuevo. El validador rehúsa IDs no visibles, cruces con
continuation/closures y claves `operation:<id>:...` copiadas como `$response`.
Capture **744/744**, mutaciones M0 **305/305**, contrato
`operation-inspection-v18`; cero muestras adicionales del modelo.

La auditoría externa v18 recorrió los 22 checks y confirmó el arreglo de
lifecycle (ME5 verde). El único rojo, ME10b, era producto: la propuesta
server-owned no escribió nada correctamente, pero la respuesta natural
«el préstamo que ya tienes registrado» agotaba tres reparaciones y devolvía 500
porque `MUTATION_CLAIM` leía cualquier participio como una escritura actual de
Kipu. La v19 reemplaza esa señal léxica por formas gramaticales de acción:
pretérito activo, perfecto/impersonal, resultado con `quedó` y recibo breve
autónomo siguen exigiendo evidencia; un participio posesivo o de estado previo
no afirma una mutación. `de hecho` y `listo para confirmar` tampoco son recibos.
IR266 prueba la barrera completa y M0M306–314 muerden nueve regresiones,
incluido el límite `\\b` no-Unicode después de `registró`. Capture **745/745**,
mutaciones M0 **314/314**, contrato `mutation-subject-v19`; cero muestras del
modelo gastadas por Codex.

La auditoría externa v19 confirmó ME10b y encontró dos clases nuevas. Primero,
cinco recibos sin write escapaban por puntuación o voz pasiva (`Perfecto,
guardado`, `Listo: registrado`, `Listo, ya está guardado`, `La devolución ya
está registrada`, `Listo, ya quedó`). La v20 no intenta distinguir préstamos de
devoluciones por vocabulario: un estado pasivo sólo es histórico si su misma
cláusula nombra una entidad proveniente de evidencia estructurada verificada;
los prefijos de éxito tras coma/dos puntos siguen exigiendo recibo de acción.
Segundo, el SQL de undo decía «money-writing» pero contaba todo
`execution_effect='write'`; una memoria/configuración añadida por el planner no
tiene transacción y volvía irreversible una operación financiera correcta.
La **108 está APLICADA (2026-08-08)** y deriva la frontera desde la ontología
financiera ya persistida en `agent_operation_steps.effects`. No afloja un write
económico sin recibo y agrega diagnóstico interno por step. El E2E PostgreSQL
ahora mezcla dos writes monetarios con un write durable de memoria sin
transacción y exige que el undo revierta exactamente las dos transacciones; el
caso inverso conserva el fail-closed para un write económico sin transacción.
La batería pasa a **65/65**. La v21 elimina la fuente de varianza revelada por
la segunda muestra v20: un juez de estilo sin hechos ya no puede vetar la
publicación después de una escritura verificada. Las barreras deterministas de
verdad, dinero, calendario, recibos, pendientes y voz siguen fail-closed; el
juez semántico tiene como máximo una reescritura y, si persiste, se publica la
mejor candidata segura con advisory durable. Los recibos breves ya no se
enumeran por prefijo: una forma terminal exige entidad estructurada o recibo de
acción. La corrida v21 quedó 21/22 por una frontera distinta: el planner declaró
la reversa completa y dos reemplazos correctos, pero tres samples no copiaron la
misma coreografía mecánica de `atomic_group` y `depends_on`. La v22 no relaja el
contrato ni sintetiza intención: `compileWholeOperationCorrection` normaliza
grupo y dependencia sólo cuando ya existen exactamente una reversa, uno o más
reemplazos individuales contiguos, target durable y evidencia estructural de su
relación. Dos reversas, acciones sin relación, batch o intercalado vuelven
intactos al validador estricto y se rehúsan. Si la planificación acotada todavía
se agota, el modelo primario redacta una explicación de no-acción; una barrera
determinista exige que diga que nada cambió y prohíbe preguntas/datos inventados,
cifras sin evidencia y recibos falsos. El runner de mutaciones ahora aborta si
el capture baseline ya está rojo: durante esta pasada un handshake desactualizado
demostró que, sin ese preflight, varios mutantes podían heredar el mismo detector
y parecer muertos. La primera muestra externa v22 cayó en ME3 y dejó ocho rojos
contiguos, pero el runner sólo imprimía la prosa segura de fallback y luego
borraba el diagnóstico junto con la persona disposable. La v23 preserva en la
metadata de ese mismo turno y en `agent_intake_failures` únicamente etapa,
código y las razones acotadas del validador en los tres intentos —nunca el JSON
candidato, el prompt ni el mensaje crudo—; los checks descendientes se reportan como `BLOCKED`, no
como ocho defectos independientes, y siguen haciendo exit 1. Una reproducción
enfocada ME1–ME3 identificó la contradicción real: la tool de pago de tarjeta
decía `TRANSFER`, pero la ontología segura exige `payment` con cash/decrease +
debt_liability/decrease. La descripción ya usa el evento contable correcto y
un compilador general, guiado por capability+modo tipados y no por frases,
puede corregir sólo una etiqueta económica redundante cuando las patas ya son
exactas. Nunca añade/elimina effects ni cambia owner, entity_ref, dirección,
amount_source, argumentos o grupos; si la forma sigue siendo insegura devuelve
el plan intacto al validador estricto. La reproducción enfocada pasó **3/3**.
Capture **750/750**, mutaciones M0 **342/342**, contrato
`intake-diagnostics-v23`.

La auditoría congelada del 2026-08-09 (árbol `db2d622e…`, 483 archivos) corrió
esa batería en verde más una muestra modelo 22/22, y el re-audit de Codex
escaló a P2 lo que su veredicto había subclasificado: los lectores de
steps/deliveries de la lectura abierta paginaban por OFFSET sin límite de
snapshot y, al reparar, apareció la mitad simétrica — el keyset del padre
paginaba sobre `updated_at` mutable, así que una entrega concurrente podía
esconder una fila con `complete:true`. La v24 lo cierra por construcción: la
**109 (APLICADA 2026-08-09)** mueve la lectura entera a UNA RPC de snapshot
único (`kipu_read_open_agent_operations`: padres, steps, deliveries, CAP+1
contado 200/3000/1500 y reloj del statement en el MISMO statement SQL) con
caller fail-closed por forma y membresía; el archivo de completadas resultó
sólido (estado terminal + `completed_at <= asOf` congelan el conjunto) y sólo
ganó dedupe por id contra el único tear posible. La **110 (APLICADA
2026-08-09)** hace verdadera la promesa documental de v23:
`agent_intake_failures` conserva fingerprint e identidad sin el mensaje crudo.
Sonda de dos conexiones M109.1 (doce vueltas reales de ciclo contra un lector
concurrente; su primera corrida 68/69 probó que exigir rondas ejecutadas evita
un verde vacuo) y M109.2 (CAP+1 con 201 operaciones ⇒ `complete=false`).
La muestra v24 (árbol `cef2cae8…`, 485 archivos) quedó **20/22** y su
diagnóstico aisló UN defecto raíz nuevo: el batch escribió perfecto pero su
recibo no declaraba montos ni entidades por fila
(`Lote de 2: 2 registrados…` + `transactionIds`), así que toda respuesta veraz
(«registré compra A por 10$…») era una mutation claim sin recibo que la
respalde — `money_not_grounded` determinista en 6 candidatos, HTTP 500 con el
dinero ya escrito y la operación `failed_retriable`; ME10aa cayó en cascada
fail-closed porque el undo exige target `completed`. Es la misma clase de
PARIDAD de frontera que los cinco defectos del Bloque K: el writer individual
sí declara `Expense 10 recorded from Produbanco`. La v25 restaura la paridad
(el recibo del lote conserva el `built.summary` por fila y agrega
`data.movements` tipado en el orden probado del lote), IR274 reproduce en puro
las dos direcciones (recibo viejo ⇒ `amount_absent`; nuevo ⇒ publica),
M0M352/353 la muerden, y el contrato pasa a `batch-receipt-v25`. La muestra
v25 (árbol `9e1acc66…`) quedó **20/22** con ME10a/ME10aa YA VERDES (el fix de
paridad certificado por el modelo real) y aisló la clase siguiente en ME9: un
query semántico sin coincidencias (`completedAgentOperationMatchesQuery` exige
TODAS las palabras) se presentaba como «No hay operaciones completadas en este
historial», y el planner convirtió esa paráfrasis sin match en un reclamo
falso de inexistencia que bloqueó el undo — el miss de un FILTRO no es
ausencia. La v26 lo cierra en la capa de evidencia (M0.3, sin rutas por
frase): el tool declara `queryMatched:false` con summary que distingue filtro
de ausencia y DEGRADA a las completadas recientes sin filtrar
(`recentUnfiltered`), de modo que una sola lectura muestra el trabajo real; la
ausencia absoluta sólo es afirmable sin filtro y con scan completo. IR275 fija
la rama, M111.1 la prueba en runtime contra PostgreSQL y M0M354–356 la
muerden; contrato `search-miss-v26`. La muestra v26 quedó **22/22** con
ME9/ME10a/ME10aa verdes; el segundo re-audit de Codex verificó el sello y
encontró DOS P2 de fuente que un 22/22 no anula: el archivo completado seguía
paginando por offset en varios statements (bajo MVCC una operación que
commitea entre páginas entra a la región ya leída y se PIERDE con
archiveComplete=true — el argumento «append-only sólo duplica» era falso) y
`queryMatched:false` afirmaba una negación sobre un scan topado. La v27 lo
cierra con la **111 (APLICADA 2026-08-09)** — scan de candidatos en UN
statement con CAP+1(120) sobre el conjunto filtrado, bundle ops+steps en un
statement con identidad terminal verificada contra la fase 1, matcher Unicode
en TypeScript como verdad única — y el veredicto ternario (false exige scan
completo; topado sin match ⇒ null). M111.2 prueba presencia bajo concurrencia
y M111.3/M111.4 el ternario topado (la propia sonda debió ganarse su rigor:
query con términos exclusivos y ≥92 rellenos incondicionales para sacar el
target de la ventana); IR276/IR277 + M0M357–363; contrato
`archive-snapshot-v27`. La muestra v27 quedó **20/22** (ME9): el agente
propuso y confirmó el undo correcto — target hallado vía el archivo nuevo,
cuatro filas enumeradas, challenge durable — y el executor rehusó con un
KIPU_* que el wrapper colapsaba a «unsafe», inobservable tras el cleanup. La
v28 es una pasada de OBSERVABILIDAD (doctrina v23, cero writers tocados): el
wrapper conserva el mensaje KIPU_* acotado como `detail`, el executor persiste
`undoRefusal/undoDetail/targetOperationId` en el receipt durable, y el harness
de ME9 captura los steps de corrección y target antes del cleanup. IR278 +
M0M364–366; contrato `undo-observability-v28`. La muestra v28 quedó 22/22 y el re-audit de Codex
aceptó la 111 y el ternario, pero encontró el P2 de CLASE que quedaba: M0
verificaba que lo dicho fuera verdad, nunca que estuviera TODO lo que la
pregunta necesitaba — ME2 respondió el vencimiento y omitió los 50,60 con todas
las barreras verdes, porque la completitud se trataba como estilo (el juez
semántico lo marcó y no tenía autoridad). La **v29** separa verdad, completitud
y voz: `plan.response_requirements` declara los hechos mínimos que la respuesta
debe cubrir —derivados por el PLANNER, no por un router de frases—, cada uno
ligado a evidencia verificada y comprobado CONTRA EL TEXTO con binding de
entidad y rol. Un requisito sin evidencia jamás se exige; un valor ligado a
otra entidad no cubre; no hay autodeclaración de cobertura; un descriptor
degenerado o un operando no probado se declaran no fundamentados. Una omisión
read-only bloquea y recibe una reparación acotada con sólo los hechos omitidos;
tras una escritura verificada la respuesta se preserva con advisory durable
(v21 intacta). El contrato es de la RESPUESTA: un turno que pregunta no lo
arrastra. IR279–IR282 + M0M367–M0M378; contrato histórico
`diagnosable-turns-v32`. El audit de Codex encontró tres P2 de clase encima de
ese verde: (1) después de una reparación incompleta el orquestador volvía a
llamar al finalizador con `responseRequirements=[]`, autorizando exactamente la
omisión que decía impedir; (2) state/identity/pending/comparison se marcaban
como cubiertos con sólo nombrar la entidad, sin probar el predicado; y (3) una
respuesta factual podía omitir silenciosamente el contrato.

La **v33** elimina la autorización, no agrega casos de preguntas. El planner
sigue interpretando la petición completa y declara únicamente valores que la
frontera puede verificar de verdad: money, date y el nombre canónico de una
entidad ya probada. Estados o explicaciones cualitativas siguen siendo lenguaje
inteligente del modelo; el servidor no finge entenderlas con una regex. Todo
contrato no vacío lleva además `response_template`, prosa natural escrita por
el mismo planner con exactamente un slot por requisito. Si el reply inicial y
su única reparación omiten un hecho fundamentado, el servidor sustituye los
slots sólo con valores canónicos de evidencia verificada y vuelve a ejecutar
TODAS las barreras con el contrato original — nunca con `[]`. Un plan factual
con assertions y sin contrato se rehúsa en planificación. IR279–IR282 +
M0M367–M0M387; contrato `canonical-fallback-v33`. Batería local v33: capture
**761/761**, mutaciones **387/387**, PostgreSQL **73/73×2**, tsc/lint/build
limpios, muestra enfocada ME1–ME3 **3/3**, residuo cero.

La auditoría completa de Claude sobre v33 encontró un P1 de protocolo: el
prompt declaraba `value:object` pero el validador exigía claves nunca
especificadas (`date`, `amount+currency`, `name`) y respondía con un error
genérico. ME2 agotó tres intentos intentando adivinar el wire contract. **v34**
lo hace explícito y discriminado, devuelve al reparador la ruta exacta
rechazada y prueba ids/source/fechas reales/moneda. También cierra la observación
secundaria: el fallback ya no es todo-o-nada; un slot no fundamentado se vuelve
incertidumbre tipada dentro del template del planner, mientras los hechos
fundamentados se publican. El valor no probado nunca se reutiliza, y money/date
sólo son fundamentados cuando valor y entidad comparten la misma ventana de
evidencia. IR279/IR280 extendidos + M0M388–398. Contrato
`explicit-requirements-v34`; batería local: capture **761/761**, mutaciones
**398/398**, PostgreSQL **73/73×2**, tsc/lint/build limpios, enfocada ME1–ME3
**3/3**, residuo cero. No requería migración; en ese momento 001–111 seguían
aplicadas y la próxima era 112.

La muestra completa v34 certificó ME2 pero quedó **21/22** en ME5 por una
contradicción entre autoridades: «¿qué falta?» debía explicar una dirección
económica cualitativa de una operación abierta; no existía un valor canónico
money/date/entity honesto, y el lifecycle correctamente prohibía copiar el
missing-field ajeno a una segunda operación. **v35** formaliza la autoridad que
ya aplicaba publicación: una inspección estrictamente read-only con
`observed_operation_ids` responde desde el pending durable observado, que debe
reconocer en prosa. La excepción exige `response_intent=answer`, cero actions y
cero missing-fields; no alcanza a `answer_and_act` ni a respuestas sin una
operación realmente observada. No se agregó un kind cualitativo ni una ruta por
frase. IR265 + M0M399–401. Contrato `observed-pending-v35`; batería local:
capture **761/761**, mutaciones **401/401**, PostgreSQL **73/73×2**,
tsc/lint/build limpios, enfocada ME1–ME5 **5/5**, residuo cero. Sin migración.

La muestra completa v35 encontró un fallo anterior a esa autoridad: ME4 escribió
los tres pagos de tarjeta y una cifra adicional sin receipt hizo que la respuesta
veraz muriera en `money_not_grounded`; el diagnóstico no nombraba la cifra, por
lo que tras cleanup no era posible distinguir sueldo, saldo u otro hecho. También
quedaba un hueco de fuente: cualquier id observado podía intentar eximir una
respuesta factual, aunque no poseyera el pending descrito. **v36** corrige ambas
clases sin routing por frase. El grounding conserva autoridad bloqueante y emite
sólo `{value, reason, roles}` (máximo ocho), lo persiste en la operación y lo
entrega a una única reparación que elimina exclusivamente esas cifras. Tras una
escritura, montos publicables vienen de receipts del plan ejecutado o pending
verificado; la procedencia puede narrarse sin inventar/repetir números. La
autoridad observada exige que cada operación posea un pending durable real y que
cada assertion proceda de `openOperations`. IR265/IR283 + M0M399–407. Contrato
`grounding-repair-v36`; batería local: capture **762/762**, mutaciones
**407/407**, PostgreSQL **73/73×2**, tsc/lint/build limpios, enfocada ME1–ME5
**5/5**, residuo cero. Sin migración.

La muestra completa v36 certificó ME4 y quedó **21/22** únicamente en ME5. El
servidor exigía que `assertions[].source` apuntara a `openOperations`, pero el
prompt sólo mostraba ejemplos de `financial_context`/`read_evidence`; el tercer
rechazo devolvía el error factual genérico, no la ruta inválida. **v37** elimina
el wire oculto: prompt, validador y fixture comparten
`openOperationAssertionSource`, enseñan la forma exacta
`openOperations[<observed_operation_id>].<campo>` y el repair recibe
`plan.assertions[i].source`. El source se liga a un id realmente observado; no
se agregó router por frase ni caso de préstamo. IR265/IR284 + M0M399–410.
Contrato `observed-source-v37`; batería local: capture **763/763**, mutaciones
**410/410**, PostgreSQL sin cambios **73/73×2**, tsc/lint/build limpios,
enfocada ME1–ME5 **5/5**, residuo cero. Sin migración.

La muestra completa v37 certificó el source compartido con cinco assertions
reales del modelo, pero ME4 terminó en el fallback seguro de intake con HTTP
200 y dejó ME5–ME10 bloqueados. La causa no era recuperable después del cleanup
aunque ya existía: `turn()` guardaba `assistantMetadata.agentIntakeFailure` y
sus filas durables en `turn.intakeDiagnostic`, mientras `turnDetail()` sólo
leía `turn.error.intakeFailures`, una propiedad exclusiva del camino HTTP de
error. **v38** cierra esa fuga de observabilidad sin tocar producto ni dinero:
el detalle incluye el diagnóstico acotado del camino HTTP 200; IR270/IR285 y
M0M411 fijan captura Y consumo. Contrato `intake-reporting-v38`; capture
**764/764**, mutaciones **411/411**, PostgreSQL sin cambios **73/73×2**. Sin
migración. El próximo rojo de ME4 debe nombrar stage/code/attempts y los tres
validationFailures; no se autoriza otra corrección semántica por inferencia.

v38 fue auditado **22/22**, comiteado en `e91df36` y desplegado con smoke
productivo, pero NO cerró M0: la primera revisión real del founder encontró una
confirmación redundante. «Acabo de pagar el arriendo» abrió correctamente una
operación por falta de fuente; «desde mi cuenta Supervielle» completó esa fuente
y el planner armó el paso correcto por 1.010.786,70 ARS, pero
`serverConfirmationRequirement` volvió a buscar ese monto únicamente en el
mensaje de continuación y emitió `unstated_amount`. El dato era el monto nativo
de un fijo estable server-owned, no una cifra inventada ni una decisión nueva
del usuario.

**v39** corrige la clase sin caso por frase: el guard acepta una lista de paths
monetarios que el executor haya re-derivado con un verificador de dominio. El
primer verificador cubre sólo `log_movement.amount` cuando `fixedExpenseId`
apunta a un fijo activo no-variable del catálogo completo y monto+moneda nativos
coinciden exactamente. Un importe explícito contradictorio en cualquier mensaje
user-authored de la operación, una factura variable, catálogo ausente o cualquier
divergencia devuelve lista vacía y conserva el challenge normal. El planner no
puede autodeclarar autoridad con `amount_source=stored_fact`. IR286 + M0M412;
contrato `stored-money-authority-v39`; capture **765/765**, mutaciones
**412/412**, tsc/lint/build limpios; PostgreSQL y migraciones sin cambios.

El re-audit de v39 validó el verificador con **24/24 adversariales**, pero su
smoke disposable encontró `pending_question_contract / missing_requirement_hidden`
antes de ejecutar el fijo estable. La atribución causal a v39 no era demostrable:
esa rama corre antes del verificador nuevo y el planner es estocástico. El rojo
sí reveló dos invariantes reales ausentes. **v40** las cierra de forma general:
(1) un `missing_field` no puede apuntar a un path que ya está suministrado en
`arguments` de la action validada; debe eliminarse o el planner debe omitir de
verdad el argumento; (2) si la pregunta natural y un repair acotado fallan el
cotejo léxico, el servidor construye la última pregunta desde TODOS los
`answer_shape` del contrato tipado y la re-finaliza con las mismas barreras. No
hay regla por «arriendo», capacidad ni idioma financiero; el fallback no aporta
hechos, montos ni claims de escritura. Si incluso esa forma falla, el intake
durable conserva hasta ocho keys faltantes acotadas. IR287 + M0M413/414 (y M0M135
re-anclado al nuevo fail path); contrato `pending-question-coherence-v40`;
capture **766/766**, mutaciones **414/414**, tsc/lint/build limpios. PostgreSQL
y migraciones siguen sin cambios.

El re-audit de v40 validó 24/25 adversariales y ejecutó el transcript exacto
dos veces. v40 sí eliminó el `pending_question_contract`, pero el modelo
persistió `fixedExpenseId` sin `amount`, dejó `amount` en missing y pidió monto
y cuenta. v39 sólo podía probar un monto que ya estuviera en el payload; faltaba
la paridad en el planner. También quedó probado que la pregunta canónica de
v40 no puede satisfacer por léxico un pendiente `amount`: las palabras
user-facing correctas son stopwords y la key interna no debe filtrarse a la
prosa. **v41** cierra ambas clases sin routing por transcript. Un compilador
posterior al plan adopta monto+moneda nativos sólo si el modelo ya eligió
`log_movement`, semántica expense y el `fixedExpenseId` exacto de una única
fila activa/no-variable dentro de un catálogo financiero COMPLETO. Nunca elige
la capacidad ni la entidad. Catálogo parcial, variable/inactivo/no-único,
moneda incompatible o cualquier monto contradictorio del usuario devuelven el
candidato intacto al repair estricto. Si un missing `amount` apunta también a
otra action no compilable, se conserva para esa action. El fallback canónico,
por ser generado desde TODOS los `answer_shape` tipados, salta únicamente la
comparación léxica de overlap; sanitización, voz determinista, grounding,
calendario, claims de escritura y completitud siguen obligatorios. IR287/IR288
y M0M415–417; contrato `stored-plan-adoption-v41`; capture **767/767**,
mutaciones **417/417**, tsc/lint/diff limpios; PostgreSQL/migraciones sin cambio.

El re-audit v41 validó el compilador con 21/21 adversariales y obtuvo por
primera vez un turno 1 correcto —preguntó sólo la cuenta—, pero el turno 2
quedó detrás del espejo de autoridad de entidad. El payload ya contenía monto,
moneda, fijo y cuenta exactos; `validateFixedExpenseMovementLink`/los guards de
entidad volvían a buscar `Arriendo` sólo en «Desde mi cuenta Supervielle» e
ignoraban «acabo de pagar el arriendo», que pertenece a la raíz user-authored de
la MISMA operación durable. **v42** hace que toda elección resuelta entre peers
consuma la autoridad de entidad de la operación exacta. No es memoria global:
`entityAuthorityMessages` viene del snapshot durable de esa continuación. El
turno actual tiene precedencia; una mención explícita de otro peer refuta la
entidad vieja. En el vínculo de fijos, el matcher recibe mensajes del usuario +
el monto ya validado, nunca la descripción escrita por el modelo (se cerró de
paso una falsa autoridad latente en batches). IR289 + M0M418–421 prueban
herencia, aislamiento, corrección y consumo; contrato
`durable-entity-authority-v42`; capture **768/768**, mutaciones **421/421**,
PostgreSQL/migraciones sin cambio.

El re-audit v42 certificó esa clase con 13/13 adversariales y el transcript
exacto de Arriendo 6/6. La muestra completa cayó en ME4 antes de tocar esa
superficie: tres intentos del planner convirtieron contexto de procedencia en
una action income incompleta, luego en una action sin effects y finalmente en
un `log_movement` agrupado como si la identidad de la conversación fuera un
grupo de reemplazo. **v43** cierra la clase en el contrato de planificación, no
en el transcript. `atomic_group` queda reservado a dependencia transaccional;
continuar awaiting_input no significa corregir una operación completed; un
hecho usado como procedencia o ya asentado no autoriza otra escritura; y un
rechazo del validador obliga a reconsiderar si la action existe. Bounded repair
conserva las actions independientes válidas y deja sólo la identidad económica
no probada como missing `$response`; jamás inventa una pata o un undo para
apaciguar el schema. IR290 + M0M422–424 fijan las tres salidas observadas;
contrato `semantic-repair-v43`; capture **769/769**, mutaciones **424/424**,
sin migración ni escritura PostgreSQL.

El re-audit v43 encontró causalidad directa contra esa política: ME12c
interpretó correctamente un préstamo saliente de 25 USD, pero la instrucción
de repair le permitió abandonar la action inequívoca y transformar el error
interno de effects en un missing `$response`; ME4 agotó sus intentos en la
misma salida. **v44** centraliza la autoridad. Las razones del validador ya no
recomiendan borrar, preguntar o inventar undo; bounded repair recibe una scope
tipada (`action_payload`, `transaction_wiring`, `clarification_lifecycle` o
`general`) derivada sólo del error del servidor. Una reparación de payload no
puede crear un missing nuevo, salvo que el candidato rechazado ya hubiese
declarado exactamente esa ambigüedad de evidencia del usuario. Además todo
missing `$response` debe ligar key==ambiguity.field, reason concreto y ningún
target de action. Es una invariante estructural, no routing por frase o tool.
IR291 y M0M425–430 fijan la prohibición, su consumo y la libertad semántica simétrica;
contrato `repair-authority-v44`, sin migración.

### M0.11 — Autoridad semántica única y fluidez operacional

**Estado: A EN RE-AUDIT; 112–115 APLICADAS. B queda
pendiente.** La revisión real posterior a v44 encontró la clase que los 22
checks no medían: cuatro propuestas sensibles de la misma capability se
canibalizaban porque `agent_action_challenges_live_uq` sólo admite un pendiente
por conversación y la confirmación todavía se interpretaba con un vocabulario
cerrado. Cinco rondas previas habían mostrado la misma forma —el modelo entendía
y una segunda capa mecánica volvía a decidir significado—. M0.11 no agrega otro
caso: cambia la unidad de autoridad.

**M0.11A — quitar esposas sin quitar seguridad.** El planner es la única
autoridad sobre intención, referencia, confirmación, modificación y abandono.
Cada entrega declara una transición tipada, y PostgreSQL persiste su evento. El
servidor valida la estructura: el pending resuelto desaparece, un progreso
parcial reduce el conjunto, una confirmación no reescribe acciones y un
abandono realmente termina. Una primera respuesta insuficiente permite una
pregunta aclaratoria distinta; un segundo turno sin progreso sobre las mismas
keys queda prohibido aunque parafrasee la pregunta.

Cada acción monetaria declara procedencia por path: `user_stated` se liga a una
entrega durable exacta de esa operación; `stored_fact` a un verificador de fila
bajo lock; `derived` sólo puede entrar cuando exista la misma derivación
server-owned bajo lock y una política de drift. La primera procedencia stored
implementada es el monto nativo de un fijo estable. Las derivaciones masivas se
declaran en el protocolo pero fallan cerrado hasta M0.11B: no se confía en un
testigo escrito por el modelo.

La migración 112 crea un manifiesto durable por operación: acciones, argumentos,
provenance, dependencias, grupos atómicos, testigos, effects, postconditions y
estado final proyectado. Una operación ordinaria queda autorizada por su propia
instrucción; una destructiva/social requiere segunda entrega. La confirmación
natural autoriza por CAS el manifiesto exacto ya mostrado, sin volver a pedir al
modelo N payloads ni una frase literal. Después de ejecutar, PostgreSQL exige
igualdad exacta `autorizado = preparado = ejecutado`; una pata ausente o distinta
queda `failed_integrity`. El índice legacy se conserva durante la auditoría para
rollback/concurrencia, pero el camino manifest no crea challenges por tool.

La primera corrida PostgreSQL de la 112 fue **76/78** por dos defectos de
instrumento/observabilidad, no por una relajación del manifiesto. M112.2
consultaba la columna inexistente `agent_action_challenges.operation_id` en vez
de `originating_operation_id`. M112.5 demostró que una acción no ejecutada sí
terminaba en `failed_integrity`, pero la RPC llamaba `actual_count` a todas las
filas preparadas y devolvía un único mensaje de set mismatch aunque los sets
autorizado/preparado/coincidente fueran iguales. La **113 append-only** redefine
sólo esa RPC: `actual_count` pasa a ser alias compatible de `executed_count` y
el registro durable separa `authorized_count`, `prepared_count`,
`matching_count`, `executed_count`, `settled_count`, `verified_count` más un
`reason_code` preciso. La igualdad estricta no se afloja.

Claude aplicó y auditó la 113: PostgreSQL quedó **78/78×2**. La primera muestra
real de A no llegó a terminar por el límite de tiempo del cliente, pero sus 14
checks ya probaron una regresión severa de interfaz: el modelo debía adivinar
qué paths numéricos llevaban provenance, cómo ligar exactamente una transición
a `continuation_operation_id` y cuándo `authorization_prompt` era obligatorio.
No era falta de inteligencia ni un writer inseguro; eran contratos wire ocultos.

La reparación vigente no enumera frases ni casos financieros. La misma
ontología de dinero genera `monetaryProvenancePathTemplates` por capability y
valida los paths concretos indexados; un rechazo devuelve el set completo
esperado, faltante y sobrante. Lifecycle y segunda entrega exponen del mismo
modo sus tablas estructurales desde las funciones que luego validan. Fechas e
ids no adquieren provenance y la clase 552,77 permanece fail-closed. IR300–301
y M0M441–448 fijan ambas direcciones. El runner largo puede lanzarse como worker
desacoplado para que un timeout del auditor no mate ni repita una muestra.

IR292–IR302 fijan 1/4/20 acciones bajo una identidad, policy de confirmación,
progreso y anti-loop literal/parafraseado, procedencia contra la clase 552,77,
igualdad post-write, diagnósticos de integridad, contratos SQL, wire explícito,
las transiciones estructurales y propiedad única del receipt. M0M431–452
apagan uno por uno los antiguos reintérpretes léxicos, el registro ready-only,
la igualdad de counts, rollback del índice y anti-loop durable. La batería
PostgreSQL sube a 78 con M112.1–M112.5; el E2E de modelo sube a 24 con ME16
(referencia natural a cuatro obligaciones → cuatro pagos, una operación) y ME17
(una confirmación natural → un manifiesto sensible de cuatro acciones). Estas
pruebas convergen sobre estado PostgreSQL y preguntas, no sobre JSON o copy.

La auditoría posterior ejecutó por primera vez los 24 checks completos. Cerró
el doble receipt y todo el clúster de undo, pero ME16 probó que el registro
`stored_fact` sólo sabía certificar el importe de un gasto fijo: cuatro pagos
de tarjeta podían tener montos correctos en `full_payment_due` y aun así no
existía una procedencia legal que el modelo pudiera declarar. La reparación no
añade un caso lingüístico: `storedFactProvenanceContractsForPlanner` publica
por capability el mismo registro que deriva la autoridad exacta. Para
`register_card_payment.amount`, el executor relee
`debt_accounts:<id>:full_payment_due`, exige tarjeta vigente/no cubierta,
moneda nativa y mismo monto; la 107 conserva además su guard SQL bajo lock.
Otra tarjeta, corte cubierto, catálogo incompleto, `source_ref` distinto o cifra
contradicha fallan cerrado. IR303 y M0M453–456 fijan catálogo, compilación,
binding y consumo.

ME12 expuso una segunda frontera de interfaz: el modelo podía escoger
correctamente una lectura antes de actuar, pero un pase interno con pregunta
era rechazado sin una forma canónica enseñada. `READ_REPLAN_WIRE` se genera de
la misma función que lo compila: sólo una o más capabilities read-only ya
elegidas, `requires_replan_after_reads=true`, sin pregunta, autorización ni
contrato de respuesta. Una acción mutante, vacía o desconocida nunca se
normaliza. El E2E de paráfrasis reproduce el orquestador una vez con evidencia
tipada real y exige después el plan económico final; una lectura sola no cuenta
verde. Los errores de action id/capability/shape ahora nombran la ruta exacta.
IR304 y M0M457–459 fijan ambos lados. Esto cierra el patrón de wire oculto sin
convertir el planner en router.

El barrido final encontró otro contrato anunciado antes de existir: el parser
durable admite `derived` para la futura M0.11B, pero A no tiene todavía una
regla derivada que el servidor pueda recalcular bajo lock. El wire vivo se
genera ahora desde runtime y enumera sólo `user_stated|stored_fact`; `derived`
declara una lista de reglas vacía y cualquier candidato que lo use sigue
fallando cerrado. IR305 y M0M460–461 impiden que prompt, validador y autoridad
vuelvan a divergir.

La siguiente muestra congelada llegó a **22/24**. ME16 quedó verde: una
referencia natural al conjunto ejecutó cuatro pagos bajo un solo manifiesto.
ME17 encontró una asimetría posterior al planner: al guardar, el plan era
válido; después de un intento del executor, `agent_operations.missing_fields`
podía describir un rechazo runtime. El worker recuperaba el plan pero volvía a
validar ese pending mutable como si fuera una ambiguity original del modelo, y
una confirmación natural terminaba en `persisted_plan_invalid`. Los planes
nuevos llevan ahora un receipt server-owned del envelope raíz exacto que ya
cruzó `validatePlannedAgentRequest`. El receipt liga delivery, plan, lifecycle,
missing-fields del planner y pregunta mediante digest; recovery verifica esa
identidad y reanuda el envelope inmutable. No interpreta texto y un receipt
presente pero alterado falla cerrado. Sólo filas históricas pre-M0.11A conservan
el camino compatible sin receipt. IR306 y M0M462–463 fijan ambas direcciones.

El mismo ME17 destapó un writer anterior a A: las tarjetas estaban sin saldo
actual, con `full_payment_due=0` y `statement_covered=true`, pero la RPC de
cierre trataba `minimum_payment` y `statement_total_due` —snapshots históricos—
como deuda viva. La migración **114 está APLICADA (2026-08-13)**. El saldo current
original/base siempre bloquea; los importes históricos dejan de bloquear sólo
para una credit_card con ciclo cubierto y remanente vivo cero. Ciclo abierto,
due remanente o cualquier saldo actual siguen fail-closed. M114.1/2, IR308 y
M0M465 fijan esa frontera; PostgreSQL pasó **80/80×2**.

ME13 fue una falla semántica independiente: «recibí dinero relacionado con un
préstamo no registrado» se clasificó como retorno de capital aunque la misma
frase también cabe si el usuario recibió principal prestado. No se añadió regex
ni router. `loanRelationshipDirectionContractForPlanner` declara la invariante
contrafactual general: dirección de caja y dirección acreedor/deudor son hechos
independientes; si ambos mundos satisfacen la evidencia, el modelo pregunta
quién debía a quién y omite sólo esa pata. El servidor sigue verificando writer,
álgebra y procedencia después de la interpretación. IR307 y M0M464 fijan la
doctrina sin congelar una frase.

**M0.11B — superficie nueva, todavía pendiente.** Selectores y derivaciones
generales (`cuentas negativas`, `cuentas de Ecuador`, obligaciones de un período,
targets masivos), atributos de entidad como país/institución y coordinador de
ajustes. Usa los writers existentes, pero cada regla derivada necesita testigo,
lock, política de drift y proyección de estado final. A debe auditarse antes de
abrir B para que el loop real no espere detrás de semanas de selectores.

La 114 está aplicada y PostgreSQL pasó **80/80×2**. Su primera muestra completa
destapó una contradicción de contrato, no un caso de lenguaje: `paidInFull`
omite correctamente `arguments.amount` porque la base deriva el corte vivo,
pero provenance se calculaba sólo desde valores presentes en arguments. El
registro `stored_fact` ofrecía `register_card_payment.amount` y el validador lo
rechazaba como path desconocido. Prompt, compilador y runtime usan ahora el
mismo cálculo: paths monetarios presentes más paths server-materialized cuyo
verificador tipado aplica a la forma estructural. El full mantiene `amount`
fuera del payload y lo exige desde el corte; un parcial sigue ligado a la
entrega exacta del usuario; una autoridad ausente/equivocada falla cerrado.
IR309 cruza cada path monetario publicado por los schemas y cada regla
materializada, sin transcript ni frase; M0M466–469 impiden separar otra vez las
tres superficies.

La muestra posterior certificó esa forma `paidInFull`, pero movió el bloqueo a
publicación: ME3 produjo el plan correcto y el executor pidió correctamente la
cuenta de origen; el finalizador rechazó tres preguntas naturales porque no
compartían palabras con el resumen interno y terminó en HTTP 500. ME16 reveló
el espejo post-write: un manifiesto podía quedar completamente verificado y la
operación `failed_retriable` sólo porque falló la prosa; el retry exacto intentaba
comenzar otra vez un manifiesto ya verificado. No son dos casos financieros:
son una violación de la frontera conversación/ejecución.

La primera reparación anti-bot separó conversación de seguridad. Una pregunta
pura `needs_info` pertenece al modelo y no se valida por solapamiento léxico
con texto del executor. Si ya hubo escritura, la respuesta aún debe nombrar
cada pendiente verificado. Un circuito de continuidad evita silencio/500 y
persiste `publicationRecovery`, que el E2E cuenta como degradación, nunca como
verde. El handler tampoco abre el cerebro legacy ante un fallo.

La migración **115 está APLICADA (2026-08-14)**. Añade paridad SQL al
verificador app-side del corte vivo de tarjeta y permite reentrar un manifiesto
`verified` sólo cuando `allow_incomplete=false` y `verified_count` coincide con
todo el conjunto autorizado. Una verificación parcial sigue rehusada. M115.1 y
M115.2 elevan PostgreSQL a **82/82**; IR310/IR311 y M0M470–478 fijan libertad de
pregunta, no-ocultamiento post-write, continuidad observable y replay sin doble
ejecución.

El primer audit post-115 probó que la red de continuidad evitaba el daño visible
pero no cerraba A: **15/24**, con cinco de veinte turnos usando recovery. Dos
eran `planner exhausted its bounded read/replan passes`; tres no dejaban causa
legible. Los cinco se etiquetaban `model_unavailable` aunque el proveedor estaba
sano. Una respuesta genérica segura tampoco es producto: si el usuario no sabe
qué debe hacer, cuándo ocurrirá algo o qué parte se entendió, sigue siendo bot.

La auditoría siguiente probó que esa reducción todavía era nominal: la muestra
retrocedió a 12/24 porque el modelo seguía fabricando simultáneamente unas
cuarenta obligaciones internas —effects, provenance por path, ids, lifecycle,
missing targets, response wire, grupos, dependencias y postcondiciones—. La
causa dominante era reveladora: el modelo entendía un gasto pero omitía
`expense_recognition/increase`, una pata que el writer conoce por definición.
Seguir corrigiendo campos habría repetido las diez rondas aditivas anteriores.

**La frontera vigente es sustractiva y falsable.** El planner vivo devuelve
exactamente seis campos raíz: `goal`, `interpretation`, `relation`,
`execution_units`, `ambiguities`, `answer_needs`. Cada step devuelve sólo
`capability + arguments + evidence`; cada unidad expresa los steps que forman
una promesa todo-o-nada, su `expected_change` observable y una pregunta natural
de confirmación si la acción realmente es sensible. La evidencia es local al
step para que dos acciones con el mismo importe no puedan prestarse citas. No
emite action ids, effects, provenance, CAS, manifest,
hash, state witness, postconditions, dependencias, grupos, missing-fields,
response template ni operation wire.

Un único compilador server-side genera esas dimensiones mecánicas desde la
capability tipada, sus argumentos y el estado esperado que el modelo declaró.
También deriva las patas contables completas —incluida
`expense_recognition/increase`— y verifica que el resultado compilado coincida
con `expected_change`; una capability, entidad o dirección incorrecta no se
vuelve silenciosamente válida. Después ejecuta el mismo validador, preflight,
writer, lock y verificador de manifiesto auditados. El modelo conserva la
decisión de atomicidad agrupando steps dentro de una `execution_unit`; runtime
sólo materializa el wiring.

La única evidencia lingüística mecánicamente comprobable es una cita exacta que
el modelo eligió por significado. Runtime no busca números para decidir qué
quiso decir el usuario: liga la cita a la entrega durable actual o a exactamente
una entrega de autoridad de la operación. Sin cita no auto-promueve 552,77 ni
otra cifra contextual. Para hechos server-owned el modelo no declara
procedencia: runtime relee el catálogo/lock y construye el verificador.

El catálogo completo de capabilities permanece disponible, sin pre-router ni
filtro de relevancia, pero se movió al prefijo `system` estático antes de todo
dato del usuario. La API puede cachear ese prefijo; cada turno persiste
`promptTokens`, `cachedPromptTokens`, `completionTokens` y estimaciones de
caracteres estáticos/dinámicos. La reducción elimina además los reintentos que
antes pagaban otra entrada completa por un wire derivable.

El E2E conversacional dejó de importar `planKipuRequest` o asertar el envelope
privado. Conversa sólo por HTTP y verifica saldos, filas, estados, manifests,
preguntas y ausencia de residuo en PostgreSQL. Las paráfrasis son sondas, no un
catálogo. La convergencia exigida es de efecto económico observable y lifecycle,
no de JSON ni de copy.

El gate estructural mide la resta: raíz **6**, unidad **3**, step **3**, gasto
ordinario **12** obligaciones semánticas (límite 14). Si esos límites crecen,
la arquitectura falla aunque una muestra salga verde. El circuito de recovery
se conserva sólo como airbag: cualquier uso, vacío, error o jerga sigue rojo.
La ruta pública normaliza todo `ok:false` con causa tipada, pero A no cierra
hasta que la ruta normal llegue sin recovery ni intake failure.

**Criterio de cierre de A.** Capture, mutaciones, tsc, lint, build y PostgreSQL
**82/82×2** deben estar verdes sobre el sello. La única muestra pagada exige
**24/24**, ME16+ME17 juntos, cobertura completa y cero respuesta vacía, error,
jerga interna o `publicationRecovery`. El circuito breaker existe sólo para
seguridad operacional: cualquier uso bloquea release y obliga a corregir su
causa; jamás se maquilla como inteligencia exitosa. No se promete un retry en
N minutos porque A no tiene un worker durable con `next_attempt_at`; inventar
ese tiempo sería otro mensaje bot.

**Baseline de la pasada sustractiva:** capture **806/806**, mutaciones
**490/490**, build **36/36** y PostgreSQL **82/82×2**, con restauración byte a
byte. La telemetría real de tokens/cache se imprime en la muestra viva. Esta
pasada no modifica SQL; Claude debe repetir PostgreSQL 82/82×2 sobre el mismo
sello antes de gastar la única muestra 24/24.

El primer rojo detiene el muestreo y se diagnostica antes de repetir; nunca se
compra un verde repitiendo el mismo sello. El checkpoint de implementación y
las auditorías anteriores quedan como historia en
`docs/M0_IMPLEMENTATION_CHECKPOINT_2026-07-31.md`,
`docs/M0_EXTERNAL_AUDIT_2026-08-02.md` /
`docs/M0_CLAUDE_EXEC_AUDIT_2026-08-03.md` y
`docs/M0_CODEX_INTAKE_DIAGNOSTICS_V23_2026-08-09.md`.
El relevo vigente de A es
`docs/M0_11A_CODEX_SUBTRACTIVE_SEMANTIC_PLAN_2026-08-14.md`; los informes
anteriores quedan como historia de las fronteras reemplazadas.

Sello ejecutable v33 entregado a Claude (histórico):
`3ae423e7d170b70953bb3b7f24824885ef8694793693da9a280f32c0933d8b60`,
486 archivos según el comando canónico del protocolo congelado.

Sello ejecutable v34 entregado a Claude:
`3720105b69fdb5e021ab6d55a17c19e45ce8aaf3d972134c06c1b094324a6f68`,
486 archivos según el mismo comando.

Sello ejecutable v35 entregado a Claude:
`180b587094b7d643ccf39207e35594ec66718d00343c905fa55f697e745fc61e`,
486 archivos según el mismo comando.

Sello ejecutable v36 entregado a Claude:
`bd3f6b701eca88c056911ed223a73331ef88a4f2d1a0382c166693300db24501`,
486 archivos según el mismo comando.

Sello ejecutable v37 entregado a Claude:
`e82f01047ef69a29922424dd2d8e0dd66eb005c0314fe6fcd7a600e97cf90474`,
486 archivos según el mismo comando.

Sello ejecutable v38 entregado a Claude:
`314ac4f742dd9988fc22a8a3bf105adf14a032ee60b1760799d5631878d38d40`,
486 archivos según el mismo comando.

Sello ejecutable v39 entregado a Claude:
`f666273482ff7a0bad72662033d3563e4a4b59c0228bbc38d9833b5855a7cda0`,
486 archivos según el mismo comando.

Sello ejecutable v40 entregado a Claude:
`d4a7a2904546f13e55613b2238e8182acf330d6791a05def2bcdf2541ffde205`,
486 archivos según el mismo comando.

Sello ejecutable v41 entregado a Claude:
`8a725ad895a2c66362ed1c0f9e2aaf77bdae8036c03e073f05aec34146526cd0`,
486 archivos según el mismo comando.

Sello ejecutable v42 entregado a Claude:
`54b73ae62bbf53d574483571f4e569ce54ce3495d25acb6292a441d1af2bf837`,
486 archivos según el mismo comando.

Sello ejecutable v43 entregado a Claude:
`e9b4ad3f5d562e8a2f705d1063c9d938906438bd8f338e1ed2f9cea88b670fe9`,
486 archivos según el comando canónico. El detalle vive en
`docs/M0_CODEX_SEMANTIC_REPAIR_V43_2026-08-12.md`.

Sello ejecutable v44 entregado a Claude:
`131ce62746d4035c8137b1e387067a7291135852302d3828681fb9bdda94df0a`,
486 archivos según el comando canónico. El detalle vive en
`docs/M0_CODEX_REPAIR_AUTHORITY_V44_2026-08-12.md`.

**Orden de release OBLIGATORIO — las migraciones van primero.** Es el inverso de la
regla habitual del repo («migrar datos después del código que los lee»), porque
aquí el código nuevo LEE una columna nueva. Verificado por ejecución contra
producción el 2026-08-02: con la 100 sin aplicar, `readOpenOccurrences` y
`readPendingOccurrenceCount` devuelven `ok:false` —fail-closed correcto— porque
filtran `satisfied_fact_id`. Desplegar este árbol antes de aplicar la migración
deja el calendario ilegible, el notifier nocturno en 5xx y al agente sin
contexto de calendario. La 100–111 ya están aplicadas; la 109, la 110 y la 111
son además seguras ANTES del deploy del código que las usa (las RPC nuevas no
las llama ningún código desplegado y relajar `request_text` no cambia al
caller viejo), verificado antes de aplicarlas.
La secuencia actual es **capture y mutaciones del sello vigente → PostgreSQL
82/82×2 → build limpio → una muestra completa de
24 checks con handshake M0.11A sobre el árbol
sellado vigente (el primer rojo detiene el muestreo, se diagnostica una vez y
sólo un árbol NUEVO habilita otra muestra — así se quemaron los sellos v24
`cef2cae8…` (ME10a: recibo de lote sin montos) y v25 `9e1acc66…` (ME9: miss
del filtro presentado como ausencia), cada uno con su fix de clase) → informe
→ re-audit externo → commit/deploy**, nunca al revés.

### Condición de cierre de M0

M0 se declara cerrado únicamente cuando:

- la migración 100 final y todas sus sucesoras, incluida la 115,
  fueron aplicadas en orden y sondeadas; ninguna migración se aplica antes de
  que su preestado y orden de rollout estén verificados;
- toda la batería anterior termina completa, exit 0 y residuo cero;
- el transcript real del founder y sus paráfrasis pasan end-to-end;
- una ronda de auditoría externa sobre el árbol CONGELADO no encuentra P1/P2
  nuevos por ejecución;
- el founder revisa una muestra del chat real y no encuentra loops, preguntas
  repetidas, lenguaje de bot ni afirmaciones incompatibles con sus datos;
- producción sirve exactamente el commit auditado, sin errores nuevos, y se
  vuelve a verificar el estado financiero del founder.

La vara no es «el modelo nunca se equivoca» — promesa imposible. La vara es que
Kipu se comporte como un colaborador inteligente con acceso a la vida financiera
completa y que, cuando no sabe, investigue o pregunte sin poner el dinero en
riesgo.

### Fuera de alcance de M0

- UI/UX visual, navegación y animaciones: siguen en M.
- Conexión bancaria, monetización y WhatsApp.
- Reintroducir rutas por regex o scripts conversacionales.
- Dar SQL o service-role al modelo.
- Construir la parte de Bloque L que fue descartada por cero uso, salvo una
  capability necesaria para cumplir un caso general de M0.

---

## Bloque M — El front, completo

**Estado: BLOQUEADO por M0.** Prioridad final · el stage grande de cierre. Sólo
se activa cuando M0 cumple su condición de cierre.

Con el back sólido debajo: interfaz, UX, navegación, accesos, tableros, animaciones,
estructura. Se hace ENTERO, no a parches.

Entra aquí todo lo visual detectado hasta ahora, incluido el hallazgo de las
**puertas**: `/app/spending` (la única superficie que renderiza el objetivo del Bloque
H), `/app/debt` (todo el Bloque G + el plan de pago, con 22 deudas vivas) y
`/app/wealth` (la curva de patrimonio que el snapshot lleva meses juntando) tienen
CERO accesos alcanzables. Las páginas existen y están construidas contra el motor: lo
que falta es la puerta. El rediseño del Bloque D mató la grilla de métricas —
correctamente — y con ella las puertas que colgaban de ahí.

Restricción de diseño: no reintroducir la grilla de métricas ni los scores que el
Bloque D retiró a propósito.

**Bloque E, como estaba escrito en los docs viejos ("construir superficies
secundarias: Tu mes, Actividad, Metas, Deudas, Patrimonio, Gasto, FX"), NO es un
bloque**: las 7 superficies ya existen. Lo que falta es navegación, y vive aquí.

---

## Explícitamente NO ahora

- **Ingreso variable.** El beta es todo sueldo fijo (confirmado por el founder).
- **Cualquier trabajo visual antes del Bloque M.**
- **Monetización y conexión bancaria.** La captura manual es por diseño.

## Deuda de cobertura

H.44 y H.46 quedaron cubiertas en el cierre Pre-M. Su evidencia PostgreSQL de
096–099 sigue siendo 40/40 con exit 0 y residuo cero. La revisión posterior del
chat real encontró una deuda distinta —continuidad, planificación y comprensión
general del agente— que ahora bloquea M y se trabaja como M0; no invalida la
integridad monetaria probada por Pre-M.

Una deuda menor, declarada y diferida a propósito: en el barrido base-only, si no
existe cotización, la marca guarda `exchange_rate_to_base = 1` como **sentinel**
(la columna es NOT NULL CHECK > 0 y no hay forma de expresar «tasa no aplicada»).
Esa rama decide en unidades base y nunca multiplica por ese 1, así que no afecta
al dinero; debe representarse honestamente —columna nullable o flag— en la
próxima migración que toque `account_balance_reconciliation_applications`.
