# M9_ACT2_SPEC — Acto 2: retirar el shell viejo (prompt ejecutable para Codex)

- **Fecha:** 2026-08-27 · **Autor:** Claude (auditor del Bloque M)
- **Para:** Codex, en la rama `stage-m-front`
- **Punto de partida:** M9 Acto 1 aceptado (`9d308f8`).
- **Decisión del founder:** ejecutar el Acto 2 **ahora**, antes de su pasada,
  para revisar el resultado ya commiteado y desplegado. Mi reparo (el Acto 1
  lo difería hasta después de esa pasada) queda registrado y **levantado**: se
  procede.

---

## 0. Lectura obligatoria

1. **`docs/design/stages/M9_PREDELETE_AUDIT.md` — es el guion de este stage.**
   Su §«Orden ejecutable para el Acto 2» manda; sus tablas §1–§4 dicen qué
   queda huérfano, qué anclajes caen, qué depende del flag y **qué NO se puede
   borrar aunque lo parezca**.
2. `M9_SPEC` y `M9_AUDIT`, `M8_SPEC` (anclajes) y `M1_SPEC §4` con la
   corrección de `M7_SPEC §4.1`.

---

## 1. Qué es el Acto 2

Retirar la convivencia: `/app` deja de bifurcar y el santuario pasa a ser **el
único front**. Es una operación **de presentación**: ni un dato, ni una
fórmula, ni un writer cambian.

**Fuera de alcance:** funcionalidad nueva, migraciones, dependencias, y
cualquier cambio en `src/lib/financial/**`, Supabase, agente, Telegram o
writers.

---

## 2. Decisiones vinculantes

- **D‑A2.1 · El orden de la auditoría es obligatorio.** Primero los tres
  callers a un solo camino vivo; **después** re-anclar `M8-3`, `M8-4` y
  `M9-1`; **sólo con esos anclajes verdes**, borrar. Borrar antes de re-anclar
  deja el gate más débil justo cuando más se necesita.
- **D‑A2.2 · `M9-1` cambia de signo.** Hoy exige que la convivencia **exista**
  (era el seguro del Acto 1). Pasa a exigir su **ausencia completa** MÁS la
  prueba de que santuario, superficies de detalle y loading siguen
  alcanzables. Una aserción de ausencia sin prueba de alcance no sirve: podría
  pasar con la app rota.
- **D‑A2.3 · `SaldoKipu.tsx` se poda POR EXPORT, jamás por archivo.**
  `QuipuCord` sigue vivo en `/app/saldo`.
- **D‑A2.4 · `/dev/ui-preview` se decide explícitamente** —reescribir contra el
  santuario o retirar— y se dice en el reporte. No se deja a medias.
- **D‑A2.5 · Cero cambio de comportamiento.** El santuario debe verse y
  funcionar **igual** antes y después: esto es una resta, no un rediseño.
- **D‑A2.6 · Sólo se borra lo probadamente huérfano**, cada uno con su prueba
  de cero referencias, medida **por símbolo**.

---

## 3. Contrato técnico

Sigue el orden del guion:

1. `page.tsx` renderiza sólo `SantuarioShell`; `loading.tsx` sólo
   `DashboardSkeleton`; `layout.tsx` conserva **auth y `TimezoneCapture`** y
   reemplaza `AppMain`/`AppBottomNav` por el wrapper vivo de las superficies de
   detalle (que siguen necesitando su envoltorio y su vuelta).
2. Re-ancla `M8-3` (skeleton por un límite vivo, conservando geometría y la
   ausencia del viejo), `M8-4` (las dos orillas laterales al wrapper nuevo,
   conservando las cinco superficies CSS y las cuatro orillas) y `M9-1`
   (D‑A2.2). Mueve también la mutación `M9-1` a la pieza cuya pérdida haga
   fallar la aserción nueva.
3. Con gates y mutaciones verdes, retira: `shell-mode.ts`, `AppNav.tsx`,
   `LegacyDashboardSkeleton`, la entrada `KIPU_SHELL` de `.env.example`, y
   `DisplayCurrencyToggle.tsx`, `UpcomingCommitmentsCard.tsx` y los exports
   `HouseholdCard`/`FxCard` de `DashboardCards.tsx` **si y sólo si** la
   medición por símbolo los deja sin consumidores.
4. Resuelve `/dev/ui-preview` (D‑A2.4) y poda `SaldoKipu.tsx` por export.
5. Verifica que **las cinco puertas de compatibilidad** (`margen`,
   `readiness`, `precision`, `reality`, `cashflow`) siguen redirigiendo y que
   **las nueve puertas de M6** siguen alcanzables.

---

## 4. Criterios de aceptación (AA1–AA12)

- **AA1** `/app` no bifurca: santuario siempre. `loading.tsx` sólo el skeleton
  del santuario. `layout.tsx` conserva auth y `TimezoneCapture`.
- **AA2** `M8-3`, `M8-4` y `M9-1` re-anclados **antes** de cualquier borrado y
  **sin debilitarse**; `M9-1` es ahora ausencia + alcance (D‑A2.2).
- **AA3** Borrados hechos **después** de esos anclajes en verde, cada uno con
  su prueba de cero referencias por símbolo.
- **AA4** `QuipuCord` sigue vivo y `/app/saldo` funciona; `SaldoKipu.tsx`
  podado por export.
- **AA5** `/dev/ui-preview` resuelto y declarado.
- **AA6** Las nueve puertas de M6 alcanzables y los cinco redirects vivos.
- **AA7** Cero cambio de comportamiento en el santuario (compáralo antes/después
  y dilo).
- **AA8** Cero cambios en `financial/**`, Supabase, agente, Telegram y writers.
- **AA9** Batería completa: `lint`, `build`, captura por **los dos runners**,
  **los dos harnesses de mutación** y **E2E con residuo cero**; salidas
  pegadas.
- **AA10** Una mutación propia por cada aserción re-anclada, muriendo **por su
  nombre**.
- **AA11** Nada borrado «por parecer muerto»: si dudas, se queda y lo dices.
- **AA12** Reporte con **«Borrados y su prueba»**, **«Anclajes re-anclados»** y
  **«Decisión sobre `/dev/ui-preview`»**.

## 5. Rama y reporte

Rama `stage-m-front`; commits `feat(M9-A2): …` / `chore(M9-A2): …`. Reporte en
`docs/design/stages/M9_ACT2_REPORT.md` con el template de `M1_SPEC §9`.

## 6. Definición de HECHO

AA1–AA12 verificados, batería pegada, reporte escrito y VERDE del auditor en
`M9_ACT2_AUDIT.md`. **Con eso el Bloque M queda cerrado del todo** y la rama
lista para que el founder la mergee, despliegue y revise en producción.
