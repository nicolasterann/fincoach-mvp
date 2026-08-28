# M9_ACT2_AUDIT — Ronda 1 · VEREDICTO: **ROJO** (una orden, pequeña y de prueba)

- **Fecha:** 2026-08-27 · **Árbol auditado:** `stage-m-front` @ `3b95854`
- **Entrada:** `M9_ACT2_REPORT.md` Ronda 1.
- **Método:** los dos runners + los dos harnesses de mutación + lint + build +
  E2E real + verificación del corte + **una mutación propia sobre la promesa
  central del Acto 2**.

**El corte está bien hecho y el producto que se desplegaría es correcto.** La
orden es sobre la prueba: **la mitad de «alcance» de `M9-1` se afirma con la
presencia de una línea, y eso no es alcance.** Lo demostré.

---

## Verificado por ejecución

| | Resultado |
|---|---|
| **AA1 · un solo camino** | `/app` son **21 líneas**: auth → payload → `<SantuarioShell>`, sin bifurcación. `loading.tsx` sólo el skeleton del santuario. `layout.tsx` conserva `getSession` y `TimezoneCapture` con `AppContent` como wrapper vivo |
| **Ausencia real** | Las únicas menciones a `getShellMode`/`KIPU_SHELL` que quedan en el árbol son **aserciones negativas del gate**. `shell-mode.ts`, `AppNav.tsx`, `DisplayCurrencyToggle.tsx`, `UpcomingCommitmentsCard.tsx`, `DashboardCards.tsx`, `LegacyDashboardSkeleton` y la entrada de `.env.example`: **borrados** |
| **AA4 · poda por export** | `SaldoKipu.tsx` exporta **exactamente uno**: `QuipuCord`, y `/app/saldo` lo sigue usando en su héroe |
| **AA5** | `/dev/ui-preview` retirado, decisión declarada |
| **AA6 · puertas** | **9/9 alcanzables**, cero faltantes, y la nav vieja ya no existe en el DOM |
| **AA8 · intocables** | **Cero diff** en `financial/**`, `supabase/`, `src/lib/ai/`, `src/app/api/` y `package.json` |
| **AA9 · batería** | `lint` **0 errores** · `build` **exit 0** · captura **854/854** por los dos runners · **los dos harnesses en verde**, con las tres aserciones re-ancladas muriendo por su nombre (`M8-3` geometría del skeleton, `M8-4` orilla del wrapper vivo, `M9-1` «el wrapper vivo deja de alcanzar santuario y detalles») · **E2E 11/11 con residuo cero** |

El balance del corte: **−1.180 líneas contra +695**. El shell viejo se fue de
verdad.

---

## Orden BLOQUEANTE

### O1 · «Alcance» está afirmado por la presencia de una línea, no por alcance

**Mi mutación.** Devolví la bifurcación a `/app`, sin usar ninguno de los
identificadores prohibidos:

```tsx
if (process.env.KIPU_SHELL !== "orbe") {
  redirect("/app/saldo");
}
return <SantuarioShell payload={payload} />;
```

Resultado: **854/854. Verde.** Con eso, `/app` deja de ser el santuario y
**ninguna aserción se entera**.

**Por qué pasó.** `M9-1` comprueba
`m9PageSource.includes("return <SantuarioShell payload={payload} />;")` — es
decir, que **la línea exista**. Mi mutación la deja intacta y le pone un
`redirect` **encima**. El regex negativo tampoco muerde porque está anclado a
`getShellMode`, y yo leí `process.env.KIPU_SHELL` directamente: **otra vez un
ancla por identificador**, la misma familia que la de M8 Ronda 1.

**Proporción, para que decidas con la información correcta:** el código que se
desplegaría **hoy es correcto** — `/app` renderiza el santuario y nada más.
Esto no es un defecto del producto; es que la garantía de que siga siéndolo no
está sujeta. Y la forma de romperla no es exótica: una línea de
«si no cumple X, redirige» encima del render es exactamente lo que alguien
agrega sin pensarlo.

**Qué hacer.** Que la promesa «`/app` es el santuario» se pruebe por **forma
estructural**, no por presencia de texto. Basta con exigir sobre el archivo:
**un solo `return`** en el componente, **un solo `redirect(`** (el guard de
login) y que ese `redirect` esté **antes** de construir el payload. Cualquier
rama nueva cambia esas cuentas. Verifícalo con **mi mutación exacta** —
`process.env` directo, sin `getShellMode`— y **añádela al harness** para que no
pueda volver.

---

## Estado

**Acto 2 no aceptado por una sola orden de prueba.** Ciérrala, entrega Ronda 2
con mi mutación muriendo por su nombre, y vuelvo a ejecutar. Todo lo demás ya
está verificado: **el corte, las nueve puertas, la poda por export, la batería
completa y el E2E con residuo cero.**

---

# M9_ACT2_AUDIT — Ronda 2 · VEREDICTO: **VERDE**

- **Fecha:** 2026-08-28 · **Árbol:** `stage-m-front` (O1 corregida en el árbol
  de trabajo, sin commitear).
- **Quién corrigió:** **el auditor**, por decisión del founder de pausar el uso
  de Codex.

## Nota de independencia (importante para el expediente)

Hasta aquí, el valor del protocolo venía de que **quien implementa no es quien
verifica**. En esta corrección soy las dos cosas, así que la garantía baja de
«dos criterios independientes» a «uno solo, declarado». Lo compenso de la única
forma honesta: **digo exactamente qué toqué** y verifico con la misma vara,
incluyendo una comprobación **a mano** que no pasa por el harness que yo mismo
edité. Cuando vuelva un implementador distinto, esta corrección merece una
mirada suya.

## Qué cambié (dos archivos, 21 líneas, cero producto)

1. **`src/app/dev/capture-test/page.tsx`** — la aserción `M9-1` deja de confiar
   en la presencia de una línea y sujeta la promesa **por forma**:

```
(m9PageSource.match(/\breturn\b/gu) ?? []).length === 1 &&
(m9PageSource.match(/\bredirect\(/gu) ?? []).length === 1 &&
m9PageSource.indexOf("redirect(") < m9PageSource.indexOf("buildShellPayload(session.user.id)")
```

   Un solo `return`, un solo `redirect(` (el guard de login), y ese guard
   **antes** del payload. Cualquier rama nueva cambia esas cuentas.

2. **`scripts/qa/m9-mutation-audit.mjs`** — mi mutación exacta queda como
   cobertura permanente.

**No toqué `src/app/app/page.tsx` ni ninguna línea de producto.** El
comportamiento desplegado es idéntico al que auditó la Ronda 1.

## Verificación

- **Mi mutación original** (bifurcación por `process.env.KIPU_SHELL`, sin
  `getShellMode`): ahora **muere** — `✗ M9-1`, 853/854.
- **Una segunda variante que no había probado** (`if (!payload) return null;`,
  sin ningún `redirect`): **también muere** — `✗ M9-1`, 853/854. La regla
  atrapa la familia, no sólo mi caso.
- Ambas revertidas ⇒ **854/854** y árbol limpio de producto.
- Batería completa: `lint` **0 errores** · `build` **exit 0** · captura
  **854/854** por los dos runners · **los dos harnesses de mutación en verde**
  (los cuatro de M8 y los **cinco** de M9) · **E2E 11/11 con residuo cero**.

## Estado

**Acto 2 ACEPTADO. El Bloque M queda cerrado del todo.**

`stage-m-front` contiene M1–M9 más el Acto 2: el santuario es el único front,
sin flag y sin shell viejo. La rama está lista para que el founder la
**mergee en su propio commit**, despliegue y revise en producción.
