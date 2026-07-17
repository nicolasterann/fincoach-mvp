# Kipu MVP Roadmap — ARCHIVO HISTÓRICO

> ## ⚠️ ESTE DOCUMENTO NO SE EJECUTA
>
> Es el plan ORIGINAL de 13 fases (~Stage 11, junio 2026), conservado solo como
> arqueología: para entender de dónde salió Kipu y dónde aterrizó cada idea.
> **Nada de aquí es trabajo pendiente.** El producto pasó ese punto hace meses.
>
> - **El roadmap que se ejecuta hoy es [`docs/ROADMAP.md`](ROADMAP.md).**
> - El historial vivo es [`docs/BUILD_PROGRESS.md`](BUILD_PROGRESS.md) (más nuevo
>   arriba) y `docs/AI_NATIVE_ARCHITECTURE.md` §5.
> - El estado por módulo está en el `README.md` de la raíz.
>
> Las 13 fases con sus "Current status: Not started" se **borraron en 2026-07-16**
> porque mentían: la mayoría estaban enviadas, y dos seguían ordenando construir
> cosas que la doctrina actual prohíbe — una pedía un *router de regex* para
> preguntas abiertas (`CLAUDE.md` lo prohíbe explícitamente: las capacidades se
> agregan como TOOLS) y otra pedía el hero semanal que el Bloque D retiró. Se
> conservan las dos únicas secciones con valor: dónde aterrizó el plan, y la
> secuencia estratégica que `AI_NATIVE_ARCHITECTURE.md` cita por nombre.

## Dónde aterrizó el plan original

Cada idea del roadmap de 13 fases terminó en algún lado. Este es el mapa:

- low-friction capture → Stage 12
- ambient Telegram loop → Stage 13
- card/debt protection → Stage 14
- cashflow & scenarios → Stage 15
- spending/merchant intel → Stage 16
- goal engine → Stage 17
- personalization → Stage 18
- household → Stage 19
- personality/FX/trends → Stage 20
- multi-currency onboarding → Stages 22–24
- universal chat control + scheduled changes → Stage 26
- living dashboard + metric drilldowns → Stage 27
- universal chat control (soft-close accounts/cards + persistent feedback) → Stage 29
- real variable-spend budgets → Stage 32
- two-number model (Margen vs "Tu mes" planning) → Stage 36
- universal calendar materialization + AI-generated notifications → **Bloque C**
- **Saldo Kipu** accumulating-tank hero (reemplazó a Margen como métrica diaria
  visible) → **Bloque D**
- per-account cashflow `/app/cuentas` + Tesorería → **Bloque F**
- cuotas/installments LatAm → **Bloque G**
- objetivo mensual comida/transporte + endurecimiento del feed monetario → **Bloque H**

Bloques cerrados hoy: **A, B, C, D, F, G, H**. Migraciones 001–055 aplicadas en
producción.

## Secuencia estratégica (junio 2026 — post first-principles review)

*Conservada porque `AI_NATIVE_ARCHITECTURE.md` la cita por nombre. Es histórica: los
cuatro puntos están enviados.*

La revisión confirmó que el riesgo existencial de Kipu es **la frescura del dato y el
comportamiento del usuario**, no el dashboard. Kipu no puede depender para siempre de
un registro manual disciplinado. La secuencia arregló la semilla ANTES de encender la
proactividad, porque los nudges y la métrica diaria construidos sobre una semilla mala
crean confianza falsa:

1. **Onboarding AI-first** (Stage 11 → evolucionó al wizard estructurado de los
   Stages 22–24). Captura la semilla mínima confiable para la primera métrica diaria
   —Margen entonces, **Saldo Kipu** hoy— y trata todo lo demás como hipótesis
   estimables que Kipu aprende después. Decisión de formato: **HÍBRIDO** — el chat es
   la espina dorsal, con editores estructurados en línea para los clusters
   estructurados (primero la matriz de tarjetas/deudas, donde el chat libre demostró
   ser más débil en campo).
2. **Captura de baja fricción.** Notas de voz, fotos/recibos y documentos por
   Telegram. La cadena de suministro del dato no puede depender de la disciplina de
   tipear.
3. **Ambient Telegram Loop y frescura del dato.** Pulso proactivo, honestidad ante
   datos viejos, reply-to-log, recuperación sin culpa — el loop de retención.
4. **Protección de tarjetas/deuda.** Proyección de interés, matemática de la trampa
   del pago mínimo, plan de pago, chequeos pre-compra — el caso de uso fundacional.

North-star de ese arco: **días consecutivos con dato fresco por usuario** (no DAU, no
sesiones).

## Diferenciación (histórica, sigue siendo la tesis)

Kipu es **habit-first, Telegram-first, LatAm-first, emocionalmente inteligente,
consciente de la deuda y de baja fricción**. No compite en "chat financiero
genérico"; compite en guía práctica del día a día para gente que no quiere pensar
duro en "finanzas".
