# M8_REPORT — Ronda 1

- Rama/commits: `stage-m-front` · `2e05b9a` · `7bed700` · `c59bceb` · `a238bc2` · `1dd44b8` · `2f2e663` · este reporte
- Estado: LISTO PARA AUDITORÍA

## Qué se construyó

- Service worker manual, sin librerías, con precache allowlist de cinco recursos públicos y estrategia NetworkOnly para dinero, API y server actions.
- Página offline autocontenida con el copy vinculante, orbe estático y ninguna cifra visible.
- Registro cliente sólo en producción, actualización sin HTTP cache, limpieza de versiones antiguas y camino explícito de desinstalación.
- Íconos PNG generados con `next/og`: metadatos Next de 192/512, Apple 180 y rutas estables 192/512/maskable para el manifest; el SVG `any` permanece.
- `themeColor` claro/oscuro, manifest coherente, shortcuts y share target preservados.
- Skeleton nuevo del santuario con asa, cinco chips, cordón, orbe, cifra, pill, cinta y dock; el branch legacy conserva su skeleton mientras el flag exista.
- Landing con orbe CSS estático, cero WebGL/canvas/permisos, sin anillo ni cifras ficticias; landing, 404 y error usan tokens M1.
- Safe areas en cuatro orillas para santuario, hoja de perspectiva, diálogo, detalles, navegación inferior y superficies públicas.
- Cuatro aserciones M8 (`M8-1`…`M8-4`) y auditoría de cuatro mutantes, cada uno muerto por su propio nombre.

## Decisiones tomadas dentro del spec

- No existe runtime cache general. Incluso los recursos públicos no listados pasan siempre por red; así no hay heurística capaz de confundir una respuesta autenticada con un asset.
- `/app` y `/api` raíz se incluyen además de sus subrutas. Los server actions son NetworkOnly por método no-GET y por header `next-action`.
- La caída de una navegación devuelve exclusivamente `/offline.html`; nunca busca una copia de la URL pedida. Esto conserva la URL de shortcut/share target sin servir estado viejo.
- Los PNG del manifest usan rutas estables `/pwa/icon/*`, pero comparten exactamente el mismo generador `ImageResponse` que `icon.tsx` y `apple-icon.tsx`.
- El arte maskable ocupa 56% del lienzo: deja 22% de inset por lado antes del borde de la máscara; sólo el fondo seguro llega al borde.
- El primer intento de safe area pública usó `max(1.25rem, env(...))`. La QA del CSS servido descubrió que el optimizador lo eliminaba. Se cambió a los 20 px equivalentes, se midieron los cuatro paddings computados y el gate fija ahora esa sintaxis.

## Desviaciones del spec

Ninguna. No se añadieron dependencias, migraciones, lógica financiera, background sync, push, WebGL en el landing ni cambios en `/app/cashflow` o el shell viejo.

## Huecos honestos

- **NO VERIFICABLE EN MI ENTORNO — instalación física:** no pude instalar la PWA en un teléfono real ni observar el recorte del launcher/status bar nativo. Sí se verificaron PNG reales, dimensiones, manifest servido y zona segura matemática.
- **NO VERIFICABLE EN MI ENTORNO — desinstalación desde UI del sistema:** la ruta de desinstalación (`uninstallKipuServiceWorker`, mensaje `KIPU_UNINSTALL`, borrado de caches prefijadas y `registration.unregister`) está gateada, pero no se ejecutó desde el panel de una PWA instalada físicamente.
- **NO VERIFICABLE EN MI ENTORNO — superficies autenticadas:** sin credenciales no se inspeccionaron visualmente el skeleton productivo, las dos hojas y las once superficies re-vestidas. El source gate verifica sus cuatro insets y la no-regresión M1–M7.
- **NO VERIFICABLE EN MI ENTORNO — fps:** M8 no introduce movimiento nuevo y el landing usa CSS, pero no se declara medición de fps.
- Un diagnóstico adicional no exigido contra `next start` hizo fallar dos aserciones preexistentes, IR338/IR339, porque la minificación cambia nombres de clases `Error`. Los dos runners vinculantes usados históricamente —Node directo y HTTP sobre `next dev`— quedan ambos 850/850. No se debilitó ni tocó IR338/IR339.
- Lint conserva ocho warnings preexistentes en dos scripts M0. Build conserva el warning preexistente de trazado NFT desde `next.config.ts` a `capture-test`. Ambos salen con código 0.

## Qué cachea el SW y qué no

Lista literal de `PRECACHE_URLS`:

```text
/offline.html
/icon.svg
/pwa/icon/192
/pwa/icon/512
/pwa/icon/maskable
```

| Entrada | Por qué es segura |
|---|---|
| `/offline.html` | HTML/CSS autocontenido y fijo. El texto no contiene ninguna cifra del usuario ni hace lecturas. |
| `/icon.svg` | Arte estático del orbe; no recibe parámetros ni datos de sesión. |
| `/pwa/icon/192` | PNG inmutable generado sólo desde constantes de color/geometría. |
| `/pwa/icon/512` | Igual que el anterior a 512 px; no consulta contexto financiero. |
| `/pwa/icon/maskable` | Igual, con orbe reducido a la zona segura. No consulta usuario ni servidor financiero. |

Qué no cachea:

| Tráfico | Estrategia y razón |
|---|---|
| `/app` y `/app/**` | NetworkOnly. Si la red cae, responde la página offline; jamás una respuesta anterior de la ruta. |
| `/api` y `/api/**` | NetworkOnly sin fallback de datos. |
| Server actions | Todo no-GET y toda request con `next-action` va directamente a `fetch`; nunca toca Cache Storage. |
| Respuestas autenticadas | No existe runtime cache ni `cache.put`; sólo los cinco path exactos anteriores consultan cache. |
| Otras navegaciones | NetworkOnly con fallback honesto a `/offline.html`. La navegación pedida no se almacena. |
| Otros assets same-origin | NetworkOnly. No se agregan dinámicamente al precache. |
| Cross-origin | El worker no los intercepta. |

No hay listeners de `sync` ni `push`; no hay stale-while-revalidate. La prueba real apagó el servidor después de activar el SW y abrió `/app/chat?share=Prueba%20offline` y `/app`: ambas conservaron su URL y renderizaron únicamente la página offline.

## Íconos generados

| Uso | Tamaño real | Ruta servida | Producción |
|---|---:|---|---|
| Metadata Next | 192×192 | `/icon/192` | `src/app/icon.tsx` + `generateImageMetadata` + `ImageResponse`. |
| Metadata Next | 512×512 | `/icon/512` | Mismo archivo/generador. |
| Apple | 180×180 | `/apple-icon` | `src/app/apple-icon.tsx` + `ImageResponse`. |
| Manifest any | 192×192 | `/pwa/icon/192` | Route handler estable que llama `createKipuIcon(192)`. Header `image/png`, `immutable`. |
| Manifest any | 512×512 | `/pwa/icon/512` | Route handler estable que llama `createKipuIcon(512)`. Header `image/png`, `immutable`. |
| Manifest maskable | 512×512 | `/pwa/icon/maskable` | Mismo generador con `maskable=true`; arte al 56% del lienzo. |
| Fallback vector | any | `/icon.svg` | SVG del mismo orbe; permanece con purpose `any`. |

Medición real con `sips`:

```text
/private/tmp/kipu-m8-icons/icon-192.png
  pixelWidth: 192
  pixelHeight: 192
  format: png
/private/tmp/kipu-m8-icons/icon-512.png
  pixelWidth: 512
  pixelHeight: 512
  format: png
/private/tmp/kipu-m8-icons/icon-maskable.png
  pixelWidth: 512
  pixelHeight: 512
  format: png
```

## Autochequeo Y1–Y16

| Criterio | Cómo se probó | Resultado |
|---|---|---|
| Y1 | Build enumera `/icon/192`, `/icon/512`, `/apple-icon` y `/pwa/icon/[variant]`; manifest servido declara 192/512/maskable + SVG. `curl` respondió `image/png`; `sips` midió 192×192 y 512×512 reales. M8-1 lo fija. | CUMPLE |
| Y2 | `createKipuIcon` usa 56% para maskable, dejando 22% por lado. M8-1 fija la proporción y el manifest. Recorte de launcher físico: **NO VERIFICABLE EN MI ENTORNO**. | CUMPLE estructural |
| Y3 | `viewport.themeColor` declara `#edf2f6` light y `#060a10` dark con media queries; M8-4 lo fija. Landing se observó en ambos temas. | CUMPLE |
| Y4 | `PwaServiceWorker` sólo registra con `NODE_ENV=production`; SW tiene cinco entradas exactas. Con `next start`, el worker quedó activo: al apagar el servidor siguió resolviendo offline. M8-2 lo fija. | CUMPLE |
| Y5 | Branch explícito NetworkOnly cubre `/app`, `/app/**`, `/api`, `/api/**`, no-GET y `next-action`; no existe `cache.put`. M8-2 murió al mutar `/api/**`. | CUMPLE |
| Y6 | DOM real offline: sólo heading y copy vinculante; regex del gate sobre texto visible no encuentra dígitos. Con servidor apagado no apareció ninguna cifra en `/app` ni share target. | CUMPLE |
| Y7 | `updateViaCache:none`, `registration.update`, `skipWaiting`, `clients.claim`, borrado de caches viejas, helper y mensaje de uninstall. SW servido con `Cache-Control: public, max-age=0`. Desinstalación física: **NO VERIFICABLE EN MI ENTORNO**. | CUMPLE estructural |
| Y8 | Manifest real preserva los dos shortcuts y share target GET. Con SW activo y red caída, `/app/chat?share=…` y `/app` conservaron sus URLs y cayeron honestamente a offline, no a cache viejo. Invocación desde share sheet/launcher físico: **NO VERIFICABLE EN MI ENTORNO**. | CUMPLE web |
| Y9 | `DashboardSkeleton` contiene asa, cinco capas, cordón, orbe 236, cifra/pill/cinta/dock; no contiene 168 ni grilla de seis. `loading.tsx` selecciona skeleton nuevo/legacy por el mismo flag. M8-3 lo fija. | CUMPLE |
| Y10 | Landing observado en móvil y escritorio: orbe con líquido, cero anillo. Source sin `IconRing`, `IconPulse` ni comentario retirado; M8-3 lo fija. | CUMPLE |
| Y11 | DOM del build final midió `canvases: 0`; landing no importa shader, WebGL, `getContext`, `mediaDevices` ni permisos. M8-3 lo fija. | CUMPLE |
| Y12 | Landing, 404 y error tienen cero `white/xx` y usan `--kipu-shell-*`. Preview light real mostró texto/controles/orbe legibles; padding computado 20 px. M8-3 lo fija. Error provocado visualmente: **NO VERIFICABLE EN MI ENTORNO**. | CUMPLE estructural/landing visual |
| Y13 | M8-4 exige los cuatro `env()` en frame, perspectiva, diálogo, detalle y públicas; nav suma left/right. El CSS optimizado final contiene la regla pública completa y el browser midió 20 px en cuatro lados sin overflow. Hojas autenticadas visuales: **NO VERIFICABLE EN MI ENTORNO**. | CUMPLE estructural |
| Y14 | Capture conserva todas las aserciones M1–M7 y termina 850/850; E2E conserva 11/11 con residuo cero. Diff M8 no toca lógica financiera, migraciones, `/app/cashflow` ni package files. | CUMPLE |
| Y15 | Persona desechable real: 11 verdes, 0 rojos finales; cleanup verificó residuo cero en DB y Auth. | CUMPLE |
| Y16 | Lint exit 0, build exit 0, Node 850/850, HTTP dev 850/850. Delta 846→850 = M8-1…M8-4. Los cuatro mutantes produjeron 849/850 con su propio nombre y restauraron 850/850. | CUMPLE |

## Gates (salida real pegada)

### Lint

```text
$ npm run lint

> fincoach-mvp@0.1.0 lint
> eslint

[BABEL] Note: The code generator has deoptimised the styling of /Users/nicot/Projects/fincoach-mvp/src/app/dev/capture-test/page.tsx as it exceeds the max of 500KB.

/Users/nicot/Projects/fincoach-mvp/scripts/qa/m0-loop-122-e2e.mjs
  39:3  warning  'authorizeAgentOperationManifest' is assigned a value but never used  @typescript-eslint/no-unused-vars
  40:3  warning  'beginAgentOperationApplication' is assigned a value but never used   @typescript-eslint/no-unused-vars
  41:3  warning  'beginAgentOperationManifest' is assigned a value but never used      @typescript-eslint/no-unused-vars
  45:3  warning  'transitionAgentOperation' is assigned a value but never used         @typescript-eslint/no-unused-vars
  46:3  warning  'verifyAgentLoopManifest' is assigned a value but never used          @typescript-eslint/no-unused-vars
  47:3  warning  'verifyAgentLoopStep' is assigned a value but never used              @typescript-eslint/no-unused-vars

/Users/nicot/Projects/fincoach-mvp/scripts/qa/m0-loop-123-e2e.mjs
   37:3   warning  'quarantineAgentLoopOperation' is assigned a value but never used  @typescript-eslint/no-unused-vars
  107:10  warning  'digest' is defined but never used                                 @typescript-eslint/no-unused-vars

✖ 8 problems (0 errors, 8 warnings)
```

### Build

```text
$ npm run build

> fincoach-mvp@0.1.0 build
> next build

▲ Next.js 16.2.4 (Turbopack)
- Environments: .env.local

  Creating an optimized production build ...
Turbopack build encountered 1 warnings:
./next.config.ts
Encountered unexpected file in NFT list
A file was traced that indicates that the whole project was traced unintentionally. Somewhere in the import trace below, there are:
- filesystem operations (like path.join, path.resolve or fs.readFile), or
- very dynamic requires (like require('./' + foo)).
To resolve this, you can
- remove them if possible, or
- only use them in development, or
- make sure they are statically scoped to some subfolder: path.join(process.cwd(), 'data', bar), or
- add ignore comments: path.join(/*turbopackIgnore: true*/ process.cwd(), bar)

Import trace:
  Server Component:
    ./next.config.ts
    ./src/app/dev/capture-test/page.tsx

✓ Compiled successfully in 2.8s
  Running TypeScript ...
  Finished TypeScript in 5.4s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/39) ...
  Generating static pages using 11 workers (9/39)
  Generating static pages using 11 workers (19/39)
  Generating static pages using 11 workers (29/39)
✓ Generating static pages using 11 workers (39/39) in 212ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/cron/ambient-loop
├ ƒ /api/cron/card-interest
├ ƒ /api/cron/fx-refresh
├ ƒ /api/cron/recurring-materialize
├ ƒ /api/cron/scheduled-changes
├ ƒ /api/cron/scheduled-payments
├ ƒ /api/inbound-email
├ ƒ /api/telegram/webhook
├ ƒ /app
├ ƒ /app/activity
├ ƒ /app/cashflow
├ ƒ /app/chat
├ ƒ /app/cuentas
├ ƒ /app/debt
├ ƒ /app/fx
├ ƒ /app/goals
├ ƒ /app/household
├ ƒ /app/join/[token]
├ ƒ /app/kipu-fit
├ ƒ /app/margen
├ ƒ /app/mes
├ ƒ /app/mis-datos
├ ƒ /app/precision
├ ƒ /app/readiness
├ ƒ /app/reality
├ ƒ /app/saldo
├ ƒ /app/settings
├ ƒ /app/settings/export
├ ƒ /app/spending
├ ƒ /app/wealth
├ ○ /apple-icon
├ ƒ /auth/confirm
├ ƒ /dev/ai-parser-test
├ ƒ /dev/capture-sim
├ ƒ /dev/capture-test
├ ƒ /dev/chat-handler-test
├ ƒ /dev/chat-preview
├ ƒ /dev/chat-review
├ ƒ /dev/coach-response-test
├ ƒ /dev/m0-agent-eval
├ ƒ /dev/manual-entry
├ ƒ /dev/onboarding-loop-test
├ ƒ /dev/onboarding-sim
├ ƒ /dev/onboarding-wizard-test
├ ƒ /dev/parser-test
├ ƒ /dev/preferences-test
├ ƒ /dev/shell-preview
├ ƒ /dev/supabase-test
├ ƒ /dev/telegram-link-test
├ ƒ /dev/transaction-test
├ ƒ /dev/ui-preview
├ ƒ /dev/user-financial-context-test
├ ○ /icon.svg
├ ● /icon/[__metadata_id__]
│ ├ /icon/192
│ └ /icon/512
├ ƒ /login
├ ƒ /login/reset
├ ○ /manifest.webmanifest
├ ƒ /onboarding
├ ƒ /onboarding/template
├ ○ /opengraph-image
├ ƒ /pwa/icon/[variant]
├ ƒ /reset-password
└ ƒ /signup

○  (Static)   prerendered as static content
●  (SSG)      prerendered as static HTML (uses generateStaticParams)
ƒ  (Dynamic)  server-rendered on demand
```

### Capture — runner Node

```text
$ node scripts/qa/run-capture-gate.mjs
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"ts":"2026-08-27T22:26:26.033Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-27T22:26:26.033Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-27T22:26:26.033Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
850/850 capture checks
(node:68127) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/capture/capture-matching.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
```

### Capture — runner HTTP

```text
$ curl -sS http://127.0.0.1:3101/dev/capture-test | rg -o '([0-9]+)/([0-9]+) aserciones pasan|[0-9]+ de [0-9]+ aserciones fallan' | head -1
850/850 aserciones pasan
```

### Mutaciones M8

```text
$ node scripts/qa/m8-mutation-audit.mjs
M8-1: mutación muerta por nombre (849/850)
M8-2: mutación muerta por nombre (849/850)
M8-3: mutación muerta por nombre (849/850)
M8-4: mutación muerta por nombre (849/850)
restauración: 850/850 capture checks
```

### E2E de persona desechable

```text
$ node --env-file=.env.local scripts/qa/m4-thread-persona-e2e.mjs
persona desechable: d80b49a3-0fe5-471b-bdf0-8f1fd044dec0
  ok   · M7-E10 · Metas muestra meta, ahorro e inversión por nombre y declara la identidad ausente
  ok   · M6-E8 · persona sin objetivo de Reserva publica cifra e invitación, nunca porcentaje
  ok   · M6-E9 · snapshots con día faltante conservan hueco y jamás interpolan el cordón
  ok   · M4-E0 · lectura productiva del hilo es completa
  ok   · M4-E1 · write real aparece con recibo reconstruido desde el ledger
  ok   · M4-E2 · digest y cierre web con chat_id NULL aparecen y conservan autor
  ok   · M4-E3 · Telegram queda intercalado en orden cronológico real
  ok   · M4-E4 · identidad durable compartida dedupea a web; texto solo no dedupea
  ok   · M4-E5 · referencia inexistente produce recibo incompleto sin relleno
  ok   · M5-E7 · audio válido falla como failed honesto sin turno de asistente inventado
  ok   · M4-E6 · chat_cleared_at oculta el hilo sin borrar una sola fila

11 verdes, 0 rojos antes de limpieza
limpieza: residuo cero verificado en DB y auth
11 verdes, 0 rojos finales
```

### Recursos PWA servidos y fallback real

```text
GET /sw.js
HTTP/1.1 200 OK
Cache-Control: public, max-age=0
Content-Type: application/javascript; charset=UTF-8

GET /pwa/icon/192
HTTP/1.1 200 OK
cache-control: public, max-age=31536000, immutable
content-type: image/png

GET /pwa/icon/512
HTTP/1.1 200 OK
cache-control: public, max-age=31536000, immutable
content-type: image/png

GET /pwa/icon/maskable
HTTP/1.1 200 OK
cache-control: public, max-age=31536000, immutable
content-type: image/png

browser, servidor apagado:
url: http://127.0.0.1:3100/app/chat?share=Prueba%20offline
title: Sin conexión · Kipu
DOM: heading "Sin conexión" + copy vinculante; ninguna cifra

url: http://127.0.0.1:3100/app
title: Sin conexión · Kipu
DOM: heading "Sin conexión" + copy vinculante; ninguna cifra
```

## Cómo verlo (guía de QA manual)

1. Ejecutar `npm run build` y `npm run start`; abrir `/manifest.webmanifest` y confirmar las cuatro entradas: 192, 512, maskable y SVG any.
2. Abrir `/pwa/icon/192`, `/pwa/icon/512`, `/pwa/icon/maskable` y `/apple-icon`; descargar/inspeccionar que sean PNG y que el orbe maskable conserve aire visible alrededor.
3. En DevTools → Application → Service Workers, confirmar `/sw.js`, scope `/`, update via cache `none`; en Cache Storage debe existir sólo `kipu-static-m8-v1` con exactamente cinco URLs.
4. Con la PWA controlada, poner el navegador offline y abrir `/app`, `/app/chat?share=texto`, `/api/...` y una server action: ninguna debe devolver contenido financiero cacheado; las navegaciones muestran sólo `/offline.html`.
5. Volver online y usar los dos shortcuts. Compartir texto desde el share sheet: debe llegar a `/app/chat?share=...` sin autoenvío y sin que el SW quite la query.
6. Actualizar el build: el worker nuevo debe activar y borrar cualquier `kipu-static-*` viejo. Disparar `window.dispatchEvent(new Event("kipu:uninstall-service-worker"))` desde una sesión de QA y confirmar cero registration/caches Kipu.
7. Abrir `/` a 390×844 en tema oscuro y claro: primer arte = orbe, no anillo; cero overflow horizontal; copy menciona Saldo, capas y Reserva.
8. Abrir una URL inexistente en ambos temas y provocar el root error en QA: 404/error deben conservar tokens, contraste, calma y vuelta al santuario.
9. Con `KIPU_SHELL=orbe`, forzar loading de `/app`: debe verse asa, cinco chips, cordón, orbe, cifra/pill/cinta/dock; nunca círculo 168 + seis tarjetas. Con flag legacy debe corresponder al camino viejo.
10. En un dispositivo con notch/isla, abrir santuario, perspectiva, diálogo y varias superficies de detalle; rotar el dispositivo y comprobar las cuatro orillas y targets ≥44 px.
11. Repetir `node scripts/qa/run-capture-gate.mjs`, HTTP `/dev/capture-test`, `node scripts/qa/m8-mutation-audit.mjs` y el E2E; exigir 850/850, cuatro mutantes muertos, 11/11 y residuo cero.

## Preguntas

Ninguna.
