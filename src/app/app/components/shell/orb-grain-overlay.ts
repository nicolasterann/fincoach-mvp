/**
 * N3C r32 · EL GRANO, QUE NO ESTÁ EN EL WEBGL.
 *
 * El founder: «le falta la textura de grain que tiene el de ellos, no sé de
 * dónde sale exactamente». Salía del sitio donde yo no había mirado: **no está
 * en su shader ni en su textura**.
 *
 *   · su configuración dice `grainOpacity: 0` — el grano del shader está APAGADO;
 *   · su PNG de degradado es LISO: medida la diferencia entre píxeles vecinos da
 *     0,0017, o sea nada.
 *
 * Está en el DOM, encima del lienzo: un `<div>` con un PNG de ruido en mosaico,
 * `mix-blend-mode: overlay` y `opacity: 0.5`, con el mosaico a 256 px (128 px en
 * pantallas de doble densidad). Se lee de su propio marcado:
 *
 *   tw-absolute tw-mix-blend-overlay tw-inset-0
 *   tw-bg-[image:var(--noise-png)] tw-bg-[length:calc(256px*var(--noise-scale))]
 *
 * Tres rondas buscándolo dentro del shader. La lección: cuando algo se ve y no
 * está en el código que mirás, mirá la CAPA DE AL LADO.
 *
 * Acá el mosaico se genera —no se usa el suyo— y se aplica con su misma receta.
 */

export const ORB_GRAIN_TILE = 256;
export const ORB_GRAIN_OPACITY = 0.5;
/** Cuánto se aparta cada píxel del gris medio. Sobre `overlay`, el gris no hace nada. */
export const ORB_GRAIN_SPREAD = 30;

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
  // ruido determinista: el mismo grano en cada máquina y en cada corrida
  let s = 0x9e3779b9;
  for (let i = 0; i < d.length; i += 4) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const v = 128 + (((s >>> 0) / 0xffffffff) * 2 - 1) * ORB_GRAIN_SPREAD;
    const c = Math.max(0, Math.min(255, v));
    d[i] = c;
    d[i + 1] = c;
    d[i + 2] = c;
    d[i + 3] = 255;
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
 * El estilo de la capa, con su misma receta.
 *
 * Recibe el mosaico en vez de generarlo, para que el componente decida CUÁNDO
 * puede existir.
 */
export function orbGrainStyle(tile: string | null): Record<string, string> {
  return {
    position: "absolute",
    inset: "0",
    borderRadius: "999px",
    pointerEvents: "none",
    mixBlendMode: "overlay",
    opacity: String(ORB_GRAIN_OPACITY),
    backgroundImage: tile ? `url(${tile})` : "none",
    backgroundRepeat: "repeat",
    // 256 px, y la mitad en pantallas de doble densidad — como el suyo
    backgroundSize: `${ORB_GRAIN_TILE / Math.min(2, Math.max(1, typeof window !== "undefined" ? window.devicePixelRatio : 1))}px`,
  };
}
