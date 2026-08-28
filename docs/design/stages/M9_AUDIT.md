# M9_AUDIT — Acto 1 · Ronda 1 · VEREDICTO: **VERDE**

- **Fecha:** 2026-08-27 · **Árbol auditado:** `stage-m-front` @ `9d308f8`
- **Entrada:** `M9_REPORT.md` Ronda 1 + `M9_PREDELETE_AUDIT.md`.
- **Método:** los dos runners + **los dos harnesses de mutación** + lint +
  build + E2E real + verificación de redirects y documentos + **una mutación
  propia sobre una garantía que debía sobrevivir al cierre**.

**El Acto 1 del Bloque M queda cerrado.** Se barrió, se borró sólo lo probado,
los documentos de autoridad dejaron de mentir, y **el camino de vuelta sigue
intacto** — que era la condición de este stage.

---

## Z1 · Lo que NO se tocó (la verificación invertida)

`shell-mode.ts` con `KIPU_SHELL`, `AppSidebar`/`AppMain`/`AppBottomNav`/
`PARENT_TAB`, `LegacyDashboardSkeleton` y la bifurcación de `page.tsx`:
**los cinco intactos**. El rollback existe.

Y hay algo mejor que mi comprobación puntual: **el gate ahora defiende la
convivencia**. La mutación `M9-1` («la convivencia desaparece») mata un test
con nombre si alguien retira el camino legacy. La promesa del Acto 1 dejó de
depender de que nos acordemos.

## Z2 · La auditoría pre-borrado es evidencia, no una lista de deseos

Medida **por símbolo**, con la salida pegada, no por parecido de nombre.
Entrega la tabla de qué queda huérfano y **bajo qué condición** («sólo después
del corte conjunto»), y —lo que más valoro— **dos hallazgos negativos**:

- `/dev/ui-preview` **no** queda huérfano por análisis estático: sigue
  importando exports visuales legacy, así que el Acto 2 deberá decidirlo
  explícitamente.
- **`QuipuCord` no se puede retirar**: `/app/saldo` lo consume hoy.

Su conclusión es la correcta: el corte es **una operación conjunta** sobre
siete archivos y dos anclajes de M8; borrar piezas sueltas dejaría ramas rotas
o un gate más débil. Con esto, el Acto 2 se ejecuta **leyendo**, no
investigando.

## Lo demás, verificado por ejecución

| | Resultado |
|---|---|
| **Batería** | `lint` **0 errores** · `build` **exit 0** · captura **854/854** por **los dos runners** · **los dos harnesses de mutación en verde**: los cuatro de M8 y los cuatro de M9, cada uno muriendo por su nombre y restaurando |
| **E2E** | **11/11 verdes, residuo cero** |
| **Z5 · borrados** | `GoalPlanCard` (−72), los cuatro `loading.tsx` de redirects, `saldoStale` y el cuerpo de `cashflow`; cada uno con su prueba de cero referencias |
| **Z6/Z7 · rutas** | Los cuatro redirects retirados siguen vivos (`margen`→saldo, `readiness`→saldo, `precision`→mis-datos, `reality`→spending) y **`/app/cashflow`→`/app/mes`**: ninguna superficie quedó sin puerta |
| **Z8/Z9 · autoridad** | `CLAUDE.md` y `AGENTS.md` corregidos en el punto exacto: el tanque pasa a ser «el nivel líquido de un orbe vivo en un carrusel de cinco capas» y **el quipu sobrevive como historia e identidad** en los indicadores y el cordón. Doctrina financiera intacta |
| **Z10 · roadmap** | El hallazgo de las puertas queda **marcado CERRADO desde M6** |
| **Z11 · QA** | `TEST_SCRIPTS.md` cubre los ocho estados honestos (niebla, día 1, lectura caída, sin conexión, reserva sin objetivo, huecos, recibo incompleto, patrimonio negativo) y las superficies nuevas |

## Mi mutación: la garantía más vieja sigue mordiendo

Reintroduje la palabra prohibida **«colchón»** en una superficie de usuario
(el asa del santuario). Murieron **dos** aserciones por su nombre: **IR65‑a**
—el trinquete que J‑6 dejó instalado hace bloques— y **M9‑3**, la nueva.
`852/854`; revertido ⇒ **854/854** y árbol limpio. La higiene de vocabulario
no sólo sobrevivió al cierre: quedó doblemente defendida.

## Estado del bloque

**Bloque M, Acto 1: CERRADO.** `stage-m-front` acumula **M1–M9**.

Nueve stages, todos verificados por ejecución: el santuario y sus cinco capas,
el orbe vivo con su escalera de calidad, la conversación con recibos releídos
del ledger, la captura sin salir, la voz, la perspectiva **con las nueve
puertas abiertas**, las once superficies re-vestidas sin que cambiara un
número, la PWA que jamás cachea dinero, y este cierre.

## Lo que sigue, y ya no es nuestro

1. **La pasada del founder**, que ahora es el único paso que falta para saber
   si esto se siente como Kipu: la voz y el aura en un teléfono real, los fps
   en gama media, el amanecer, la densidad de texto (las líneas de
   «Denominador · …» de M6 y la poda de M7), y la instalación de la PWA con su
   ícono recortado.
2. **El Acto 2**, después de esa pasada y de uso real: borrar el shell viejo,
   el flag y su navegación en un commit propio, con
   `M9_PREDELETE_AUDIT.md` como guion y la decisión pendiente sobre
   `/dev/ui-preview`.
