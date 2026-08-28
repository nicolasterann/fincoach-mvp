# N0_SPEC — La regla y el metro

> **Contrato completo y autocontenido.** El chat implementador entra leyendo
> este archivo. Contexto del bloque:
> `docs/design/N_DESIGN_001_ACABADO_FIRST_PRINCIPLES_2026-08-28.md`.
> Protocolo del ciclo: `docs/design/README.md`.

---

## 1. La promesa de esta etapa

**Después de N0, ninguna pantalla de Kipu inventa un valor propio, "no medí"
nunca se disfraza de "medí y da cero", y podemos decir con un número si algo
mejoró.**

N0 no arregla ningún hallazgo del founder. Es la regla contra la que se van a
medir los siete arreglos siguientes. Va primero por dos razones concretas:

1. Hoy hay **más de veinte duraciones de animación distintas** en
   `globals.css`, ninguna con nombre. Cada etapa siguiente inventaría las
   suyas y el conjunto se sentiría barato aunque cada pieza estuviera bien.
2. La queja número uno del founder es velocidad, y **hoy no existe forma de
   medirla desde su teléfono.** Optimizar sin metro es opinar.

---

## 2. Lo que N0 NO hace

- No toca el motor financiero, ni `supabase/`, ni migraciones, ni el agente.
- No cambia el comportamiento visible de ninguna pantalla. Si al terminar el
  santuario se ve distinto en algo que no sea un valor atípico corregido, es
  un defecto de N0, no una mejora.
- **No convierte toda la app a los tokens.** Convierte el santuario y los
  componentes nuevos. Cada pantalla se convierte en la etapa que la toca
  (N3–N6). Convertir todo aquí sería un diff imposible de auditar.
- No añade dependencias. No añade paquetes de animación, de diseño ni de
  telemetría.

---

## 3. Alcance

| Archivo | Qué pasa |
|---|---|
| `src/app/globals.css` | Se añade el bloque de tokens de §4 en `:root` y se convierte **la región del santuario** (`.kipu-shell-*`, `.kipu-dialog-*`, `.kipu-orb-*`) a esos tokens |
| `src/app/app/components/state/*` (nuevo) | Los cinco estados de §5 como componentes |
| `src/app/app/components/state/state-contract.ts` (nuevo) | La lógica **pura** de los estados y del formateo de métricas. **Sin `server-only`** (lección de M3 O1: el gate headless debe poder ejecutarlo) |
| `src/lib/metro/metro-contract.ts` (nuevo) | Lógica pura del metro: formateo, umbrales, "sin medir" |
| `src/app/app/components/shell/shell-payload.ts` | **Sólo** instrumentación de tiempos por tramo (§6). Cero cambios de lógica |
| `src/app/dev/sistema/page.tsx` (nuevo) | La superficie de aprobación |
| `src/app/dev/capture-test/page.tsx` | Aserciones nuevas N0-1…N0-6 |

---

## 4. Los tokens

Nombres exactos. El implementador no los renombra.

### 4.1 Movimiento — cuatro duraciones y tres curvas, no veinte

```css
--kipu-t-instant: 90ms;   /* un control responde al dedo */
--kipu-t-quick:  180ms;   /* algo aparece, desaparece o cambia de color */
--kipu-t-move:   320ms;   /* algo se desplaza: hojas, capas, paneles */
--kipu-t-settle: 620ms;   /* algo se acomoda: el líquido, una cifra que cambia */

--kipu-e-out:    cubic-bezier(0.22, 0.61, 0.24, 1);  /* entra y frena */
--kipu-e-in-out: cubic-bezier(0.50, 0.00, 0.20, 1);  /* se desplaza */
--kipu-e-settle: cubic-bezier(0.20, 0.90, 0.30, 1.06); /* se asienta con peso */
```

Las animaciones **ambientales** (respiración, flotación, brillo lento: 23 s,
27 s, 38 s, 52 s…) no entran en esta escala porque no son respuesta a una
acción. Se les da un token propio (`--kipu-t-breath-*`) y se documentan, pero
conservan sus valores.

**Regla de oro:** ninguna transición o animación de respuesta puede declarar
una duración literal. Si algo necesita una quinta duración, se discute — no se
inventa en la hoja de estilos.

### 4.2 Tipografía

```css
--kipu-fs-cifra:  clamp(34px, 7svh, 58px);  /* la cifra del orbe: es el héroe */
--kipu-fs-title:  clamp(19px, 3.4svh, 24px);
--kipu-fs-body:   15px;
--kipu-fs-label:  13px;
--kipu-fs-micro:  11px;   /* mayúsculas con tracking: procedencia, sellos */
```

Cinco tamaños. Y una regla que hoy no existe y se nota:

> **Todo número de dinero lleva `font-variant-numeric: tabular-nums`.**

Sin eso, una cifra que cambia de 4.311,14 a 4.298,20 hace saltar los dígitos.
Es la clase de detalle que separa "artesanal" de "producto".

### 4.3 Espaciado, esquinas, elevación

```css
--kipu-sp-1: 4px;  --kipu-sp-2: 8px;  --kipu-sp-3: 12px;
--kipu-sp-4: 16px; --kipu-sp-5: 24px; --kipu-sp-6: 36px;

--kipu-r-1: 10px; --kipu-r-2: 14px; --kipu-r-3: 20px;
--kipu-r-4: 28px; --kipu-r-full: 999px;

--kipu-el-0: none;                                  /* al ras */
--kipu-el-1: 0 2px 10px -4px rgba(0,0,0,0.5);       /* tarjeta */
--kipu-el-2: 0 18px 42px -20px rgba(0,0,0,0.92);    /* hoja */
```

Los colores **ya están tokenizados y son buenos**: no se tocan. N0 no cambia
la paleta.

---

## 5. Los cinco estados

Hoy cada pantalla improvisa. A partir de N0 hay cinco componentes y sólo cinco.

| Estado | Cuándo | Cómo se ve |
|---|---|---|
| `cargando` | el dato viene en camino | **Un esqueleto con la forma de lo que viene.** Un orbe cargando es un círculo del tamaño del orbe, no una barra redondeada |
| `vacío` | hay cero de esto, y es correcto | Forma completa, contenido en cero, y **una invitación**: qué hacer para que deje de estar vacío |
| `sin dato` | **no pude leer** | Debe ser **inconfundible** frente a `vacío`. Nunca un cero, nunca una barra vacía: una frase honesta y un "Reintentar" |
| `sin señal` | no hay red | La página fuera de línea ya existe y es correcta; aquí se le da forma de componente |
| `error` | algo se rompió | Qué pasó, que su plata está a salvo, y una salida |

**Las dos reglas que no se relajan:**

1. **`vacío` y `sin dato` no pueden parecerse.** Es la doctrina monetaria del
   proyecto —"no pude leer" ≠ "no hay nada"— hecha visual. Hoy la pantalla de
   inicio la incumple: cuatro orbes sin nivel se ven idénticos a un orbe que
   no pudo leerse.
2. **Una medición que no ocurrió se escribe `—`, jamás `0`.** Esto es
   literalmente la orden M2 O2, que costó media auditoría persiguiendo un
   fantasma. Vive en `state-contract.ts` como función pura y el gate la
   ejecuta.

---

## 6. El metro

Dos mitades. Ninguna inventa un número.

### 6.1 Del lado del servidor

`buildShellPayload` se instrumenta con el tiempo de cada tramo — contexto,
preferencias, hilo, briefing, cotizaciones, historia, último movimiento — y los
emite como `Server-Timing`. Cero cambios de lógica: sólo se mide.

Esto responde la pregunta que hoy no podemos responder: **de los N segundos
que tarda en abrir, ¿cuántos son cada cosa?** N1 va a mover esos tramos y
necesita el antes y el después.

### 6.2 Del lado del teléfono

Un overlay que se enciende con `?metro=1` y muestra:

```
TTFB   —      LCP   —      INP   —      CLS   —
servidor: contexto — · hilo — · briefing — · resto —
```

- Sale de `useReportWebVitals` de Next y de la cabecera `Server-Timing`.
- **Cada casilla sin medir muestra `—`.** Cero prohibido.
- Sólo con `?metro=1`. Nunca visible para un usuario.
- No se envía nada a ningún servidor: el founder lee la pantalla y la
  fotografía. Sin almacenamiento, sin telemetría, sin decisión de privacidad
  pendiente.

---

## 7. Criterios de aceptación

Verificables **por ejecución**. El reporte pega la salida real de cada uno.

| # | Criterio |
|---|---|
| **A1** | Los tokens de §4 existen en `:root` con esos nombres exactos, y el tema claro no los rompe |
| **A2** | **Cero duraciones literales** en transiciones/animaciones de respuesta dentro de la región del santuario de `globals.css`. Las ambientales usan sus propios tokens con nombre |
| **A3** | Toda cifra de dinero del santuario usa `tabular-nums`. Se comprueba en el DOM, no leyendo la hoja |
| **A4** | Los cinco estados existen como componentes, se exportan de un solo módulo, y `/dev/sistema` los muestra los cinco para cada forma (orbe, tarjeta, línea, hoja) |
| **A5** | `vacío` y `sin dato` se distinguen a simple vista. El reporte pega ambas capturas y describe qué los separa |
| **A6** | `formatMetric(null) === "—"` y `formatMetric(0)` devuelve un cero **medido**, distinguible. Ejecutado por el gate, no leído |
| **A7** | `?metro=1` muestra el overlay con `—` en lo no medido; sin el parámetro no existe en el DOM |
| **A8** | `Server-Timing` llega en la respuesta de `/app` con un tramo nombrado por cada await de `buildShellPayload` |
| **A9** | **El santuario no cambió de comportamiento.** Los cinco taps del carrusel siguen dando paridad posición/slide/tab/acento/cifra (la comprobación de M2 B12 sirve tal cual) |
| **A10** | `lint` 0 errores · `build` exit 0 · captura **854 + nuevas**, ninguna anterior removida ni relajada |
| **A11** | **Mutación propia con dientes:** romper a mano la regla de A6 (devolver `"0"` en vez de `"—"`) hace fallar una aserción **con nombre**, no el build. Se pega la salida y se revierte |
| **A12** | Cero dependencias nuevas, cero `supabase/**`, cero migraciones, cero cambios en `src/lib/financial/**` ni en `src/lib/ai/**` |

---

## 8. Trampas conocidas de este entorno

Las pagó el Bloque M. No hace falta volver a pagarlas:

1. **Quien no puede renderizar no puede verificar lo visual.** Si tu entorno no
   compone cuadros, dilo en el reporte y marca esas casillas como no
   verificadas. Declararlo es aceptable; afirmarlo sin verlo, no.
2. **Una pestaña oculta pausa `requestAnimationFrame`.** Si mides fps ahí, mides
   cero y no lo sabes.
3. **Medir contraste en plena transición miente.** Espera a que la transición
   termine antes de medir un color.
4. **Una pestaña con tus propios parches no es evidencia.** Recarga limpia.
5. **Re-mide antes de reportar un fallo.** En el Bloque M, cuatro acusaciones
   se cayeron al volver a medir.
6. **`server-only` mata los runners headless del gate.** Toda lógica que el
   gate deba ejecutar vive en un módulo `*-contract.ts` sin ese import.

---

## 9. Formato del reporte

`docs/design/stages/N0_REPORT.md`, append-only por rondas (`## Ronda N`). Por
cada criterio A1–A12: **cómo lo verificaste** y **la salida real**. Al final,
tres secciones obligatorias:

- **Desviaciones**: todo lo que hiciste distinto al spec, con el motivo. Si no
  hubo ninguna, dilo — pero si tocaste un archivo fuera de §3, hubo una.
- **No verificado**: qué no pudo comprobar tu entorno, y por qué.
- **Lo que le dejo a N1**: cualquier cosa que descubriste midiendo y que la
  etapa siguiente debe saber.

Cuando esté listo, el founder abre un **chat auditor nuevo** que no verá esta
conversación.
