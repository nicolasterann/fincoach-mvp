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
  /**
   * N3C r32 · EL TEXTO QUE SE ESTÁ "NARRANDO".
   *
   * El founder: «quisiera que en las pruebas de audio agregues un texto de
   * narración como el de ellos para escuchar la reacción a voz real». Su página
   * muestra el guion que el orbe está leyendo, y eso cambia cómo se juzga: uno
   * deja de mirar un tono y empieza a seguir una frase. Las sílabas de la
   * muestra se generan a partir de este texto, así que las pausas y los acentos
   * caen donde caerían al leerlo.
   */
  texto: string;
  /**
   * N3C r33 · UNA VOZ DE VERDAD, LA SUYA.
   *
   * Las muestras sintéticas tienen lo que el orbe mira —bandas y flancos—, pero
   * no la PROPORCIÓN entre bandas de una voz grabada. Su portada reproduce un
   * clip público de 3,4 s («Christopher», el orbe de Narrator); pasándolo por su
   * propio analizador la banda grave lee 0,77 de media y casi 1,0 de pico, los
   * medios 0,53, los agudos 0,22 y el total 0,22. Con una muestra que no tenga
   * ese reparto, todo lo que cuelga de una banda —los relojes, el arco, los
   * anillos— se juzga contra otra cosa. Si hay `url`, la muestra es ese clip
   * decodificado (a 48 kHz, con una pausa de silencio al final para que el
   * bucle respire) y `f0` no se usa.
   */
  url?: string;
  /** Frecuencia fundamental, en hercios. 0 = silencio. */
  f0: number;
  /** Sílabas por segundo. */
  ritmo: number;
  /** Cuánto peso tienen los armónicos altos: separa la banda aguda. */
  brillo: number;
  energia: number;
}

/** Su clip público de Narrator, el que suena en el orbe naranja de su portada. */
export const ORB_REAL_VOICE_URL =
  "https://storage.googleapis.com/eleven-public-prod/database/workspace/48ab3aae468d4e9baded4b1693820088/voices/EkK5I93UQWFDigLMpZcX/117d85a7-853f-482d-bf48-2d169f399830.mp3";
/** Silencio que se le añade al clip para que el bucle tenga un «entre frases». */
export const ORB_REAL_VOICE_TAIL_SECONDS = 1.5;

export const ORB_VOICE_SAMPLES: readonly OrbVoiceSample[] = [
  {
    nombre: "Christopher · su clip real de Narrator",
    url: ORB_REAL_VOICE_URL,
    f0: 0,
    ritmo: 0,
    brillo: 0,
    energia: 0,
    texto:
      "La misma voz grabada que suena en su portada: 3,4 segundos de narración, decodificados y pasados por su propio analizador.",
  },
  {
    nombre: "voz calmada",
    f0: 118,
    ritmo: 3.6,
    brillo: 0.55,
    energia: 0.85,
    texto:
      "Tu saldo de hoy alcanza para lo que tenías pensado. No hace falta que te aprietes: lo de esta semana ya está cubierto.",
  },
  {
    nombre: "voz animada",
    f0: 165,
    ritmo: 5.2,
    brillo: 0.8,
    energia: 1,
    texto:
      "¡Llegaste a la meta del viaje! Guardaste mil doscientos en cuatro meses y todavía te sobra la reserva entera. Eso hay que celebrarlo.",
  },
  {
    nombre: "voz grave",
    f0: 88,
    ritmo: 3.0,
    brillo: 0.3,
    energia: 0.95,
    texto:
      "Se viene el pago de la tarjeta el jueves. Si movés doscientos desde la cuenta de ahorro, entra sin tocar la reserva.",
  },
  {
    nombre: "voz aguda",
    f0: 210,
    ritmo: 4.6,
    brillo: 1,
    energia: 0.9,
    texto:
      "Registré el almuerzo de ayer y lo dividí con Ana. Te devuelve nueve con cincuenta; te lo aviso cuando lo pague.",
  },
  { nombre: "silencio", f0: 0, ritmo: 0, brillo: 0, energia: 0, texto: "" },
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
  // N3C r32 · LAS PAUSAS SALEN DEL TEXTO. Una voz de verdad no es una ráfaga
  // regular: tiene comas, puntos y respiraciones, y el orbe reacciona a los
  // flancos de subida — o sea, justo a los arranques después de una pausa.
  const palabras = muestra.texto.split(/\s+/).filter(Boolean);
  const pausas: number[] = [];
  {
    let reloj = 0;
    for (const w of palabras) {
      const silabas = Math.max(1, (w.match(/[aeiouáéíóúAEIOUÁÉÍÓÚ]+/g) ?? []).length);
      reloj += silabas / Math.max(0.5, muestra.ritmo);
      if (/[,;:]$/.test(w)) reloj += 0.18;
      if (/[.!?]$/.test(w)) reloj += 0.42;
      pausas.push(reloj);
    }
  }
  const largoTexto = pausas.length ? pausas[pausas.length - 1]! : segundos;
  const enPausa = (t: number) => {
    if (!pausas.length) return false;
    const tt = t % Math.max(0.5, largoTexto);
    for (let k = 0; k < pausas.length; k += 1) {
      const fin = pausas[k]!;
      const ini = k > 0 ? pausas[k - 1]! : 0;
      if (tt >= ini && tt < fin) {
        const w = palabras[k]!;
        const cola = /[.!?]$/.test(w) ? 0.42 : /[,;:]$/.test(w) ? 0.18 : 0.04;
        return tt > fin - cola;
      }
    }
    return false;
  };
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    const silaba = Math.max(0, Math.sin(2 * Math.PI * muestra.ritmo * t));
    const frase = 0.35 + 0.65 * Math.max(0, Math.sin(2 * Math.PI * 0.13 * t + 0.4));
    const env = Math.pow(silaba, 1.6) * frase * muestra.energia * (enPausa(t) ? 0.06 : 1);
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

/**
 * Decodifica un clip de voz a números, a la tasa del banco, y le añade una
 * cola de silencio. Usa un contexto sin salida (`OfflineAudioContext`), que
 * decodifica y remuestrea sin necesitar un gesto del usuario — la trampa de
 * la política de autoplay que ya nos costó una ronda no aplica acá.
 */
export async function decodeOrbVoiceClip(
  url: string,
  sampleRate = ORB_SAMPLE_RATE,
  tailSeconds = ORB_REAL_VOICE_TAIL_SECONDS,
): Promise<Float32Array | null> {
  if (typeof window === "undefined") return null;
  const Offline =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!Offline) return null;
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const ctx = new Offline(1, 1, sampleRate);
  const audio = await ctx.decodeAudioData(buf);
  const voz = audio.getChannelData(0);
  const cola = Math.max(0, Math.floor(tailSeconds * sampleRate));
  const pcm = new Float32Array(voz.length + cola);
  pcm.set(voz, 0);
  return pcm;
}
