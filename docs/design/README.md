# Track M-DISEÑO (Bloque M · rediseño visual desde cero)

**Estado: ACTIVO en paralelo a M0 · research y diseño ONLY — cero código.**

Este directorio es el espacio EXCLUSIVO del rediseño de interfaz (Bloque M).
Existe para que el trabajo de diseño avance en paralelo al Bloque M0 (que corre
en otro chat) sin contaminar su árbol ni su contexto.

## Protocolo de aislamiento (no negociable)

1. **Este track NO toca**: `src/`, `supabase/`, `scripts/`, ni los documentos de
   autoridad que M0 usa (`CLAUDE.md`, `AGENTS.md`, `docs/ROADMAP.md`,
   `docs/M0_*`). La implementación del Bloque M sigue BLOQUEADA por M0 en el
   roadmap; este track sólo produce investigación y especificaciones.
2. **Todo vive aquí** como archivos nuevos con prefijo `M_DESIGN_` y numeración
   secuencial (`M_DESIGN_001_…`, `M_DESIGN_002_…`). Archivos nuevos = untracked
   = cero ruido en el `git status` / diff del chat de M0.
3. **Sin commits** salvo orden explícita del founder. Cuando se commitee, será
   un commit propio `docs(M-design): …` sin código. El puntero de una línea en
   `docs/ROADMAP.md` («track de diseño M corre en paralelo, research-only») se
   agrega recién en ese commit coordinado, no antes.
4. **Prototipos** (cuando el founder los autorice) viven fuera de `src/` —
   en `prototypes/` o como artifacts — jamás dentro de la app real.
5. La rama de implementación (`stage-m-front`) se corta recién cuando empiece
   el código, desde un commit posterior al cierre de M0 (o coordinado con él).

## Prototipos

- `prototypes/orbe-kipu.html` — **mock interactivo v1** (2026-08-18). Los tres
  niveles, los cinco orbes con sus materias, tema noche/día, captura con caída
  de líquido, cruce de capa y estados especiales por el panel «Guion».
  Publicado como artifact: https://claude.ai/code/artifact/870d0557-c84f-4823-a909-733d773e3ae3
  Es un archivo autónomo fuera de `src/` — no toca la app.

## Índice

- [M_DESIGN_001 — Visión y first principles](M_DESIGN_001_VISION_FIRST_PRINCIPLES_2026-08-18.md)
  · 2026-08-18 · La tesis, el análisis de la propuesta del founder (orbe /
  3 niveles / carrusel de capas), refinamientos, riesgos, mapa de superficies
  y decisiones abiertas D1–D7.
- [M_DESIGN_002 — Decisiones resueltas D1–D7](M_DESIGN_002_DECISIONES_2026-08-18.md)
  · 2026-08-18 · Respuestas del founder + verificación contra el motor.
  Carrusel de 5 orbes con «Metas» unificado (el motor ya calculaba los aportes
  reservados), patrón líquido/fantasma/hueco, regla de apertura en la capa
  actual con histéresis, dock texto+voz+foto, PWA-first. **Sustituye la §12 de
  M_DESIGN_001.**
