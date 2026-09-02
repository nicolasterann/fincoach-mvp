import { createElevenFluid, type ElevenFluid } from "./orb-eleven-fluid";
import {
  advanceOrbAudioAverage,
  advanceOrbCumulativeAudio,
  ORB_AUDIO_ZERO,
  type OrbAudioBands,
} from "./voice-capture-contract";
import type { OrbRgb } from "./orb-shader";
import { paintOrbGradient } from "./orb-gradient-texture";

/**
 * N3C r33 · EL CLON, LÍNEA POR LÍNEA — y las seis cosas en que el porte no era
 * el suyo.
 *
 * Treinta y dos rondas ajustando un porte que se leía «cerca» y el founder
 * seguía viendo otra cosa. Se fue a la fuente con Chrome abierto: su orbe SÍ
 * está en la portada (el lienzo de 512 px del carrusel «ElevenCreative»), su
 * bundle `75548` trae el shader entero, y comparando ese código contra este
 * archivo aparecieron seis diferencias que ninguna métrica había visto:
 *
 *   1 · `EL_AUDIO_CLOCK = 0.02` NO EXISTE en el suyo. Se había inventado porque
 *       una medición decía que su orbe «no acelera al hablar». Pasando su clip
 *       real de voz por su propio analizador, la banda grave lee 0,77 de media
 *       (casi saturada) y su integrador mueve el reloj del fbm MÁS que el
 *       tiempo (13,9 contra 10,8 en 3,4 s): su orbe se acelera ~2,3× al hablar,
 *       exactamente lo que medía el porte sin parche (1,45 → 3,6). La medición
 *       vieja era casi seguro una pestaña oculta —rAF parado— contra ruido de
 *       captura. Sus coeficientes van tal cual.
 *   2 · El arco cuelga del PROMEDIO RÁPIDO, como en el suyo. La «corrección»
 *       al envolvente lento era gusto nuestro, no su orbe.
 *   3 · La ORIENTACIÓN: su vértice espeja la x y su `main` la vuelve a espejar,
 *       así que la textura se lee derecha y el ruido/anillo espejados. El porte
 *       tenía exactamente lo contrario.
 *   4 · EL FLUIDO no era el suyo: el porte leía un tinte de 0 a 1 de nuestra
 *       simulación (cinco agitadores siempre encendidos), y su shader lo lee
 *       con `× 0,001` y `× 0,01` porque SU tinte vive en cientos. Ahora va su
 *       simulación (`orb-eleven-fluid.ts`).
 *   5 · `ringColorOpacity` es 0,25 (estaba en 0,17 «para no quemar»). Lo que
 *       quemaba era nuestra pintura demasiado clara, no su arco.
 *   6 · El grano de al lado es NEGRO con alfa (sólo oscurece), no gris
 *       simétrico — ver `orb-grain-overlay.ts`. Y su textura viva es un WebP
 *       más oscuro que el PNG contra el que se calibró todo.
 *
 * El shader de abajo es su `main` en GLSL ES 1.0 (el suyo es 3.0): mismos
 * nombres, mismo orden, mismas constantes. Su `pulse` se calcula y no se usa en
 * el suyo; acá no se calcula.
 *
 * Provenance: the drawing is a port of the shader ElevenLabs serves on their
 * marketing site (chunk `75548`), reproduced for the `/dev/onda` comparison
 * bench. The fluid is Pavel Dobryakov's (MIT). Production keeps `orb-shader.ts`.
 */

const VERT = `
attribute vec2 aQuad;
varying vec2 vUv;
void main(){
  vUv = aQuad * 0.5 + 0.5;
  gl_Position = vec4(aQuad, 0.0, 1.0);
}`;

/** Sus constantes, leídas de su configuración (`this.config` de su reproductor). */
export const EL_CIRCLE_SIZE = 1.0;
export const EL_ALPHA = 1.0;
export const EL_TIME_SCALE = 1.4;
export const EL_SPHERE_SCALE = 0.9;
export const EL_SPHERE_POWER = 1.1;
export const EL_NOISE_SPEED = 0.25;
export const EL_NOISE_AMPLITUDE = 0.15;
export const EL_NOISE_SCALE = 0.65;
export const EL_RING_OPACITY = 0.25;
export const EL_FLUID_OPACITY = 0.1;
export const EL_FBM_SCALE = 3.25;
export const EL_FBM_POWER = 2.75;
export const EL_FBM_AMPLITUDE = 0.65;
export const EL_FBM_SPEED = 4.5;
export const EL_CONTRAST = 0.0;
/** Su grano de shader está APAGADO: el grano vive en el DOM, encima. */
export const EL_GRAIN_OPACITY = 0.0;
/** Sus opciones por defecto del componente. */
export const EL_EXPOSURE = 0.15;
export const EL_SATURATION = 1.0;
/** Su `dpr`: `Math.min(devicePixelRatio, 2)`. */
export const EL_MAX_DPR = 2;

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform vec4 uAudioAverage;
uniform vec4 uAudioAverageInput;
uniform vec4 uCumulativeAudio;
uniform sampler2D uGradient;
uniform sampler2D uFluid;
uniform vec2 uResolution;
uniform vec2 uTextureResolution;

// ============================================
// COVER UV (como background-size: cover). Con lienzo y textura cuadrados es
// la identidad; va igual porque el suyo la lleva.
// ============================================
vec2 getCoverUv(vec2 uv, vec2 containerRes, vec2 textureRes) {
  float containerAspect = containerRes.x / containerRes.y;
  float textureAspect = textureRes.x / textureRes.y;
  vec2 scale = vec2(1.0);
  if (containerAspect > textureAspect) {
    scale.y = textureAspect / containerAspect;
  } else {
    scale.x = containerAspect / textureAspect;
  }
  return (uv - 0.5) * scale + 0.5;
}

// ============================================
// SIMPLEX 3D (Ashima Arts / Stefan Gustavson, MIT) — el suyo, tal cual
// ============================================
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 permute(vec4 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// ============================================
// SU CORRECCIÓN DE COLOR — sin tonemap: terminan en un clamp
// ============================================
vec3 contrast(vec3 color, float value) {
  return clamp(0.5 + (1.0 + value) * (color - 0.5), vec3(0.0), vec3(1.0));
}
vec3 exposure(vec3 color, float value) {
  return (1.0 + value) * color;
}
vec3 czm_saturation(vec3 rgb, float adjustment) {
  const vec3 W = vec3(0.2125, 0.7154, 0.0721);
  vec3 intensity = vec3(dot(rgb, W));
  return mix(intensity, rgb, adjustment);
}

// ============================================
// SUS MEZCLAS
// ============================================
vec3 blendMultiply(vec3 base, vec3 blend) {
  return base*blend;
}
vec3 blendMultiply(vec3 base, vec3 blend, float opacity) {
  return (blendMultiply(base, blend) * opacity + base * (1.0 - opacity));
}
float blendOverlay(float base, float blend) {
  return base<0.5?(2.0*base*blend):(1.0-2.0*(1.0-base)*(1.0-blend));
}
vec3 blendOverlay(vec3 base, vec3 blend) {
  return vec3(blendOverlay(base.r,blend.r),blendOverlay(base.g,blend.g),blendOverlay(base.b,blend.b));
}
vec3 blendHardLight(vec3 base, vec3 blend) {
  return blendOverlay(blend,base);
}
vec3 blendHardLight(vec3 base, vec3 blend, float opacity) {
  return (blendHardLight(base, blend) * opacity + base * (1.0 - opacity));
}

// ============================================
// UTILIDADES
// ============================================
float random(in vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}
vec2 hash(vec2 p) {
  p = vec2(dot(p, vec2(2127.1, 81.17)), dot(p, vec2(1269.5, 283.37)));
  return fract(sin(p) * 43758.5453);
}
float filmGrainNoise(in vec2 uv) {
  return length(hash(vec2(uv.x, uv.y)));
}
float noise(in vec2 _st) {
  vec2 i = floor(_st);
  vec2 f = fract(_st);
  float a = random(i);
  float b = random(i + vec2(1.0, 0.0));
  float c = random(i + vec2(0.0, 1.0));
  float d = random(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) +
      (c - a) * u.y * (1.0 - u.x) +
      (d - b) * u.x * u.y;
}
#define NUM_OCTAVES 4
float fbm(in vec2 _st) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < NUM_OCTAVES; ++i) {
    v += a * noise(_st);
    _st = rot * _st * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

// ============================================
// MAIN — su main, en su orden
// ============================================
void main() {
  // N3C r33 · LA ORIENTACIÓN. Su vértice entrega vUv con la x espejada y su
  // main la vuelve a espejar para leer la textura: la textura se ve derecha; el
  // ruido, el círculo y el anillo miran la x espejada. Acá \`uv\` es su \`uv\` y
  // \`sUv\` es su \`vUv\`.
  vec2 uv = vUv;
  vec2 sUv = vec2(1.0 - vUv.x, vUv.y);
  float circleSize = ${EL_CIRCLE_SIZE.toFixed(2)} - pow(uAudioAverageInput.x * 0.75, 3.0) * 0.2;

  vec3 fluid = texture2D(uFluid, sUv).rgb;

  // Sphere UV
  float sphereScale = ${EL_SPHERE_SCALE.toFixed(2)};
  float spherePower = ${EL_SPHERE_POWER.toFixed(2)};
  vec2 uvDot = ((uv - 0.5) * 2.0);
  float d = sqrt(1.0 - clamp(dot(uvDot, uvDot), 0.0, 1.0));
  d = pow(d, spherePower);
  vec3 normals = vec3(uvDot, d);
  uv = uvDot / ((vec2(d, d) + vec2(1.0)) * (1.0 / ${EL_SPHERE_SCALE.toFixed(2)}));
  uv = (uv + 1.0) * 0.5;

  // FBM — el integrado de GRAVES corre este reloj, con SU 0,25 y sin parche
  float fbmTime1 = uTime * ${EL_FBM_SPEED.toFixed(2)};
  float fbmTime2 = uTime * (${EL_FBM_SPEED.toFixed(2)} * 0.5) + uCumulativeAudio.x * 0.25;
  vec2 fbmUv = uv * ${EL_FBM_SCALE.toFixed(2)};
  vec2 q = vec2(0.0);
  q.x = fbm(fbmUv + 0.00 * fbmTime1);
  q.y = fbm(fbmUv + vec2(1.0));
  vec2 r = vec2(0.0);
  r.x = fbm(fbmUv + 1.0 * q + vec2(91.3, 0.55) + 0.15 * fbmTime2);
  r.y = fbm(fbmUv + 1.0 * q - vec2(45.33, 1.2) + 0.126 * fbmTime2);
  float f = fbm(fbmUv + r);
  float ffbm = mix(0.8, 0.66, clamp((f * f) * ${EL_FBM_POWER.toFixed(2)}, 0.0, 1.0));
  ffbm = mix(ffbm, 0.0, clamp(length(q), 0.0, 1.0));
  ffbm = mix(ffbm, 1.0, clamp(length(r.x), 0.0, 1.0));

  // Simplex Noise — el integrado de AGUDOS corre este reloj
  float noiseTime1 = uTime * ${EL_NOISE_SPEED.toFixed(2)} * 0.5 + uCumulativeAudio.z * 0.1;
  float noiseX = snoise(vec3(sUv * ${EL_NOISE_SCALE.toFixed(2)}, noiseTime1));
  float noiseTime2 = uTime * ${EL_NOISE_SPEED.toFixed(2)};
  float noiseY = snoise(vec3(sUv * ${EL_NOISE_SCALE.toFixed(2)} + vec2(54.0, 54.0), noiseTime2));
  vec2 noiseDisp = vec2(noiseX, noiseY);
  noiseDisp *= 1.0 + uAudioAverage.z * 0.25;

  // Circle shape and alpha mask
  vec2 circleUv = sUv - 0.5;
  float dist = sqrt(dot(circleUv, circleUv));
  float circleAA = max(fwidth(dist * 2.0), 1e-4);
  float s = 1.0 - smoothstep(1.0, 1.0 + circleAA, dist * 2.0);

  // Uv shift — el fluido (en cientos) × 0,001, el arrastre por la normal, el ruido
  uv += -fluid.rg * 0.001;
  uv += normals.xy * (ffbm - 0.5) * ${EL_FBM_AMPLITUDE.toFixed(2)};
  uv += noiseDisp * ${EL_NOISE_AMPLITUDE.toFixed(2)};

  // Gradient sampling with cover strategy
  vec2 tuv = getCoverUv(uv, uResolution, uTextureResolution);
  vec3 color = texture2D(uGradient, tuv).rgb;

  // Ring — todo sobre el PROMEDIO RÁPIDO, como el suyo
  float innerRadius = 0.25;
  float noiseScale = 0.65 + uAudioAverage.x * 0.4;
  vec2 ringUv = (sUv - 0.5) * 2.0 * (1.0 / circleSize);
  ringUv *= 0.75;
  float ang = atan(ringUv.y, ringUv.x);
  float len = length(ringUv);
  float ringTime = (-uTime * 0.5) - uCumulativeAudio.a * 0.2;
  ringUv.x += 1.0 + uAudioAverage.y * 1.5 - uAudioAverageInput.y * 2.5;
  float n0 = snoise(vec3(ringUv * noiseScale, ringTime * 0.5)) * 0.5 + 0.5;
  float cl = cos(ang + ringTime * 2.0) * 0.5 + 0.5;
  float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
  float v3 = pow(smoothstep(innerRadius, mix(innerRadius, 1.0, n0 * 0.75), len), 2.0);
  cl = cl * v2 * v3;
  cl = clamp(pow(cl * min(uAudioAverage.a * 4.0 + uAudioAverageInput.x * 4.0, 1.0), 3.0), 0.0, 1.0);

  // Compositing — el fluido entra como LUZ DURA, con su tinte en cientos
  color = color + (vec3(cl) * ${EL_RING_OPACITY.toFixed(2)});
  color = blendHardLight(color, vec3(1.0), length(fluid) * 0.01 * ${EL_FLUID_OPACITY.toFixed(2)});

  // Color correction — su grano de shader está apagado (opacidad 0)
  color = blendMultiply(color, vec3(filmGrainNoise(sUv)), ${EL_GRAIN_OPACITY.toFixed(2)});
  color = czm_saturation(color, ${EL_SATURATION.toFixed(2)});
  color = contrast(color, ${EL_CONTRAST.toFixed(2)});
  color = exposure(color, ${EL_EXPOSURE.toFixed(2)});

  float alpha = s * ${EL_ALPHA.toFixed(2)};
  color = clamp(color, 0.0, 1.0);
  gl_FragColor = vec4(color * alpha, alpha);
}`;

export interface ElevenOrbFrame {
  timeSeconds: number;
  dtSeconds: number;
  /** Las cuatro bandas CRUDAS del analizador en este cuadro, 0–1. */
  bands: OrbAudioBands;
  /** Qué capa es: decide su cuadro pintado. */
  seed: number;
  /** Cinco tonos explícitos, de oscuro a claro. Para replicar una paleta ajena. */
  tonos?: readonly OrbRgb[];
  deep: OrbRgb;
  liquid: OrbRgb;
  accent: OrbRgb;
}

export interface ElevenOrbRenderer {
  resize(css: number, dpr: number): { width: number; height: number };
  /** Reemplaza el degradado pintado por una imagen (su WebP, o una ajena). */
  useImage(img: HTMLImageElement | HTMLCanvasElement | ImageBitmap): void;
  draw(frame: ElevenOrbFrame): void;
  hasFluid(): boolean;
  /** Los acumuladores del orbe, para el banco. */
  readonly audio: { average: OrbAudioBands; cumulative: OrbAudioBands };
  dispose(): void;
}

function compile(gl: WebGLRenderingContext, tipo: number, src: string) {
  const sh = gl.createShader(tipo);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function createElevenOrbRenderer(
  canvas: HTMLCanvasElement,
): ElevenOrbRenderer | null {
  // Su renderer: alpha, premultiplicado, sin antialias (el círculo se
  // suaviza en el shader). `preserveDrawingBuffer` sólo para poder medir.
  const gl =
    (canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    }) as WebGLRenderingContext | null) ?? null;
  if (!gl) return null;
  gl.getExtension("OES_standard_derivatives");
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(
    gl,
    gl.FRAGMENT_SHADER,
    `#extension GL_OES_standard_derivatives : enable\n${FRAG}`,
  );
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "aQuad");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;

  const buf = gl.createBuffer();
  if (!buf) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const fluid: ElevenFluid | null = createElevenFluid(gl);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const locs = {
    time: u("uTime"),
    avg: u("uAudioAverage"),
    input: u("uAudioAverageInput"),
    cum: u("uCumulativeAudio"),
    gradient: u("uGradient"),
    fluid: u("uFluid"),
    resolution: u("uResolution"),
    textureResolution: u("uTextureResolution"),
  };

  // ── LA TEXTURA ──
  // Su cargador: `flipY`, mipmaps generados, LINEAR_MIPMAP_LINEAR / LINEAR,
  // borde repetido. Los mipmaps no son un detalle de rendimiento: sin ellos
  // el escorzo esférico muestrea granos distintos en cada cuadro y la textura
  // hormiguea.
  const gradTex = gl.createTexture();
  let gradSeed = -1;
  let texRes: [number, number] = [1, 1];
  const conMipmaps = () => {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  const subir = (img: HTMLImageElement | HTMLCanvasElement | ImageBitmap, w: number, h: number) => {
    if (!gradTex) return;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, gradTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    conMipmaps();
    texRes = [w, h];
  };
  const subirGradiente = (frame: ElevenOrbFrame) => {
    if (!gradTex || gradSeed === -2 || frame.seed === gradSeed) return;
    const cv = paintOrbGradient({
      deep: frame.deep,
      liquid: frame.liquid,
      accent: frame.accent,
      seed: frame.seed,
      tonos: frame.tonos,
    });
    if (!cv) return;
    gradSeed = frame.seed;
    subir(cv, cv.width, cv.height);
  };

  const audio = {
    average: ORB_AUDIO_ZERO as OrbAudioBands,
    cumulative: ORB_AUDIO_ZERO as OrbAudioBands,
  };
  let disposed = false;

  return {
    audio,
    resize(css, dpr) {
      const d = Math.min(Math.max(dpr || 1, 1), EL_MAX_DPR);
      const px = Math.max(1, Math.round(css * d));
      if (canvas.width !== px) canvas.width = px;
      if (canvas.height !== px) canvas.height = px;
      return { width: px, height: px };
    },
    useImage(img) {
      gradSeed = -2;
      const w = "naturalWidth" in img ? img.naturalWidth : img.width;
      const h = "naturalHeight" in img ? img.naturalHeight : img.height;
      subir(img, w, h);
    },
    draw(frame) {
      if (disposed || gl.isContextLost()) return;
      const dt = Math.max(0, Number.isFinite(frame.dtSeconds) ? frame.dtSeconds : 1 / 60);
      // ── SU setAudioData: el promedio (0,55) escala amplitudes; el integrado
      // (0,25 × 60·dt·1,4) corre relojes. El micrófono de entrada no existe acá.
      audio.average = advanceOrbAudioAverage(audio.average, frame.bands);
      audio.cumulative = advanceOrbCumulativeAudio(audio.cumulative, frame.bands, dt);
      if (fluid) {
        fluid.setAudioData(frame.bands, dt * 1000);
        fluid.advance(dt);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(locs.time, frame.timeSeconds * EL_TIME_SCALE);
      const a = audio.average;
      const c = audio.cumulative;
      gl.uniform4f(locs.avg, a.low, a.mid, a.high, a.all);
      gl.uniform4f(locs.input, 0, 0, 0, 0);
      gl.uniform4f(locs.cum, c.low, c.mid, c.high, c.all);
      gl.uniform2f(locs.resolution, canvas.width, canvas.height);
      subirGradiente(frame);
      gl.uniform2f(locs.textureResolution, texRes[0], texRes[1]);
      if (gradTex) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, gradTex);
        gl.uniform1i(locs.gradient, 2);
      }
      if (fluid) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, fluid.texture);
        gl.uniform1i(locs.fluid, 1);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    hasFluid() {
      return fluid !== null;
    },
    dispose() {
      disposed = true;
      fluid?.dispose();
      gl.deleteProgram(prog);
      if (gradTex) gl.deleteTexture(gradTex);
      gl.deleteBuffer(buf);
    },
  };
}
