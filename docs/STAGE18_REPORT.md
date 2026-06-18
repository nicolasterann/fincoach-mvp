# Stage 18 — Personalización, Memoria y Contexto de Vida · Revisión Ultracode, Completado y Endurecimiento Adversario

**Fecha:** 2026-06-17 · **Estado:** código completo y endurecido · gate **115/115** · lint limpio · build verde · **migración 026 creada pero NO aplicada** · **sin commit / push / deploy** — a la espera de aprobación explícita. **No se inició Stage 19.**

---

## 1. Resumen ejecutivo

Stage 18 le da a Kipu la capacidad central que pidió el fundador: **conocer al usuario y adaptarse a su filosofía de vida** — permisivo y celebrante con quien vive por experiencias, exigente y patrimonial con quien construye riqueza — manteniendo intactas la verdad financiera, las protecciones, el Margen Kipu y la simplicidad por defecto. "Genio adentro, simple afuera."

La implementación original (hecha bajo un modo de razonamiento menor) tenía una **espina dorsal correcta** (señales → perfil → decisiones → digest; AI-first; money-safe; brevity-safe; privacy-safe), pero una **revisión Ultracode multi-agente** (14 revisores por dimensión + pre-mortem de 64 escenarios + verificación adversaria de cada hallazgo + síntesis; 76 agentes) encontró **46 defectos de correctitud/honestidad/completitud** que sobrevivieron a la verificación. Todos se corrigieron y se **re-verificaron** con un segundo workflow de 5 agentes que dio **GO limpio** (0 sin resolver, 0 regresiones). El defecto más grave (HIGH): una capacidad estrella —fijar tono/detalle explícitos— **fallaba en silencio** porque escribía valores que violaban el CHECK de `coach_preferences`.

**Veredicto: GO** (código completo; migración 026 sin aplicar). El motor es AI-first, money-safe y respeta la brevedad por defecto; los residuales son cosméticos o forward-looking.

---

## 2. Revisión de la implementación de razonamiento menor

La revisión confirmó que la arquitectura **no** estaba fundamentalmente mal y **no** había que reemplazarla: `defaultBrevity` es un literal `true` que ninguna rama puede voltear; `effectiveAmbition` solo reordena el reparto de un excedente con mínimos ya reservados y cede ante una ambición explícita; la supresión de nudges es aditiva sobre los límites de Stage 13; la inferencia usa solo metadatos de uso (nada sensible); filosofía y contexto de vida son explícito-only; la migración es aditiva con RLS deny-by-default.

Los defectos sobrevivientes eran **de correctitud/honestidad, no de seguridad de dinero ni privacidad**: persistencia de tono rota por el CHECK, el feedback de exigencia que reescribía la filosofía declarada, un reset que prometía más de lo que borraba, un piso de supresión silencioso para la población por defecto, varias etiquetas de `provenance` deshonestas, y un colapso del patrimonio en el dashboard para usuarios inferidos de baja confianza.

---

## 3. Qué se mantuvo, corrigió, reemplazó o eliminó

| Artefacto | Veredicto | Motivo |
|---|---|---|
| `personalization-signals.ts` | **mantener** | Puro, confianza-gated, solo metadatos de uso. Se añadió comentario de que la detección de canal/modalidad telegram/voz es forward-looking (prod escribe solo web/chat). |
| `personalization-profile.ts` | **corregir** | Núcleo explícito-sobre-inferido correcto, pero 3 `provenance` deshonestos (tono hardcodeado, userMode, dashboardDensity) corregidos; añadidos mappers puros `toCoachTone`/`toCoachDetail`; `normTone('clear')→'calm'`. |
| `personalization-decisions.ts` | **corregir** | `defaultBrevity`/`effectiveAmbition` correctos; `suppressThreshold` ahora `normal=0`, inferred-high=25, explicit-high=50; comentario de diferido en `preferWindow`. |
| `personalization-intelligence.ts` | **mantener** | Digest con regla de oro + privacidad + encuadre; coherente con el estado neutral tras el fix de tono. |
| `personalization-store.ts` | **corregir** | `setCommunicationPref` ahora mapea a valores válidos del CHECK; `resetPersonalization` también olvida contexto de vida (no toca coach/financial prefs). |
| `kipu-agent-tools.ts` | **corregir** | `personalization_feedback` ya no reescribe la filosofía (va a ambición); reset honesto; **nueva tool `forget_life_context`**; `explain_personalization` enriquecido; copia de nudges honesta. |
| `kipu-agent.ts` | **corregir** | Tool list + bloque de prompt actualizados (forget_life_context; "exigencia ajusta ambición, no filosofía"). |
| `ambient-decision.ts` / `ambient-loop.ts` | **corregir** | Set `PERSONALIZATION_PROTECTED_TOPICS` que evita suprimir obligaciones; supresión estrictamente aditiva sobre Stage 13. |
| `reality/page.tsx` | **corregir** | El patrimonio se oculta solo con densidad mínima explícita u orientación que lo colapsa; nunca por inferencia de baja confianza; nunca la verdad central. |
| `026_stage18_personalization.sql` | **corregir** | `user_preference_events` ahora append-only de verdad (sin DELETE). |
| `dev/capture-test` (gate) | **corregir** | #96 prueba la realidad (chat/web) + 96b forward-looking; #106 umbral real (50) + bypass protegido; +8 aserciones de alto riesgo. |
| Engines puros (lógica de cálculo), digest, cadena money-safe | **mantener** | Verificados correctos por la revisión. |
| (nada) | **eliminar** | No se eliminó código: lo forward-looking se documentó como diferido, no se borró. |

---

## 4. Análisis de producto / diferenciación

Lo que hace a Kipu único frente a cualquier app de presupuesto **no es más información** sino "la información correcta, en el momento correcto, al nivel de detalle correcto, para ESTE usuario", sobre **memoria financiera viva** y con **acción segura**. La diferenciación de Stage 18: la misma app se siente distinta para un usuario de experiencias y para uno patrimonial **sin volverse un producto distinto** — adapta encuadre, prioridades, densidad y nudges, pero jamás la verdad financiera ni la simplicidad. Un competidor genérico restringe a todos por igual y pierde al usuario de experiencias; Kipu lo retiene porque lo entiende.

---

## 5. Funciones extra propuestas y por qué

1. **`forget_life_context`** — el usuario podía declarar contexto pero no retractarlo; control y anti-creepiness exigen poder olvidar.
2. **Set explícito de densidad de dashboard vía `personalization_feedback` (aspect `dashboard`)** — "hazme el dashboard más simple/cargado" persiste densidad explícita sin una tool nueva.
3. **Topics ambient protegidos** — garantía estructural de que la personalización nunca silencia una obligación/deuda.
4. **`explain_personalization` con datos del dashboard** — transparencia concreta ("¿por qué cambió mi dashboard?").
5. **Anclaje de feedback positivo de nudges** ("ese aviso me sirvió" → sensibilidad normal) para que un feedback útil no quede pisado por una inferencia de "ignorando".

---

## 6. Extra features: implementadas vs diferidas

- **Implementadas ahora:** 1–5 de la sección 5 (todas pequeñas, completan capacidades, no son gimmicks).
- **Diferidas (documentadas, NO reclamadas como entregadas):**
  - Etiquetado real de modalidad/canal de captura (voz/foto/estado/telegram) — requeriría tocar el escritor canónico del ledger (carga el dedupe); fuera de alcance.
  - Timing por ventana preferida (`preferWindow`) — el cron diario no tiene ventana que honrar; se activa cuando el cron sea sub-diario.
  - Onboarding adaptativo con UI dedicada (scaffolded: las prefs persisten y el agente pregunta progresivamente).
  - Rasgos de adherencia/personalidad financiera como señales inferidas (riesgo de sobre-personalizar; queda como follow-up).
  - Lectura del log `user_preference_events` hacia señales (hoy es auditoría append-only intencional).

---

## 7. Hallazgos de la inspección del código actual

Se inspeccionaron: perfil/preferencias (`coach_preferences`, `user_financial_preferences`, `user_engagement`), onboarding, memoria (`user_context_notes`, merchant memory de S16), metas/ambición/riesgo de S17, ingestión Telegram/web, `channelToInputChannel` (escribe solo `web`/`chat`), `created_at`/`input_channel`, `chat_messages`, el constructor de briefing, prompt/tools del agente, decisión ambient, dashboards, Margen/cashflow/budget/goals intelligence, Pulso, gates y migraciones. Hallazgo clave: **`coach_preferences.tone`/`detail_level` son NOT NULL con CHECK** (`clear|coach_like|playful` / `short|medium|detailed`), lo que rompía la persistencia de tono de S18 y obligaba a NO nulificar esas columnas en el reset.

---

## 8. Gap analysis

- **Ya existía y se reusó:** tono/detalle (`coach_preferences`), ambición/riesgo (`user_financial_preferences`), timing de nudges (`user_engagement`), adherencia S17, merchant memory S16, allocation/joy-floor S17.
- **Existía pero incompleto/roto (corregido):** persistencia de tono; reset; supresión de nudges para población por defecto; provenance; gate vacuo.
- **Faltaba y se construyó:** `forget_life_context`; topics protegidos en ambient; set explícito de densidad por feedback; transparencia de dashboard.
- **Útil pero diferido:** etiquetado de modalidad, ventana preferida, onboarding UI, rasgos de adherencia, lectura del log.

---

## 9. Alcance exacto de la implementación

Cuatro módulos puros + orquestador + store (S18 base) **revisados y corregidos**; 11 tools de personalización (10 base + `forget_life_context`); integración en briefing con `effectiveAmbient` alimentando el joy-floor de S17; ambient con supresión por sensibilidad + topics protegidos; dashboard con densidad gated por provenance; migración 026 aditiva (sin aplicar); gate de 115 aserciones. No se añadieron rutas regex; todo es tool + memoria + prompt.

---

## 10. Archivos cambiados

Modificados: `src/types/financial.ts`, `src/lib/financial/coaching-signals.ts`, `src/lib/financial/personalization-profile.ts`, `src/lib/financial/personalization-decisions.ts`, `src/lib/financial/personalization-signals.ts`, `src/lib/financial/personalization-store.ts`, `src/lib/ai/agent/kipu-agent.ts`, `src/lib/ai/agent/kipu-agent-tools.ts`, `src/lib/ambient/ambient-decision.ts`, `src/lib/ambient/ambient-loop.ts`, `src/app/app/reality/page.tsx`, `src/app/dev/capture-test/page.tsx`, `docs/BUILD_PROGRESS.md`.
Nuevos: `src/lib/financial/personalization-{signals,profile,decisions,intelligence,store}.ts`, `supabase/sql/026_stage18_personalization.sql`, `docs/STAGE18_REPORT.md`.

---

## 11. Migraciones creadas (no aplicadas)

`supabase/sql/026_stage18_personalization.sql` — aditiva, **NO aplicada**. Tres tablas: `user_personalization` (filosofía + prefs de UX), `user_life_context` (declarado-only, único por `(user_id,kind)`), `user_preference_events` (auditoría **append-only inmutable** — grant ahora solo `select, insert`). RLS habilitada, 0 políticas de cliente (deny-by-default), grants a `service_role`. No elimina ni debilita ningún objeto existente.

---

## 12. Cambios en el modelo de datos

Solo aditivos (sección 11). El comportamiento inferido **no se persiste** (se deriva en lectura). Se reusan superficies existentes en vez de duplicarlas. El store degrada con gracia (`select *` + try/catch) → **producción idéntica hasta aplicar 026**.

---

## 13. Modelo del perfil de personalización

`PersonalizationProfile`: `userMode` (simple/guided/power/expert/unknown), `detailLevel`, `tone`, `financialPhilosophy`, `financialOrientation`, `riskPosture`, `usageStyle`, `preferredCapture`, `registrationWindow`, `nudgeSensitivity`, `dashboardDensity`, `lifeContext`, `onboardingCompleteness`, `confidence`, y **`provenance` por rasgo** (explicit/inferred/default). Explicable y cauteloso; baja confianza → defaults conservadores.

---

## 14. Preferencias explícitas vs comportamiento inferido

**Lo explícito SIEMPRE manda** (verificado rasgo por rasgo). Lo inferido lleva confianza y cae a `unknown` con poca data. `provenance` ahora honesto: el tono solo es "explicit" si hay un `coach_preferences.tone` realmente fijado (ya no el `profiles.tone_preference` forzado a "playful"); `userMode` es "explicit" cuando lo dispara un driver explícito (detalle detallado o filosofía wealth) y "inferred" solo en el caso de solo-inversiones; `dashboardDensity` hereda la provenance de `userMode` (→ "default" para usuarios nuevos).

---

## 15. Detección de tipo de usuario

Cautelosa, para **adaptar, no etiquetar**: `userMode` y `financialOrientation` se derivan de filosofía + hechos no sensibles. Un usuario simple no es empujado a dashboards de patrimonio; uno power no es forzado a respuestas de una línea; nunca se expone la etiqueta.

---

## 16. Modelo experiencias-first vs patrimonio-first

El corazón del fundador: `financial_philosophy` (experiences|balanced|builder|wealth) → `philosophyToAmbition` (experiences→`light_touch`, wealth→`power_builder`, builder/balanced→`steady`) → `effectiveAmbition = ambition_mode explícito ?? derivado` → alimenta el `ambitionMode` del allocation de S17 (**solo el joy floor**). Verificado de punta a punta (gate #110): con el mismo excedente, `light_touch` preserva más piso de gustos que `power_builder` — la filosofía mueve dinero real **sin tocar mínimos, obligaciones, cashflow ni Margen**.

---

## 17. Adaptación del estilo de conversación

Se adapta **tono y encuadre**, no la longitud por defecto. `defaultBrevity: true` es invariante de tipo; el digest y el prompt empiezan con la REGLA DE ORO; un usuario power/detallado **mantiene** confirmaciones breves tras acciones rutinarias (gate #105). El detalle es bajo demanda. El tono explícito ahora **persiste** (fix HIGH).

---

## 18. Personalización del dashboard

`/app/reality` adapta densidad y superficies. La línea **opcional** de patrimonio se oculta solo si la orientación la colapsa (lifestyle/debt_cleanup declarados) o el usuario eligió densidad mínima **explícitamente** — nunca por una inferencia de baja confianza, y **nunca la verdad central** (Margen, safe-spend, obligaciones). El dashboard principal (`/app`) no fue tocado a propósito (estabilidad del núcleo).

---

## 19. Timing/copia ambient personalizados

`suppressBelowPriority` se pasa a `decideAmbientNudge` **sobre** todos los límites de Stage 13 (quiet hours, tope diario, cooldown por tema, light mode, idempotencia). `normal` = 0 (comportamiento Stage 13); `high` explícito = 50; `high` inferido (señal "ignorando") = 25. **`PERSONALIZATION_PROTECTED_TOPICS`** (tarjetas, margen negativo, runway, deuda, mínimos, alto interés, posible doble cargo) **nunca** se suprime. Solo suprime, nunca aumenta frecuencia. `preferWindow` se computa pero está diferido (cron diario).

---

## 20. Inteligencia de hábito de captura

Se infieren ritmo (mañana/tarde/noche, batch semanal/fin de semana — real desde `created_at`), interacción con nudges, tendencia de corrección y nivel de actividad. Canal/modalidad (telegram/voz/foto/estado) son **forward-looking**: producción escribe solo `web`/`chat`, así que hoy resuelven a web/texto/desconocido; el clasificador queda listo (probado por #96b) para cuando se etiquete la modalidad en captura, sin tocar el escritor del ledger.

---

## 21. Onboarding adaptativo

Scaffolded: `onboarding_mode` (simple/power) persiste y el agente puede preguntar progresivamente vía las tools; aun en power las respuestas por defecto son breves. Una UI de test de personalidad dedicada queda **diferida** (capacidad subyacente lista).

---

## 22. Modelo de contexto de vida

Solo lo **declarado** por el usuario (estudiante, freelancer, mantiene familia, viajero, sueldo fijo, emprende, ingreso irregular…). Nunca inferido, nunca sensible. Se puede añadir (`update_life_context`), **olvidar individualmente** (`forget_life_context`, nuevo) y se borra completo en el reset.

---

## 23. Perfil de personalidad/adherencia financiera

Práctico y no clínico: la orientación + ambición + postura de riesgo moldean el ritmo de metas (joy floor), el tono y la densidad; la adherencia de S17 (slip-risk, mini-metas, refuerzo positivo) ya alimenta el plan. **No** se presenta como diagnóstico ni se expone etiqueta alguna. El modelado de rasgos de adherencia como señales inferidas propias queda diferido (evitar sobre-personalización).

---

## 24. Recomendaciones conscientes de la personalización

Alimentan S15–17 **sin cambiar la verdad financiera**: el joy budget se preserva más para lifestyle; superficies más ambiciosas para wealth; encuadre conservador para riesgo bajo; el feedback de exigencia ajusta la **ambición** (postura de reparto), no la filosofía declarada.

---

## 25. Tools conscientes de la personalización (11)

`set_financial_philosophy`, `get_personalization_profile`, `set_communication_preference` (tono/detalle, ahora persisten de verdad), `set_risk_preference`, `set_onboarding_mode`, `set_nudge_sensitivity`, `update_life_context`, **`forget_life_context` (nueva)**, `explain_personalization` (enriquecida), `personalization_feedback` (exigencia→ambición; nudge útil→normal; dashboard→densidad), `reset_personalization_preference` (honesta). Todas validan, escriben por store tipado (sin SQL crudo), no exponen internos y no tocan el ledger.

---

## 26. Bucle de feedback

`personalization_feedback` registra y aplica el cambio obvio: exigencia→ambición (`light_touch`/`power_builder`), recordatorio molesto→sensibilidad alta, útil→normal, detalle mucho/poco→corto/detallado, dashboard cargado/escaso→minimal/rich. El feedback explícito manda sobre lo inferido. El log `user_preference_events` es auditoría append-only (lectura hacia señales, diferida).

---

## 27. Manejo de confianza/transparencia

Cada rasgo lleva confianza y `provenance` honesto. `explain_personalization` (read-only, solo cuando el usuario pregunta) explica tono, superficies del dashboard y por qué (con la provenance de la densidad), recordando que es ajustable y que **ningún dato financiero se oculta**.

---

## 28. Guardas de privacidad / anti-creepiness

Nunca infiere atributos sensibles, emociones ni personalidad; nunca expone etiquetas/JSON/enums/IDs; nunca manipula ni avergüenza; no sobre-personaliza con señales débiles (confianza-gated); explícito manda; el usuario puede ver, cambiar, olvidar y resetear su personalización; nunca sube la frecuencia de nudges.

---

## 29. Variación de UI / experiencia

Orden y colapso de tarjetas por orientación/densidad; línea de patrimonio opcional gated con seguridad; sugerencia de captura en estados vacíos (vía digest). Nunca contradice los números ni oculta la verdad central.

---

## 30. Observabilidad

`user_preference_events` (append-only) registra cada cambio/feedback con tipo, valor y fuente. El ambient ya registra outcomes/skips por tema (no sensible). El gate `/dev/capture-test` cubre los caminos de alto riesgo de forma determinista.

---

## 31. Resultados de tests

Gate determinista **115/115** (eran 107: se reemplazaron 2 aserciones débiles/ficticias y se añadieron 8 de alto riesgo). Lint limpio. Build verde (`tsc --noEmit` sin errores). La revisión Ultracode (76 agentes) y la verificación de fixes (5 agentes) confirman 0 hallazgos sin resolver y 0 regresiones.

---

## 32. Resultados de calidad de conversación

Por comportamiento (no por frase): experiencias → celebra el disfrute, metas livianas, sin presión a ahorrar; wealth → empuja metas y costo de oportunidad, menos permisivo, sin culpa; ambos → confirmación **breve** tras registrar un gasto; "¿por qué me hablas así / cambió mi dashboard?" → explicación honesta; "me exiges mucho" → afloja la **ambición** sin tocar la filosofía; "resetea / olvida que soy estudiante" → reset honesto / olvido puntual; "me siento juzgado" → sin mutar la filosofía, tono empático.

---

## 33. Escenarios del pre-mortem y resultados

64 escenarios simulados; 27 inicialmente fallaban. Tras los fixes, los de alto riesgo quedan resueltos y con cobertura de gate: persistencia de tono (7,8 — HIGH), exigencia que no reescribe filosofía (13,46,51,63), reset honesto + olvido de contexto (43,44,52,53,36,38), piso de nudges para default (2), deuda+lifestyle con nudges de protección siempre activos (33), densidad de dashboard sin ocultar verdad (30,48,49), feedback positivo de nudge (42), brevedad para power (4). Los de canal/modalidad (17,19,20,21) se resolvieron como **honestidad**: el clasificador es forward-looking y el gate ahora prueba la realidad. Residuales documentados (sección 34).

---

## 34. Limitaciones conocidas

1. Mapeo de tono lossy: calm/analytical/gentle colapsan a `clear`; al leer se ve "calm" — provenance sigue honesto; solo cosmético.
2. `personalization_feedback` con `aspect:'tone'` solo registra (sin aplicar) — el tono se cambia con `set_communication_preference`; conservador por diseño.
3. Migración 026 sin aplicar → escrituras de personalización no-op (graceful) hasta que la humana aplique el DDL.
4. Clasificador de canal/modalidad forward-looking: inerte hasta etiquetar modalidad en captura.
5. Onboarding adaptativo y rasgos de adherencia: scaffolded/diferidos.

---

## 35. Stage 18 — GO / NO-GO

**GO** (código completo; migración 026 sin aplicar). Arquitectura sólida, money-safe, brevity-safe y privacy-safe; los 14 fixes verificados en código fuente; lint/tsc/build limpios; gate 115/115; cero regresiones de verdad financiera/privacidad/verbosidad. Solo restan residuales cosméticos/forward-looking. Para producción: aplicar 026 antes de depender de la persistencia.

---

## 36. Plan de migración / despliegue

1. Aplicar `026_stage18_personalization.sql` (3 tablas aditivas, RLS deny-by-default, grants service_role, auditoría append-only) — la humana ejecuta.
2. Commit + push (rama).
3. Esperar deploy Vercel READY.
4. Smoke en usuario desechable contra la DB real: filosofía experiences vs wealth (encuadre + joy floor), tono/detalle persisten, reset honesto, forget_life_context, nudges protegidos no se silencian, dashboard no oculta verdad central, brevedad tras gasto.
5. Limpiar el usuario desechable; verificar DB en cero.
6. Reporte GO/NO-GO.

`vercel.json` (cron diario `0 14 * * *`) sin cambios. Sin datos reales/de fundador. Nada de esto se ejecutó.

---

## 37. Próximo paso exacto que requiere tu autorización

**Autoriza el rollout de Stage 18**: (1) aplicar la migración 026; (2) commit + push; (3) deploy + esperar READY; (4) smoke en usuario desechable; (5) limpiar; (6) reporte GO/NO-GO. Hasta tu visto bueno, el repo queda con cambios sin commitear y la migración creada **sin aplicar**; no se hizo commit, push, deploy ni se aplicó migración, y **no se inició Stage 19**.
