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
