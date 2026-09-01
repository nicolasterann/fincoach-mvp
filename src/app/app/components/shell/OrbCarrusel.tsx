"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createOrbRenderer, ORB_SPAN, type OrbRenderer, type OrbRgb } from "./orb-shader";
import {
  createElevenOrbRenderer,
  type ElevenOrbRenderer,
} from "./orb-eleven-shader";
import {
  ORB_KINDS,
  orbMatter,
  orbPresentationMaterial,
  orbWaterline,
  type OrbKind,
} from "./shell-orb-contract";
import { advanceOrbField, orbFieldDrive, orbFieldSpeed } from "./orb-water-sim";
import {
  createOrbSampleAnalyser,
  orbVoiceSamplePcm,
  ORB_SAMPLE_RATE,
  ORB_SAMPLE_SECONDS,
  ORB_VOICE_SAMPLES,
} from "./orb-audio-sample";
import {
  advanceVoiceTau,
  VOICE_SHAPE_TAU_MS,
  advanceOrbAudioAverage,
  advanceOrbCumulativeAudio,
  orbAudioBands,
  ORB_AUDIO_ZERO,
  VOICE_ANALYSER_FFT_SIZE,
  VOICE_ANALYSER_SMOOTHING,
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
 * La muestra se sintetiza acá —formantes, sílabas y pausas— para no depender de
 * un archivo de nadie y para que sea siempre la misma en las dos pantallas.
 */

const MUESTRAS = ORB_VOICE_SAMPLES;

export function OrbCarrusel({ size = 260 }: { size?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const porteRef = useRef<HTMLCanvasElement>(null);
  const [indice, setIndice] = useState(0);
  const [sonando, setSonando] = useState(false);
  const [medidas, setMedidas] = useState<OrbAudioBands>(ORB_AUDIO_ZERO);
  const [falla, setFalla] = useState<string | null>(null);

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

  useEffect(() => {
    indiceRef.current = indice;
  }, [indice]);

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
    pcmRef.current = orbVoiceSamplePcm(MUESTRAS[indiceRef.current]!);
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
  }, [parar]);

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
    let vivo = true;
    let raf = 0;
    let ultimoMs = -1;
    let forzado: number | null = null;
    let reloj = 0;
    let promedio: OrbAudioBands = ORB_AUDIO_ZERO;
    let acumulado: OrbAudioBands = ORB_AUDIO_ZERO;
    let ultimoTotal = 0;
    // N3C r28 · el envolvente LENTO, que es el que puede mover amplitudes. El
    // promedio de bandas es el RÁPIDO (mezcla 0,55 ≈ 30 ms): colgarle el dipolo,
    // el halo y la deformación lo hace pulsar una vez por sílaba — el mismo
    // defecto que la r27 mató, reaparecido acá por pasar la señal equivocada.
    let lento = 0;
    // las cuatro bandas con el envolvente lento: lo que puede mover amplitudes
    let lentas: OrbAudioBands = ORB_AUDIO_ZERO;
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
        if (posRef.current >= ORB_SAMPLE_RATE * ORB_SAMPLE_SECONDS) posRef.current = 0;
        crudo = analizadorRef.current.leer(pcmRef.current, Math.floor(posRef.current));
      }
      bandasRef.current = crudo;
      const antesTotal = promedio.all;
      promedio = advanceOrbAudioAverage(promedio, crudo);
      acumulado = advanceOrbCumulativeAudio(acumulado, crudo, dt);
      const subiendo = promedio.all - antesTotal;
      ultimoTotal = promedio.all;

      lento = advanceVoiceTau(lento, promedio.all, dt, VOICE_SHAPE_TAU_MS);
      lentas = {
        low: advanceVoiceTau(lentas.low, promedio.low, dt, VOICE_SHAPE_TAU_MS),
        mid: advanceVoiceTau(lentas.mid, promedio.mid, dt, VOICE_SHAPE_TAU_MS),
        high: advanceVoiceTau(lentas.high, promedio.high, dt, VOICE_SHAPE_TAU_MS),
        all: advanceVoiceTau(lentas.all, promedio.all, dt, VOICE_SHAPE_TAU_MS),
      };
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

      // ── N3C r29 · EL PORTE FIEL, AL LADO ────────────────────────────────
      // Mismo audio, mismo cuadro, mismos colores. Es la única forma honesta de
      // preguntar «¿se parece?»: las dos cosas haciendo LO MISMO al mismo tiempo.
      if (porte) {
        porte.resize(size, window.devicePixelRatio || 1);
        porte.draw({
          timeSeconds: relojPorte,
          dtSeconds: dt,
          average: promedio,
          cumulative: acumulado,
          slow: lentas,
          risingAll: subiendo,
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
      delete (window as unknown as { __kipuOnda?: unknown }).__kipuOnda;
      void ultimoTotal;
    };
  }, [size]);

  const muestra = MUESTRAS[indice]!;

  return (
    <div className="kipu-carrusel" data-sonando={sonando ? "1" : "0"}>
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
          <div className="kipu-carrusel__orbe" style={{ width: size, height: size }}>
            <canvas ref={porteRef} style={{ width: size, height: size }} />
            <p className="kipu-carrusel__cual">el porte de su orbe</p>
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

      <div ref={hostRef} className="kipu-carrusel__pie">
        <p className="kipu-carrusel__nombre">
          {ORB_KINDS[indice % ORB_KINDS.length]} · {muestra.nombre}
        </p>
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
