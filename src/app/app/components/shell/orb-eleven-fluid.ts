import type { OrbAudioBands } from "./voice-capture-contract";

/**
 * N3C r33 · SU FLUIDO, TAL CUAL — con SUS magnitudes.
 *
 * El porte de la r29 leía «el fluido» de nuestra simulación de producción
 * (`orb-fluid.ts`): cinco agitadores de fondo siempre encendidos, un tinte de
 * luz inventado de 0 a 1, curl 30, mapa material de 24 px. Nada de eso existe
 * en el suyo. Su fluido es la simulación de Pavel Dobryakov casi sin tocar,
 * con estas decisiones encima, leídas de su bundle (`75548`):
 *
 *   · velocidad y presión a 128, tinte a 512, curl CERO (la vorticidad es un
 *     paso muerto y acá no se ejecuta);
 *   · UNA salpicadura por cuadro, sólo cuando el promedio total SUBE, y no es
 *     una mancha: es un tren de anillos concéntricos que viaja hacia afuera;
 *   · el audio del fluido lleva SU propia escala: las bandas van ×2
 *     (`OverallSoundScale`), el promedio se mezcla a 0,35 y el integrado NO
 *     lleva el 1,4 del orbe;
 *   · la amplitud del anillo es `graves × 30` — con graves ≈ 1,5 tras la escala,
 *     cada salpicadura inyecta hasta ~45 en el tinte. El tinte vive en CIENTOS,
 *     no entre 0 y 1: por eso su shader lo lee con `× 0,001` y `× 0,01`. El
 *     porte alimentaba esas mismas fórmulas con un tinte de 0 a 1, o sea que su
 *     fluido no se veía nunca;
 *   · el tinte se desenfoca ENTERO en cada cuadro (dos pasadas de blur9 con
 *     desplazamientos en unidades de la malla de 128, sobre la textura de 512):
 *     los anillos nacen nítidos y se funden en luz difusa en menos de un segundo;
 *   · la advección usa un `dt` FIJO de 0,016 por actualización y se actualiza
 *     como mucho una vez por 1/60 s.
 *
 * Atribución: la simulación base es WebGL-Fluid-Simulation de Pavel Dobryakov
 * (MIT, © 2017). La salpicadura de anillos y las constantes son las de la
 * página de ElevenLabs, leídas de su código publicado; se reproducen aquí sólo
 * para el banco de comparación de `/dev/onda`.
 */

type Gl = WebGLRenderingContext | WebGL2RenderingContext;

export const EL_FLUID_SIM_RES = 128;
export const EL_FLUID_DYE_RES = 512;
export const EL_FLUID_OVERALL_SOUND_SCALE = 2;
export const EL_FLUID_INPUT_SCALE = 12;
export const EL_FLUID_DENSITY_DISSIPATION = 0.98;
export const EL_FLUID_VELOCITY_DISSIPATION = 0.98;
export const EL_FLUID_PRESSURE_DISSIPATION = 0.97;
export const EL_FLUID_RADIUS = 1.5;
export const EL_FLUID_BLUR = 1.2;
export const EL_FLUID_ITERATIONS = 3;
export const EL_FLUID_DT = 0.016;
export const EL_FLUID_AVERAGE_MIX = 0.35;
export const EL_FLUID_CUMULATIVE_MIX = 0.25;
export const EL_FLUID_RISING_THRESHOLD = 1e-4;
export const EL_FLUID_INTERVAL = 1 / 60;
/** `graves × 30`: la amplitud de cada anillo. */
export const EL_FLUID_RING_GAIN = 30;

const VERT = `
precision highp float;
attribute vec2 aPos;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform vec2 texelSize;
void main () {
  vUv = aPos * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const CLEAR = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
uniform sampler2D uTexture;
uniform float value;
void main () {
  gl_FragColor = value * texture2D(uTexture, vUv);
}`;

// El tren de anillos. `point` y `aspectRatio` existen en el suyo y no se usan.
const SPLAT = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform vec3 color;
uniform float radius;
uniform float time;
uniform vec4 cumulativeAudio;
uniform vec4 audioAverage;
const float width = .15;
void main () {
  vec2 p = vUv - vec2(.5);
  p *= radius;
  float dist = sqrt(dot(p, p));
  float pTime = time * .25 + cumulativeAudio.a * .15;
  float pDist = mod(dist * 2. - pTime, 1.);
  float pulse = smoothstep(0., width, pDist) - smoothstep(width, width * 2., pDist);
  vec3 splat = pulse * (audioAverage.x * ${EL_FLUID_RING_GAIN.toFixed(1)}) * clamp(dist * 1., 0., 1.) * color;
  vec3 base = texture2D(uTarget, vUv).xyz;
  gl_FragColor = vec4(base + splat, 1.0);
}`;

// Su advección con filtrado lineal del hardware (la rama que usan cuando la
// extensión de filtrado flotante existe). La rama con bilerp manual es la
// misma cuenta hecha a mano.
const ADVECT = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;
void main () {
  vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
  gl_FragColor = dissipation * texture2D(uSource, coord);
  gl_FragColor.a = 1.0;
}`;

const DIVERGENCE = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }
  float div = 0.5 * (R - L + T - B);
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}`;

const PRESSURE = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  float divergence = texture2D(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;
  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}`;

const GRADIENT = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity.xy -= vec2(R - L, T - B);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}`;

const BLUR = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
uniform sampler2D uTexture;
uniform vec2 simRes;
uniform vec2 direction;
vec4 blur9(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
  vec4 color = vec4(0.0);
  vec2 off1 = vec2(1.3846153846) * direction;
  vec2 off2 = vec2(3.2307692308) * direction;
  color += texture2D(image, uv) * 0.2270270270;
  color += texture2D(image, uv + (off1 / resolution)) * 0.3162162162;
  color += texture2D(image, uv - (off1 / resolution)) * 0.3162162162;
  color += texture2D(image, uv + (off2 / resolution)) * 0.0702702703;
  color += texture2D(image, uv - (off2 / resolution)) * 0.0702702703;
  return color;
}
void main () {
  gl_FragColor = blur9(uTexture, vUv, simRes, direction);
}`;

interface Fbo {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  size: number;
}
interface DoubleFbo {
  read: Fbo;
  write: Fbo;
  swap(): void;
}

export interface ElevenFluid {
  /** El tinte (512×512, en cientos): lo que el shader del orbe lee. */
  readonly texture: WebGLTexture;
  /** Su `setAudioData`: bandas crudas 0–1 y el paso en milisegundos. */
  setAudioData(bands: OrbAudioBands, dtMs: number): void;
  /** Su acumulador: actualiza como mucho una vez por 1/60 s. */
  advance(dtSeconds: number): void;
  /** Una actualización completa, con el paso en milisegundos. */
  update(dtMs: number): void;
  readonly audioAverage: Float32Array;
  readonly cumulativeAudio: Float32Array;
  dispose(): void;
}

function compile(gl: Gl, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(gl: Gl, vert: WebGLShader, fragSrc: string): WebGLProgram | null {
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!frag) return null;
  const p = gl.createProgram();
  if (!p) {
    gl.deleteShader(frag);
    return null;
  }
  gl.attachShader(p, vert);
  gl.attachShader(p, frag);
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

/**
 * Devuelve `null` si el contexto no puede dibujar en texturas flotantes: el
 * orbe sigue sin fluido, peor y verdadero. Nunca se finge un fluido que no
 * corrió.
 */
export function createElevenFluid(gl: Gl): ElevenFluid | null {
  const isGl2 =
    typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
  let internal: number;
  let type: number;
  let linear = true;
  if (isGl2) {
    const gl2 = gl as WebGL2RenderingContext;
    if (!gl2.getExtension("EXT_color_buffer_float") && !gl2.getExtension("EXT_color_buffer_half_float")) {
      return null;
    }
    internal = gl2.RGBA16F;
    type = gl2.HALF_FLOAT;
  } else {
    const half = gl.getExtension("OES_texture_half_float");
    if (!half || !gl.getExtension("EXT_color_buffer_half_float")) return null;
    internal = gl.RGBA;
    type = (half as { HALF_FLOAT_OES: number }).HALF_FLOAT_OES;
    linear = Boolean(gl.getExtension("OES_texture_half_float_linear"));
  }

  const makeFbo = (size: number, filtro: number): Fbo | null => {
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) return null;
    gl.activeTexture(gl.TEXTURE0 + 3);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtro);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtro);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, size, size, 0, gl.RGBA, type, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
    gl.viewport(0, 0, size, size);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fbo, size };
  };
  const double = (size: number, filtro: number): DoubleFbo | null => {
    const a = makeFbo(size, filtro);
    const b = makeFbo(size, filtro);
    if (!a || !b) return null;
    const d: DoubleFbo = {
      read: a,
      write: b,
      swap() {
        const t = d.read;
        d.read = d.write;
        d.write = t;
      },
    };
    return d;
  };

  const vert = compile(gl, gl.VERTEX_SHADER, VERT);
  if (!vert) return null;
  const progs = {
    clear: link(gl, vert, CLEAR),
    splat: link(gl, vert, SPLAT),
    advect: link(gl, vert, ADVECT),
    divergence: link(gl, vert, DIVERGENCE),
    pressure: link(gl, vert, PRESSURE),
    gradient: link(gl, vert, GRADIENT),
    blur: link(gl, vert, BLUR),
  };
  gl.deleteShader(vert);
  const todos = Object.values(progs);
  if (todos.some((p) => !p)) {
    for (const p of todos) if (p) gl.deleteProgram(p);
    return null;
  }

  const suave = linear ? gl.LINEAR : gl.NEAREST;
  const density = double(EL_FLUID_DYE_RES, suave);
  const velocity = double(EL_FLUID_SIM_RES, suave);
  const pressure = double(EL_FLUID_SIM_RES, gl.NEAREST);
  const divergence = makeFbo(EL_FLUID_SIM_RES, gl.NEAREST);
  if (!density || !velocity || !pressure || !divergence) {
    for (const p of todos) if (p) gl.deleteProgram(p);
    return null;
  }
  const quad = gl.createBuffer();
  if (!quad) return null;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const u = (p: WebGLProgram | null, name: string) => (p ? gl.getUniformLocation(p, name) : null);
  const texel = 1 / EL_FLUID_SIM_RES;
  const audioAverage = new Float32Array(4);
  const lastAverage = new Float32Array(4);
  const averageDelta = new Float32Array(4);
  const cumulativeAudio = new Float32Array(4);
  let time = 0;
  let acumulador = 0;
  let disposed = false;
  const splats: { dx: number; dy: number }[] = [];

  const bindQuad = () => {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  };
  const usar = (p: WebGLProgram | null) => {
    gl.useProgram(p);
    gl.uniform2f(u(p, "texelSize"), texel, texel);
  };
  const bindTex = (p: WebGLProgram | null, name: string, unit: number, tex: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u(p, name), unit);
  };
  const blit = (target: Fbo) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.size, target.size);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const salpicar = (sp: { dx: number; dy: number }) => {
    const p = progs.splat;
    usar(p);
    gl.uniform3f(u(p, "color"), sp.dx, sp.dy, 1);
    gl.uniform1f(u(p, "radius"), EL_FLUID_RADIUS);
    gl.uniform1f(u(p, "time"), time);
    gl.uniform4fv(u(p, "cumulativeAudio"), cumulativeAudio);
    gl.uniform4fv(u(p, "audioAverage"), audioAverage);
    bindTex(p, "uTarget", 0, velocity.read.tex);
    blit(velocity.write);
    velocity.swap();
    bindTex(p, "uTarget", 0, density.read.tex);
    blit(density.write);
    density.swap();
  };

  const update = (dtMs: number) => {
    if (disposed || gl.isContextLost()) return;
    time += dtMs / 1000;
    const t = -(0.2 * Math.sin(0.5 * cumulativeAudio[1]!)) + 0.5;
    const i = 0.15 * Math.cos(0.38 * cumulativeAudio[0]!) + 0.5;
    if (averageDelta[3]! > EL_FLUID_RISING_THRESHOLD) {
      splats.push({ dx: (t - 0.5) * EL_FLUID_INPUT_SCALE, dy: (i - 0.5) * EL_FLUID_INPUT_SCALE });
    }
    gl.disable(gl.BLEND);
    bindQuad();
    for (let k = splats.length - 1; k >= 0; k -= 1) salpicar(splats.splice(k, 1)[0]!);

    usar(progs.divergence);
    bindTex(progs.divergence, "uVelocity", 0, velocity.read.tex);
    blit(divergence);

    usar(progs.clear);
    gl.uniform1f(u(progs.clear, "value"), EL_FLUID_PRESSURE_DISSIPATION);
    bindTex(progs.clear, "uTexture", 0, pressure.read.tex);
    blit(pressure.write);
    pressure.swap();

    usar(progs.pressure);
    bindTex(progs.pressure, "uDivergence", 1, divergence.tex);
    for (let k = 0; k < EL_FLUID_ITERATIONS; k += 1) {
      bindTex(progs.pressure, "uPressure", 0, pressure.read.tex);
      blit(pressure.write);
      pressure.swap();
    }

    usar(progs.gradient);
    bindTex(progs.gradient, "uPressure", 0, pressure.read.tex);
    bindTex(progs.gradient, "uVelocity", 1, velocity.read.tex);
    blit(velocity.write);
    velocity.swap();

    usar(progs.advect);
    gl.uniform1f(u(progs.advect, "dt"), EL_FLUID_DT);
    gl.uniform1f(u(progs.advect, "dissipation"), EL_FLUID_VELOCITY_DISSIPATION);
    bindTex(progs.advect, "uVelocity", 0, velocity.read.tex);
    bindTex(progs.advect, "uSource", 1, velocity.read.tex);
    blit(velocity.write);
    velocity.swap();
    gl.uniform1f(u(progs.advect, "dissipation"), EL_FLUID_DENSITY_DISSIPATION);
    bindTex(progs.advect, "uVelocity", 0, velocity.read.tex);
    bindTex(progs.advect, "uSource", 1, density.read.tex);
    blit(density.write);
    density.swap();

    usar(progs.blur);
    gl.uniform2f(u(progs.blur, "simRes"), EL_FLUID_SIM_RES, EL_FLUID_SIM_RES);
    for (const dir of [[EL_FLUID_BLUR, 0], [0, EL_FLUID_BLUR]] as const) {
      gl.uniform2f(u(progs.blur, "direction"), dir[0], dir[1]);
      bindTex(progs.blur, "uTexture", 0, density.read.tex);
      blit(density.write);
      density.swap();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  return {
    get texture() {
      return density.read.tex;
    },
    audioAverage,
    cumulativeAudio,
    setAudioData(bands, dtMs) {
      const v = [bands.low, bands.mid, bands.high, bands.all].map(
        (x) => (Number.isFinite(x) ? x : 0) * EL_FLUID_OVERALL_SOUND_SCALE,
      );
      const paso = (dtMs / 1000) * 60;
      for (let k = 0; k < 4; k += 1) {
        cumulativeAudio[k] = cumulativeAudio[k]! + EL_FLUID_CUMULATIVE_MIX * v[k]! * paso;
        audioAverage[k] = audioAverage[k]! + (v[k]! - audioAverage[k]!) * EL_FLUID_AVERAGE_MIX;
        averageDelta[k] = audioAverage[k]! - lastAverage[k]!;
        lastAverage[k] = audioAverage[k]!;
      }
    },
    advance(dtSeconds) {
      acumulador += Math.max(0, Number.isFinite(dtSeconds) ? dtSeconds : 0);
      if (acumulador >= EL_FLUID_INTERVAL) {
        update(acumulador * 1000);
        acumulador = 0;
      }
    },
    update,
    dispose() {
      disposed = true;
      for (const p of todos) if (p) gl.deleteProgram(p);
      for (const d of [density, velocity, pressure]) {
        for (const f of [d.read, d.write]) {
          gl.deleteTexture(f.tex);
          gl.deleteFramebuffer(f.fbo);
        }
      }
      gl.deleteTexture(divergence.tex);
      gl.deleteFramebuffer(divergence.fbo);
      gl.deleteBuffer(quad);
    },
  };
}
