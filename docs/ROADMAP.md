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

**Estado: EN RE-AUDITORÍA (2026-07-17)** · Prioridad 1

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

Prioridad 2 · Módulo grande

Abrir el chat REAL del founder en la beta y revisarlo mensaje por mensaje: ¿cada
respuesta tiene sentido? El founder ya tiene errores mapeados que se revisan aquí.
Objetivo: dejar el agente pulido, sin errores.

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
