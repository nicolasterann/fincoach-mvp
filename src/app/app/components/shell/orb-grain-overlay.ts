/**
 * N3C r32 · EL GRANO, QUE NO ESTÁ EN EL WEBGL.
 *
 * El founder: «le falta la textura de grain que tiene el de ellos, no sé de
 * dónde sale exactamente». Salía del sitio donde no se había mirado: **no está
 * en su shader ni en su textura**. Está en el DOM, encima del lienzo: un `<div>`
 * con un mosaico de ruido, `mix-blend-mode: overlay` y `opacity: 0.5`, leído de
 * su propio marcado:
 *
 *   tw-absolute tw-mix-blend-overlay tw-inset-0
 *   tw-bg-[image:var(--noise-png)] tw-bg-[length:calc(256px*var(--noise-scale))]
 *   [@media(min-resolution:2x)]:tw-bg-[length:calc(128px*var(--noise-scale))]
 *   image-rendering: pixelated
 *
 * N3C r33 · Y EL MOSAICO ES NEGRO CON ALFA, no gris simétrico.
 *
 * Se decodificó su `noise@20aq.avif` (256×256) y se midió: RGB = 0 en TODOS los
 * píxeles; lo que varía es el ALFA — media 103/255, desvío 43/255, casi
 * gaussiano, con una correlación espacial leve (+0,11 a un píxel, −0,16 a dos).
 * Sobre `overlay`, un píxel negro con alfa `a` no «da textura alrededor del
 * gris»: OSCURECE, y cuanto más claro el fondo, menos (base < 0,5 → base·(1−a/2);
 * base ≥ 0,5 → base − a/2·(1−base)). Con la media de 0,40 eso baja los medios
 * tonos ~0,08–0,10 en promedio: buena parte del «15 % más claro» que el porte
 * arrastraba era este grano, que el nuestro (gris centrado) no aportaba.
 *
 * Acá el mosaico se genera con esa misma receta: negro, alfa gaussiano con su
 * media y desvío, y un núcleo pequeño que reproduce su correlación. `orbGrainAlpha`
 * es pura a propósito: el gate mide sus estadísticas en Node en vez de buscar
 * cadenas en el archivo.
 */

export const ORB_GRAIN_TILE = 256;
export const ORB_GRAIN_OPACITY = 0.5;
/** Alfa medio del mosaico (0–255): cuánto oscurece en promedio. El suyo mide 103. */
export const ORB_GRAIN_ALPHA_MEAN = 103;
/** Desvío del alfa (0–255): el contraste del grano. El suyo mide 43. */
export const ORB_GRAIN_ALPHA_SD = 43;
/** Núcleo espacial: vecinos a 1 y a 2 píxeles. Ajustado a su +0,11 / −0,16. */
export const ORB_GRAIN_KERNEL_1 = 0.05;
export const ORB_GRAIN_KERNEL_2 = -0.1;

/**
 * El alfa de cada píxel del mosaico, 0–255, determinista: el mismo grano en
 * cada máquina y en cada corrida.
 */
export function orbGrainAlpha(tile = ORB_GRAIN_TILE): Float64Array {
  const N = tile;
  let s = 0x9e3779b9;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) + 0.5) / 4294967296;
  };
  // gaussiano por Box-Muller
  const g = new Float64Array(N * N);
  for (let i = 0; i < N * N; i += 2) {
    const u1 = rnd();
    const u2 = rnd();
    const r = Math.sqrt(-2 * Math.log(u1));
    g[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < N * N) g[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  // el núcleo, toroidal para que el mosaico repita sin costura
  const at = (x: number, y: number) => g[((y + N) % N) * N + ((x + N) % N)]!;
  const out = new Float64Array(N * N);
  let suma = 0;
  let suma2 = 0;
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      let v = at(x, y);
      v += ORB_GRAIN_KERNEL_1 * (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1));
      v += ORB_GRAIN_KERNEL_2 * (at(x - 2, y) + at(x + 2, y) + at(x, y - 2) + at(x, y + 2));
      out[y * N + x] = v;
      suma += v;
      suma2 += v * v;
    }
  }
  // se normaliza a SU media y SU desvío, y se recorta al rango del alfa
  const media = suma / (N * N);
  const desvio = Math.sqrt(Math.max(1e-9, suma2 / (N * N) - media * media));
  for (let i = 0; i < N * N; i += 1) {
    const z = (out[i]! - media) / desvio;
    out[i] = Math.max(0, Math.min(255, ORB_GRAIN_ALPHA_MEAN + ORB_GRAIN_ALPHA_SD * z));
  }
  return out;
}

let cache: string | null = null;

/** El mosaico de ruido, como data URI. Se genera una vez por sesión. */
export function orbGrainTile(): string | null {
  if (cache) return cache;
  if (typeof document === "undefined") return null;
  const N = ORB_GRAIN_TILE;
  const cv = document.createElement("canvas");
  cv.width = N;
  cv.height = N;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(N, N);
  const d = img.data;
  const alfa = orbGrainAlpha(N);
  for (let i = 0, k = 0; i < d.length; i += 4, k += 1) {
    // NEGRO con alfa: sólo oscurece, como el suyo
    d[i] = 0;
    d[i + 1] = 0;
    d[i + 2] = 0;
    d[i + 3] = Math.round(alfa[k]!);
  }
  ctx.putImageData(img, 0, 0);
  cache = cv.toDataURL("image/png");
  return cache;
}

/**
 * Lo que React necesita para leer un valor que SÓLO existe en el navegador.
 *
 * El grano se pinta con un lienzo, y en el servidor no hay lienzo. Las dos
 * salidas obvias fallan: generarlo en un efecto dispara un render en cascada
 * (y el lint lo rechaza), y generarlo en el primer render deja al servidor
 * diciendo «sin imagen» y a la hidratación sin reparar la diferencia — la capa
 * quedaba en `none`, sin error y sin nada en consola.
 *
 * `useSyncExternalStore` es la puerta hecha para esto: el servidor devuelve
 * `null`, el navegador devuelve el mosaico, y React vuelve a leer después de
 * hidratar. La suscripción no hace nada porque el valor nunca cambia, y
 * `orbGrainTile()` devuelve SIEMPRE la misma cadena — si devolviera una nueva
 * en cada lectura, React re-renderizaría para siempre.
 */
export const orbGrainSubscribe = () => () => {};
export const orbGrainServerTile = (): string | null => null;

/**
 * Sólo la imagen: el tamaño del mosaico (256 px, 128 en doble densidad), la
 * mezcla, la opacidad y el `image-rendering: pixelated` viven en la clase CSS
 * `kipu-grano`. Leer `devicePixelRatio` en el render era la causa del error de
 * hidratación del banco: el servidor decía 256 y el navegador 128.
 */
export function orbGrainStyle(tile: string | null): Record<string, string> {
  return {
    backgroundImage: tile ? `url(${tile})` : "none",
  };
}
