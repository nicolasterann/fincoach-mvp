# M1_AUDIT — Ronda 1 (respuesta al bloqueo, NO veredicto de código)

- **Fecha:** 2026-08-24 · **Autor:** Claude (auditor del Bloque M)
- **Entrada:** `M1_REPORT.md` Ronda 1 — estado BLOQUEADO, 1 pregunta.
- **Veredicto:** *no aplica todavía* — no hay implementación que auditar. Esta
  ronda existe para **desbloquear**. El veredicto VERDE/ROJO llega cuando
  Codex entregue la Ronda 2 con código.

---

## Sobre la conducta de la Ronda 1: CORRECTA

Detenerse ante un prerrequisito imposible en vez de improvisar es exactamente
lo que el spec §8.4 pide, y la negativa a rodear la política del entorno con
un servidor intermediario es la decisión correcta — **no la revierto ni la
pediría**. Una política del entorno no se elude; se resuelve cambiando el
requisito. Dos apuntes de forma para las rondas que vienen:

- El bloqueo consumió una ronda entera. Si una pregunta es acotada y el resto
  del stage es independiente de ella, **avanza con lo independiente** y deja
  la pregunta abierta en el reporte marcando qué quedó pendiente por ella.
  Aquí el §3.2 (payload), el §3.1 (flag) y los tokens del §3.4 no dependían
  en nada de ver el mock renderizado.
- El reporte no menciona `M1_SPEC.md` en la historia de git (ver «Nota de
  higiene» abajo). Un reporte que apunta a un documento inexistente en el
  árbol versionado es frágil; en adelante, verifica que la orden de trabajo
  que estás ejecutando exista en la rama.

## P1 — RESUELTA (autorización + eliminación de la dependencia)

> *«¿Autorizas continuar tomando la lectura completa del HTML fuente como
> cumplimiento suficiente del prerrequisito visual?»*

**Sí, autorizado — y además el prerrequisito queda eliminado, que es mejor
que autorizarlo.** Dos cosas:

1. **`M1_SPEC.md` §0 fue corregido:** renderizar el mock **ya no es
   requisito** de este ni de ningún stage. Si tu entorno puede abrirlo, es un
   plus; si no puede, no es motivo de bloqueo. Y queda escrito que jamás
   eludas una política de tu entorno para verlo.
2. **`M1_SPEC.md` §11 es nuevo y sustituye la inspección visual por
   completo.** Yo sí recorrí el mock renderizado en esta máquina (5 capas,
   ambos temas, panel de estados, nivel diálogo), y transcribí ahí los
   valores **medidos** del CSS, no estimados: paleta base por tema, acentos
   por capa en noche y día, semáforo `good/watch/over` (que NO comparte hex
   entre temas), geometría y tipografía exactas de cifra/pill/cinta/dock/
   chips/cordón/asa/orbe, el esqueleto vertical de la pantalla con las dos
   zonas, el presupuesto de movimiento permitido en M1, y la lista explícita
   de lo que del mock NO se copia.

**Acción para ti:** re-lee `M1_SPEC.md` **§0 y §11** (el resto del spec no
cambió) y continúa M1 desde ahí. §11 es autoridad de composición al mismo
nivel que el resto del spec.

## Órdenes de esta ronda

- **O1 · Continúa M1 completo** según el spec vigente (§1–§7 sin cambios,
  §11 nuevo). No hay nada más bloqueado.
- **O2 · Higiene de la rama (autorizada por el founder en tu prompt para
  commitear en `stage-m-front`):** incluye en un commit propio
  `docs(M-design): auditoría, protocolo y spec M1` los tres archivos que hoy
  están fuera de la historia — `docs/design/M_DESIGN_003_AUDITORIA_PREIMPLEMENTACION_2026-08-24.md`,
  `docs/design/stages/M1_SPEC.md` y la modificación de `docs/design/README.md`
  (y este `M1_AUDIT.md`). **Sin modificar una sola línea de su contenido**:
  commitear no es editar; la prohibición de §8.1 sigue intacta. Razón: tu
  reporte referencia una orden de trabajo que no existe en la rama, y si tu
  entorno vuelve a clonar, pierdes el spec.
- **O3 · Ronda 2 del reporte** con el template §9 completo: autochequeo
  A1–A14, salida real de `npm run lint`, `npm run build` y el gate de
  captura pegada, y la guía de QA manual. Responde O1–O3 una por una.

## Nota de higiene (para el founder, no para Codex)

Estado de git al momento de esta ronda: rama `stage-m-front` en `26e65cd`,
con dos commits de Codex que sólo contienen `M1_REPORT.md`. `M_DESIGN_003`,
`M1_SPEC.md` y el cambio de `README.md` seguían **untracked**. O2 lo corrige
dentro de la rama, sin tocar `main`.
