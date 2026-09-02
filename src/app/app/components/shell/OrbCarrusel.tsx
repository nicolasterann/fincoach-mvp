"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createOrbRenderer, ORB_SPAN, type OrbRenderer, type OrbRgb } from "./orb-shader";
import { paintOrbGradient } from "./orb-gradient-texture";
import {
  orbGrainServerTile,
  orbGrainStyle,
  orbGrainSubscribe,
  orbGrainTile,
} from "./orb-grain-overlay";
import {
  createElevenOrbRenderer,
  type ElevenOrbRenderer,
} from "./orb-eleven-shader";
import {
  ORB_KINDS,
  orbMatter,
  orbPresentationMaterial,
  orbWaterline,
} from "./shell-orb-contract";
import { advanceOrbField, orbFieldDrive } from "./orb-water-sim";
import {
  createOrbSampleAnalyser,
  decodeOrbVoiceClip,
  orbVoiceSamplePcm,
  ORB_SAMPLE_RATE,
  ORB_VOICE_SAMPLES,
} from "./orb-audio-sample";
import {
  advanceVoiceTau,
  VOICE_SHAPE_TAU_MS,
  advanceOrbAudioAverage,
  advanceOrbCumulativeAudio,
  ORB_AUDIO_ZERO,
  type OrbAudioBands,
} from "./voice-capture-contract";

/**
 * N3C r28 · EL BANCO DE COMPARACIÓN, PEDIDO TAL CUAL.
 *
 * El founder: «creas una página dentro de nuestro dev que sea exactamente igual
 * a la de ellos, en el sentido en que están los orbes en carrusel y con un audio
 * sample, que puedes poner play y pasar entre uno y otro».
 *
 * La razón de fondo es de método y ya nos costó tres rondas: comparar el nuestro
 * contra el suyo exige que los dos estén haciendo LO MISMO. Un deslizador no es
 * una voz, y una foto no es un movimiento. Acá suena una muestra real, el
 * analizador la parte en las cuatro bandas de la referencia, y el orbe recibe
 * exactamente lo que recibiría el suyo.
 *
 * N3C r33 · Y AHORA LO MISMO DE VERDAD: su clip de voz grabada, su textura WebP,
 * su grano, su recorte y su fondo crema. Ver `orb-eleven-shader.ts`.
 */

const MUESTRAS = ORB_VOICE_SAMPLES;

/**
 * N3C r32/r33 · SU NARANJA DE NARRATOR, sacado de su textura VIVA.
 *
 * El founder: «no veo que hayas replicado su orbe naranja de Narrator; el
 * experimento era replicarlo exacto, con sus colores y textura, para encontrar
 * las diferencias de forma más clara». Los cinco tonos salen de su
 * `creative-1.webp` —lo que su WebGL muestrea; el PNG es sólo el cartel de
 * carga— por percentiles de luminancia (5, 20, 50, 80 y 95).
 */
const NARRATOR: readonly OrbRgb[] = [
  [0xa6 / 255, 0x36 / 255, 0x1a / 255],
  [0xc5 / 255, 0x53 / 255, 0x2b / 255],
  [0xde / 255, 0x81 / 255, 0x56 / 255],
  [0xf1 / 255, 0xae / 255, 0x82 / 255],
  [0xf5 / 255, 0xb4 / 255, 0x88 / 255],
];

/**
 * Su textura viva, tal cual la sirve su CDN (con CORS abierto). Sólo para el
 * banco: producción jamás carga un asset ajeno.
 */
export const NARRATOR_TEXTURE_URL =
  "https://eleven-public-cdn.elevenlabs.io/marketing_website/_next/static/media/creative-1.18030cd4.webp";

export function OrbCarrusel({ size = 260 }: { size?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const porteRef = useRef<HTMLCanvasElement>(null);
  // N3C r30 · VER LA TEXTURA, no sólo el orbe. Lo que se ve del orbe es la
  // textura ARRASTRADA, así que juzgar el resultado sin mirar la entrada es
  // adivinar — este bloque ya pagó tres veces por instrumentos que escondían el
  // paso intermedio.
  const texRef = useRef<HTMLCanvasElement>(null);
  const narradorRef = useRef<HTMLCanvasElement>(null);
  const [indice, setIndice] = useState(0);
  const [sonando, setSonando] = useState(false);
  const [medidas, setMedidas] = useState<OrbAudioBands>(ORB_AUDIO_ZERO);
  const [falla, setFalla] = useState<string | null>(null);
  const [clipListo, setClipListo] = useState(false);
  /**
   * El mosaico del grano: nulo en el servidor, el PNG de ruido en el navegador.
   * El porqué de esta puerta y no un efecto está en `orb-grain-overlay.ts`.
   */
  const grano = useSyncExternalStore(
    orbGrainSubscribe,
    orbGrainTile,
    orbGrainServerTile,
  );

  const bandasRef = useRef<OrbAudioBands>(ORB_AUDIO_ZERO);
  const ctxRef = useRef<AudioContext | null>(null);
  const fuenteRef = useRef<AudioBufferSourceNode | null>(null);
  const indiceRef = useRef(0);
  // La muestra como NÚMEROS y su analizador propio: es lo que mira el orbe, y
  // no depende de que el navegador deje sonar nada.
  const pcmRef = useRef<Float32Array>(orbVoiceSamplePcm(MUESTRAS[0]!));
  const analizadorRef = useRef(createOrbSampleAnalyser());
  const posRef = useRef(0);
  const corriendoRef = useRef(false);
  /** Su clip real, decodificado una vez al montar. */
  const clipRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    indiceRef.current = indice;
  }, [indice]);

  /**
   * N3C r33 · EL CLIP REAL SE TRAE ANTES DEL PRIMER TOQUE.
   *
   * Un `await` dentro del manejador del clic gasta la activación del usuario y
   * el sonido no arranca (lección de la r28). Así que el clip se decodifica al
   * montar, y el clic ya lo encuentra como números.
   */
  useEffect(() => {
    let vivo = true;
    const url = MUESTRAS.find((m) => m.url)?.url;
    if (!url) return;
    decodeOrbVoiceClip(url)
      .then((pcm) => {
        if (!vivo || !pcm) return;
        clipRef.current = pcm;
        setClipListo(true);
      })
      .catch(() => {
        /* sin clip: la muestra queda en silencio y el banco lo dice */
      });
    return () => {
      vivo = false;
    };
  }, []);

  const pcmDe = useCallback((i: number): Float32Array => {
    const m = MUESTRAS[i]!;
    if (m.url) return clipRef.current ?? orbVoiceSamplePcm(m);
    return orbVoiceSamplePcm(m);
  }, []);

  const parar = useCallback(() => {
    try {
      fuenteRef.current?.stop();
    } catch {
      /* ya estaba parada */
    }
    fuenteRef.current = null;
    corriendoRef.current = false;
    bandasRef.current = ORB_AUDIO_ZERO;
    setSonando(false);
  }, []);

  // N3C r28 · TODO SÍNCRONO, y no es un detalle de estilo.
  //
  // Un `await` antes de crear los nodos ROMPE el gesto del usuario: el navegador
  // sólo trata como «activado» la parte síncrona del manejador del clic, así que
  // `ctx.resume()` esperaba una activación que ya se había consumido y la
  // promesa no resolvía nunca — sin error, sin sonido y sin nada en la consola.
  // Se crean los nodos y se arranca la fuente en el mismo tirón, y el resume se
  // deja suelto: si hace falta, llega solo.
  const tocar = useCallback(() => {
    if (corriendoRef.current) {
      parar();
      return;
    }
    // La reproducción que MIRA el orbe es la de la muestra en números: arranca
    // siempre, en cualquier navegador y sin permiso de nadie.
    pcmRef.current = pcmDe(indiceRef.current);
    analizadorRef.current = createOrbSampleAnalyser();
    posRef.current = 0;
    corriendoRef.current = true;
    setSonando(true);

    // Y el sonido de verdad, que es un extra: si el navegador lo deja, se oye
    // exactamente la misma muestra. Si no lo deja, el banco funciona igual — que
    // es lo que lo hace comparable.
    const Contexto =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Contexto) return;
    try {
      const ctx = ctxRef.current ?? new Contexto();
      ctxRef.current = ctx;
      const pcm = pcmRef.current;
      const buf = ctx.createBuffer(1, pcm.length, ORB_SAMPLE_RATE);
      buf.getChannelData(0).set(pcm);
      const fuente = ctx.createBufferSource();
      fuente.buffer = buf;
      fuente.loop = true;
      fuente.connect(ctx.destination);
      fuente.start();
      fuenteRef.current = fuente;
      if (ctx.state === "suspended") void ctx.resume();
    } catch {
      /* sin sonido; el banco sigue midiendo */
    }
  }, [parar, pcmDe]);

  // al cambiar de orbe, la muestra cambia con él — como en el suyo
  useEffect(() => {
    if (!corriendoRef.current) return;
    parar();
    tocar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indice]);

  useEffect(() => () => parar(), [parar]);

  /**
   * N3C r28 · ARRANQUE POR URL, para que el banco se pueda GUIONAR.
   *
   * `?tocar=1` deja armado el play en el primer toque. Existe porque la
   * comparación con la referencia hay que hacerla con las dos pantallas haciendo
   * lo mismo al mismo tiempo, y eso no se puede coreografiar a mano; y porque la
   * política de audio del navegador exige un toque de todos modos, así que el
   * arranque se cuelga de él en vez de pelearlo.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("tocar") !== "1") return;
    const arrancar = () => {
      document.removeEventListener("pointerdown", arrancar);
      if (!corriendoRef.current) tocar();
    };
    document.addEventListener("pointerdown", arrancar);
    return () => document.removeEventListener("pointerdown", arrancar);
  }, [tocar]);

  /**
   * N3C r28 · REANUDAR EN LA PRIMERA INTERACCIÓN.
   *
   * Chrome sólo deja arrancar el audio con una activación del usuario VIGENTE, y
   * la activación se gasta: si el contexto quedó suspendido —porque se creó un
   * instante tarde, o porque la pestaña volvió del fondo— no se recupera solo y
   * la página se queda muda sin decir nada. Cualquier toque posterior lo despierta.
   */
  useEffect(() => {
    const despertar = () => {
      const ctx = ctxRef.current;
      if (ctx && ctx.state === "suspended") void ctx.resume();
    };
    document.addEventListener("pointerdown", despertar);
    document.addEventListener("keydown", despertar);
    return () => {
      document.removeEventListener("pointerdown", despertar);
      document.removeEventListener("keydown", despertar);
    };
  }, []);

  useEffect(() => {
    const destino = texRef.current;
    if (!destino) return;
    const kind = ORB_KINDS[indice % ORB_KINDS.length]!;
    const leer = (n: string): OrbRgb => {
      const css = getComputedStyle(destino).getPropertyValue(n).trim();
      const m = /#?([0-9a-f]{6})/i.exec(css);
      const hex = m ? m[1]! : "888888";
      return [
        Number.parseInt(hex.slice(0, 2), 16) / 255,
        Number.parseInt(hex.slice(2, 4), 16) / 255,
        Number.parseInt(hex.slice(4, 6), 16) / 255,
      ];
    };
    const cv = paintOrbGradient({
      deep: leer(`--kipu-deep-${kind}`),
      liquid: leer(`--kipu-liquid-${kind}`),
      accent: leer(`--layer-${kind}`),
      seed: indice,
    });
    if (!cv) return;
    destino.width = cv.width;
    destino.height = cv.height;
    destino.getContext("2d")?.drawImage(cv, 0, 0);
  }, [indice]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: OrbRenderer | null = null;
    try {
      renderer = createOrbRenderer(canvas, { forceFluid: true });
    } catch {
      renderer = null;
    }
    if (!renderer) {
      setFalla("sin contexto WebGL");
      return;
    }
    const activo = renderer;
    let porte: ElevenOrbRenderer | null = null;
    if (porteRef.current) {
      try {
        porte = createElevenOrbRenderer(porteRef.current);
      } catch {
        porte = null;
      }
    }
    let narrador: ElevenOrbRenderer | null = null;
    if (narradorRef.current) {
      try {
        narrador = createElevenOrbRenderer(narradorRef.current);
      } catch {
        narrador = null;
      }
    }
    const flags =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams();
    // N3C r31 · `?tex=<url>` mete una imagen ajena en el porte. Existe para
    // separar los dos problemas: si el shader come SU textura y da lo mismo que
    // su orbe, el shader está bien y lo que falla es nuestra pintura. Es una
    // herramienta de medición de la mesa de luz — producción nunca la toca.
    const cargar = (destino: ElevenOrbRenderer | null, url: string) => {
      if (!destino) return;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => destino.useImage(img);
      img.src = url;
    };
    const tex = flags.get("tex");
    if (tex) cargar(porte, tex);
    // N3C r33 · EL ORBE DE LA DERECHA COME SU TEXTURA VIVA por defecto. Con
    // `?pintado=1` usa nuestra pintura con su paleta: la distancia entre las
    // dos es lo que falta de PINTURA, y nada más.
    if (flags.get("pintado") !== "1") cargar(narrador, NARRATOR_TEXTURE_URL);
    let vivo = true;
    let raf = 0;
    let ultimoMs = -1;
    let forzado: number | null = null;
    let reloj = 0;
    let promedio: OrbAudioBands = ORB_AUDIO_ZERO;
    let acumulado: OrbAudioBands = ORB_AUDIO_ZERO;
    let ultimoTotal = 0;
    // N3C r28 · el envolvente LENTO, que es el que puede mover amplitudes en
    // NUESTRO orbe de producción. El clon no lo usa: su arco cuelga del rápido.
    let lento = 0;
    let relojPorte = 0;
    let avisoMs = 0;

    const leerColor = (nombre: string): OrbRgb => {
      const css = getComputedStyle(canvas).getPropertyValue(nombre).trim();
      const m = /#?([0-9a-f]{6})/i.exec(css);
      const hex = m ? m[1]! : "888888";
      return [
        Number.parseInt(hex.slice(0, 2), 16) / 255,
        Number.parseInt(hex.slice(2, 4), 16) / 255,
        Number.parseInt(hex.slice(4, 6), 16) / 255,
      ];
    };

    const paso = (ahora: number) => {
      if (!vivo) return;
      const dt = forzado ??
        (ultimoMs < 0 ? 1 / 60 : Math.min(1 / 20, Math.max(1 / 240, (ahora - ultimoMs) / 1_000)));
      ultimoMs = ahora;

      // ── EL AUDIO, por la ley de la referencia ──
      let crudo: OrbAudioBands = ORB_AUDIO_ZERO;
      if (corriendoRef.current) {
        posRef.current += dt * ORB_SAMPLE_RATE;
        if (posRef.current >= pcmRef.current.length) posRef.current = 0;
        crudo = analizadorRef.current.leer(pcmRef.current, Math.floor(posRef.current));
      }
      bandasRef.current = crudo;
      const antesTotal = promedio.all;
      promedio = advanceOrbAudioAverage(promedio, crudo);
      acumulado = advanceOrbCumulativeAudio(acumulado, crudo, dt);
      const subiendo = promedio.all - antesTotal;
      ultimoTotal = promedio.all;

      lento = advanceVoiceTau(lento, promedio.all, dt, VOICE_SHAPE_TAU_MS);
      relojPorte += dt;
      reloj = advanceOrbField(reloj, orbFieldDrive(promedio.all, 0), dt);

      const info = activo.resize(size, size, window.devicePixelRatio || 1);
      const kind = ORB_KINDS[indiceRef.current % ORB_KINDS.length]!;
      activo.draw({
        time: ahora / 1_000,
        day: document.documentElement.dataset.theme === "light" ? 1 : 0,
        tier: 3,
        voice: promedio.all,
        wave: 0,
        dtSeconds: dt,
        audio: { average: promedio, cumulative: acumulado, risingAll: subiendo },
        orbs: [
          {
            seed: indiceRef.current,
            centerX: info.width / (info.dpr || 1) / 2,
            centerY: info.height / (info.dpr || 1) / 2,
            radius: size / 2 / ORB_SPAN,
            presence: 1,
            waterline: orbWaterline(0.62),
            energy: 0,
            voice: promedio.all,
            voiceSlow: lento,
            voiceCumulative: acumulado.all,
            tiltX: 0,
            tiltZ: 0,
            spin: 0,
            wave: 0,
            bob: 0,
            depth: 0,
            env: 1,
            field: reloj,
            material: orbPresentationMaterial({
              kind,
              matter: orbMatter(kind),
              fill: "nivel",
            }),
            liquid: leerColor(`--kipu-liquid-${kind}`),
            deep: leerColor(`--kipu-deep-${kind}`),
            accent: leerColor(`--layer-${kind}`),
          },
        ],
      });
      canvas.dataset.fluid = activo.hasFluid() ? "1" : "0";

      // ── N3C r33 · EL CLON, AL LADO ────────────────────────────────────────
      // Mismo audio crudo, mismo cuadro. El clon lleva SUS acumuladores adentro
      // (su `setAudioData`), así que acá sólo recibe las bandas del analizador.
      if (narrador) {
        narrador.resize(size, window.devicePixelRatio || 1);
        narrador.draw({
          timeSeconds: relojPorte,
          dtSeconds: dt,
          bands: crudo,
          seed: 99,
          deep: NARRATOR[0]!,
          liquid: NARRATOR[2]!,
          accent: NARRATOR[3]!,
          tonos: NARRATOR,
        });
      }

      if (porte) {
        porte.resize(size, window.devicePixelRatio || 1);
        porte.draw({
          timeSeconds: relojPorte,
          dtSeconds: dt,
          bands: crudo,
          seed: indiceRef.current,
          deep: leerColor(`--kipu-deep-${kind}`),
          liquid: leerColor(`--kipu-liquid-${kind}`),
          accent: leerColor(`--layer-${kind}`),
        });
      }
      if (ahora - avisoMs > 120) {
        avisoMs = ahora;
        setMedidas({ ...promedio });
        // El segundo de la muestra que se está mirando: sin esto, «no se mueve»
        // y «no está sonando» se ven igual desde afuera.
        canvas.dataset.pos = (posRef.current / ORB_SAMPLE_RATE).toFixed(2);
        canvas.dataset.corriendo = corriendoRef.current ? "1" : "0";
      }
      if (forzado === null) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);

    /**
     * N3C r28 · UN PASO A MANO, DETERMINISTA.
     *
     * `requestAnimationFrame` no corre en una pestaña que no está al frente, y
     * este banco existe justamente para medirse contra otra pantalla — o sea que
     * la mitad del tiempo va a estar detrás. Sin esto, «no se mueve» y «el
     * navegador lo pausó» se ven exactamente igual, que es la trampa que ya me
     * costó una ronda entera.
     *
     * Avanza el mismo bucle con un paso fijo, así dos corridas dan lo mismo y se
     * pueden comparar cuadro contra cuadro.
     */
    const avanzar = (dtSeconds = 1 / 60, veces = 1) => {
      for (let i = 0; i < veces; i += 1) {
        forzado = dtSeconds;
        paso((ultimoMs < 0 ? 0 : ultimoMs) + dtSeconds * 1000);
      }
      forzado = null;
      return true;
    };
    (window as unknown as { __kipuOnda?: typeof avanzar }).__kipuOnda = avanzar;

    return () => {
      vivo = false;
      cancelAnimationFrame(raf);
      activo.dispose();
      porte?.dispose();
      narrador?.dispose();
      delete (window as unknown as { __kipuOnda?: unknown }).__kipuOnda;
      void ultimoTotal;
    };
  }, [size]);

  const muestra = MUESTRAS[indice]!;

  return (
    <div className="kipu-carrusel" data-sonando={sonando ? "1" : "0"} data-fondo="crema">
      <div className="kipu-carrusel__pista">
        <button
          type="button"
          className="kipu-carrusel__flecha"
          onClick={() => setIndice((i) => (i + MUESTRAS.length - 1) % MUESTRAS.length)}
          aria-label="anterior"
        >
          ‹
        </button>
        <div className="kipu-carrusel__par">
          <div className="kipu-carrusel__orbe" style={{ width: size, height: size }}>
            <canvas ref={canvasRef} style={{ width: size, height: size }} />
            <button
              type="button"
              className="kipu-carrusel__play"
              onClick={tocar}
              aria-label={sonando ? "pausa" : "reproducir"}
            >
              {sonando ? "❚❚" : "▶"}
            </button>
            <p className="kipu-carrusel__cual">el nuestro de hoy</p>
          </div>
          {/* Sus capas, en su orden: recorte redondo con anillo interior, el
              lienzo, y el grano encima mezclado como overlay. */}
          <div className="kipu-carrusel__orbe" style={{ width: size, height: size }}>
            <div className="kipu-orbe-recorte">
              <canvas ref={porteRef} style={{ width: size, height: size }} />
              <div className="kipu-grano" style={orbGrainStyle(grano)} />
            </div>
            <p className="kipu-carrusel__cual">su clon, con nuestra pintura</p>
          </div>
          <div className="kipu-carrusel__orbe" style={{ width: size, height: size }}>
            <div className="kipu-orbe-recorte">
              <canvas ref={narradorRef} style={{ width: size, height: size }} />
              <div className="kipu-grano" style={orbGrainStyle(grano)} />
            </div>
            <p className="kipu-carrusel__cual">su clon, con su textura</p>
          </div>
        </div>
        <button
          type="button"
          className="kipu-carrusel__flecha"
          onClick={() => setIndice((i) => (i + 1) % MUESTRAS.length)}
          aria-label="siguiente"
        >
          ›
        </button>
      </div>

      <div className="kipu-carrusel__tex">
        <p className="kipu-carrusel__cual" style={{ position: "static" }}>
          el cuadro que se arrastra
        </p>
        <canvas ref={texRef} style={{ width: 168, height: 168 }} />
      </div>

      <div ref={hostRef} className="kipu-carrusel__pie">
        <p className="kipu-carrusel__nombre">
          {ORB_KINDS[indice % ORB_KINDS.length]} · {muestra.nombre}
          {muestra.url && !clipListo ? " · (trayendo el clip…)" : ""}
        </p>
        {muestra.texto && (
          <p className="kipu-carrusel__guion" data-sonando={sonando ? "1" : "0"}>
            “{muestra.texto}”
          </p>
        )}
        <dl className="kipu-carrusel__bandas">
          <div><dt>graves</dt><dd data-banda="low">{medidas.low.toFixed(3)}</dd></div>
          <div><dt>medios</dt><dd data-banda="mid">{medidas.mid.toFixed(3)}</dd></div>
          <div><dt>agudos</dt><dd data-banda="high">{medidas.high.toFixed(3)}</dd></div>
          <div><dt>total</dt><dd data-banda="all">{medidas.all.toFixed(3)}</dd></div>
        </dl>
        {falla && <p className="kipu-carrusel__falla">{falla}</p>}
      </div>
    </div>
  );
}
