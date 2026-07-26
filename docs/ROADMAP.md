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

**Estado: EN CURSO (desde 2026-07-19)** · Prioridad 1 · Módulo grande

Abrir el chat REAL del founder en la beta y revisarlo mensaje por mensaje: ¿cada
respuesta tiene sentido? El founder ya tiene errores mapeados que se revisan aquí.
Objetivo: dejar el agente pulido, sin errores.

El bloque tiene DOS mitades y solo una es código:

### Mapa J-1…J-7 (orden ORIGINAL del founder — ésta es la lista autoritativa)

La numeración se me había corrido en sesión: lo que cerré como «J-3» es en
realidad **J-5**. Queda fijada acá para que no vuelva a pasar.

| # | Qué es | Estado |
|---|---|---|
| **J-1** | La moneda manda la cuenta (Error 1) | **CERRADO** · migraciones 066–074, 8 re-auditorías |
| **J-2** | «No era X, era Y» = corrección, jamás gasto nuevo (Error 2) | **CERRADO** · `correctivePhrasing` + `movementCorrectionTargets` + interlock legacy |
| **J-3** | «Ya la pagué» del onboarding significa CUBIERTA (Error 3) | **CERRADO** · predicado `cardStatementSettled` cableado en las 3 superficies |
| **J-4** | Un digest, no una ametralladora (Error 4) | **PENDIENTE ← siguiente** |
| **J-5** | Responder por chat CIERRA la pregunta (Error 5) | **CERRADO** · migración 075 (lo que llamé «J-3») |
| **J-6** | Barrido de vocabulario retirado (H2) | PENDIENTE |
| **J-7** | Harness de observación + 3 barridos + persona desechable E2E | PENDIENTE |

**Deuda que arrastra J-5 y hay que saldar dentro de J-3 o J-4:** los 3 avisos
`card_statement` del founder siguen `pending` con `ask_count = 3` — nadie los va
a volver a preguntar y la 075 no los resucita. La limpieza de datos y la higiene
de ciclo (una ocurrencia superada por un `statement_date` más nuevo se
auto-descarta) estaban en el plan de J-5 y quedaron sin hacer.

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

Prioridad 3

Los fijos de monto variable (luz, gas, internet) ya están marcados `is_variable` y
Kipu pregunta el monto cada mes. Pero con `scope='from_now'`, `updatePlanAmount`
**sobrescribe** el plan con el monto de ese mes: no promedia, no mira el histórico.

El histórico SÍ existe — cada ocurrencia pagada queda en el ledger etiquetada con su
`recurring_expense_id`. Kipu tiene la historia de la luz y nunca la abre. Efecto para
el usuario: si julio vino con pico de aire acondicionado, reserva ese pico todo el
invierno y su Saldo se ve más bajo de lo que es.

Esto rompe la promesa que el producto ya hace por escrito
(`docs/FOUNDER_BETA_GUIDE.md`: "los presupuestos por categoría se refinan con el
uso").

## Bloque L — Compartidos y reembolsos

Prioridad BAJA · nicho

Datos de producción al 2026-07-16: **0** gastos compartidos, **0** reembolsos, **0**
hogares, **0** préstamos — y 21 de las 115 tools del agente ya están construidas para
esto. Está sobreconstruido para uso cero. Se evalúa después del front.

Único fail-safe barato que vale antes: `record_person_payment` tiene `category` sin
enum y default `other`, así que un refund se salta en silencio el restore del tanque
Y el neteo del objetivo.

## Bloque M — El front, completo

Prioridad final · el stage grande de cierre

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

## Deuda de cobertura que se arrastra (no son defectos)

- H.44 prueba el predicado y el finalizador por separado, no `buildCoachingBriefing`
  con un fallo de lectura inyectado.
- H.46 prueba los textos degradados de cuotas, no los executors completos.

Ambas necesitan sesión + DB. El vehículo existe: el patrón de usuario disposable de
`scripts/qa/`.
