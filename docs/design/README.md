# Track M-DISEÑO (Bloque M · rediseño visual desde cero)

**Estado: FASE DE BUILD (desde 2026-08-24, M0 cerrado y Bloque M activo).**
La fase research-only terminó con M_DESIGN_003. Ahora: Claude especifica y
audita; Codex implementa por stages en la rama `stage-m-front`.

## Protocolo de build (el repo es el canal Claude↔Codex)

Por cada stage Mn, tres archivos de nombre fijo en `stages/`:

| Archivo | Autor | Regla |
|---|---|---|
| `Mn_SPEC.md` | Claude | La orden de trabajo completa. Codex jamás lo edita. |
| `Mn_REPORT.md` | Codex | Append-only por rondas (`## Ronda N`); template en el spec. |
| `Mn_AUDIT.md` | Claude | Veredicto VERDE/ROJO + órdenes numeradas On si rojo. |

Ciclo: founder pega el prompt corto en el chat de Codex → Codex ejecuta el
spec y escribe su reporte → founder dice «audita Mn» a Claude → Claude
verifica por ejecución y emite veredicto → si ROJO, founder dice «corrige
Mn» a Codex (lee el audit, responde orden por orden en una ronda nueva) →
repetir hasta VERDE → founder mergea `stage-m-front`. El founder transporta
señales, nunca contenido. Nadie declara verde sin pegar la salida real de
los gates. Stages: M1–M9 según M_DESIGN_003 §6; cada spec nuevo llega solo
después del VERDE del anterior.

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
- [stages/M1_SPEC — Cimientos](stages/M1_SPEC.md) · 2026-08-24 · Primer stage
  de build: flag `KIPU_SHELL`, santuario con carrusel de 5 orbes estáticos
  honestos, payload de UNA lectura, puertas a todos los detalles, dock v1,
  harness `/dev/shell-preview`, criterios A1–A14 y protocolo de comunicación.
  **CERRADO VERDE en 3 rondas** (ver `M1_AUDIT.md`).
- [stages/M2_SPEC — El orbe vivo](stages/M2_SPEC.md) · 2026-08-24 · Shader
  WebGL portado del mock con UN solo contexto, cinco materias por capa,
  máquina de ocho estados (amanecer cableado; capturando/escrito/cruce tras
  una API imperativa para M4–M5), escalera de calidad que se degrada sola con
  su instrumentación medible, y los arrastres m1–m3 de M1. Criterios B1–B14.
- [stages/M3_SPEC — Diálogo I](stages/M3_SPEC.md) · 2026-08-25 · El chat que
  expresa al agente: recibos releídos del ledger (nunca del modelo y **sin
  flecha de saldo** — el motor sólo conoce el post-write), `status` deja de
  descartarse, hilo unificado web+Telegram con procedencia, dedupe por
  identidad durable, fix de lectura del digest invisible (C4), `?turn=` para
  la cinta, y los anclajes del gate re-anclados sin debilitarse. Criterios
  T1–T14.
- [stages/M4_SPEC — Dock, pill y diálogo en su sitio](stages/M4_SPEC.md) ·
  2026-08-25 · Capturar sin salir del santuario por la MISMA server action, el
  orbe moviéndose sólo con nivel calculado en servidor, la pill con su escalera
  de cuatro fuentes reales (y sin afirmar ausencia cuando no pudo leer), el
  chat como hoja, la cámara alineada al contrato del texto, y el **E2E de
  persona desechable** como entregable que salda la deuda de verificación del
  bloque. Criterios U1–U16.
- [stages/M5_SPEC — Voz y aura](stages/M5_SPEC.md) · 2026-08-25 · La puerta web
  del micrófono sobre un pipeline ya probado (`transcribeAudio` + el camino de
  evidencia), el aura ligada al ciclo REAL del agente en sus cuatro registros
  —y prohibido simular ninguno—, negociación de mime base contra `AUDIO_MIMES`,
  ciclo de vida del micrófono con liberación de pistas, y fallos de voz dichos
  en vez de tragados. Criterios V1–V16.
- [stages/M6_SPEC — Perspectiva](stages/M6_SPEC.md) · 2026-08-25 · Los cinco
  módulos como preguntas humanas (Hoy · Tu mes · cordón del Saldo · Progresos ·
  Lo que viene), anillos vs barras, **cero scores**, ningún porcentaje sin
  denominador declarado (verificadas las fuentes: el objetivo de reserva es
  opcional y la historia de deuda/patrimonio vive en los snapshots), el sueño
  con nombre al frente, y **el cierre del hallazgo más viejo del roadmap: que
  no quede ninguna superficie sin puerta**. Criterios W1–W16.
- [stages/M7_SPEC — Re-vestir los detalles](stages/M7_SPEC.md) · 2026-08-25 ·
  Las once superficies al sistema nuevo con la regla dura de que **ningún
  número cambia de valor**, el dinero derivado en páginas movido al servidor o
  declarado, el framing semanal muerto donde enmarca y **vivo donde es cadencia
  elegida** (lección J-6: por contexto, jamás find/replace), C5 cerrado con los
  nombres del detalle de Metas, y poda de prosa. Criterios X1–X16.
- [M_DESIGN_003 — Auditoría de pre-implementación](M_DESIGN_003_AUDITORIA_PREIMPLEMENTACION_2026-08-24.md)
  · 2026-08-24 (M0 cerrado, Bloque M activo) · Veredicto GO sobre la propuesta,
  medición del front actual, 7 correcciones factuales de los docs contra el
  código (multicanal C1, recibos C2, pill C3, bug del digest C4, nombres de
  Metas C5, niebla C6, voz web C7), análisis first-principles de usuario
  (Deuda número-vs-líquido, el sueño a dos gestos, estados día-1), decisiones
  nuevas D8–D14 y plan de stages M1–M9. Pendiente: discusión con el founder →
  specs por stage en `M_DESIGN_004+`.
