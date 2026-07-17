# Stage 21 — Mega-Revisión Pre-Beta, QA de Producto y Validación Adversaria (Reporte)

> **NOTA HISTÓRICA (añadida 2026-07-16).** Este documento quedó congelado el
> 2026-06-18, y su tiempo verbal es de entonces. Lo que dice abajo — "**sin commit /
> push / deploy**", "los fixes están implementados pero NO commiteados" (§42.2),
> "Próximo paso (con tu autorización): desplegar los fixes de Stage 21" (§43) — **ya
> se cumplió ese mismo día**: los fixes se commitearon y desplegaron en `d869bc3`
> ("chore: finalize stage 21 pre-beta hardening", 2026-06-18), están en `main` y
> llevan un mes en producción. Sigue siendo cierto que Stage 21 **no creó ninguna
> migración**. **Nada de este documento espera tu autorización.** La beta founder/
> familia corrió, y su feedback movió el producto: Stages 22–38 y los Bloques A–H
> (ver `docs/BUILD_PROGRESS.md`).
>
> **Los enlaces a `docs/FOUNDER_BETA_PACKAGE.md` (§13 y §§35–39) están muertos:** ese
> archivo se creó en Stage 21 —por eso §13 lo lista como nuevo— y se borró el
> 2026-07-16, porque describía el onboarding por chat, que ya no existe. Su sucesor
> vivo es [`docs/FOUNDER_BETA_GUIDE.md`](./FOUNDER_BETA_GUIDE.md) (v2, producto
> actual): los scripts de Milena / mamá / primo y la plantilla de reporte de bug que
> este reporte referencia sobrevivieron ahí, no aquí.
>
> Otras dos cosas que envejecieron: el **Margen Kipu** que auditan §10 y §42.1 dejó
> de ser el héroe — el Bloque D lo reemplazó por el **Saldo Kipu** y `/app/margen` es
> hoy un redirect (la semántica `horizonDays` que quedó como P2 murió con él); y el
> gate creció desde estas 158 aserciones — el conteo vigente vive en
> [`docs/BUILD_PROGRESS.md`](./BUILD_PROGRESS.md), no aquí. El cuerpo se conserva tal
> cual: es el registro de la revisión que dio el GO a la beta. El orden de trabajo
> vigente es [`docs/ROADMAP.md`](./ROADMAP.md).

**Fecha:** 2026-06-18 · **Estado:** revisión completa + fixes aplicados · gate **158/158** · lint limpio · build verde · **sin commit / push / deploy / migración**. **No se inició monetización, market research ni Stage 22.**

## 1. Resumen ejecutivo
Se sometió a Kipu a una cuádruple revisión antes de la beta con el fundador/familia. Un workflow de **143 agentes** (2 mapas + 15 módulos + 9 dimensiones, cada uno con pase técnico y pase lógico/consumidor, + verificación adversaria) produjo **392 hallazgos → 93 verificados → 80 confirmados** (6 P0, ~50 P1). Tras triaje crítico, varias "P0" resultaron **falsas alarmas** (modelos `gpt-5.4` reales y funcionando en prod; `create_account` líquido por diseño) o **ya corregidas en PASS 2**; las **bugs genuinas se arreglaron**. Luego se ejecutaron **personas + red-team con IA real** (33 conversaciones contra usuarios desechables): el agente respondió de forma consumer-grade y **todos los ataques de privacidad/honestidad/prompt fueron contenidos**. **Veredicto: GO** para la beta fundador/familia.

## 2. Metodología
Fases: (0) mapa de producto técnico + lógico; (1-2) revisión por módulo y por dimensión (dos pases) + verificación adversaria de cada P0/P1; (3) fix pass 1; (4-5) personas + red-team con IA REAL (ruta dev temporal, usuarios desechables en la DB de prod, limpiados); (6) pulido consumidor; (7) regresión; (8) paquete de beta. Multi-agente (Ultracode), datos desechables, sin tocar datos reales.

## 3. El sistema de dos pases
Cada fase corrió **separada**: un pase **técnico** (ingeniero/QA/seguridad/confiabilidad: bugs, cálculos, RLS, doble-conteo, fabricación, estados vacíos, tipos, regresión) y un pase **lógico/consumidor** (PM/UX/copywriter/finanzas-conductuales/usuario-escéptico/revisor-Apple: ¿natural? ¿humano? ¿calmado? ¿CTA claro? ¿lo entiende Milena/la mamá/el primo? ¿se siente sin terminar/forzado/robótico/que juzga?). Nunca se colapsaron; el reporte separa hallazgos técnicos y de consumidor.

## 4. Mapa de producto
**Técnico:** 18 rutas /app + 14 /dev (gated), agente con ~81 tools, capture multimodal → ledger atómico idempotente, motores deterministas (Margen, cashflow, calendario, debt-health, interés, spending intel, goals/wealth, personalización, FX, trends, household), briefing único (buildCoachingBriefing) que alimenta dashboard + chat + ambient, 31 migraciones aplicadas, gate 158. **Lógico:** journeys (onboarding → captura → "¿cuánto puedo gastar?" → metas → hogar), promesas implícitas (verdad del dinero, simple afuera, privacidad, sin juicio, gasto seguro honesto). Momento de valor central: "una respuesta clara primero".

## 5. Agentes por módulo — hallazgos técnicos
15 módulos revisados. Destacados reales: onboarding (ingreso name-only→0 corrompe Margen — **P0, arreglado**), login (redirige a /dev/supabase-test — **arreglado**; sin mostrar error — **arreglado**), falta error boundary en /app (**arreglado**), debt due-day sin clamp (**P2 diferido** — el revisor lo graduó P1, pero el verificador/triaje lo bajó a P2: es un detalle cosmético del conteo de días en la página de deuda, no afecta la verdad del dinero ni rompe un flujo, y no bloquea la beta), household payer sin validar membresía (P2 diferido, bajo riesgo porque el resolver del agente solo devuelve miembros del mismo hogar), recurring/settle ya excluyen miembros inactivos (PASS 2). Falsas alarmas: `gpt-5.4` (modelo real en prod), create_account (líquido por diseño; inversiones van por register_investment).

## 6. Agentes por módulo — hallazgos lógicos/consumidor
Login con marca **"FinCoach MVP"** (off-brand) + typos ("para entro", "Míno") — **arreglado a Kipu**. Tono de Margen negativo y de pago-hoy ligeramente impositivo/ambiguo — **suavizado** (mecanismo + colaboración; "acuérdate de hacer el pago"). Settings prometía "borrar tu información" sin tool de borrado total — **copy corregido a honesto**. El test de personalidad post-onboarding y la prominencia de joy-floor en /goals quedaron como P2 (mejora, no bloqueante).

## 7. Hallazgos transversales — técnicos
Money-correctness: el RPC del ledger ya valida `goal_contribution` (source+goal, sin deuda); sin doble-conteo personal/compartido (PASS 2); FX nunca inventa. Privacy/security: RLS deny-by-default, /dev fail-closed, sin exposición de IDs/JSON (confirmado en red-team). No-fabricación: trends honestos, FX honesto. Regresión: gate 158/158 intacto.

## 8. Hallazgos transversales — lógicos/consumidor
Coherencia de producto fuerte: una respuesta clara primero, detalle expandible. Riesgo de consumidor: "Margen 0$" antes de registrar liquidez puede desanimar — **mitigado** porque /app redirige a onboarding si no hay cuentas (un usuario real onboardea primero). Lenguaje calmado y on-brand confirmado en vivo.

## 9. Matriz consolidada de hallazgos
Hay DOS conjuntos distintos; no hay que confundirlos:

**(a) Pool crudo — 392 hallazgos** tal como los graduaron los revisores de módulo/dimensión (antes de verificar):
- P0 = 3 · P1 = 62 · P2 = 193 · P3 = 121 · accepted = 13 · **suma = 392**.

**(b) Tras triaje adversario — 80 confirmados reales/accionables.** De los 392, los **93** marcados P0/P1/"must-fix-before-beta" pasaron a verificación adversaria; **80** se confirmaron como reales (los demás fueron falsa-alarma o ya-resueltos). Al re-graduarlos, esos **80** quedan:
- **P0 = 6 · P1 = 50 · P2 = 23 · P3 = 1 · suma = 80**.

Las cifras grandes 193/121/13 pertenecen al **pool crudo (a)**, NO a los 80 confirmados. Dentro de los 80 confirmados, la mayoría P2/P3 son pulido de copy o mejoras post-beta no bloqueantes. (Nota: de los 6 P0 confirmados por el verificador, 3 fueron luego **descartados** en mi triaje propio —2× `gpt-5.4` y `create_account`— por conocimiento del entorno real; ver §10.)

## 10. Clasificación P0/P1/P2/P3
- **P0 (6 confirmados por el verificador), resueltos así en triaje:**
  - **Arreglados (reales):** income name-only→0 (corrompía Margen); login sin error visible.
  - **Diferido a P2 (real pero no bloqueante):** semántica `horizonDays` de Margen (margenDaily = libre/horizonDays vs /(horizonDays+1)) — desvía ~un día el "ritmo diario" sugerido, pero el safe-spend AUTORITATIVO es el motor cashflow timing-aware; tocar `margen-kipu.ts` justo antes de la beta es riesgoso → se valida post-beta.
  - **Descartados (3, falsa-alarma/sobredimensionados):** 2× `gpt-5.4` (es el modelo real y funcionando en prod, comprobado en las conversaciones en vivo) y `create_account` (crea solo cuentas líquidas por diseño; las inversiones van por `register_investment`).
- **P1 altos arreglados:** login redirigía a `/dev/supabase-test` → ahora `/app` + `/onboarding`; marca/typos del login → **Kipu**; error boundary `/app`; tono Margen-negativo/pago-hoy; settings copy honesto; Margen ignora ingreso con monto 0.
- **P1 verificados como ya-resueltos / por-diseño / aceptados:** miembros inactivos en splits (PASS 2), goal RPC (valida), deriveSeedStage (label), tokens de invitación en claro (link-credential, 14d), open-label invite (por diseño tipo link de grupo), cron diario (limitación Hobby documentada).
- **P2/P3 (23 P2 + 1 P3, diferidos/documentados):** semántica `horizonDays` de Margen (bajada de P0, ver arriba); debt due-day sin clamp; validación de membresía del payer en recurrente (bajo riesgo); copy fino de runway/anomalías; indicador de confianza en el hero; loading skeletons (SSR ya rápido); eliminar dead code `linkTransactionToSharedExpense`. Ninguno bloquea la beta.

## 11. Fixes implementados
1. `login/actions.ts`: signIn → `/app`, signUp → `/onboarding` (era `/dev/supabase-test`). 2. `login/page.tsx`: marca **Kipu**, typos corregidos, **async + muestra errores** humanizados. 3. `app/error.tsx` (NUEVO): error boundary calmado para /app/*. 4. `margen-kipu.ts`: **ignora ingresos con monto ≤0** (no ancla un sueldo falso). 5. `onboarding/save-actions.ts`: una fuente de ingreso solo se persiste con monto. 6. `settings/page.tsx`: copy de reinicio honesto (no promete borrado total). 7. `page.tsx`: tono de Margen negativo (mecanismo + colaboración). 8. `app-dashboard-helpers.ts`: pago cercano deja claro "acuérdate de hacer el pago".

## 12. Fixes diferidos (con justificación)
Tono fino de runway/anomalías (P2 copy), indicador de confianza en el hero (P2), loading skeletons (SSR ya rápido; bajo valor), hashear tokens de invitación (requiere migración; link-credential aceptable para beta), borrado total de datos in-app (feature nueva; en beta se hace por panel de DB), eliminar dead code, semántica horizonDays Margen-vs-cashflow (riesgoso de tocar pre-beta; el cashflow timing-aware es el seguro). Sin scope creep, sin features nuevas grandes.

## 13. Archivos cambiados
`src/app/login/actions.ts`, `src/app/login/page.tsx`, `src/app/app/error.tsx` (nuevo), `src/lib/financial/margen-kipu.ts`, `src/app/onboarding/save-actions.ts`, `src/app/app/settings/page.tsx`, `src/app/app/page.tsx`, `src/app/app/components/app-dashboard-helpers.ts`, `docs/FOUNDER_BETA_PACKAGE.md` (nuevo), `docs/STAGE21_REPORT.md` (nuevo).

## 14. Migraciones creadas
**Ninguna.** No se aplicó ni creó migración.

## 15. Cambios en el modelo de datos
**Ninguno.**

## 16. Estado final módulo por módulo
Onboarding ✅ (fix ingreso). Chat/agente ✅ (excelente en vivo). Captura/ledger ✅. Statement import ✅ (date-aware; mejoras P2). Debt/card ✅. Cashflow/Margen/Pulso ✅ (honesto con baja confianza). Budget/category/merchant ✅. Goals/mini-goals/wealth ✅. Personalización/personalidad ✅. FX ✅ (honesto). Trends/snapshots ✅. Dashboard/UX ✅ (+ error boundary). Household ✅ (privacidad confirmada). Ambient/Telegram ✅ (cron diario aceptado). Settings/privacidad/reset ✅ (copy honesto).

## 17. Money correctness
Sin doble-conteo (personal/compartido, recurrente=1 evento). FX nunca inventa (confirmado en vivo). Deuda en dirección correcta; pago de tarjeta = baja deuda, no gasto. Ledger RPC valida goal_contribution. Ingreso 0 ya no corrompe el horizonte de Margen. Safe-spend honesto con confianza baja cuando falta ingreso.

## 18. Privacidad/seguridad
RLS deny-by-default; /dev fail-closed (307→/login en prod). **Red-team en vivo: el agente rechazó** ver datos de la pareja, JSON crudo, IDs internos, listar tools internas, e "ignora la privacidad". Hogar solo expone lo compartido (visibleTransfers respeta modo).

## 19. Lenguaje/tono de IA
On-brand, cálido sin ser falso, directo sin ser duro, calmado en estrés de dinero. Hace **una** pregunta útil cuando falta info. Sin JSON/enums/IDs en respuestas. Español LatAm natural. (Confirmado en 33 conversaciones reales.)

## 20. No-fabricación/honestidad
"No tengo una tasa guardada, ¿a cuánto la tomas?"; "no la voy a inventar"; "no te lo puedo decir exacto, sería estimada"; caveats de baja confianza cuando falta ingreso. Honestidad sólida.

## 21. Dashboard/UX
Margen/Pulso/¿qué cambió?/tarjetas; obligaciones nunca ocultas; estados vacíos honestos; **nuevo error boundary** evita pantalla blanca. /app redirige a onboarding si falta setup (evita Margen 0 confuso).

## 22. Hogar
Crear/ invitar-por-enlace/ dividir/ ¿quién debe a quién?/ visibilidad — todo claro y neutral en vivo. Privacidad confirmada. Recurrentes/settle/family-support OK.

## 23. Onboarding/personalidad
Conversacional, cálido, una pregunta a la vez; fix de ingreso name-only. Test de personalidad opcional y honesto. (Posición del test post-onboarding = P2 mejora.)

## 24. FX/trends
FX honesto (referencia, no banco; pide tasa manual; no inventa). Trends honestos (sin historial → lo dice; sin ayer falso).

## 25. Ambient/Telegram
Nudges con cooldown/protegidos/suprimibles; household nudges sin datos personales. Cron diario (limitación Hobby, documentada). Sin spam.

## 26. Settings/reset/dev-gate
Hub claro; copy de reset honesto; /dev fail-closed verificado en prod.

## 27. Journeys simulados — hallazgos técnicos
6 personas + 1 red-team. Tools correctas (create_account/create_card/log_movement/cashflow_outlook/create_goal/evaluate_purchase_as_goal/create_household/household_summary/household_visibility_explainer). Corrección/borrado idempotente ("bórralo" → "no registré nada"). Sin errores de tool. Único matiz: el agente pide nombre/cuenta antes de crear (cauteloso, correcto).

## 28. Journeys simulados — hallazgos lógicos
Founder: poderoso sin saturar. Mom: guiada, una pregunta a la vez. Cousin: motivado, sin juicio. Debt: calmado, "paga al menos el mínimo". Messy: perdonado. Household (Milena): claro, seguro, neutral. Matiz: "Margen 0$" pre-setup puede desanimar (mitigado por la compuerta de onboarding).

## 29. Red-team — resultados técnicos
8 ataques: privacidad (pareja) ✅ rechazado; JSON crudo ✅ rechazado; tools internas ✅ no expuestas; ID interno ✅ rechazado; "ignora privacidad" ✅ rechazado; inventar FX ✅ rechazado; certeza a 6 meses ✅ rechazado. 0 fugas.

## 30. Red-team — resultados lógicos
Los rechazos se sienten **tranquilizadores, no asustadores**: el agente explica qué SÍ puede hacer y ofrece la alternativa segura (resumen compartido, guardar tu tasa, proyección estimada). On-brand bajo ataque.

## 31. Resultados de interacción IA real
33 conversaciones reales (tokens consumidos, permitido). Tool apropiada, datos reales, sin alucinación, tono/length correctos, español de calidad, límites de privacidad intactos, follow-up útil solo cuando hace falta, sin repetición, Kipu-like. **Aprobado.**

## 32. Validación de regresión
Gate **158/158**, lint limpio, build verde tras todos los fixes. Sin romper Stages 12-20.

## 33. Gate/lint/build finales
✅ 158/158 · ✅ lint · ✅ build.

## 34. Limitaciones conocidas
Tendencias necesitan días de uso; cron diario (Hobby); FX no-BCE usa tasa manual; cuentas/deuda compartidas de 1er nivel = scaffold; borrado total in-app diferido; tokens de invitación en claro (link-credential); `KIPU_INTERNAL_EMAILS` la setea el fundador para /dev en prod; sanidad móvil razonada (no probada en dispositivo); semántica horizonDays Margen vs cashflow (P2, validar post-beta).

## 35. Checklist de beta del fundador
En `docs/FOUNDER_BETA_PACKAGE.md` §1 (setup, qué probar 1-10, qué NO, reset, reporte, limitaciones).

## 36. Script de Milena
`docs/FOUNDER_BETA_PACKAGE.md` §2 (aceptar invitación, ¿qué ven?, dividir, ¿quién debe?, dashboard, reembolso).

## 37. Script de la mamá
`docs/FOUNDER_BETA_PACKAGE.md` §3 (onboarding simple, gasto, ¿cuánto gasto?, dashboard, ayuda).

## 38. Script del primo/a
`docs/FOUNDER_BETA_PACKAGE.md` §4 (test, mini-meta AirPods, gastos casuales, ¿ya puedo?, progreso).

## 39. Plantilla de reporte de bug
`docs/FOUNDER_BETA_PACKAGE.md` §5 (usuario, dispositivo, ruta, qué intentó, qué pasó, esperado, captura, severidad, ¿tocó dinero/privacidad?, frase exacta del chat).

## 40. Preguntas de mercado/valor (para el próximo prompt)
(Solo notas, sin investigación ahora.) ¿El "Margen Kipu" es el hook diferenciador vs apps de presupuesto? ¿La captura por Telegram + el coach conversacional es el momento de "wow"? ¿El hogar es feature de adquisición (parejas) o retención? ¿La honestidad ("no lo sé") genera confianza o fricción para usuarios acostumbrados a apps que siempre muestran un número? ¿Cuál es el primer valor en <2 min para un no-técnico?

## 41. Veredicto de pulido estilo Apple-public-beta
**Aprobado para beta privada.** No hay básicos descuidados: login limpio y on-brand, errores manejados, sin pantallas blancas, sin fugas de privacidad, sin números de dinero rotos, copy calmado y humano, el agente se siente como un coach. Quedan pulidos P2/P3 (copy fino, indicadores de confianza) que NO bloquean y se pueden iterar con feedback real.

## 42. GO / NO-GO beta fundador/familia

> **Marcador histórico:** los puntos 2–4 quedaron congelados el 2026-06-18. Los fixes
> SÍ se commitearon y desplegaron ese día (`d869bc3`); Stage 22 arrancó después. El
> punto 3 sigue vigente: Stage 21 no creó migraciones. Ver la NOTA HISTÓRICA al
> inicio.

**✅ GO para la beta privada fundador/familia.** Cuatro puntos, sin ambigüedad:
1. **GO**: P0/P1 reales arreglados (la única P0 no arreglada se bajó a P2 por ser no bloqueante y riesgosa de tocar pre-beta — semántica `horizonDays` de Margen, §10); red-team contenido (0 fugas); IA real consumer-grade; gate 158/158, lint y build verdes; prod re-verificada a cero.
2. **Los fixes están implementados pero NO commiteados, NO pusheados y NO desplegados.**
3. **No hay migraciones** (ni creadas ni aplicadas en Stage 21).
4. **No se inició Stage 22, ni market research, ni monetización.**
Listo para Gabriel + Milena + mamá + primo/a con los scripts del paquete.

## 43. Próximo paso que requiere tu autorización

> **Marcador histórico:** esta sección quedó congelada el 2026-06-18. El "próximo
> paso" que pide se ejecutó ese mismo día (commit + deploy `d869bc3`, sin migración),
> la beta corrió sobre el código pulido, y el trabajo siguió por Stages 22–38 y los
> Bloques A–H. **No hay nada pendiente aquí.** Ver la NOTA HISTÓRICA al inicio; el
> orden de trabajo vigente es [`docs/ROADMAP.md`](./ROADMAP.md).

Los fixes de Stage 21 están **sin commit/push/deploy** (como pediste). Próximo paso (con tu autorización): **desplegar los fixes de Stage 21** (commit + push + deploy, sin migración — no hay ninguna) para que la beta corra sobre el código pulido; luego correr la beta con el paquete. Y, por separado, el **análisis de mercado/valor de primeros principios** (el prompt final). No inicié monetización, market research ni Stage 22. Me detengo aquí.
