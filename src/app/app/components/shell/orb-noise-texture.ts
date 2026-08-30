// Bloque N3C — la tela del campo de color, GENERADA, no pedida.
//
// El componente de ElevenLabs alimenta su shader con una textura de ruido que
// descarga de un CDN ajeno:
//
//     https://storage.googleapis.com/eleven-public-cdn/images/perlin-noise.png
//
// Tal cual, el santuario le pediría un archivo a un tercero en cada carga. No
// entra: hay service worker, hay página sin conexión, y no mandamos al usuario
// a un CDN ajeno sin decidirlo. Así que la tela se FABRICA acá, en una función
// pura y determinista que el gate puede ejecutar — cero peticiones, ni siquiera
// a nuestro propio origen, y cero bytes de asset.
//
// Por qué una textura y no ruido procedural en el shader: su campo hace NUEVE
// lecturas de esta tela por píxel (siete óvalos + las dos del flujo). Nueve fbm
// procedurales por píxel es otra cosa en un teléfono. Una tela de 256×256 se
// genera una vez, se sube una vez y se lee con el muestreador de la GPU.
//
// ─────────────────────────────────────────────────────────────────────────────
// `orbSplitmix32` y `orbSeededAngles` son un porte de `splitmix32` y de los
// `offsets` de:
//
//   MIT License · Copyright (c) 2025 ElevenLabs
//   https://github.com/elevenlabs/ui — apps/www/registry/elevenlabs-ui/ui/orb.tsx
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in
//   all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.
// ─────────────────────────────────────────────────────────────────────────────

/** Lado de la tela, en téxeles. Potencia de dos: WebGL1 sólo repite POT. */
export const ORB_NOISE_SIZE = 256;

/**
 * La semilla del santuario. Fija a propósito: el campo tiene que verse igual en
 * los dos orbes que se comparan y en cada carga, o la comparación de G6 estaría
 * mirando dos ruidos distintos y no dos técnicas.
 */
export const ORB_NOISE_SEED = 0x4b697075;

/** Cuántos óvalos lleva el campo. Es el número de su componente, no un gusto. */
export const ORB_FIELD_OVALS = 7;

/** Porte de `splitmix32` de ElevenLabs (MIT, aviso arriba). */
export function orbSplitmix32(seed: number): () => number {
  let a = seed | 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return (t >>> 0) / 4294967296;
  };
}

/**
 * Los desfasajes de arranque de los óvalos: `random() * 2π`, la misma cuenta de
 * su componente. Sin ellos los siete óvalos arrancarían alineados y el campo
 * empezaría con una simetría que nunca se rompe del todo.
 */
export function orbSeededAngles(seed: number, count: number): Float32Array {
  const random = orbSplitmix32(seed);
  const angles = new Float32Array(count);
  for (let i = 0; i < count; i += 1) angles[i] = random() * Math.PI * 2;
  return angles;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Perlin clásico sobre una RED PERIÓDICA. La periodicidad no es un detalle: el
 * shader lee esta tela con coordenadas que crecen sin techo (el flujo la
 * desplaza con el reloj) y con envoltura `REPEAT`. Si la red no cerrara, cada
 * vuelta se vería una costura recorriendo el orbe.
 */
function periodicPerlin(
  x: number,
  y: number,
  period: number,
  gradX: Float32Array,
  gradY: Float32Array,
): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = fade(xf);
  const v = fade(yf);
  const at = (gx: number, gy: number, dx: number, dy: number): number => {
    const ix = ((gx % period) + period) % period;
    const iy = ((gy % period) + period) % period;
    const index = iy * period + ix;
    return gradX[index]! * dx + gradY[index]! * dy;
  };
  const n00 = at(xi, yi, xf, yf);
  const n10 = at(xi + 1, yi, xf - 1, yf);
  const n01 = at(xi, yi + 1, xf, yf - 1);
  const n11 = at(xi + 1, yi + 1, xf - 1, yf - 1);
  const a = n00 + u * (n10 - n00);
  const b = n01 + u * (n11 - n01);
  return a + v * (b - a);
}

/** Las tres octavas y sus pesos. Fijas: la tela es un hecho, no un ajuste. */
const OCTAVES: readonly { period: number; amplitude: number }[] = [
  { period: 4, amplitude: 1 },
  { period: 8, amplitude: 0.5 },
  { period: 16, amplitude: 0.25 },
];

/**
 * El valor CONTINUO de la tela en téxeles, de 0 a 1. Existe aparte del arreglo
 * de bytes para que la periodicidad se pueda EJECUTAR: `orbNoiseAt(x + size, y)`
 * tiene que devolver exactamente `orbNoiseAt(x, y)`.
 */
export function orbNoiseAt(
  x: number,
  y: number,
  size: number = ORB_NOISE_SIZE,
  seed: number = ORB_NOISE_SEED,
): number {
  const lattices = latticesFor(seed);
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < OCTAVES.length; o += 1) {
    const { period, amplitude } = OCTAVES[o]!;
    const lattice = lattices[o]!;
    sum +=
      amplitude *
      periodicPerlin((x / size) * period, (y / size) * period, period, lattice.gx, lattice.gy);
    norm += amplitude;
  }
  // El techo teórico del Perlin 2D es √2/2. Se normaliza contra ESE techo y no
  // contra el mínimo/máximo medidos: así el rango que la tela ocupa de verdad
  // sigue siendo una MEDICIÓN, y no una consecuencia de haberla estirado.
  const value = sum / (norm * Math.SQRT1_2);
  return Math.min(1, Math.max(0, value * 0.5 + 0.5));
}

interface Lattice {
  gx: Float32Array;
  gy: Float32Array;
}

const latticeCache = new Map<number, Lattice[]>();

function latticesFor(seed: number): Lattice[] {
  const cached = latticeCache.get(seed);
  if (cached) return cached;
  const random = orbSplitmix32(seed);
  const built = OCTAVES.map(({ period }) => {
    const gx = new Float32Array(period * period);
    const gy = new Float32Array(period * period);
    for (let i = 0; i < period * period; i += 1) {
      const angle = random() * Math.PI * 2;
      gx[i] = Math.cos(angle);
      gy[i] = Math.sin(angle);
    }
    return { gx, gy };
  });
  latticeCache.set(seed, built);
  return built;
}

/**
 * La tela, lista para subir: un byte por téxel, un solo canal. El shader la lee
 * en `.r`, igual que la de ellos.
 */
export function orbNoiseTexture(
  size: number = ORB_NOISE_SIZE,
  seed: number = ORB_NOISE_SEED,
): Uint8Array {
  const bytes = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      bytes[y * size + x] = Math.round(orbNoiseAt(x, y, size, seed) * 255);
    }
  }
  return bytes;
}
