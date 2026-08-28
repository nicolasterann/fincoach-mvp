# M8_AUDIT — Ronda 1 · VEREDICTO: **ROJO** (una orden, pero es la que importa)

- **Fecha:** 2026-08-25 · **Árbol auditado:** `stage-m-front` @ `0634ea3`
- **Entrada:** `M8_REPORT.md` Ronda 1 (Y1–Y16 + las dos secciones propias).
- **Método:** los dos runners headless + lint + build + **la corrida real del
  E2E** + fetch real de los tres íconos + DOM del landing + **una mutación
  propia sobre la regla central del stage**.

**Casi todo M8 está bien y verificado.** La orden es una sola, y es sobre lo
único que este stage no podía permitirse: **la regla «el service worker no
cachea dinero» no está defendida por ninguna prueba.** El código de hoy es
correcto; lo que falta es que no pueda dejar de serlo mañana.

---

## Verificado por ejecución

| | Cómo lo probé |
|---|---|
| **Gates** | `lint` **0 errores** · `build` **exit 0** · captura **850/850** por **los dos runners** (846 + 4 nuevas) |
| **E2E** | **11/11 verdes, residuo cero** — no-regresión intacta |
| **Y1/Y2 · íconos** | Pedidos por HTTP: `/pwa/icon/192` → **10.082 bytes**, `/512` → **32.202**, `/maskable` → **28.781**, los tres `image/png` y con la **firma real de PNG** (`89504e47…`). No son declaraciones: son archivos |
| **Y3 · theme_color** | Por tema: `#edf2f6` en claro y `#060a10` en oscuro — los mismos tokens de M1 §11 |
| **Y9 · esqueleto** | El de `/app` ahora dibuja **el santuario** (asa, cinco tabs, cordón, orbe de 236, cifra, pill, dock de tres acciones). El viejo sobrevive **emparejado al camino legacy**, con su comentario de que muere en M9 — exactamente lo que pedía D‑M8.4 |
| **Y10/Y11/Y12 · landing** | Muestra **el orbe**, no el anillo: cero `canvas`, cero WebGL, cero `IconRing`/`IconPulse`, cero «Margen ring». Vocabulario retirado en cero. Y **cero `white/xx` crudo** en landing, `not-found` y `error`: las tres participan del tema |
| **El SW, tal como está escrito** | Correcto: precachea sólo cinco estáticos incapaces de contener una cifra, excluye server actions por su cabecera, trata `/app/**` y `/api/**` como red-o-página-sin-conexión, y **no tiene ninguna ruta de código que escriba en caché en runtime**. La página sin conexión no contiene ni un dígito |

---

## Orden BLOQUEANTE

### O1 · La regla central del stage no la defiende nada

**Mi mutación:** cambié el bloque de rutas de dinero del SW para que sirva
desde caché y **guarde** la respuesta:

```js
caches.match(request).then((hit) => hit || fetch(request).then((res) => {
  caches.open(CACHE_NAME).then((c) => c.put(request, res.clone()));
  return res;
}))
```

Con eso, la app instalada serviría **tu saldo de ayer como si fuera el de
hoy**. Resultado del gate: **850/850. Verde.**

**Por qué pasó.** La aserción `M8-2` defiende la regla con
`!m8WorkerSource.includes("cache.put(")` — un guard anclado **al nombre de una
variable**. Mi mutación escribió `c.put(...)` y lo esquivó sin esfuerzo. El
otro ancla relevante,
`includes("fetch(request).catch(() => caches.match(OFFLINE_URL))")`, tampoco
murió: esa misma línea existe en la rama de navegación, así que **el bloque de
dinero se puede reescribir entero sin tocarla**. Y el harness
`m8-mutation-audit.mjs` tampoco lo cubre: su mutación del SW cambia
`"/api/"` por `"/money-api/"`, es decir prueba el **nombre de la ruta**, no el
peligro.

Es exactamente la lección que este proyecto ya pagó dos veces: un ancla por
substring que un renombrado ordinario satisface (el caso del `drop trigger` en
IR28) y una aserción que no prueba lo que dice probar.

**Qué hacer — estructural, no otro string.** Sigue el patrón que M3 ya dejó
funcionando: **extrae la decisión de ruteo del SW a una función pura** que el
gate pueda **ejecutar** con peticiones sintéticas y afirmar el resultado:

- `/app`, `/app/saldo`, `/api/x` ⇒ **`network-only`** (con la página sin
  conexión como único respaldo);
- una petición con la cabecera de server action ⇒ **`network-only`**;
- `/pwa/icon/192`, `/offline.html` ⇒ **`cache-first`**;
- una navegación cualquiera ⇒ red con respaldo a la página sin conexión;
- y la invariante dura: **ninguna entrada de ruta de dinero puede producir un
  resultado que almacene**, afirmado sobre el conjunto de decisiones posibles,
  no sobre el texto del archivo.

Después **añade mi mutación exacta** (una escritura de caché con la variable
renombrada) al harness de mutaciones, para que no pueda volver.

---

## Lo que no cambia

El diseño de M8 es correcto y no hay que rehacerlo: la lista de precache, la
exclusión de server actions, la política de red para dinero, la página sin
conexión sin cifras, los íconos generados sin dependencias, el color por tema,
el esqueleto nuevo y el landing con el orbe. **La orden es sobre la prueba, no
sobre el producto.**

## Lo que queda para la pasada del founder

Instalar la PWA en un teléfono real y ver el ícono recortado en su lanzador,
el color del cromo en ambos temas, y el comportamiento sin señal. Nada de eso
se puede sustituir desde aquí.

## Estado

**M8 no aceptado por una sola orden.** Ciérrala, entrega Ronda 2 con la salida
de la mutación renombrada muriendo por su nombre, y vuelvo a ejecutar. Todo lo
demás ya está verificado y no hay que tocarlo.
