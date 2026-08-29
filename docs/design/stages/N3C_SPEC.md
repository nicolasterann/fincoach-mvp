# N3C_SPEC — El orbe de ElevenLabs, con nuestro líquido

> **Contrato completo y autocontenido.** Contexto: `stages/N3_SPEC.md`,
> `stages/N3B_SPEC.md` y sus auditorías. Protocolo: `docs/design/README.md`.
> Lo escribió el auditor que dio VERDE a N3 y N3B, tras ejecutar el código y
> **leer la fuente del componente de ElevenLabs**.
>
> **Tercer acto de N3.** No renumera nada: N4–N8 siguen donde están.

---

## 1. La promesa

**El orbe se ve como los de ElevenLabs — y adentro tiene nuestro líquido, con
su nivel y su aire arriba.**

El founder puntuó N3B en **4,5/10** y trajo la referencia exacta:

> *«Sus agentes son la forma exacta en la que me imagino nuestros orbes. Sólo
> que en lugar de todo sólidos, que lo de adentro sea líquido y tenga un espacio
> vacío para que se vea el aire. […] Lo más interesante es cómo se mueven las
> ondas de adentro mientras habla, exacto como su tono de voz.»*

Y una corrección suya que ordena toda la etapa: **la ventana de N3B no cumple
ninguna función.** Los orbes de ElevenLabs no reflejan ningún objeto
reconocible — son **campos de color abstractos en movimiento**, y se ven mucho
mejor. Reflejar un cuarto era una respuesta correcta a la pregunta equivocada.

---

## 2. Lo que N3C NO puede hacer

- **Ningún número cambia de valor.** Paridad de M2/B12 y las cinco cifras.
- **El tope del vaso sigue siendo un mapeo de DIBUJO** (`orbWaterline` fuera de
  `shell-payload.ts`). Nadie acota el valor, se acota el trazo.
- **`vacío` ≠ `sin dato`**, y sólo el que leyó puede pintar un cero.
- **Sin techo declarado no se inventa un nivel**: cambia la materia.
- **Un solo objeto, y un solo lienzo.** Los cinco orbes siguen en el mismo
  canvas: no se vuelve a un contexto WebGL por orbe. Ya nos costó, y en
  `/dev/sistema` tocamos el techo de contextos del navegador.
- **El agua conserva su masa.** `advanceOrbWater` es de N3B y no se tira:
  oscila, cruza el cero y se aquieta.
- **Cero `supabase/**`, migraciones, `src/lib/financial/**` ni `src/lib/ai/**`.**
- **El hito `orbe` no empeora** (frío 1526–1744 ms · caliente 620–672 ms).

---

## 3. Lo que verifiqué leyendo su código — y cambia el encuadre

Fuente: [`elevenlabs/ui`](https://github.com/elevenlabs/ui),
`apps/www/registry/elevenlabs-ui/ui/orb.tsx`, **498 líneas, licencia MIT**.

### 3.1 No es una esfera 3D. Es un disco con un shader.

```tsx
<circleGeometry args={[3.5, 64]} />
<shaderMaterial …>
```

**Es exactamente nuestra arquitectura**: un disco plano pintado por un shader de
fragmento. Lo que hace que se vea bien **es el shader**, no `three`.

**Consecuencia:** adoptar su orbe **no es pasarse a 3D real**. Es adoptar su
*look*. Y su look es código MIT que podemos leer, portar y modificar.

### 3.2 Carga una textura desde un CDN ajeno

```
https://storage.googleapis.com/eleven-public-cdn/images/perlin-noise.png
```

Tal cual, el santuario haría **una petición a un tercero en cada carga**. Eso no
entra: hay service worker, hay página sin conexión, y no mandamos al usuario a
un CDN ajeno sin decidirlo. **La textura se aloja acá o se genera en código.**

### 3.3 Su API encaja con lo nuestro

```ts
colors?: [string, string]        // dos colores → una capa
colorsRef?: RefObject<[string,string]>
seed?: number
agentState?: null | "thinking" | "listening" | "talking"
volumeMode?: "auto" | "manual"
inputVolumeRef?, outputVolumeRef?, getInputVolume?
```

**`volumeMode: "manual"` es la pieza clave**: el orbe se alimenta de volúmenes
que le damos nosotros. Funciona **sin sus agentes**, con el medidor real que M5
ya construyó. Y `agentState` ya prevé el módulo de voz.

### 3.4 Las dependencias, y un margen estrecho

| paquete | versión | nota |
|---|---|---|
| `three` | 0.185.1 | sin peer deps |
| `@react-three/fiber` | 9.7.0 | **`react: ">=19 <19.3"`** |
| `@react-three/drei` | 10.7.8 | `react: ^19` · sólo se usa para `useTexture` |

Hoy: **React 19.2.4** — entra, pero **con poco margen**. Si Next sube a React
19.3, r3f bloquea la actualización hasta que ellos publiquen. El proyecto tiene
**seis dependencias**; éstas serían las tres primeras de peso.

---

## 4. La decisión de integración — **recomendada, con su alternativa**

Nuestro orbe **no es un orbe**: son **cinco en un solo lienzo**, colocados por
`orbFieldPlacements` según el gesto. El componente de ellos es **un orbe por
`<Canvas>`**. Así que "instalarlo y listo" no existe: hay que reescribir su
contenedor igual.

**Recomendación: portar su shader a nuestro renderer.**

- Conserva todo lo que N3 y N3B ganaron: un lienzo, las vecinas, la
  profundidad, la simulación del agua, la escalera de calidad, y los pines del
  gate que sujetan la doctrina.
- **Cero dependencias nuevas** y sin el techo de React 19.3.
- La textura se resuelve alojándola o generándola.
- **Es usar su orbe**: el look vive en el shader, y el shader es MIT.

**Alternativa, si el porte se atasca:** adoptar el componente con `three` + r3f
y reescribir su contenedor para cinco meshes en un `<Canvas>`. Vale, y el spec
la autoriza — pero entonces **se declara y se pesa el bundle** (hoy: **1,3 MB**
de `.next/static/chunks`).

**Cualquiera de las dos: la licencia MIT exige conservar el aviso de copyright.**
El archivo portado lleva la atribución a ElevenLabs en su cabecera. No es un
detalle opcional.

---

## 5. El trabajo

### 5.1 El look
Igualar lo que hace bonito su orbe: campos de color que se mueven **despacio**,
grano fino, bordes suaves, y **nada reconocible adentro**. Muere la ventana de
N3B, muere el horizonte, muere el marco.

**Dos colores por capa**, como su API. Nuestras cinco capas ya tienen su acento
y su líquido; ahí está el mapeo.

### 5.2 El líquido dentro — la variante del founder
Su orbe es sólido. El nuestro tiene que tener **nivel y aire**:

- El campo de color vive **dentro del líquido**, y por encima de la línea de
  agua hay **aire** — vidrio, no color.
- El menisco sigue siendo la frontera, y el tope del vaso de N3B se conserva:
  **un orbe lleno deja aire visible**.
- **Un orbe vacío se lee vacío** (la gota de N2).
- Las cuatro capas líquidas comparten física; **sin techo declarado, cristal**.

### 5.3 Las ondas de la voz — **sobre el agua, no encima del vidrio**
Es lo que más le gustó al founder: las ondas que responden al tono.

**Regla de forma:** la onda vive **en la superficie del líquido**. Es el mismo
líquido que ya tiene masa, reaccionando a la voz — **no un efecto separado
pegado encima**. Mantiene «un solo objeto», que es la regla que costó N2 y N3.

En esta etapa se cablea **con nuestro medidor de M5** (`volumeMode: "manual"`).
`agentState` se deja preparado y **sin usar**: es del módulo de voz.

---

## 6. Criterios de aceptación

| # | Criterio |
|---|---|
| **G1** | Ningún número cambió; paridad y las cinco cifras intactas |
| **G2** | La doctrina sigue **ejecutable**: `orbFill`, `orbWaterline` sólo en el dibujo, `orbMustRedraw`, `vacío ≠ sin dato`, sin techo ⇒ sin nivel |
| **G3** | **Un solo lienzo** para los cinco orbes; ningún contexto WebGL por orbe |
| **G4** | **Cero peticiones a dominios ajenos** desde el santuario. Se prueba mirando la red, no leyendo el código |
| **G5** | **El aviso de copyright MIT de ElevenLabs está en el archivo** que porta o adapta su código |
| **G6** | **Comparación lado a lado** en `/dev/vidrio`: su orbe original y el nuestro, mismo tamaño. Es la prueba de que igualamos el look, y la imagen que decide la etapa |
| **G7** | **Líquido con nivel y aire**: vacío / 60 % / lleno se distinguen, y el lleno deja aire visible. Medido |
| **G8** | **La onda de voz vive en la superficie del agua** y responde al volumen real de M5 |
| **G9** | El agua conserva su masa: oscila, cruza el cero, se aquieta (`advanceOrbWater` intacto o más fuerte) |
| **G10** | **El peso, medido**: `.next/static/chunks` antes y después (hoy **1,3 MB**), y el servido comprimido. Si entraron dependencias, se justifican |
| **G11** | El hito `orbe` no empeoró |
| **G12** | `lint` 0 · `build` 0 · captura **883 + nuevas**, ninguna removida ni relajada; los re-anclajes se declaran |
| **G13** | **Mutación propia con dientes, y el CABLE además de la conducta** |
| **G14** | Cero `supabase/**`, migraciones, `src/lib/financial/**`, `src/lib/ai/**` |

---

## 7. Trampas verificadas

1. **La textura del CDN ajeno** (§3.2). Es lo primero que hay que resolver y lo
   más fácil de dejar pasar.
2. **No es 3D** (§3.1). Si alguien espera que `three` traiga el look por sí
   solo, va a instalar 3 dependencias y seguir en 4,5.
3. **Cinco orbes, un lienzo.** Un `<Canvas>` por orbe toca el techo de contextos
   WebGL — lo vimos en `/dev/sistema`.
4. **`react >=19 <19.3`** si se adoptan las dependencias.
5. **Este entorno no compone cuadros** (cero `requestAnimationFrame`), pero
   WebGL2 pinta el primer cuadro y `/dev/vidrio` es medible. **Nunca esperes a
   rAF: se cuelga.**
6. **Cuanto mejor es el vidrio, peor funciona un detector de bordes.** En la
   auditoría de N3B gasté cuatro sondas buscando la línea de agua por gradiente:
   el reflejo del entorno era más fuerte que la superficie. Para lo visual,
   mirar sigue siendo el instrumento correcto.
7. **`rm -rf .next` rompe cualquier dev server corriendo**, incluido el de otro
   chat. Borrá antes de levantar.
8. **Re-medí antes de acusar.** En el bloque se cayeron **trece** acusaciones al
   volver a medir.
9. **Un pin de cadena puede CONGELAR un defecto** — pasó en N3 con el
   giroscopio. Pinchá la conducta, no cómo está escrita.

---

## 8. Formato del reporte

`docs/design/stages/N3C_REPORT.md`, append-only por rondas. Por cada criterio
G1–G14: cómo lo verificaste y la salida real.

**Y lo que decide esta etapa es G6: la comparación lado a lado.** Mostrala
temprano. El founder viene de puntuar 3, 4 y 4,5 — no llegues al final con un
reporte, llegá a la mitad con esa imagen.
