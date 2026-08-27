# M7_AUDIT — Ronda 1 · VEREDICTO: **VERDE**, con una orden de registro

- **Fecha:** 2026-08-25 · **Árbol auditado:** `stage-m-front` @ `1e9e1e7`
- **Entrada:** `M7_REPORT.md` Ronda 1 (X1–X16 + inventario + campos leídos).
- **Método:** los dos runners headless + lint + build + **la corrida real del
  E2E de persona desechable** + una mutación propia + lectura del diff completo
  con foco en las áreas prohibidas.

**La sustancia de M7 está bien y verificada.** La única orden es de registro:
**el reporte declara «Desviaciones: Ninguna» y hay dos**. La causa raíz es una
contradicción de **mi propio spec**, que ya corregí.

---

## Verificado por ejecución

| | Cómo lo probé |
|---|---|
| **Gates** | `lint` **0 errores** · `build` **exit 0** · captura **846/846** por **los dos runners** (842 + 4 nuevas) |
| **E2E** | **11/11 verdes, residuo cero**, con **M7-E10** nuevo: Metas muestra meta, ahorro e inversión **por su nombre** y **declara la identidad ausente** en vez de inventarla ⇒ **C5 cerrado con datos**, la última corrección pendiente de la auditoría de pre-implementación |
| **X6 · framing semanal** | Exactamente la distinción que pedí: el héroe **«Tu semana» desapareció** de `/app/spending` y el chip semanal del chat también, **pero los tres `/semana` de `/app/goals` siguen ahí** — son la cadencia que el usuario comprometió, y borrarlos habría hecho mentir la frase. Por contexto, no por find/replace |
| **X4/X5 · ningún número cambió** | El helper extraído conserva la fórmula al dígito (`protegido − base`, clamp 0, centavos). **Mi mutación** (resta→suma) produjo **130 donde debía dar 50** y mató **M7-2** (845/846); revertido ⇒ **846/846**, árbol limpio |
| **X11 · cashflow** | Intacto: **0 líneas** de diff y sin enlaces nuevos |
| **Inventario** | Las once superficies con fila propia, y la tabla «campos leídos, antes y después» declara accesos idénticos superficie por superficie |
| **El diff financiero** | Aditivo y honesto: identidades solamente, con el comentario explícito de que **los montos siguen siendo del motor**, el `name` legacy **preservado** (`sourceName ?? "Inversión"`) para no alterar la narración existente, y los flags `readable` cableados a las lecturas publicables que ya existían |

## Orden única

### O1 · Declarar las dos desviaciones (sólo documentación)

El reporte dice **«Desviaciones del spec: Ninguna»**, pero M7 modificó dos
áreas que `M1_SPEC §4` prohíbe y que `M7_SPEC §4.1` heredaba:

1. **`src/lib/financial/**`** — tres módulos nuevos (`goal-layer-sources.ts`,
   `tu-mes.ts`, `activity-detail.ts`) y tres modificados (`coaching-signals.ts`,
   `goals-intelligence.ts`, `goals-wealth-store.ts`).
2. **`src/lib/ai/agent/kipu-agent.ts`** — cuatro líneas en
   `buildUnavailableBriefingPlaceholder`.

**Verifiqué su contenido y lo apruebo:** ninguna fórmula ni monto cambió, y el
placeholder del agente recibe `readable: {goals:false, savingsPlans:false,
investments:false}` — es decir **«no pude leer»**, que es el valor
doctrinalmente correcto; poner `true` con lista vacía habría sido el pecado
clásico de este proyecto.

**La causa es mía:** D‑M7.2 ordenaba mover el dinero derivado «al servidor» y
D‑M7.4 exigía unir nombres que **viven en la capa financiera** — es decir, mi
spec pedía trabajo que sus propias prohibiciones impedían. **Ya corregí
`M7_SPEC §4.1`**: se permite añadir módulos y campos **aditivos de identidad o
presentación** en esa capa —jamás una fórmula, un monto o una lectura de dinero
existente— y **toda entrada se declara**.

**Qué hacer:** corregir la sección §Desviaciones del reporte nombrando las dos
áreas, por qué cada una fue necesaria y qué **no** se hizo (ninguna fórmula,
ningún comportamiento del agente). **Sin cambios de código.**

Lo pido porque el valor entero de este protocolo es el auto-reporte honesto:
«ninguna» cuando hay dos es la misma falla que declarar CUMPLE sobre lo que no
se puede ejecutar, y ya la corregimos una vez en M2.

## Lo que queda para la pasada del founder

Como en M5 y M6: las once rutas autenticadas no se pueden recorrer sin sesión,
así que la inspección visual de cada superficie re-vestida, los dos temas y la
continuidad perceptual desde cada orbe siguen siendo material de hardware.
La **densidad** —la nota que dejé en M6 sobre las líneas de «Denominador · …»,
y ahora la poda de prosa de `/app/saldo` y el semáforo único de
`/app/spending`— es justamente lo que conviene juzgar con los ojos.

## Estado

**M7 ACEPTADO** con O1 pendiente de registro. `stage-m-front` acumula M1–M7.
Faltan **M8** (PWA, iconos, modo día completo, landing) y **M9** (borrar el
shell viejo, redirects, barrido final) para cerrar el bloque.
