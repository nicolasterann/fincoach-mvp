export type OrbRgb = readonly [number, number, number];

export interface OrbUniforms {
  time: number;
  level: number;
  energy: number;
  day: number;
  material: number;
  voice: number;
  liquid: OrbRgb;
  deep: OrbRgb;
  accent: OrbRgb;
  tier: 1 | 2 | 3;
}

export interface OrbBufferInfo {
  dpr: number;
  width: number;
  height: number;
}

export interface OrbRenderer {
  resize(cssWidth: number, cssHeight: number, dpr: number): OrbBufferInfo;
  draw(uniforms: OrbUniforms): void;
  dispose(): void;
}

const VERTEX_SOURCE = `
attribute vec2 aPos;
void main(){
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// The tier-3 path is the measured prototype shader. Tiers 2 and 1 are
// deliberate branches of the same material model, so changing quality never
// changes the financial level sent by the server.
const FRAGMENT_SOURCE = `
precision highp float;
uniform vec2 uRes;
uniform float uTime, uLevel, uEnergy, uDay, uMat, uVoice;
uniform vec3 uLiq, uDeep, uAcc;
const float KIPU_TIER = __KIPU_TIER__;

float hash21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1.0,0.0)), u.x),
             mix(hash21(i+vec2(0.0,1.0)), hash21(i+vec2(1.0,1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i=0;i<4;i++){
    v += a*vnoise(p);
    p = p*2.03 + vec2(1.7,9.2);
    a *= 0.5;
  }
  return v;
}
vec2 vcell(vec2 x){
  vec2 n = floor(x), f = fract(x);
  float md = 8.0;
  vec2 mr = vec2(0.0);
  for(int j=-1;j<=1;j++){
    for(int i=-1;i<=1;i++){
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(hash21(n+g), hash21(n+g+vec2(31.7,11.3)));
      vec2 r = g + o - f;
      float dd2 = dot(r,r);
      if(dd2 < md){ md = dd2; mr = n+g; }
    }
  }
  return vec2(sqrt(md), hash21(mr));
}
vec3 rotY(vec3 v, float a){
  float c = cos(a), sn = sin(a);
  return vec3(c*v.x + sn*v.z, v.y, -sn*v.x + c*v.z);
}
void matParams(out float amp, out float spd){
  amp = 0.040; spd = 1.0;
  if(uMat > 0.5 && uMat < 1.5){ amp = 0.017; spd = 0.42; }
  else if(uMat > 1.5 && uMat < 2.5){ amp = 0.029; spd = 0.68; }
  else if(uMat > 2.5 && uMat < 3.5){ amp = 0.007; spd = 0.18; }
  else if(uMat > 3.5){ amp = 0.021; spd = 0.33; }
}
float surfH(vec3 p, float amp, float spd){
  if(uMat > 2.5 && uMat < 3.5) return -9.0;
  float base = uLevel*2.06 - 1.03;
  float A = amp * (1.0 + uEnergy*2.6);
  float w = sin(p.x*4.4 + uTime*0.85*spd)*A
          + sin(p.z*3.2 - uTime*0.66*spd)*A*0.75
          + (fbm(p.xz*2.6 + vec2(uTime*0.15*spd, 0.0)) - 0.5)*A*2.4;
  return base + w;
}
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / (0.5*min(uRes.x,uRes.y)) * 1.52;
  float r = length(uv);
  float rr = r*r;

  // The aura varies by direction, never atan: no seam through the halo.
  vec3 soul = vec3(0.0);
  float soulA = 0.0;
  {
    vec2 dir = uv / max(r, 0.0001);
    float n1 = fbm(dir*1.5 + vec2(uTime*0.040, uTime*0.028));
    float n2 = fbm(dir*2.9 - vec2(uTime*0.029, uTime*0.019));
    float breath = 0.5 + 0.5*sin(uTime*0.31);
    float energy = 0.15 + 0.055*breath + uVoice*0.26;
    float reach = 1.0 + energy*(0.95 + (n1-0.5)*1.05 + (n2-0.5)*0.55);
    float nearGlow = 1.0 - smoothstep(1.0, reach, r);
    float farGlow = 1.0 - smoothstep(1.0, 1.0 + (reach - 1.0)*3.1, r);
    float halo = pow(nearGlow, 1.7)*0.45 + pow(farGlow, 1.25)*0.55;
    halo *= smoothstep(0.965, 1.015, r);
    vec3 sc = mix(uAcc, uLiq, 0.45);
    soul = sc * halo * (0.26 + 0.34*uVoice);
    soulA = clamp(halo*(0.15 + 0.24*uVoice), 0.0, 1.0);
  }
  if(rr > 1.0){ gl_FragColor = vec4(soul, soulA); return; }

  float amp, spd;
  matParams(amp, spd);

  // Tier 1: no raymarch. It keeps the same level and material semantics with
  // a cheap vertical body, a soft wave and a fixed patrimonio crystal.
  if(KIPU_TIER < 1.5){
    float edge1 = 1.0 - smoothstep(0.90, 1.0, rr);
    float fres1 = pow(smoothstep(0.62, 1.0, r), 2.4);
    if(uMat > 2.5 && uMat < 3.5){
      float angle = atan(uv.y, uv.x);
      float facets = 0.62 + 0.38*cos(angle*8.0 + uTime*0.08);
      float crystal = 1.0 - smoothstep(0.30, 0.36, r);
      vec3 core1 = mix(uDeep, uLiq, facets) * crystal;
      gl_FragColor = vec4((core1 + uAcc*fres1*0.42)*edge1 + soul,
                         clamp(crystal + fres1*0.34 + soulA, 0.0, 1.0));
      return;
    }
    float wave = sin(uv.x*4.4 + uTime*0.55*spd)*amp*1.8;
    float surface = uLevel*1.78 - 0.89 + wave;
    float liquidMask = smoothstep(surface + 0.035, surface - 0.035, uv.y);
    liquidMask *= step(0.001, uLevel);
    float depth1 = clamp((surface - uv.y)*0.85, 0.0, 1.0);
    vec3 body1 = mix(uLiq*1.15, uDeep*1.2, depth1) * liquidMask;
    float sheen1 = (1.0-smoothstep(0.0,0.045,abs(uv.y-surface))) * step(0.001,uLevel);
    vec3 col1 = body1 + uAcc*(sheen1*0.72 + fres1*0.34);
    float alpha1 = clamp(liquidMask*0.82 + sheen1*0.42 + fres1*0.38, 0.02, 1.0);
    if(uDay > 0.5){ col1 *= 0.86; alpha1 = clamp(alpha1*1.18,0.0,1.0); }
    gl_FragColor = vec4(col1*edge1 + soul, min(1.0,alpha1*edge1+soulA));
    return;
  }

  vec3 ro = vec3(0.0, 0.0, 3.4);
  vec3 rd = normalize(vec3(uv*0.94, -3.2));
  float b = dot(ro, rd), c = dot(ro,ro) - 1.0, h = b*b - c;
  if(h < 0.0) discard;
  h = sqrt(h);
  float t0 = -b - h, t1 = -b + h;
  vec3 pf = ro + rd*t0;
  vec3 N = normalize(pf);
  vec3 V = -rd;
  float ndv = max(dot(N,V), 0.0);
  float fres = pow(1.0 - ndv, 3.4);

  vec3 rdi = refract(rd, N, 0.78);
  float steps = KIPU_TIER > 2.5 ? 32.0 : 16.0;
  float dt = (t1 - t0) / steps;
  float thick = 0.0;
  vec3 hp = vec3(0.0);
  float wbest = 0.0;
  for(int i=0;i<32;i++){
    if(float(i) >= steps) break;
    vec3 p = pf + rdi*(dt*(float(i)+0.5));
    if(dot(p,p) <= 1.0){
      float sd = surfH(p, amp, spd) - p.y;
      float dens = smoothstep(-0.030, 0.030, sd);
      thick += dens*dt;
      float w = dens*(1.0-dens);
      if(w > wbest){ wbest = w; hp = p; }
    }
  }

  float d = clamp(thick*1.25, 0.0, 1.0);
  float has = smoothstep(0.0, 0.035, thick);
  float hit = step(0.004, thick);
  float sy = surfH(vec3(uv.x, 0.0, 0.0), amp, spd);
  float below = clamp((sy - uv.y)*1.15, 0.0, 1.0);
  vec3 body = mix(uLiq*1.40, uDeep*1.30, pow(below, 0.70));
  body *= (0.40 + 0.70*d);

  float flow = fbm(vec2(uv.x*2.3 + uTime*0.055*spd, uv.y*2.7 - uTime*0.042*spd));
  float flow2 = fbm(vec2(uv.x*4.6 - uTime*0.03*spd, uv.y*4.1 + uTime*0.025*spd));
  body *= 0.80 + 0.34*flow + 0.12*flow2;

  if(KIPU_TIER > 2.5){
    float ca = fbm(hp.xz*5.0 + vec2(uTime*0.26*spd, uTime*0.12*spd));
    body += uAcc * pow(max(ca-0.44, 0.0), 1.8) * 2.4 * hit * (1.0 - below*0.6);
  }

  float wl = abs(uv.y - sy);
  float sheen = (1.0 - smoothstep(0.0, 0.05, wl)) * has;
  body += uAcc * sheen * 0.95;
  body += uLiq * pow(max(-uv.y,0.0), 2.0) * 0.34 * d;

  if(KIPU_TIER > 2.5){
    float motes = 0.0;
    for(int i=0;i<6;i++){
      float fi = float(i);
      float ph = fract(uTime*0.028 + fi*0.1631);
      vec2 mp = vec2(sin(uTime*0.19 + fi*2.37)*0.52, -0.92 + ph*1.7);
      motes += smoothstep(0.023, 0.0, length(uv - mp));
    }
    body += uAcc * motes * 1.15 * hit;
  }

  vec3 Lk = normalize(vec3(-0.42, 0.86, 0.55));
  vec3 R = reflect(-V, N);
  float spec = pow(max(dot(R, Lk), 0.0), 210.0) * 0.85;
  float spec2 = pow(max(dot(R, normalize(vec3(0.58,-0.42,0.7))), 0.0), 46.0) * 0.14;
  float rimw = pow(1.0 - ndv, 5.0);
  vec3 irid = 0.5 + 0.5*cos(6.28318*(vec3(0.0,0.34,0.68) + fres*1.5 + uTime*0.025));
  vec3 rim = mix(uAcc, irid, 0.26) * (fres*1.30 + rimw*2.35);

  // Patrimonio deliberately has a fixed crystal. Its number carries value;
  // no invented denominator changes this geometry.
  vec3 core = vec3(0.0);
  float coreA = 0.0;
  if(uMat > 2.5 && uMat < 3.5){
    float cr = 0.38;
    float bb = dot(pf, rdi), cc2 = dot(pf,pf) - cr*cr, hh = bb*bb - cc2;
    if(hh > 0.0){
      hh = sqrt(hh);
      float ct0 = max(-bb - hh, 0.0);
      vec3 cn = normalize(pf + rdi*ct0);
      float rota = uTime*0.05;
      vec2 sph = vec2(atan(cn.z, cn.x) + rota, acos(clamp(cn.y,-1.0,1.0)));
      vec2 q = vec2(sph.x*1.55, sph.y*2.15);
      vec2 tri = vec2(q.x + q.y*0.577, q.y*1.155);
      float fx = fract(tri.x), fy = fract(tri.y);
      float sub = step(1.0, fx + fy);
      vec2 cell = floor(tri) + mix(vec2(0.3333), vec2(0.6667), sub);
      float qy = cell.y/1.155, qx = cell.x - qy*0.577;
      vec2 cs = vec2(qx/1.55, qy/2.15);
      vec3 fn = rotY(normalize(vec3(sin(cs.y)*cos(cs.x), cos(cs.y), sin(cs.y)*sin(cs.x))), -rota);
      vec3 Lc = normalize(vec3(-0.38, 0.80, 0.62));
      float lam = max(dot(fn, Lc), 0.0);
      float sp = pow(max(dot(reflect(rdi, fn), Lc), 0.0), 24.0);
      float fh = hash21(floor(tri) + sub*17.0);
      core = uDeep*(0.75 + 0.35*fh) + uLiq*(0.16 + 0.80*lam*lam);
      core += vec3(0.94,0.98,1.0) * sp * 0.85;
      float cfres = pow(1.0 - max(dot(cn, -rdi), 0.0), 2.4);
      core += uAcc * cfres * 0.75;
      coreA = clamp(0.88 + cfres*0.28, 0.0, 1.0);
    }
  }

  vec3 col = body*has + core*coreA + rim + vec3(spec) + uAcc*spec2;
  float alpha = clamp(has*(0.42 + 0.56*d) + coreA*0.90 + fres*0.34 + rimw*0.72 + spec + sheen*0.4 + 0.02, 0.0, 1.0);
  if(uDay > 0.5){ col *= 0.86; alpha = clamp(alpha*1.22 + d*0.1, 0.0, 1.0); }
  float edge = 1.0 - smoothstep(0.958, 1.0, rr);
  gl_FragColor = vec4(col*edge + soul, min(1.0, alpha*edge + soulA));
}`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

type RenderTier = 1 | 2 | 3;

interface ProgramBundle {
  tier: RenderTier;
  program: WebGLProgram;
  locations: {
    resolution: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    level: WebGLUniformLocation | null;
    energy: WebGLUniformLocation | null;
    day: WebGLUniformLocation | null;
    material: WebGLUniformLocation | null;
    voice: WebGLUniformLocation | null;
    liquid: WebGLUniformLocation | null;
    deep: WebGLUniformLocation | null;
    accent: WebGLUniformLocation | null;
  };
}

const RENDER_TIERS: readonly RenderTier[] = [1, 2, 3];

function linkTierProgram(
  gl: WebGLRenderingContext,
  vertex: WebGLShader,
  tier: RenderTier,
): ProgramBundle | null {
  const source = FRAGMENT_SOURCE.replace("__KIPU_TIER__", `${tier}.0`);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, source);
  if (!fragment) return null;
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(fragment);
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  return {
    tier,
    program,
    locations: {
      resolution: uniform("uRes"),
      time: uniform("uTime"),
      level: uniform("uLevel"),
      energy: uniform("uEnergy"),
      day: uniform("uDay"),
      material: uniform("uMat"),
      voice: uniform("uVoice"),
      liquid: uniform("uLiq"),
      deep: uniform("uDeep"),
      accent: uniform("uAcc"),
    },
  };
}

export function createOrbRenderer(canvas: HTMLCanvasElement): OrbRenderer | null {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
    // N2 §5.1 · Sin esto, el navegador PUEDE limpiar el lienzo después de
    // componer, y un lienzo pausado se queda en blanco. Hasta N1 daba igual
    // porque pausar coincidía con esconder el orbe vivo; ahora el orbe vivo se
    // queda puesto mientras se desliza o mientras el chat está abierto, así que
    // el último cuadro TIENE que sobrevivir. Pausar la animación es legítimo;
    // quedarse sin imagen sería otra sustitución con otro nombre.
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;

  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  if (!vertex) {
    return null;
  }
  const programs: ProgramBundle[] = [];
  for (const tier of RENDER_TIERS) {
    const bundle = linkTierProgram(gl, vertex, tier);
    if (!bundle) {
      for (const compiled of programs) gl.deleteProgram(compiled.program);
      gl.deleteShader(vertex);
      return null;
    }
    programs.push(bundle);
  }
  gl.deleteShader(vertex);

  const buffer = gl.createBuffer();
  if (!buffer) {
    for (const compiled of programs) gl.deleteProgram(compiled.program);
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  let width = 1;
  let height = 1;
  let disposed = false;

  return {
    resize(cssWidth, cssHeight, requestedDpr) {
      const dpr = Math.min(Math.max(requestedDpr || 1, 1), 2);
      width = Math.max(1, Math.round(cssWidth * dpr));
      height = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.viewport(0, 0, width, height);
      return { dpr, width, height };
    },
    draw(values) {
      if (disposed || gl.isContextLost()) return;
      const bundle = programs[values.tier - 1];
      if (!bundle) return;
      const { locations } = bundle;
      gl.useProgram(bundle.program);
      gl.uniform2f(locations.resolution, width, height);
      gl.uniform1f(locations.time, values.time);
      gl.uniform1f(locations.level, values.level);
      gl.uniform1f(locations.energy, values.energy);
      gl.uniform1f(locations.day, values.day);
      gl.uniform1f(locations.material, values.material);
      gl.uniform1f(locations.voice, values.voice);
      gl.uniform3fv(locations.liquid, values.liquid);
      gl.uniform3fv(locations.deep, values.deep);
      gl.uniform3fv(locations.accent, values.accent);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gl.deleteBuffer(buffer);
      for (const compiled of programs) gl.deleteProgram(compiled.program);
    },
  };
}
