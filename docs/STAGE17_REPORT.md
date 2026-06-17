# Stage 17 — Metas, Mini-Metas, Wealth Builder y Prioridades Financieras Humanas

**Informe de implementación · 2026-06-17**
Estado: **código completo** (gate determinista **95/95**, lint limpio, build verde, revisión adversarial de 5 dimensiones con verificación por hallazgo + correcciones aplicadas).
**No** commit, **no** push, **no** deploy. Migración `025_stage17_goals_wealth.sql` **creada pero NO aplicada**.

---

## 1. Resumen ejecutivo

Stage 17 convierte a Kipu en **el sistema personal del usuario para transformar dinero en objetivos de vida**: no un tracker de metas, no un budget, no un dashboard de patrimonio — un copiloto que entiende qué quiere el usuario, qué importa, qué puede esperar, qué nunca se sacrifica, qué es óptimo, qué es psicológicamente realista, y **cuánto y cuándo** puede destinar a cada objetivo sin romper sus pagos.

El caso central (la visión del fundador): el usuario quiere unos AirPods. Kipu le dice si le alcanza HOY (contra el gasto seguro timing-aware, no el saldo del banco) y, si comprarlos hoy lo dejaría apretado, los convierte en una **mini-meta**: *"aparta ~$25/sem y en 4 semanas los tienes sin tocar tu viaje a Brasil ni tu inversión ni tu tarjeta"*. Kipu deja vivir y darse gustos, con la tranquilidad de no sacrificar nada.

Principio: **"un genio adentro, simple afuera."** Adentro: portafolio de metas, motor de asignación con prioridades, costo de oportunidad, factibilidad, compuesto de inversiones, patrimonio neto. Afuera: **¿se puede? ¿qué afecta? mejor plan, aporte semanal, fecha.** Todo número viene del motor determinista; el LLM explica. Construido SOBRE los motores validados (Margen Kipu, cashflow Stage 15, deuda Stage 14) — los vuelve un **portafolio** sin tocar la matemática de dinero.

## 2. Análisis de producto / diferenciación

- **No es un tracker de metas:** los trackers solo miden progreso. Kipu **decide** cuánto puedes aportar sin romper tu cashflow, **prioriza** entre metas que compiten, y te dice **cuándo** puedes comprar algo con tranquilidad.
- **No es un budget:** no te pone límites por categoría; usa tu Margen/cashflow vivo para repartir tu sobrante con criterio humano.
- **No es un portfolio tracker:** integra patrimonio e inversiones DENTRO de tu vida financiera (cashflow, deuda, metas), no como un tablero aislado.
- **Por qué el usuario sigue volviendo:** Kipu resuelve el punto ciego real — la gente mira el saldo y cree que puede comprar, sin ver pagos futuros de tarjeta, gastos fijos, interés de deuda, timing del cashflow, compromisos de metas, fondo de emergencia ni suscripciones. Kipu quita ese punto ciego SIN fricción y **sin decir solo "no"**: dice "sí, en el momento correcto".
- **Math + comportamiento:** lo óptimo (mandar todo a la tarjeta de alto interés) es insostenible para un humano. Kipu mete el factor humano: protege mínimos, plantea un plan de deuda significativo, PERO deja un espacio de **gustos controlados** para que el usuario no abandone la app. Eso es justo donde las apps financieras fracasan.

**UX — cómo se mantiene cada promesa:** *genio adentro* (8 motores deterministas + orquestador); *simple afuera* (digest + tools instruyen "¿se puede? mejor plan, aporte, fecha", sin jerga ni listas); *sin culpa* (jamás "fracasaste"; gustos controlados preservados); *centrado en Margen/cashflow/gasto seguro* (las mini-metas y aportes se atan al gasto seguro real); *no es planilla* (el dashboard añade una sola tarjeta calmada).

## 3. Features extra propuestos y por qué

1. **Mini-metas para impulsos** (pedido del fundador): convertir una compra en un ahorro semanal cashflow-safe + fecha realista + celebración al lograrlo (dopamina sin deuda).
2. **Allocation engine humano-realista:** reparte el sobrante con tope a deuda (nunca 100%) y piso de gustos, para que el plan sea sostenible.
3. **Costo de oportunidad interno:** Kipu razona "si pones $25 en AirPods, eso baja tu margen y atrasa tu otra meta X semanas; si fuera a deuda, ahorrarías Y de interés" — y lo dice SIMPLE.
4. **Modo ambición** (light_touch / steady / power_builder): adapta cuán fuerte empuja metas vs preservar gustos — usuario simple vs power user.
5. **Compuesto de inversiones reusando interest-math:** pólizas/plazos fijos/DCA proyectados con la tasa que da el usuario, etiquetado estimado.
6. **Patrimonio neto + meta de patrimonio** (ej. "llegar a 500k") con aporte mensual requerido estimado.
7. **Detección de conflictos de metas** (demasiadas activas, aportes que exceden el sobrante, una mini que frena la principal) con propuestas (pausar/extender/reordenar).
8. **Fundación provider-agnóstica para portafolios externos** (eToro): tabla scaffold, sin sync ni secretos.

## 4. Features implementados vs diferidos

- **Implementados ahora (1–8):** todos, en su forma segura. eToro queda como **scaffold** (tabla `external_portfolio_connections`, sin sync).
- **Diferidos explícitamente:**
  - **Sync real de eToro / broker (API, OAuth, rate limits)** — superficie grande, sin payoff MVP, requiere credenciales/ToS verificados.
  - **Precios de mercado en vivo / cotizaciones** — dependencia externa + cron; el `expectedReturn` que da el usuario es honesto y suficiente.
  - **Modelado profundo de retiro/impuestos** — fuera de alcance LatAm-MVP; la proyección de tasa única basta.
  - **Flujo de onboarding-UI dedicado para metas/patrimonio** — el agente ya adapta simple vs power progresivamente (set_ambition_mode, create_goal, register_investment) y las prefs persisten; una pantalla dedicada se difiere.

## 5. Hallazgos de inspección del código actual (workflow `wix3vlc6q`)

- **El motor es single-goal en todas partes:** `ctx.mainGoal` es singular; `weeklyGoalContribution` (margen-kipu) y `plannedGoalContribution` (flexible-spending) son escalares; cada reserva consume ese escalar.
- `weekly_required_amount`/`monthly_required_amount` y `feasibility_status` se almacenan pero se **recomputan** en runtime (`buildGoalPlan`) — columnas efectivamente derivadas.
- El aporte planificado hoy ≈ `goal.weeklyRequiredAmount` (0 por defecto en onboarding) → las metas casi no reservan dinero hoy; solo `protectedGoalMoney` (currentAmount) se protege.
- `interest-math.ts` (monthlyRateDecimal, payoffProjection) es REUSABLE para el compuesto de inversiones; `cashflow-projection`/`cashflow-scenario`/`margen-kipu`/`flexible-spending`/`debt-health`/`debt-vs-investment`/`buildGoalPlan` están validados y se reusan tal cual.
- No existen tablas de assets/investments/mini-goals/net-worth → Stage 17 las crea (migración 025).
- El patrón del gate (`assert` + `stubBrief`) y `AgentContext.goals` (ya un array) son reusables.

## 6. Análisis de brechas

- **Reusar tal cual:** interest-math (compuesto), cashflow/calendar/scenario (sin cambios), margen reserve cascade, flexible-spending, debt-health, debt-vs-investment, buildGoalPlan (por meta), gate/stub.
- **Fortalecer (sin romper):** `ctx.mainGoal` singular → portafolio; el escalar de goal-reserve → suma de aportes comprometidos; feasibility por-meta → portafolio.
- **Construir nuevo:** portafolio multi-meta, mini-metas, allocation engine, costo de oportunidad, compuesto de inversiones, patrimonio neto, adherencia psicológica, orquestador, store, migración 025, tools, ambient, dashboard, gate.
- **Diferir:** eToro live, precios en vivo, retiro/impuestos, onboarding-UI.

## 7. Alcance exacto de implementación

8 módulos puros + orquestador + store + migración 025 (no aplicada) + `goalsIntel` en el briefing + feed del recarve a Margen/cashflow + 9 tools de agente + 5 temas ambient + superficie de dashboard + 16 aserciones de gate. **Fuera de alcance (respetado):** no Stage 18; no segundo concepto de usuario; no commit/push/deploy; no aplicar 025; eToro solo scaffold.

## 8. Archivos cambiados

**Nuevos (11):** `src/lib/financial/`{`goal-portfolio.ts`, `allocation-engine.ts`, `mini-goal.ts`, `opportunity-cost.ts`, `investment-math.ts`, `net-worth.ts`, `psychological-adherence.ts`, `goals-intelligence.ts`, `goals-wealth-store.ts`}; `supabase/sql/025_stage17_goals_wealth.sql`; `docs/STAGE17_REPORT.md`.
**Modificados (6):** `src/types/financial.ts` (campos additivos de meta + enums), `src/lib/financial/coaching-signals.ts` (recarve + `goalsIntel` + digest), `src/lib/ai/agent/kipu-agent-tools.ts` (9 tools), `src/lib/ai/agent/kipu-agent.ts` (emptyBriefing + prompt METAS + lista de tools), `src/lib/ambient/ambient-decision.ts` (5 temas), `src/app/dev/capture-test/page.tsx` (16 aserciones + stub `goalsIntel`), `docs/BUILD_PROGRESS.md`.

## 9. Migraciones creadas

**`supabase/sql/025_stage17_goals_wealth.sql`** (aditiva, **NO aplicada**):
- **`goals` +=** `goal_type`, `archetype`, `parent_goal_id` (→ mini-metas), `is_primary`, `priority`, `cadence`, `contribution_amount` (reserva comprometida), `cashflow_protected`, `flexible_deadline`, `can_pause`, `contribution_model`, `investment_eligible`; índice `(user_id, parent_goal_id)`.
- **`user_financial_preferences` +=** `ambition_mode`, `risk_tolerance`, `emergency_reserve_target`, `investment_horizon`, `investment_readiness`, `wealth_target`.
- **Tablas nuevas:** `investment_accounts`, `recurring_investment_plans`, `goal_allocation_revisions` (audit, sin UPDATE = inmutable), `net_worth_snapshots`, `external_portfolio_connections` (scaffold).
- **Seguridad:** todas additivas; columnas nullable/defaulted → filas y comportamiento single-goal intactos; columnas text (no enums) para mantener additividad; RLS habilitada en cada tabla nueva, **sin políticas de cliente → deny por defecto**, grant a `service_role` (los handlers de canal corren sin sesión); el audit table sin UPDATE.

## 10. Cambios en el modelo de datos

Aditivos (ver §9). Derivado (no se almacena): contribución requerida por meta, feasibility, el `AllocationPlan` (se recomputa cada turno; la tabla de revisiones es solo auditoría), patrimonio neto (snapshots solo para tendencia). En memoria: `GoalPortfolio`, `AllocationPlan`, `InvestmentInput`, `NetWorthResult`, `MiniGoalPlan`, `GoalsIntelligence`, y `CoachingBriefing.goalsIntel` (additivo).

## 11. Modelo de meta

`FinancialGoal` extendido additivamente: `goalType` (primary/mini/milestone), `archetype` (savings/travel/purchase/emergency/debt_payoff/investment/wealth/family/lifestyle/custom), `parentGoalId`, `isPrimary`, `priority`, `cadence`, `contributionAmount` (la reserva comprometida), `cashflowProtected`, `flexibleDeadline`, `canPause`, `contributionModel`, `investmentEligible`. `goal-portfolio.ts` arma el portafolio: llama `buildGoalPlan` por meta (reuso), asigna prioridad efectiva, elige la principal (una mini NUNCA es principal), suma los aportes comprometidos y detecta conflictos.

## 12. Modelo de mini-meta

`mini-goal.ts`: `evaluatePurchase(price, safeToday, safeThisWeek, joyBudget, cardDueSoon, runwayOk)` decide **comprar hoy** (cabe en el gasto seguro de hoy, sin presión de tarjeta/runway), **mini-meta** (cabe en la semana pero hoy aprieta, o no cabe) o **esperar** (sin margen libre). `planMiniGoal(price, discretionaryWeekly)` calcula un aporte semanal desde el presupuesto de gustos (deja 30% de gustos aun ahorrando), `weeks = ceil(price/weekly)` y fecha. Una mini-meta creada obtiene `cadence: weekly` + `contributionAmount` → reserva ese semanal (recarve) y se celebra al completarse.

## 13. Motor de prioridad / asignación

`allocation-engine.ts` reparte el **sobrante libre semanal** (ya neto de esenciales, fijos, programados, mínimos de deuda, ahorro e inversión): (1) top-up de fondo de emergencia si está bajo objetivo; (2) abono **extra** a deuda de alto interés, TOPEADO (nunca 100%); (3) metas por prioridad, cada una al GAP de financiamiento (requerido − comprometido), sin re-sugerir lo comprometido; (4) **piso de gustos preservado** (20–50% según modo ambición). Salida = split de suma cero de `availableWeekly`.

## 14. Priorización humano-realista

El motor jamás manda el 100% del sobrante a deuda: aunque lo eficiente sería eso, deja un espacio de gustos controlados para que el plan sea sostenible (la regla `JOY_FLOOR_PCT` + `DEBT_EXTRA_CAP_PCT`). `psychological-adherence.ts` decide si una mini-meta es elegible (hay discrecional, <4 metas, deuda no crítica), el quotient de gustos por modo, y el `slipRisk` (plan demasiado ajustado → así se abandona → afloja). Permite gusto controlado incluso con deuda, salvo semana totalmente rota.

## 15. Lógica de costo de oportunidad

`opportunity-cost.ts`: para "agregar $X/sem a la meta A" calcula reducción de gustos (= el monto), cuánto **adelanta** la meta financiada, cuánto **atrasa** la meta competidora, y el **interés de deuda evitado** si fuera a la tarjeta — con un veredicto (worth_it/balanced/reconsider). Interno; el agente lo dice SIMPLE ("comprarlo hoy te baja el margen; en mini-meta no toca nada").

## 16. Lógica de factibilidad de metas

Por meta vía `buildGoalPlan` (reuso, sin cambios): estados on_track/tight/at_risk/not_realistic/blocked_by_debt_or_margin + aporte requerido semanal/mensual + brecha de capacidad. El portafolio lo corre por cada meta; `goal-portfolio` agrega conflictos a nivel cartera (deadline imposible, aportes > sobrante, mini que frena la principal).

## 17. Integración goal-aware con cashflow / Margen

Los aportes COMPROMETIDOS (metas activas + cashflow-protected con cadencia+monto) se suman en `committedGoalReserveWeekly` y se alimentan al ÚNICO escalar `weeklyGoalContribution` que ya consumen `calculateMargenKipu` y `buildFinancialCalendar` — **recarve de suma cero que reemplaza** el escalar legacy. Pre-migración (sin comprometidos) cae al valor legacy → sin regresión. El `goalsIntel` (portafolio + allocation + patrimonio + costo de oportunidad + digest) es un campo additivo del briefing; la allocation/audit se recomputa cada turno y NUNCA se relee hacia Margen.

## 18. Autopilot de metas en Telegram

5 temas sobre el bucle de Stage 13 (quiet hours / pausa / max-por-día / idempotencia intactos): `mini_goal_ready` (celebración money-positive, prioritaria, light-mode OK), `goal_milestone` (mitad de la meta), `goal_off_track` (principal en riesgo → ajustar, sin perderla), `too_many_goals` (conflicto → enfocar/pausar), `allocation_opportunity` (sobrante libre → aporte chico OPCIONAL, sin presión). Guardados para usuarios sin metas; uno por corrida, redactado por IA, jamás shaming.

## 19. Tools de chat añadidos o cambiados

9 nuevos: `evaluate_purchase_as_goal` (la compra impulse-safe — comprar hoy / mini-meta / esperar), `create_goal`, `create_mini_goal`, `prioritize_goals`, `update_goal` (pausar/reactivar/repriorizar/reprogramar/hacer principal), `register_investment`, `net_worth`, `set_wealth_target`, `set_ambition_mode`. Cada uno devuelve un hecho estructurado SIMPLE con guía de voz; las escrituras pasan por el store tipado y marcan `ctx.dirty` para refrescar en el mismo turno.

## 20. Enfoque de onboarding adaptativo

Scaffolded: las prefs `ambition_mode`/`risk_tolerance`/`emergency_reserve_target`/`investment_horizon`/`wealth_target` persisten (025), y el agente pregunta progresivamente (set_ambition_mode, create_goal, register_investment) — usuario simple recibe lo mínimo; power user puede dar todo. Un flujo de onboarding-UI dedicado se difiere (el agente ya adapta).

## 21. Modelo de inversión / activos

`investment_accounts` (manual primero): name, asset_class (cash/investment/fixed_term/crypto/property/vehicle/business/receivable/other), value_base, currency, liquid, include_in_net_worth, expected_return_pct, return_kind, compounding, cost_basis, valuation_date, valuation_confidence, linked_goal_id. `register_investment` usa SOLO lo que da el usuario; sin rendimiento informado, cuenta para patrimonio pero no proyecta crecimiento. Jamás inventa valores/precios/rendimientos ni recomienda un activo específico.

## 22. Lógica de compuesto / interés

`investment-math.ts` reusa `monthlyRateDecimal` (Stage 14): proyecta mes a mes acreditando interés en el límite de capitalización (mensual/trimestral/anual) y sumando aportes recurrentes — **compuesto, no simple**. Sin tasa → valor plano + `hasRate=false` (honesto). Ej.: póliza 5% anual cap. mensual sobre 5000 → ~5256 en 12 meses. `receivableProjection` para préstamos a favor con interés. Todo etiquetado ESTIMADO.

## 23. Lógica de patrimonio neto / meta de patrimonio

`net-worth.ts`: activos − deuda, separado en líquido/invertido/otros, **sin doble conteo** de inversiones líquidas (cada activo cuenta una vez). Meta de patrimonio: progreso % + aporte mensual requerido (búsqueda binaria con la tasa del usuario) + meses proyectados al ritmo actual — **mismo modelo de tasa** en ambos (corregido en revisión, ver §28). Sin precisión falsa; estimado.

## 24. Fundación de portafolio externo / eToro

Solo **scaffold provider-agnóstico**: tabla `external_portfolio_connections` (provider/status), sin sync, sin secretos, sin llamadas a API no oficiales, sin scraping, sin valores en tiempo real, sin afirmar que un bróker está conectado. La integración real de eToro queda diferida hasta tener API oficial, auth, permisos y credenciales verificadas.

## 25. Cambios de dashboard

`/app/reality` ganó una sección "Metas y patrimonio" sin clutter: presupuesto de gustos semanal, progreso de la meta principal, mini-metas listas (celebración) / activas, y patrimonio neto + % de la meta de patrimonio. Todo con guards (no renderiza nada en estado vacío). Sin tablero complejo.

## 26. Guardrails de seguridad

Nunca: fabrica rendimientos/valores/precios; recomienda un activo específico; dice que un bróker está conectado (eToro = scaffold); sugiere saltarse un mínimo de tarjeta/deuda por una meta; manda 100% del sobrante a deuda (piso de gustos + indulgencia controlada incluso con deuda); cuenta un aporte a meta/inversión como gasto; duplica aporte vs transferencia vs reserva (recarve único; audit nunca releído); promete proyecciones de largo plazo sin etiquetar estimado; expone JSON/IDs/etiquetas internas. Toda escritura pasa por ejecutor tipado.

## 27. Observabilidad

`goal_allocation_revisions` (audit inmutable: por qué se recomendó un aporte), `net_worth_snapshots` (tendencia), las `conflicts` del portafolio con `note`, el `digest` estructurado inspeccionable, las `facts` del ambient con su `reason`. El `slipRisk`/`miniGoalEligible`/`allocation.rationale` explican por qué Kipu propuso (o no) una mini-meta. No se loguea detalle financiero sensible innecesario.

## 28. Resultados de pruebas

- **Gate determinista: 95/95** (16 aserciones Stage 17, #80–#95): portafolio (principal correcta/mini nunca principal, recarve = aportes comprometidos), allocation (nunca 100% a deuda + piso de gustos + no re-sugiere comprometido), compra (comprar/mini/esperar), planificador de mini-meta, compuesto de inversión, patrimonio + meta, costo de oportunidad, adherencia, orquestador (recarve + digest no-doble-conteo), fallback vacío, ambient mini-goal-ready, conflictos, + **3 regresiones de correcciones de revisión** (guard NaN, consistencia de tasa, guard mini-meta /0).
- **Lint limpio. Build verde.**

## 29. Resultados de calidad de conversación

Revisión adversarial (dimensión conversation-leakage) confirmó: el digest queda interno; el system prompt + sanitizeAgentReply impiden fuga de internals; el prompt METAS es "simple afuera" (¿se puede? mejor plan, aporte, fecha) y sin culpa. Correcciones de voz aplicadas: `mini_goal_ready` madurado (sin "dopamina"/exclamaciones de marketing) y `allocation_opportunity` reformulado como OPCIÓN (no "mantener viva la meta"). Hallazgo aceptado/diferido: los `summary` de TODOS los tools (patrón transversal Stage 14–17) llevan guía de tono para el agente — el sanitizador + prompt lo mantienen fuera del texto del usuario; un split facts/summary repo-wide se difiere (fuera de alcance + riesgo de regresión).

## 30. Escenarios de pre-mortem (60) y resultados

1. Usuario nuevo sin metas → portafolio vacío; digest invita a crear; sin nudge. ✅
2. Una meta principal → buildGoalPlan; recarve = su aporte comprometido (0 si no fijó cadencia). ✅
3. Múltiples metas → portafolio prioriza; principal protegida. ✅
4. Principal + una mini → mini nunca es principal; ambas en cartera. ✅
5. AirPods con tarjeta por vencer → cardPressure → mini-meta. ✅
6. AirPods con cashflow seguro → buy_today + ofrece mini igual. ✅
7. AirPods que haría resbalar la principal → mini-meta desde gustos (no toca principal). ✅
8. AirPods con deuda de alto interés → gusto controlado vía mini-meta, mínimos protegidos. ✅
9. $15k de tarjeta + meta de viaje → allocation deja espacio de gustos; no niega el viaje, lo prioriza realista. ✅
10. Gusto controlado pagando deuda → permitido (allowControlledJoy) salvo semana rota. ✅
11. "Todo el sobrante a deuda" → respeta intención pero el motor preserva piso (el agente puede subir power_builder). ✅
12. Invertir mensual con deuda de tarjeta → compare_debt_vs_investment + opportunity cost; nunca saltar mínimos. ✅
13. Fondo de emergencia bajo objetivo → reserve top-up FIRST en la allocation. ✅
14. Fondo lleno → sin top-up; sobrante a metas/gustos. ✅
15. Viaje a Brasil como principal → create_goal isPrimary; feasibility + aporte requerido. ✅
16. Laptop en 3 meses → create_goal con fecha; requerido semanal. ✅
17. Meta de patrimonio 500k → set_wealth_target; progreso + aporte mensual estimado. ✅
18. Cuenta de inversión manual → register_investment; entra a patrimonio. ✅
19. Póliza 5% anual cap. mensual → investment-math proyecta (~5256/12m); etiquetado estimado. ✅
20. Préstamo a favor con interés → receivableProjection. ✅
21. Propiedad → asset_class property, otros activos en patrimonio. ✅
22. Carro → asset_class vehicle. ✅
23. Negocio (equity) → asset_class business (invertido). ✅
24. Acciones/ETF manuales → register_investment; nunca recomienda activos. ✅
25. "Conecta eToro" → scaffold; Kipu dice que aún no hay sync, no finge conexión. ✅
26. "Valor en tiempo real sin conexión" → honesto: solo lo que registró el usuario; no inventa. ✅
27. "¿deuda o inversión o meta?" → compare_debt_vs_investment + prioritize_goals. ✅
28. "¿qué meta priorizo?" → prioritize_goals (orden + reparto). ✅
29. "¿cuándo puedo comprar esto?" → evaluate_purchase_as_goal (fecha de mini-meta). ✅
30. "¿puedo comprarlo hoy?" → buy_today vs mini vs esperar. ✅
31. "crea mini-meta" → create_mini_goal (eligibilidad chequeada). ✅
32. Aporte no realizado → la meta sigue viva; el plan se recalcula; no shaming. ✅
33. Mini-meta completada → ambient mini_goal_ready celebra. ✅
34. Pausar meta principal → update_goal status paused; su reserva se libera. ✅
35. Pausar mini-meta → update_goal; libera su semanal. ✅
36. Demasiadas metas activas → conflicto too_many_active; propone enfocar/pausar. ✅
37. Deadline imposible → status not_realistic; conflicto deadline_unrealistic; extender. ✅
38. Deadline flexible → flexibleDeadline; meta sin fecha fija manejada. ✅
39. Baja de ingreso → menos sobrante → allocation reduce aportes, preserva gustos/mínimos. ✅
40. Sube ingreso → más sobrante → más a metas, gustos intactos. ✅
41. Cashflow cambia tras importar estado de cuenta → recarve y feasibility se recomputan al refrescar. ✅
42. Pico de gasto reduce sobrante → menos para metas; mini-meta puede no ser elegible. ✅
43. Cambia supuesto de rendimiento → proyección recalculada; estimada. ✅
44. Cambia valor de activo → update; patrimonio recalculado. ✅
45. Onboarding simple → mínimo; el agente no abruma. ✅
46. Onboarding power → puede dar metas/inversiones/patrimonio/ambición. ✅
47. Usuario sin conocimiento de inversión → sin rendimiento → no proyecta crecimiento, honesto. ✅
48. Usuario con detalle avanzado → register_investment con tasa/kind/compounding. ✅
49. Usuario cuestiona la recomendación → tradeoffs explicados simples; ajustable (ambición/aporte). ✅
50. Usuario se siente restringido y quiere irse → piso de gustos + gusto controlado = plan sostenible. ✅
51. Recordatorio Telegram de mini-meta → allocation_opportunity opcional, sin presión. ✅
52. Celebración Telegram de meta lista → mini_goal_ready, madura, sin exagerar. ✅
53. Cron duplicado → idempotencia Stage 13 intacta (sin doble envío). ✅
54. Proyección de largo plazo → estimada y etiquetada; sin precisión falsa. ✅
55. Garantía exacta pedida → Kipu aclara que son estimados, no garantías. ✅
56. Activo en moneda extranjera → value_base en base; no inventa FX (límite del motor). ✅
57. Aporte a meta ya registrado como transacción → goal_contribution excluido de gasto; recarve no lo duplica. ✅
58. Aporte a inversión ya registrado → no se cuenta doble (patrimonio vs aporte). ✅
59. Compra de meta completada → mini-meta marcada lista; no reserva y gasta lo mismo. ✅
60. "¿por qué no puedo comprar esto hoy?" → evaluate_purchase_as_goal explica el motivo (tarjeta/runway) + ofrece mini-meta. ✅

**Resultado:** los 60 quedan cubiertos por diseño determinista + guías de voz + guardrails; los que tocaban math/seguridad están respaldados por aserciones de gate (#80–#95). Tres bugs (NaN, consistencia de tasa, mini-meta /0) fueron descubiertos por la revisión adversarial y corregidos con regresiones.

## 31. Limitaciones conocidas (aceptadas)

- **eToro/broker live, precios en vivo, retiro/impuestos, onboarding-UI dedicado:** diferidos.
- **FX:** valores en base; activos en otra moneda sin tasa confiable pueden subrepresentar (límite del motor).
- **`current_amount` vs balance de cuenta-meta:** el modelo de contribución (`contribution_model`) existe pero la reconciliación profunda cuenta-meta ↔ current_amount es básica (notional por defecto).
- **`summary` de tools con guía de tono:** patrón transversal; el sanitizador lo mantiene fuera del usuario; split facts/summary diferido.
- **Adaptive onboarding:** vía agente + prefs, sin pantalla dedicada.

## 32. GO / NO-GO de Stage 17

- **¿Código completo?** **SÍ.** 8 motores + orquestador + store + integración + 9 tools + 5 ambient + dashboard; gate **95/95**, lint limpio, build verde, revisión adversarial aplicada.
- **¿Listo para producción tras migración + rollout?** **SÍ, condicionado** a: (1) aplicar migración 025, (2) commit + push + deploy, (3) smoke en usuario desechable. Hasta entonces producción **no cambia** (degradación elegante).
- **¿Bloqueantes?** Ninguno técnico. El único gate es la **aprobación explícita** para aplicar 025 y desplegar.
- **¿Limitaciones aceptadas?** Las de §31; ninguna afecta seguridad ni corrección.
- **¿Autorización necesaria?** Aprobar: **aplicar 025 + commit + push + deploy + smoke**.

**Veredicto: GO para rollout, sujeto a tu autorización explícita.**

## 33. Plan de migración / despliegue

1. **Aplicar** `supabase/sql/025_stage17_goals_wealth.sql` y verificar: columnas additivas en `goals` y `user_financial_preferences`; tablas `investment_accounts`/`recurring_investment_plans`/`goal_allocation_revisions`/`net_worth_snapshots`/`external_portfolio_connections` con RLS ON, 0 políticas de cliente (deny), grants `service_role` (audit sin UPDATE).
2. `npm run lint` + `npm run build` (verdes localmente) y `/dev/capture-test` → **95/95**.
3. **Commit** (sugerido: *"Stage 17 — Goals, Mini-Goals & Wealth Builder"*) + **push** a main.
4. Esperar Vercel **READY**; **smoke** en usuario desechable: crear meta principal + una mini-meta ("AirPods"), "¿puedo comprar X hoy?" (comprar vs mini), prioritize_goals, register_investment (póliza 5%), net_worth + set_wealth_target, set_ambition_mode, y verificar que el recarve reserva el aporte comprometido y que un mini-goal listo dispara el ambiente; sin doble conteo.
5. **Limpiar** todo el dato desechable; verificar DB a estado limpio.

## 34. Próximo paso exacto que requiere tu autorización

**Detenido aquí**, como se indicó — implementado, verificado y reportado. Para avanzar necesito tu **aprobación explícita** de una opción:
- **(A) Rollout completo:** aplicar migración 025 → commit → push → deploy → smoke en usuario desechable → limpieza → reporte GO/NO-GO. *(Recomendado.)*
- **(B) Solo aplicar 025** ahora y dejar el código para un rollout posterior.
- **(C) Solo commitear** el código (sin aplicar 025 ni desplegar) — funciona con degradación elegante hasta aplicar 025.

No haré commit, push, deploy, ni aplicaré 025, ni comenzaré Stage 18, hasta que indiques cuál opción autorizas.
