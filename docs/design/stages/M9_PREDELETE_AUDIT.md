# M9_PREDELETE_AUDIT — Bloque M, cierre Acto 1

- **Fecha:** 2026-08-27
- **Rama medida:** `stage-m-front`
- **Punto de código:** `8f58091`
- **Alcance:** evidencia para un Acto 2 posterior a la pasada del founder. Este
  documento no autoriza ni ejecuta ese borrado.

## Conclusión

El shell legacy todavía es alcanzable y todavía sostiene un rollback real.
Retirarlo exige una operación conjunta sobre `page.tsx`, `loading.tsx`,
`layout.tsx`, `shell-mode.ts`, `AppNav.tsx`, `.env.example` y dos anclajes M8.
Borrar piezas sueltas hoy dejaría ramas rotas o debilitaría el gate. Por eso M9
conserva íntegros el flag, la rama legacy, su navegación y su skeleton.

## 1. Qué quedaría huérfano al retirar el shell viejo

La medición se hizo por símbolo, no por parecido de nombre:

```text
$ rg -n 'getShellMode|KIPU_SHELL|LegacyDashboardSkeleton|AppBottomNav|AppMain|PARENT_TAB' .env.example src/app/app src/lib/shell-mode.ts src/app/dev/capture-test/page.tsx
.env.example:46:KIPU_SHELL=legacy
src/lib/shell-mode.ts:5:export function getShellMode(): ShellMode {
src/app/app/page.tsx:81:  if (getShellMode() === "orbe") {
src/app/app/loading.tsx:5:  return getShellMode() === "orbe" ? <DashboardSkeleton /> : <LegacyDashboardSkeleton />;
src/app/app/layout.tsx:30:      <AppMain shellMode={shellMode}>{children}</AppMain>
src/app/app/layout.tsx:31:      <AppBottomNav shellMode={shellMode} />
src/app/app/components/AppNav.tsx:61:const PARENT_TAB: Record<string, string> = {
src/app/app/components/living/states.tsx:114:export function LegacyDashboardSkeleton() {
```

Una vez que `/app` renderice `SantuarioShell` sin bifurcación, el loading use
directamente `DashboardSkeleton` y el layout deje de envolver el árbol con la
nav anterior, estos elementos sí quedarían sin consumidores productivos:

| Archivo / export | Consumidor actual | Estado después del corte conjunto |
|---|---|---|
| `src/lib/shell-mode.ts` · `ShellMode`, `getShellMode` | `page.tsx`, `loading.tsx`, `layout.tsx` | Archivo entero huérfano. |
| `src/app/app/components/AppNav.tsx` · `AppSidebar`, `AppMain`, `AppBottomNav`, internos `NAV_ITEMS`, `BOTTOM_NAV_ITEMS`, `PARENT_TAB`, `activeHref` | `layout.tsx` | Archivo entero huérfano, sólo después de reemplazar su wrapper de detalle. |
| `LegacyDashboardSkeleton` | `app/loading.tsx` | Export huérfano; `DashboardSkeleton` y los demás estados del archivo siguen vivos. |
| `DisplayCurrencyToggle.tsx` | sólo la rama legacy de `app/page.tsx` | Archivo huérfano. |
| `UpcomingCommitmentsCard.tsx` | sólo la rama legacy de `app/page.tsx` | Archivo huérfano. |
| `DashboardCards.tsx` · `HouseholdCard`, `FxCard` | sólo la rama legacy de `app/page.tsx` | Archivo huérfano. |

No aparece una ruta de producto adicional para borrar: `/app` continúa siendo
la ruta del santuario. La ruta `/dev/ui-preview` sigue importando varios
exports visuales legacy de `SaldoKipu.tsx`; por eso **no** queda huérfana por
simple análisis estático y el Acto 2 deberá decidir explícitamente si se
reescribe o se retira. `QuipuCord` tampoco se puede retirar: `/app/saldo` lo
consume hoy.

```text
$ rg -n 'components/SaldoKipu' src --glob '!src/app/app/page.tsx'
src/app/app/saldo/page.tsx:10:import { QuipuCord } from "../components/SaldoKipu";
src/app/dev/ui-preview/page.tsx:18:} from "@/app/app/components/SaldoKipu";

$ rg -n 'DashboardCards|UpcomingCommitmentsCard|DisplayCurrencyToggle' src --glob '!src/app/app/page.tsx'
src/app/app/components/UpcomingCommitmentsCard.tsx:18:export function UpcomingCommitmentsCard({
src/app/app/components/DisplayCurrencyToggle.tsx:9:export function DisplayCurrencyToggle({
```

## 2. Anclajes del gate que se caerían

| Anclaje actual | Por qué cae | Re-anclaje obligatorio en Acto 2 |
|---|---|---|
| `M8-3` extrae `DashboardSkeleton` cortando antes de `LegacyDashboardSkeleton` y exige el ternario `getShellMode() === "orbe"` | Ambos marcadores desaparecen al retirar la convivencia | Extraer el skeleton por un límite vivo y exigir que `app/loading.tsx` importe/renderice sólo `DashboardSkeleton`; conservar todos los chequeos de geometría y ausencia del skeleton viejo. |
| `M8-4` exige safe-area izquierda/derecha en `AppNav.tsx` | El archivo desaparece | Re-anclar esas dos orillas al wrapper vivo de detalle que reemplace `AppMain`; conservar las cinco superficies CSS y las cuatro orillas, nunca quitar la condición. |
| `M9-1` exige flag, branch, nav, `PARENT_TAB` y skeleton presentes | Es el seguro del Acto 1 | Sustituirlo por una aserción de ausencia completa más prueba de que santuario, detalles y loading siguen alcanzables. |
| Mutación `M9-1` cambia `KIPU_SHELL=legacy` | Su ancla desaparece | Mover la mutación al nuevo wrapper/ruteo cuya pérdida haría fallar la aserción re-anclada. |

Los anclajes monetarios y de comportamiento M3–M7 no dependen del shell
legacy. `M7-1` ya trata `/app/cashflow` como redirect sin `DetailSurface`; no
debe eliminarse al hacer el Acto 2.

## 3. Dependencias actuales de `KIPU_SHELL`

| Valor | `/app/page.tsx` | `/app/loading.tsx` | `/app/layout.tsx` |
|---|---|---|---|
| ausente o `legacy` | Rama dashboard anterior | `LegacyDashboardSkeleton` | `AppMain` + `AppBottomNav` visibles |
| `orbe` | `SantuarioShell` | `DashboardSkeleton` del santuario | `AppMain` oculta nav sólo en `/app`; detalles conservan wrapper/nav |
| desconocido | warning una sola vez y fallback `legacy` | mismo fallback | mismo fallback |

Por lo tanto, **quitar sólo la variable de entorno no activa el santuario**:
`getShellMode()` tiene default `legacy`. El Acto 2 debe cambiar primero los tres
callers a un único camino vivo y recién entonces borrar el parser, el tipo y la
entrada de `.env.example` en el mismo cambio verificado.

## 4. Qué no se puede borrar aunque lo parezca

| Pieza | Evidencia viva / razón |
|---|---|
| `src/app/app/page.tsx` | La ruta `/app` permanece; sólo se recorta la rama legacy. |
| `src/app/app/layout.tsx` | Conserva autenticación y `TimezoneCapture`; necesita un wrapper nuevo o directo, no borrado. |
| `DashboardSkeleton`, `FogState`, `ErrorState`, `LearningState`, `DetailPageSkeleton` | Son estados actuales del santuario y detalles; sólo `LegacyDashboardSkeleton` es retirado en Acto 2. |
| `SaldoKipu.tsx` completo | `QuipuCord` vive en `/app/saldo` y `/dev/ui-preview` aún consume los exports antiguos. Primero separar/decidir, luego podar por símbolo. |
| `MovementRow.tsx` y `app-dashboard-helpers.ts` | Vivos en `/app/activity`, `thread-view.ts` y `shell-payload.ts`. |
| `signOutAction` | Aunque `AppNav` lo importa, también lo usa `/app/settings`; no queda huérfano. |
| `/app/margen`, `/app/readiness`, `/app/precision`, `/app/reality`, `/app/cashflow` | Son puertas de compatibilidad declaradas; se conservan como redirects. |
| Todo `src/lib/financial/**`, Supabase, agente, Telegram y writers | El cambio del shell es exclusivamente de presentación; los datos del santuario salen del mismo motor. |

## Orden ejecutable para el Acto 2

1. Congelar un commit aceptado por founder y volver a medir los consumidores.
2. Hacer que `page.tsx` renderice sólo el santuario, `loading.tsx` sólo su
   skeleton y `layout.tsx` conserve auth/timezone con un wrapper vivo de detalle.
3. Re-anclar `M8-3`, `M8-4` y `M9-1` antes de borrar ningún archivo.
4. Ejecutar gates y mutaciones; sólo con esos anclajes verdes retirar
   `shell-mode.ts`, `AppNav.tsx`, `LegacyDashboardSkeleton`, la entrada de env y
   los tres módulos que entonces queden realmente huérfanos.
5. Decidir aparte `/dev/ui-preview` y podar `SaldoKipu.tsx` por export, nunca por
   nombre de archivo.
