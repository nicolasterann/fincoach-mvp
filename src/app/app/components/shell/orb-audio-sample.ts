import {
  orbAudioBands,
  VOICE_ANALYSER_FFT_SIZE,
  VOICE_ANALYSER_SMOOTHING,
  type OrbAudioBands,
} from "./voice-capture-contract";

/**
 * N3C r28 · LA MUESTRA DE VOZ DEL BANCO, Y SU ESPECTRO, SIN NAVEGADOR.
 *
 * El banco de comparación necesita que las dos pantallas —la suya y la nuestra—
 * estén haciendo lo mismo al mismo tiempo. Colgarlo del `AudioContext` lo hacía
 * imposible de guionar: la política de autoplay exige una activación del usuario
 * que un clic automatizado no siempre concede, y cuando falla no avisa: el
 * contexto queda «suspended», el analizador entrega ceros y el orbe se ve
 * quieto sin que nada esté roto. Un banco que puede quedarse mudo en silencio no
 * sirve para comparar.
 *
 * Acá la muestra se sintetiza como números y su espectro se calcula con una FFT
 * propia, reproduciendo lo que `getByteFrequencyData` haría con los MISMOS
 * ajustes de la referencia (256 puntos, suavizado 0,8, escala en decibelios
 * entre −100 y −30). Es una medición del audio real, no un modelo de él: si se
 * reproduce por los parlantes, suena exactamente esto.
 */

export interface OrbVoiceSample {
  nombre: string;
  /** Frecuencia fundamental, en hercios. 0 = silencio. */
  f0: number;
  /** Sílabas por segundo. */
  ritmo: number;
  /** Cuánto peso tienen los armónicos altos: separa la banda aguda. */
  brillo: number;
  energia: number;
}

export const ORB_VOICE_SAMPLES: readonly OrbVoiceSample[] = [
  { nombre: "voz calmada", f0: 118, ritmo: 3.6, brillo: 0.55, energia: 0.85 },
  { nombre: "voz animada", f0: 165, ritmo: 5.2, brillo: 0.8, energia: 1 },
  { nombre: "voz grave", f0: 88, ritmo: 3.0, brillo: 0.3, energia: 0.95 },
  { nombre: "voz aguda", f0: 210, ritmo: 4.6, brillo: 1, energia: 0.9 },
  { nombre: "silencio", f0: 0, ritmo: 0, brillo: 0, energia: 0 },
];

export const ORB_SAMPLE_RATE = 48_000;
export const ORB_SAMPLE_SECONDS = 8;

/**
 * Una voz sintética: un tono con armónicos —los formantes—, recortado en sílabas
 * con sus pausas, con una frase que respira y una entonación que se mueve. No es
 * habla de verdad, pero tiene lo único que el orbe mira: bandas separadas y
 * flancos de subida.
 */
export function orbVoiceSamplePcm(
  muestra: OrbVoiceSample,
  sampleRate = ORB_SAMPLE_RATE,
  segundos = ORB_SAMPLE_SECONDS,
): Float32Array {
  const n = Math.max(1, Math.floor(sampleRate * segundos));
  const pcm = new Float32Array(n);
  if (muestra.f0 <= 0) return pcm;
  let fase = 0;
  // ruido determinista: la misma muestra en cada máquina y en cada corrida
  let semilla = 0x2545f491;
  const azar = () => {
    semilla ^= semilla << 13;
    semilla ^= semilla >>> 17;
    semilla ^= semilla << 5;
    return ((semilla >>> 0) / 0xffffffff) * 2 - 1;
  };
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    const silaba = Math.max(0, Math.sin(2 * Math.PI * muestra.ritmo * t));
    const frase = 0.35 + 0.65 * Math.max(0, Math.sin(2 * Math.PI * 0.13 * t + 0.4));
    const env = Math.pow(silaba, 1.6) * frase * muestra.energia;
    const f = muestra.f0 * (1 + 0.06 * Math.sin(2 * Math.PI * 0.31 * t));
    fase += (2 * Math.PI * f) / sampleRate;
    let v = Math.sin(fase) * 0.55;
    v += Math.sin(fase * 2) * 0.28 * muestra.brillo;
    v += Math.sin(fase * 3) * 0.16 * muestra.brillo;
    v += Math.sin(fase * 5) * 0.09 * muestra.brillo;
    v += azar() * 0.06 * muestra.brillo;
    // N3C r29 · el nivel de la muestra se calibró contra el suyo: su banda total
    // llega a 0,36 de pico hablando, y con la muestra floja de la r28 llegaba a
    // 0,22 — con eso la compuerta del arco NO se satura y el arco parpadea una
    // vez por sílaba, que es un defecto del banco y no del orbe.
    pcm[i] = v * env * 0.92;
  }
  return pcm;
}

/** FFT radix-2 en el sitio. Devuelve las magnitudes normalizadas. */
function magnitudes(re: Float64Array, im: Float64Array): Float64Array {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ur = re[i + k]!;
        const ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const vi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const mitad = n / 2;
  const out = new Float64Array(mitad);
  for (let k = 0; k < mitad; k += 1) {
    out[k] = Math.hypot(re[k]!, im[k]!) / n;
  }
  return out;
}

export const ORB_MIN_DECIBELS = -100;
export const ORB_MAX_DECIBELS = -30;

/**
 * El analizador de la referencia, hecho a mano: ventana de Blackman, FFT,
 * decibelios mapeados al rango de `getByteFrequencyData` y el mismo suavizado
 * entre lecturas. Devuelve las cuatro bandas.
 */
export function createOrbSampleAnalyser(sampleRate = ORB_SAMPLE_RATE) {
  const n = VOICE_ANALYSER_FFT_SIZE;
  const suavizadas = new Float64Array(n / 2);
  const bins = new Uint8Array(n / 2);
  const ventana = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    // Blackman, la misma que usa la Web Audio API
    const x = (2 * Math.PI * i) / (n - 1);
    ventana[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
  }
  let primera = true;
  return {
    bins,
    leer(pcm: Float32Array, desde: number): OrbAudioBands {
      const re = new Float64Array(n);
      const im = new Float64Array(n);
      for (let i = 0; i < n; i += 1) {
        const j = desde + i;
        re[i] = (j >= 0 && j < pcm.length ? pcm[j]! : 0) * ventana[i]!;
      }
      const mag = magnitudes(re, im);
      for (let k = 0; k < mag.length; k += 1) {
        suavizadas[k] = primera
          ? mag[k]!
          : VOICE_ANALYSER_SMOOTHING * suavizadas[k]! +
            (1 - VOICE_ANALYSER_SMOOTHING) * mag[k]!;
        const db = suavizadas[k]! > 0 ? 20 * Math.log10(suavizadas[k]!) : ORB_MIN_DECIBELS;
        const escala =
          ((db - ORB_MIN_DECIBELS) / (ORB_MAX_DECIBELS - ORB_MIN_DECIBELS)) * 255;
        bins[k] = Math.max(0, Math.min(255, Math.round(escala)));
      }
      primera = false;
      return orbAudioBands(bins, sampleRate);
    },
  };
}
