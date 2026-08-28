# M8_SPEC — Stage M8 «PWA de verdad y la primera impresión» (prompt ejecutable para Codex)

- **Fecha:** 2026-08-25 · **Autor:** Claude (auditor del Bloque M)
- **Para:** Codex, en la rama `stage-m-front`
- **Punto de partida:** M1–M7 aceptados (M7 con su registro ya corregido).
- Si algo bloquea de verdad, escríbelo en `M8_REPORT.md` §Preguntas y detente;
  si sólo bloquea una parte, avanza con el resto.

---

## 0. Lectura obligatoria

1. `CLAUDE.md`, `AGENTS.md`.
2. `M1_SPEC` (§11 y §4) · `M2`–`M7_SPEC` y los siete `*_AUDIT.md` — en especial
   la **corrección de `M7_SPEC §4.1`** sobre cómo se declara una entrada a un
   área restringida.
3. `M_DESIGN_001` **§9** (plataforma, gestos y rendimiento; **D1 = PWA
   instalada primero**) y §10 · `M_DESIGN_002` **D1** ·
   `M_DESIGN_003` **§2.5 y §2.6** (las costuras de identidad y la PWA
   aspiracional: es el inventario que este stage salda).
4. En el código: `src/app/manifest.ts`, `src/app/layout.tsx` (viewport y
   `appleWebApp`), `src/app/opengraph-image.tsx` (**ya usa `next/og`: ésa es la
   vía sin dependencias para generar PNG**), `src/app/app/loading.tsx` +
   `components/living/states.tsx`, `src/app/page.tsx` (landing),
   `src/app/not-found.tsx` y `src/app/error.tsx`.

---

## 1. Qué es M8 (y qué NO)

M8 salda **la decisión D1** —«PWA instalada primero»— que hasta hoy es una
intención: hay manifest, pero **un solo ícono SVG sin variantes, cero service
worker, `theme_color` sólo oscuro** y un esqueleto de carga que dibuja el
dashboard **retirado**. Y arregla **la primera impresión**: hoy el landing
vende un anillo que la app no tiene.

**Fuera de alcance:** borrar el shell viejo, redirects y barrido final
(**M9**) · **cero migraciones** · cero dependencias npm · ningún cambio de
lógica financiera ni de copy de producto más allá de lo que este spec pide.

---

## 2. Decisiones vinculantes

- **D‑M8.1 · EL SERVICE WORKER NO CACHEA DINERO. NUNCA.** Es la regla más
  importante del stage y la más fácil de romper sin darse cuenta: un saldo
  cacheado y servido después es **exactamente** «un snapshot viejo mostrado
  como ahora», que `M_DESIGN_001 R5/P3` prohíbe y que el Bloque I persiguió
  durante seis auditorías. Reglas duras:
  - Precachea **sólo** assets estáticos e inmutables y **una página de sin
    conexión**.
  - **`NetworkOnly`** para `/app/**`, `/api/**`, server actions y cualquier
    respuesta autenticada. Sin `stale-while-revalidate`, sin fallback a una
    copia vieja de esas rutas.
  - **Sin conexión** ⇒ la página honesta de sin conexión, **jamás una cifra**.
  - Cero background sync y cero push en este stage.
  - El SW debe poder **actualizarse y desinstalarse** sin dejar al usuario
    atrapado en una versión vieja, y **no puede romper** el `share_target`
    (`?share=`) ni los shortcuts que ya existen.
- **D‑M8.2 · Los íconos se generan con `next/og`, sin dependencias.** El repo
  ya lo hace en `opengraph-image.tsx`. Usa la generación por archivo de Next
  (`icon.tsx`, `apple-icon.tsx`) para emitir PNG reales, y añade una variante
  **maskable** con su zona segura (el arte no puede tocar el borde: Android la
  recorta en círculo). El manifest declara **192 y 512** más `maskable`, sin
  perder el SVG como `any`.
- **D‑M8.3 · `theme_color` por tema.** Hoy es un solo valor oscuro, así que un
  usuario en modo día instala la app y recibe el cromo del navegador oscuro.
  Next admite `themeColor` como lista con `media`; declara claro y oscuro con
  los tokens que M1 ya definió.
- **D‑M8.4 · El esqueleto de carga no puede mostrar un producto retirado.**
  `DashboardSkeleton` dibuja hoy **un círculo de 168 px y una grilla de seis
  tarjetas** —el dashboard de anillo y métricas que el Bloque D retiró— y es
  justo lo que se ve antes de que pinte el santuario. El esqueleto debe
  parecerse a **lo que realmente va a cargar**, y con el flag apagado, a lo
  que carga el camino viejo.
- **D‑M8.5 · El landing deja de vender un anillo.** `page.tsx` muestra un arco
  al 62% rotulado «Tu Saldo Kipu» (el comentario todavía dice «Margen ring») y
  usa `IconRing`/`IconPulse`. La primera imagen del producto tiene que ser
  **el orbe**, no una forma retirada. Puede ser una imagen estática o una
  versión ligera: **el landing no monta el shader ni pide WebGL**.
- **D‑M8.6 · Modo día completo en las tres superficies huérfanas.** El landing,
  `not-found.tsx` y `error.tsx` usan `white/xx` crudo (10 apariciones sólo en
  el landing) y por eso **no participan del tema claro** que el resto de la app
  sí respeta. Pasan a los tokens.
- **D‑M8.7 · Safe areas de verdad.** `viewportFit: "cover"` está declarado
  desde siempre, pero el respeto a los insets vive en pocos sitios. Revisa las
  cuatro orillas en el santuario, las dos hojas y las superficies re-vestidas.
- Siguen firmes: constitución `M_DESIGN_001 §10`, prohibiciones `M1_SPEC §4`
  (con la corrección de `M7_SPEC §4.1` sobre declarar entradas), y toda la
  honestidad de M3–M7.

---

## 3. Contrato técnico

### 3.1 El service worker mínimo

Escrito a mano (sin librerías), registrado sólo en cliente y **sólo en
producción**. Su lista de precache es explícita y corta. Todo lo demás pasa por
red. Documenta en el reporte, con la lista literal, **qué se cachea y qué no**,
y por qué cada entrada es segura — es decir, por qué **ninguna** puede contener
una cifra del usuario.

Debe convivir con lo que ya existe: `start_url: /app`, `scope: /`, los dos
shortcuts y el `share_target` GET hacia `/app/chat`.

### 3.2 Íconos y manifest

`icon.tsx` (192 y 512), `apple-icon.tsx`, y una entrada **maskable** con zona
segura. El manifest declara los tamaños reales; `background_color` y
`theme_color` coherentes con D‑M8.3. **No inventes un arte nuevo**: usa la
identidad que ya existe (el orbe y su acento de Saldo).

### 3.3 Esqueletos

El de `/app` refleja el santuario (asa, tabs, orbe, cifra, pill, cinta, dock)
en bloques, sin números. Los de las superficies re-vestidas reflejan su forma
nueva. Ninguno puede dibujar el anillo ni la grilla retirados.

### 3.4 Landing y superficies huérfanas

Landing: el orbe como imagen principal, copy vigente (Saldo Kipu, capas,
Reserva; jamás vocabulario retirado), tokens en vez de `white/xx`, y modo día
funcionando. `not-found` y `error` igual, en su escala.

### 3.5 Harness y E2E

- No hace falta harness nuevo. Si te ayuda, una vista de `/dev` que liste los
  íconos generados y el estado del SW.
- **E2E:** no se pide prueba de datos nueva; el E2E existente debe seguir en
  **verde con residuo cero** (es no-regresión).

---

## 4. Prohibiciones duras

1. Todo lo de `M1_SPEC §4` con la corrección de `M7_SPEC §4.1`; cero
   migraciones; cero dependencias npm.
2. **El SW no cachea nada autenticado ni nada con cifras** (D‑M8.1).
3. Sin conexión **no se muestra un número**, se muestra la página honesta.
4. El landing **no monta WebGL** ni pide permisos.
5. No debilitar aserciones; cada substring anclado aparece **exactamente una
   vez**.
6. No tocar `/app/cashflow` ni el shell viejo (eso es M9).
7. No commits en `main`, no merge, no deploy.

---

## 5. Copy

- Sin conexión: **«Sin conexión. Tus números viven en el servidor, así que
  prefiero no mostrarte uno viejo. Vuelvo apenas haya señal.»**
- Landing: el vigente, revisado para que no prometa nada retirado.
- `not-found` / `error`: calmos, sin culpa, con vuelta al santuario.

---

## 6. Criterios de aceptación (Y1–Y16)

- **Y1** El manifest declara **192, 512 y maskable** con PNG reales servidos
  por la app; el SVG sobrevive como `any`.
- **Y2** La variante maskable respeta su zona segura (el arte no toca el
  borde).
- **Y3** `theme_color` responde al tema: claro y oscuro declarados.
- **Y4** Existe un service worker, se registra **sólo en producción**, y su
  precache es una lista corta y explícita de estáticos + la página sin
  conexión.
- **Y5** **Ninguna respuesta de `/app/**`, `/api/**` o server action se
  cachea.** Demuéstralo con la lista literal y con la estrategia por ruta.
- **Y6** Sin conexión ⇒ página honesta; **cero cifras** en pantalla.
- **Y7** El SW se actualiza y se puede desinstalar sin dejar una versión vieja
  pegada.
- **Y8** `share_target` y los dos shortcuts siguen funcionando con el SW
  activo.
- **Y9** El esqueleto de `/app` **ya no dibuja** el círculo de 168 px ni la
  grilla de seis; refleja el santuario.
- **Y10** El landing muestra **el orbe**, no el anillo; cero `IconRing`/
  `IconPulse` como identidad; cero comentario «Margen ring».
- **Y11** El landing **no** carga WebGL ni pide permisos (compruébalo por
  consola/red).
- **Y12** Landing, `not-found` y `error` participan del tema claro: cero
  `white/xx` crudo donde deba haber tokens.
- **Y13** Safe areas correctas en las cuatro orillas del santuario y de las dos
  hojas.
- **Y14** No-regresión M1–M7: santuario, orbe, hilo, captura, voz, perspectiva,
  las nueve puertas y las once superficies re-vestidas.
- **Y15** **E2E existente en verde con residuo cero**; salida pegada.
- **Y16** Gates verdes por **los dos runners headless** (`lint`, `build`,
  captura 846 o el número nuevo explicando el delta), **más una mutación propia
  por cada aserción nueva** que mate un test **con nombre**.

---

## 7. Rama, protocolo y reporte

- Rama `stage-m-front`; commits `feat(M8): …` / `chore(M8): …`.
- Protocolo de `M1_SPEC §8` con la enmienda vigente: marca **«NO VERIFICABLE
  EN MI ENTORNO»** lo que no puedas ejecutar (instalar la PWA en un teléfono
  real, por ejemplo, no lo es).
- Reporte `M8_REPORT.md` con el template de `M1_SPEC §9`, autochequeo Y1–Y16, y
  dos secciones propias: **«Qué cachea el SW y qué no»** (lista literal + la
  razón de seguridad de cada entrada) y **«Íconos generados»** (tamaños, ruta y
  cómo se produjo cada uno).

## 8. Definición de HECHO

Y1–Y16 verificados, gates verdes con salida pegada, E2E en verde con residuo
cero, reporte escrito, y VERDE del auditor en `M8_AUDIT.md`. Después NO
arranques M9.
