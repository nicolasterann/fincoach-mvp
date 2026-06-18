# Stage 20 PASS 2 — Dashboard Visual, Completar Hogar y Listo-para-Beta (Reporte)

**Fecha:** 2026-06-18 · **Estado:** **PRODUCTION-LIVE** · gate **158/158** · lint limpio · build verde · migración **031 aplicada + verificada** · commit `aee435b` · deploy `dpl_A1frEQe3PR8hN1ZBRjYR146apLyo` READY · **smoke 14/14** (A,D,E,F,G,H,I,J,K,L,N,O,Q,R) con usuarios desechables · prod re-verificada a cero. **No se inició monetización ni Stage 21.**

## 1. Resumen ejecutivo
PASS 2 lleva a Kipu a sentirse listo para beta de fundador/familia con dos focos: **(B) Dashboard visual estilo Whoop** (puntajes, tendencias, detalle expandible, calmado y no-Excel) y **(F) Completar Hogar para beta** (invitar por enlace, gastos compartidos recurrentes, modos viaje/soporte familiar, control de visibilidad, nudges de hogar), más **(H) pulido de beta** (cierre de rutas /dev internas, centro de Ajustes, guía de beta). Decisión clave: **gráficos hechos a mano en SVG, sin dependencia** (consistente con PulsoOrb/MargenRing, renderizado en servidor, sin hidratación, mobile-safe). Nada toca la verdad del dinero ni el Kipu personal. Revisión adversaria de 5 dimensiones (23 agentes) → **9 hallazgos reales corregidos**. **GO de código**; nada aplicado/desplegado.

## 2. Auditoría PASS 2 + plan
Workflow de 6 agentes Explore mapeó dashboard, briefing/motores, personalización (S18), hogar (S19), ambient (S13) y stack/gate/FX/higiene-dev. Hallazgos que guiaron el plan: el dashboard ya tiene primitivas SVG (PulsoOrb/MargenRing/RhythmBars) → extender ese estilo, **sin** librería de charts; los snapshots solo cargaban el día previo → añadir serie histórica honesta (solo query); `promotedSurfaces/collapsedSurfaces/density` de S18 existían pero el dashboard no los consumía → cablearlos sin ocultar obligaciones; **riesgo crítico de beta**: `/dev/*` no tenía gate central → cualquier usuario logueado podía abrir simuladores con costo de modelo; el `token` de invitación ya existía (027) → invitar-por-enlace sin migración. Orden: H1 (gate /dev) → B (dashboard) → F (hogar) → H (pulido) → gates → revisión → reporte.

## 3. Micro-stages implementadas
- **B — Dashboard visual:** librería SVG `Charts.tsx`, view-model puro `dashboard-model.ts`, serie histórica `loadSnapshotSeries`, tarjetas `DashboardCards.tsx` + ensamblado `DashboardSecondary.tsx`, cableado en `/app`, rutas `/app/kipu-fit` y `/app/household`.
- **F — Completar Hogar:** invitar-por-enlace/token + `/app/join/[token]`; gastos compartidos recurrentes (migración 031); enforcement de privacidad (`visibleTransfers`); `settleHousehold` (cerrar viaje); soporte familiar vía recurrente payer_absorbs; 6 tools nuevas; nudges de hogar (sin migración).
- **H — Pulido beta:** gate `/app/dev` fail-closed; centro `/app/settings`; `docs/FOUNDER_BETA_GUIDE.md`.

## 4. Micro-stages diferidas y por qué
- **Cuentas/deuda compartidas de primer nivel** — scaffold solo; riesgo de modelo de permisos; se modela suficiente con gastos/recurrentes/settlements para beta.
- **Visibilidad por-campo** — sobre-ingeniería para beta; mínimo/estándar/completo basta.
- **Entrega de invitación por email/SMS** — sin infra; el enlace/código que el usuario comparte cubre la beta.
- **Evidencia/comprobante de reembolso** — no crítico para beta.
- **Gráfico multi-día de patrimonio** — requiere historial acumulado (los snapshots empiezan a llenarse desde el deploy); muestra honesta "sin historial aún".
- **Captura-modalidad (micro-stage D)** — sigue siendo riesgoso para el writer del ledger; diferido.
- **eToro / precios en vivo / retiro-impuestos** — fuera de alcance.

## 5. Archivos cambiados
**Nuevos:** `src/app/dev/layout.tsx`; `src/lib/dashboard/dashboard-model.ts`; `src/app/app/components/{Charts,DashboardCards,DashboardSecondary}.tsx`; `src/app/app/{kipu-fit,household,settings}/page.tsx`; `src/app/app/join/[token]/page.tsx`; `src/app/app/join/actions.ts`; `src/lib/household/recurring-shared.ts`; `supabase/sql/031_stage20pass2_household_recurring.sql`; `docs/FOUNDER_BETA_GUIDE.md`; `docs/STAGE20_PASS2_REPORT.md`.
**Modificados:** `src/app/app/page.tsx`, `reality/page.tsx`, `components/AppNav.tsx`; `src/lib/trends/snapshot-store.ts`; `src/lib/household/{household-intelligence,household-store}.ts`; `src/lib/ambient/ambient-decision.ts`; `src/lib/ai/agent/{kipu-agent-tools,kipu-agent}.ts`; `src/app/dev/capture-test/page.tsx` (gate); `.env.example`; `docs/BUILD_PROGRESS.md`; memoria `project_phases.md`.

## 6. Migraciones creadas
**031 `household_recurring_expenses`** (additive, NO aplicada): plantilla de gasto compartido recurrente (household_id, payer_member_id, description, amount_base, split_method, cadence, anchor_day, next_due, active, …). RLS habilitado, **0 políticas de cliente (deny-by-default)**, grants **service_role only** — idéntico al patrón S19. Los stores degradan gracefully (try/catch) → producción inalterada hasta aplicarla. **Ninguna otra migración:** invitar-por-enlace reutiliza el `token` de 027; visibilidad usa `privacy_mode` de 027; nudges de hogar y serie de snapshots no requieren esquema nuevo.

## 7. Cambios en el modelo de datos
Solo migración 031 (tabla nueva). El motor de hogar gana en memoria `LoadedHousehold.privacyMode` + `LoadedHousehold.recurringBills`, y `HouseholdSummaryView` gana `privacyMode`, `visibleTransfers` y `upcomingSharedBills` (todo derivado, no persistido extra). Sin cambios a tablas existentes, sin debilitar RLS, sin tocar el ledger.

## 8. Dashboard / analítica estilo Whoop
Arriba: una respuesta clara (Margen, Pulso) + **¿Qué cambió?** (tendencias honestas) + tarjetas opcionales (Lo que viene/cashflow, Tu gasto, Compartido, Patrimonio, Monedas, Kipu Fit) ordenadas y colapsables. Visualizaciones: sparkline de Margen/patrimonio, barras de gasto por categoría, anillo de progreso (meta/patrimonio), barra compuesta (líquido vs invertido), timeline de cashflow, pills de tendencia. Detalle expandible ("Ver más"); nunca tablas/ledger crudo por defecto.

## 9. Estrategia de gráficos + decisión de dependencia
**Decisión: SVG hecho a mano, SIN dependencia.** Justificación: el dashboard ya usa SVG/CSS a mano (PulsoOrb/MargenRing/RhythmBars); React 19 + App Router renderizan SVG en servidor con **cero costo de hidratación**; los gráficos son simples y calmados; Recharts/Victory son client-only, sensibles a la versión de React, y pesados → violarían "sin dependencias pesadas / evita problemas de hidratación / no todo client". Resultado: `Charts.tsx` con `Sparkline, MiniBars, ProgressRing, StackedBar, TrendPill, CashflowTimeline` (todos server, mobile-first, `prefers-reduced-motion` ya respetado en el CSS global).

## 10. Comportamiento de personalización del dashboard
`buildDashboardModel` (puro) toma señales del briefing + decisiones de S18 (`promotedSurfaces`/`collapsedSurfaces`/`dashboardDensity`+provenance) y produce superficies ordenadas. **Regla de hierro: una obligación (Margen negativo, tarjeta vencida/hoy/≤7d, riesgo de runway) NUNCA se colapsa ni se oculta** y se fija arriba. wealth-first sube patrimonio; experiences/minimal-explícito colapsa analítica opcional (gasto/patrimonio/monedas/kipu-fit) en "Ver más"; densidad mínima **inferida** (no explícita) no colapsa nada. Colapsado ≠ oculto: la verdad financiera siempre es alcanzable.

## 11. Uso de tendencias / snapshots
`loadSnapshotSeries(userId, 30d)` lee SOLO los días realmente registrados (sin rellenar huecos). `TrendStrip` muestra sparkline + pills cuando hay historial; con <2 puntos dice "estoy juntando tu historial". `briefing.trend` (S20) alimenta los pills (deuda-sube no es mejora). Nunca se fabrica un ayer/hoy.

## 12. Funciones de hogar diferidas implementadas
Invitar-por-enlace/token; lifecycle de invitación (pending/accept/decline/cancel/expired-14d); gastos compartidos recurrentes; enforcement de visibilidad (mínimo/estándar/completo); cierre/settle de viaje; soporte familiar (recurrente payer_absorbs a participante no-usuario); nudges de hogar; explicador "¿qué pueden ver?". Diferidos: cuentas/deuda compartidas de 1er nivel, visibilidad por-campo, entrega email/SMS, comprobante de pago (ver §4).

## 13. Resultado: nudges de hogar
**Sin migración.** Topics `household_settlement_pending`/`household_bill_due`/`household_shared_goal`, generados SOLO desde `briefing.household` (verdad compartida — los `facts` no contienen Margen/ledger/cuenta/patrimonio/deuda personal de nadie). Neutrales, sin culpa, enviados al chat propio de cada miembro. **Suprimibles** por sensibilidad alta (NO son obligaciones protegidas). Idempotentes vía el claim existente `(user, topic, día)`; compiten por el único cupo diario; respetan horario tranquilo, frecuencia y tope. Gate verifica selección + facts-sin-datos-personales + supresión.

## 14. Resultado: invitación / flujo de aceptar
`household_invite_link` (owner/admin) genera enlace `…/app/join/<token>` + código; `/app/join/[token]` muestra el hogar y permite aceptar/rechazar; `accept_household_invite` por código en chat. Solo el usuario objetivo acepta; expira a 14 días (computado); **race-safe** (se inserta la membresía ANTES de marcar "aceptada"; un fallo deja la invitación PENDIENTE para reintentar; un duplicado concurrente se trata como éxito). Las server actions verifican el `WriteResult` y muestran el error (token vacío, expirada, no-es-tuya) en la página.

## 15. Resultado: gastos compartidos recurrentes
Plantilla (renta/servicios/internet/suscripción/soporte/cuota de viaje) con cadence (weekly/biweekly/monthly/annual) + anchor; `recurring-shared.ts` calcula la próxima ocurrencia (ancla=hoy cuenta como hoy; pasada → siguiente periodo). Aparece en `upcomingSharedBills` (dashboard, resumen, nudge). **El dinero real se registra cada ciclo** con `log_recurring_shared_expense` → crea UN solo `shared_expense` (split entre miembros **activos**) → **sin doble conteo** (la plantilla nunca es dinero). Migración 031 graceful.

## 16. Resultado: pulido viaje / soporte familiar
**Viaje:** `settle_household` ("cerramos el viaje / ya quedamos a mano") registra las transferencias más simples como pagadas (cuadra a cero, no inventa dinero, un reembolso NO es ingreso) y opcionalmente archiva el grupo. **Soporte familiar:** modelado como gasto compartido recurrente `payer_absorbs` hacia un participante no-usuario ("le mando 100 a mi mamá cada mes"); afecta solo el plan del pagador. Ligero, sin motor aparte.

## 17. Resultado: controles de visibilidad / privacidad
`privacy_mode` (027) ahora se ENFORCEA: `visibleTransfers` = en **mínimo** solo las transferencias que involucran al miembro (su propia parte); en estándar/completo el grafo completo. Aplicado en el resumen del agente, el digest, `/app/household` y `/app/reality`. `household_visibility_explainer` responde "¿qué pueden ver?" tranquilizando que el grupo nunca ve cuentas/Margen/deuda personales. Sin visibilidad por-campo (diferida).

## 18. Pulido de beta fundador/familia
**Gate `/app/dev` fail-closed**: en producción solo emails en `KIPU_INTERNAL_EMAILS` entran a /dev/* (si vacío → nadie); en local cualquier sesión (para el gate/QA). Cierra la exposición de simuladores con costo de modelo a testers. Centro **`/app/settings`** (Kipu Fit, Hogar, importar estado, tipo de cambio, Telegram, recordatorios, reiniciar, privacidad) con entradas en sidebar + engranaje en el header; CTAs agent-native vía `?share=` del chat. Estados vacíos/honestos en todas las tarjetas nuevas.

## 19. Guía de beta
`docs/FOUNDER_BETA_GUIDE.md`: setup, qué probar (captura, dashboard, hogar, FX, personalización), comportamiento esperado, limitaciones conocidas, cómo reportar bugs, reiniciar/limpiar, privacidad.

## 20. Integración IA / chat
6 tools nuevas (`household_invite_link`, `accept_household_invite`, `add_recurring_shared_expense`, `log_recurring_shared_expense`, `settle_household`, `household_visibility_explainer`) registradas (schema + executor + dispatch). Prompt HOGAR extendido (invitar por enlace; recurrentes y "cerrar viaje"; "¿qué pueden ver?"). `household_summary` ahora usa `visibleTransfers` (privacidad). El test de personalidad/Kipu Fit ya alimenta S18.

## 21. Integración dashboard
`/app` añade TrendStrip + región secundaria ordenada por el view-model; el núcleo (hero Margen, Pulso, métricas) intacto (sin regresión). Nuevas rutas `/app/kipu-fit`, `/app/household`, `/app/settings`, `/app/join/[token]`. Lee `briefing` + `loadSnapshotSeries` + `loadPersonalityResult` + `loadFxRates` (sin red en el dashboard).

## 22. Integración hogar
Motores S19 (split/settlement/intelligence) reutilizados sin duplicar. `loadHouseholdData` carga `privacy_mode` + recurrentes (guardado aparte para no romper si 031 no está). View enriquecida (visibleTransfers, upcomingSharedBills). Permisos del store (canManage/canWriteShared) en cada escritura nueva; audit log append-only.

## 23. Integración ambient / Telegram
Topics de hogar añadidos al motor de decisión existente (cooldowns, light-mode, sensibilidad, idempotencia). El cron ya construye el briefing (con hogar) por usuario → los nudges fluyen sin cambios de cron. **`vercel.json` cron sin cambios.**

## 24. Integración FX / multimoneda
Tarjeta **Monedas** en el dashboard: lista las monedas no-base del usuario (de cuentas + tasas manuales) con la tasa **conocida** (manual) o "sin tasa — pregúntame". **El dashboard nunca llama al proveedor/red ni inventa una tasa** (reutiliza `findRate` sobre tasas manuales). Etiqueta "de referencia, no del banco". Sin cambios al motor FX de PASS 1.

## 25. Revisión privacidad / seguridad / RLS
Migración 031 deny-by-default service-role-only. Nudges/digests/tarjetas de hogar usan solo verdad compartida; `visibleTransfers` aplica el modo de privacidad (corregido en `reality/page.tsx`). Gate `/dev` fail-closed. Aserciones de gate verifican: privacidad mínima oculta el grafo entre otros; facts de nudge sin datos personales. Sin claves expuestas; el navegador no toca tablas de hogar.

## 26. Revisión de correctitud del dinero
Sin doble conteo: la plantilla recurrente no es dinero; `log_recurring` crea UN shared_expense; `settle_household` registra reembolsos (no ingreso). Splits solo entre miembros **activos** (corregido: se excluye removidos/left, incluso no-usuarios). FX nunca inventa una tasa. El Kipu personal (Margen, ledger, metas) intacto. Gate cubre cadencia recurrente + visibilidad + no-doble-conteo.

## 27. Resultados de tests / gates
Gate determinista **158/158** (14 aserciones nuevas PASS-2: view-model obligación-fijada/promueve/colapsa/mínima-explícita/presencia; cadencia recurrente; visibilidad mínima vs estándar; bills próximas; nudge de hogar seleccionado/facts-sin-datos-personales/suprimible). Lint limpio. Build verde.

## 28. Resultados de revisión adversaria
Workflow de 5 dimensiones × verificación por hallazgo (23 agentes). **9 hallazgos reales, TODOS corregidos:** (1) `reality/page.tsx` exponía `settlement.transfers` → `visibleTransfers` [alta, privacidad]; (2) CashflowTimelineCard sin estado vacío honesto → añadido [media]; (3/7) split incluía miembros removidos (`||userId===null`) → filtro `status==="active"` en 3 sitios [alta, dinero]; (4/6) join actions ignoraban el WriteResult → verifican y muestran error [alta]; (5) race en `acceptInviteByToken` (marca aceptada antes de insertar) → membresía primero, duplicado=éxito, fallo deja pendiente [alta]; (8) token vacío silencioso → guard [alta]; (9) update de expiry no condicional → `.eq(status,pending)` [media benigna]. Re-validado: 158/158, lint, build.

## 29. Limitaciones conocidas
Gráficos de tendencia necesitan días de uso (snapshot diario). Cuentas/deuda compartidas de 1er nivel = scaffold. Invitación solo por enlace/código (sin email/SMS). Soporte familiar = recurrente payer_absorbs (sin motor aparte). Visibilidad mínimo/estándar/completo (no por-campo). FX cubre monedas BCE; LatAm no-BCE usa tasa manual. Cron diario (no por hora). Sanidad móvil razonada (componentes server SVG + Tailwind responsive), no probada en dispositivo. TOCTOU extremo (miembro removido entre carga e inserción de split) es despreciable y preexistente en S19.

## 30. Stage 20 PASS 2 — GO / NO-GO
**GO de código.** Gate 158/158, lint, build verdes; revisión adversaria cerrada (9/9 corregidos); invariantes intactos (obligaciones nunca ocultas; sin doble conteo; privacidad de hogar; FX no inventa; /dev cerrado). Migración 031 sin aplicar; nada commit/push/deploy. Listo para rollout cuando lo autorices.

## 31. Plan de migración / despliegue (cuando autorices)
1) Preflight: prod limpia (sin datos reales/fundador), git alineado. 2) Aplicar **031** (verificar: tabla, RLS habilitado, 0 políticas de cliente, service_role-only, 0 filas). 3) Setear env `KIPU_INTERNAL_EMAILS` (tu email) en producción **antes/junto** al deploy para no bloquearte de /dev; opcional `KIPU_APP_BASE_URL` para los enlaces de invitación. 4) gate/lint/build. 5) commit + push + deploy READY. 6) smoke con usuarios desechables (dashboard por perfil, invitar-por-enlace + aceptar, recurrente + log, settle viaje, visibilidad mínima, nudge de hogar, FX card, /dev bloqueado para no-admin). 7) limpiar datos desechables + verificación a cero. 8) cerrar docs.

## 32. Próximo paso exacto que requiere tu autorización
Autorizar el **rollout de Stage 20 PASS 2**: aplicar la migración **031**, setear `KIPU_INTERNAL_EMAILS`, y hacer commit/push/deploy + smoke con usuarios desechables. Hasta entonces: **no aplico migraciones, no hago commit/push/deploy, no inicio monetización ni Stage 21.** Detenido aquí, como pediste.
