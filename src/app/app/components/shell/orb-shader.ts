// Bloque N3 — el orbe deja de ser un lienzo quieto en el centro.
//
// LA FORMA NUEVA: los cinco orbes viven en UN solo lienzo, y el lienzo es el
// carrusel. Cada orbe se dibuja en su propio cuadrilátero, con su centro
// derivado del desplazamiento de la vía. Deslizar los mueve a todos; las
// vecinas asoman a los costados. No hay cambio de capa: hay movimiento — y la
// familia de defectos que costó N2 (sustitución, relevo, lag de una capa) deja
// de existir porque ya no hay nada que sustituir.
//
// Por qué un cuadrilátero por orbe y no un bucle sobre cinco dentro de un
// lienzo completo: el rasterizador descarta gratis los píxeles que no toca cada
// orbe. En reposo sólo hay UNA presencia > 0, así que el costo es el de un solo
// orbe — el mismo que hasta N2. Durante el gesto hay dos. Nunca cinco.
//
// LO QUE ESTE ARCHIVO NO HACE: no decide un nivel, no acota un valor y no sabe
// qué significan las cifras. Recibe una altura de TRAZO ya mapeada por
// `orbWaterline` y la dibuja. La frontera entre dato y dibujo vive en el
// contrato puro, donde el gate puede ejecutarla.

export type OrbRgb = readonly [number, number, number];

/** Cuánto sobra alrededor del radio para el halo y la sombra propia. */
export const ORB_SPAN = 1.62;

export interface OrbDrawCall {
  /** Centro del orbe en píxeles CSS, desde la esquina superior izquierda. */
  centerX: number;
  centerY: number;
  /** Radio del orbe en píxeles CSS. */
  radius: number;
  /** 0–1. Cuánto está presente. Con 0 no se emite la llamada de dibujo. */
  presence: number;
  /** La ALTURA DE TRAZO, ya mapeada por `orbWaterline`. Nunca un valor crudo. */
  waterline: number;
  energy: number;
  voice: number;
  /** Inclinación del plano de agua: gesto + giroscopio, sumados por el caller. */
  tiltX: number;
  tiltZ: number;
  /** Giro acumulado del orbe, en radianes. */
  spin: number;
  /**
   * N3B · CUÁNTA OLA HAY, de la simulación. No es un reloj: es la velocidad del
   * líquido. Con 0 la superficie es un espejo — que es lo que hace que se lea
   * como agua y no como textura animada.
   */
  wave: number;
  /** N3B · El modo vertical del líquido. Un recibo lo empuja y el agua rebota. */
  bob: number;
  /**
   * N3B · 1 = el cuarto (horizonte, ventana, suelo); 0 = la luz plana de N3.
   * Existe para PROBAR F3, no para configurarlo: producción siempre manda 1.
   */
  env: number;
  /**
   * N3B · 0 = el orbe que mirás; 1 = el más lejano. Le da perspectiva aérea a
   * las vecinas para que pasen DETRÁS en vez de intersecarse con un borde duro.
   */
  depth: number;
  material: number;
  liquid: OrbRgb;
  deep: OrbRgb;
  accent: OrbRgb;
}

export interface OrbFrame {
  time: number;
  day: number;
  tier: 1 | 2 | 3;
  orbs: readonly OrbDrawCall[];
}

export interface OrbBufferInfo {
  dpr: number;
  width: number;
  height: number;
  /** `2` cuando el contexto es WebGL2; `1` cuando degradó. */
  glVersion: 1 | 2;
  antialias: boolean;
}

export interface OrbRenderer {
  resize(cssWidth: number, cssHeight: number, dpr: number): OrbBufferInfo;
  draw(frame: OrbFrame): void;
  dispose(): void;
}

const VERTEX_SOURCE = `
attribute vec2 aQuad;
uniform vec2 uCanvas;
uniform vec2 uCenter;
uniform float uSpan;
varying vec2 vP;
void main(){
  // El eje Y del lienzo crece HACIA ABAJO y el del orbe hacia ARRIBA: el agua
  // se apoya en el fondo, la luz entra por arriba y la sombra cae abajo. Sin
  // esta vuelta el agua llena el techo del vaso.
  vP = vec2(aQuad.x, -aQuad.y) * ${ORB_SPAN.toFixed(2)};
  vec2 px = uCenter + aQuad * uSpan;
  vec2 clip = (px / uCanvas) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

// UN SOLO MUNDO PARA LAS CINCO MATERIAS (§5.3 · E5).
//
// El founder fotografió lo contrario: «unos son super intensos en color y otros
// super opacos, no hay simetría entre ellos». La causa estaba en el código: cada
// material traía su propia amplitud, su propia velocidad y su propio brillo, así
// que cada capa vivía con otra física y otra exposición.
//
// Ahora hay UNA física (el mismo oleaje, el mismo menisco, la misma absorción de
// Beer-Lambert), UNA luz (`LKEY`, una sola dirección coherente) y UNA exposición
// (el mismo tonemap al final, para todas). Lo único que cambia entre capas es el
// PIGMENTO, que entra como coeficiente de extinción. La excepción es Patrimonio,
// y no es una decisión de estilo: el motor no puede afirmarle un techo, así que
// su materia es cristal — la doctrina de N2, no un gusto.
const FRAGMENT_SOURCE = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;
varying vec2 vP;
uniform float uTime, uLevel, uEnergy, uDay, uMat, uVoice, uPresence, uSpin;
uniform float uWave, uBob, uDepth, uEnv;
uniform vec2 uTilt;
uniform vec3 uLiq, uDeep, uAcc;
const float KIPU_TIER = __KIPU_TIER__;
const vec3 LKEY = vec3(-0.4082, 0.8367, 0.3646);
const vec3 LFILL = vec3(0.6396, -0.2559, 0.7248);

// ── EL CUARTO (N3B) ────────────────────────────────────────────────────────
//
// N3 ya tenía un entorno, y aun así el founder lo puntuó 4/10 y dijo «parece más
// una caricatura que algo real o tech». La causa no era que faltara un entorno:
// era que el entorno NO TENÍA FORMA. Era un degradado vertical más dos lóbulos
// de potencia — es decir, un cielo sin horizonte y una luz sin ventana. Un
// degradado reflejado se ve como plástico brillante porque no hay nada que
// RECONOCER en el reflejo.
//
// Lo que hace que el ojo lea «vidrio» es reflejar COSAS: una línea de horizonte
// nítida, un rectángulo de ventana con su marco, un suelo que devuelve luz. Son
// bordes, y los bordes son la información. Eso es lo que tienen las gemas de
// OPAL: no más brillo, más CUARTO.
const vec3 ENV_SKY_HI = vec3(0.048, 0.062, 0.086);
const vec3 ENV_SKY_LO = vec3(0.070, 0.086, 0.112);
const vec3 ENV_FLOOR = vec3(0.010, 0.012, 0.017);
const vec3 ENV_SKY_HI_DAY = vec3(0.340, 0.368, 0.420);
const vec3 ENV_SKY_LO_DAY = vec3(0.520, 0.548, 0.596);
const vec3 ENV_FLOOR_DAY = vec3(0.118, 0.130, 0.154);
const vec3 ENV_KEY = vec3(0.90, 0.945, 1.00);
const vec3 ENV_FILL = vec3(0.34, 0.44, 0.62);
const float WAVE_AMP = 0.026;
const float CAM_PITCH = -0.30;
// El menisco DE VERDAD es una película fina, no un bulto. N3 lo tenía en 0.078
// —más alto que el piso del vaso entero— y por eso un orbe vacío dibujaba un
// charco: el bulto trepaba la pared y levantaba la superficie visible.
const float MENISCUS = 0.030;
const vec2 WD1 = vec2(0.9806, 0.1961);
const vec2 WD2 = vec2(-0.3162, 0.9487);
const vec2 WD3 = vec2(0.7071, -0.7071);
const vec2 WD4 = vec2(0.5547, 0.8321);

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

// Un rectángulo redondeado en el plano tangente a una dirección. Es la ventana:
// se proyecta gnomónicamente, así que se deforma con el ángulo igual que un
// reflejo de verdad.
float panelMask(vec3 d, vec3 axis, vec3 tanA, vec3 tanB, vec2 half_, float soft){
  float z = dot(d, axis);
  if(z <= 0.02) return 0.0;
  vec2 q = vec2(dot(d, tanA), dot(d, tanB)) / z;
  vec2 e = abs(q) - half_;
  float sd = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
  return 1.0 - smoothstep(0.0, soft, sd);
}

// EL CUARTO SE PUEDE APAGAR (F3). No es un modo de producción: es el
// instrumento con el que se demuestra que el vidrio refracta UN ENTORNO y no un
// degradado. Con uEnv = 0 queda la iluminación plana que tenía N3 —un cielo sin
// horizonte y una luz sin ventana—, así que las dos mitades del criterio se
// pueden fotografiar lado a lado con el mismo renderer y la misma exposición.
vec3 envSample(vec3 d){
  // EL HORIZONTE ES UN BORDE, NO UN DEGRADADO. Es la mitad de por qué esto se
  // lee como un cuarto: el suelo y el cielo son dos materiales distintos con una
  // línea entre ellos, y esa línea es lo que se ve curvarse sobre el vidrio.
  float h = d.y;
  vec3 sky = mix(mix(ENV_SKY_LO, ENV_SKY_LO_DAY, uDay),
                 mix(ENV_SKY_HI, ENV_SKY_HI_DAY, uDay),
                 smoothstep(0.02, 0.75, h));
  vec3 grd = mix(ENV_FLOOR, ENV_FLOOR_DAY, uDay) * (0.45 + 0.75*smoothstep(-1.0, 0.0, h));
  float horizon = mix(smoothstep(-0.85, 0.85, h), smoothstep(-0.012, 0.012, h), uEnv);
  vec3 base = mix(grd, sky, horizon);
  // la pared iluminada justo encima del horizonte: la banda que delata que hay
  // un piso y un techo, y no una esfera de color
  base += ENV_KEY * (0.10 + 0.09*uDay) * exp(-abs(h - 0.05) * 26.0) * uEnv;

  // LA VENTANA. Un especular redondo es una bola de plástico; un rectángulo con
  // marco es una ventana, y el ojo lo reconoce sin que nadie se lo explique.
  vec3 tanA = normalize(cross(LKEY, vec3(0.0, 1.0, 0.0)));
  vec3 tanB = cross(LKEY, tanA);
  float pane = panelMask(d, LKEY, tanA, tanB, vec2(0.42, 0.26), 0.10);
  // el marco: dos travesaños que parten el vidrio de la ventana en cuatro
  float z = max(dot(d, LKEY), 0.0001);
  vec2 q = vec2(dot(d, tanA), dot(d, tanB)) / z;
  float mullion = (1.0 - smoothstep(0.010, 0.030, abs(q.x)))
                + (1.0 - smoothstep(0.010, 0.030, abs(q.y)));
  base += ENV_KEY * pane * (1.0 - clamp(mullion, 0.0, 1.0) * 0.85) * (1.25 + 0.55*uDay) * uEnv;
  // sin cuarto queda el lóbulo suave de N3: una luz, ningún objeto
  base += ENV_KEY * (pow(max(dot(d, LKEY), 0.0), 14.0)*0.30
                   + pow(max(dot(d, LKEY), 0.0), 2.6)*0.055) * (1.0 - uEnv);
  // y su brillo pequeño y duro, que es el que hace la chispa en el borde
  base += ENV_KEY * pow(max(dot(d, LKEY), 0.0), 260.0) * 0.55;
  base += ENV_FILL * pow(max(dot(d, LFILL), 0.0), 5.0) * 0.10;
  return base;
}

vec3 toWater(vec3 p){
  float c = cos(CAM_PITCH), sn = sin(CAM_PITCH);
  return vec3(p.x, c*p.y - sn*p.z, sn*p.y + c*p.z);
}
vec3 fromWater(vec3 q){
  float c = cos(CAM_PITCH), sn = sin(CAM_PITCH);
  return vec3(q.x, c*q.y + sn*q.z, -sn*q.y + c*q.z);
}
vec3 rotY(vec3 v, float a){
  float c = cos(a), sn = sin(a);
  return vec3(c*v.x + sn*v.z, v.y, -sn*v.x + c*v.z);
}
vec3 tonemap(vec3 x){
  x *= 1.04;
  return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0);
}

float isDrop(){ return step(4.5, uMat); }

// EL PISTÓN entra en el nivel: un recibo empuja el agua y todo el plano sube y
// baja antes de asentarse. Lo calcula la simulación; acá sólo se suma.
float waterBase(){ return clamp(uLevel + uBob, 0.0, 1.0) * 2.0 - 1.0; }

// ── LA AMPLITUD SALE DE LA VELOCIDAD DEL LÍQUIDO, NO DEL RELOJ ──────────────
//
// Es el cambio que mata la «masa deforme». Hasta N3 el oleaje corría a amplitud
// fija estuviera pasando algo o no, así que el agua se veía SIEMPRE revuelta —
// y un agua siempre revuelta no se lee como agua, se lee como textura animada.
// Un agua quieta es un ESPEJO, y ese espejo es justo el aspecto que faltaba.
// Queda un fondo mínimo y lentísimo porque un vaso de verdad tampoco está
// perfectamente plano: respira.
float waveAmp(){
  return WAVE_AMP * (0.17 + uWave*2.9 + uEnergy*1.5);
}

float waterHeight(vec3 p, float detail){
  float base = waterBase();
  float lean = dot(p.xz, uTilt);
  float A = waveAmp();
  float w = A*(       sin(dot(p.xz, WD1)*4.40 + uTime*0.85)
              + 0.75*sin(dot(p.xz, WD2)*3.20 - uTime*0.66)
              + 0.20*sin(dot(p.xz, WD3)*11.70 - uTime*1.35)
              + 0.20*sin(dot(p.xz, WD4)*9.30 + uTime*1.12));
  // El detalle fino ya NO es ruido fractal sumado a la altura: eso era
  // literalmente la «masa deforme». Es un rizo capilar, corto y coherente, que
  // sólo aparece cuando el líquido se está moviendo.
  if(detail > 0.5){
    w += A*0.34*uWave*sin(dot(p.xz, WD2)*23.0 + uTime*3.1)
       * sin(dot(p.xz, WD1)*19.0 - uTime*2.4);
  }
  // EL MENISCO: una película fina que trepa la pared, y que se APAGA cuando
  // queda poca agua. Un charco no tiene menisco de vaso lleno.
  float wallR = sqrt(max(0.0, 1.0 - base*base));
  float rad = length(p.xz);
  float men = smoothstep(wallR*0.55, wallR*1.02, rad) * MENISCUS
            * smoothstep(0.0, 0.30, base + 1.0);
  return base + lean + w + men;
}

// La NORMAL de la superficie, analítica. Sin esto no hay reflejo del cuarto en
// el agua —había un 'sheen' sumado a mano, que es pintar un brillo, no
// reflejar— y sin reflejo el agua no puede leerse como agua.
vec3 waterNormal(vec3 p, float detail){
  float A = waveAmp();
  float c1 = A*4.40*cos(dot(p.xz, WD1)*4.40 + uTime*0.85);
  float c2 = A*0.75*3.20*cos(dot(p.xz, WD2)*3.20 - uTime*0.66);
  float c3 = A*0.20*11.70*cos(dot(p.xz, WD3)*11.70 - uTime*1.35);
  float c4 = A*0.20*9.30*cos(dot(p.xz, WD4)*9.30 + uTime*1.12);
  vec2 g = c1*WD1 + c2*WD2 + c3*WD3 + c4*WD4 + uTilt;
  if(detail > 0.5){
    float k = A*0.34*uWave;
    g += vec2(k*23.0, k*19.0)
       * cos(dot(p.xz, WD2)*23.0 + uTime*3.1)
       * cos(dot(p.xz, WD1)*19.0 - uTime*2.4);
  }
  return normalize(vec3(-g.x, 1.0, -g.y));
}

void main(){
  vec2 uv = vP;
  float r = length(uv);
  float rr = r*r;

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
    halo *= 0.80 + 0.34*max(dot(dir, LKEY.xy), 0.0);
    vec3 sc = mix(uAcc, uLiq, 0.45);
    soul = sc * halo * (0.21 + 0.30*uVoice);
    soulA = clamp(halo*(0.105 + 0.20*uVoice) * mix(1.0, 0.50, uDay), 0.0, 1.0);
  }

  float shadow = 0.0;
  {
    vec2 sp = (uv - vec2(0.30, -1.06)) / vec2(0.86, 0.20);
    shadow = (1.0 - smoothstep(0.0, 1.0, length(sp))) * 0.30;
  }

  if(rr > 1.0){
    float aOut = clamp(soulA + shadow, 0.0, 1.0) * uPresence;
    gl_FragColor = vec4(tonemap(soul) * uPresence, aOut);
    return;
  }

  vec3 ro = vec3(0.0, 0.0, 3.4);
  vec3 rd = normalize(vec3(uv*0.94, -3.2));
  float b = dot(ro, rd), c = dot(ro,ro) - 1.0, h = b*b - c;
  if(h < 0.0){ gl_FragColor = vec4(0.0); return; }
  h = sqrt(h);
  float t0 = -b - h;
  vec3 pf = ro + rd*t0;
  vec3 N = normalize(pf);
  vec3 V = -rd;
  float ndv = max(dot(N,V), 0.0);
  float fres = pow(1.0 - ndv, 3.4);

  vec3 rdi = refract(rd, N, 0.90);

  float tExit = max(0.0, -2.0*dot(pf, rdi));
  vec3 qo = toWater(pf);
  vec3 qd = toWater(rdi);
  float base = waterBase();
  float wallR = sqrt(max(0.0, 1.0 - base*base));
  float drop = isDrop();
  // LA GOTA (§4) · Un orbe en CERO no dibuja un vaso con poca agua: dibuja una
  // gota. Es el vacío deliberado de N2, que N3 perdió por el camino — el nivel
  // nulo caía al piso del mapeo y el piso del mapeo dibujaba un charco. Acá la
  // gota tiene su propia materia: un disco chico, apoyado en el fondo, con la
  // cara CONVEXA que le da la tensión superficial.
  if(drop > 0.5){ base = -0.955; wallR = 0.30; }

  float tA = 0.0, tB = 0.0;
  float tS = -1.0;
  float surfaceSeen = 0.0;
  vec3 qSurf = qo;
  float detail = KIPU_TIER > 1.5 ? 1.0 : 0.0;
  if(abs(qd.y) > 0.0015){
    tS = (base - qo.y) / qd.y;
    vec3 guess = qo + qd*tS;
    tS += (waterHeight(guess, detail) - guess.y) / qd.y;
    qSurf = qo + qd*tS;
    if(qd.y < 0.0){ tA = max(0.0, tS); tB = tExit; }
    else { tA = 0.0; tB = min(tS, tExit); }
    if(tS > 0.0 && tS < tExit && dot(qSurf, qSurf) <= 1.0) surfaceSeen = 1.0;
  } else {
    tA = 0.0;
    tB = qo.y < base ? tExit : 0.0;
  }
  // La gota está acotada en radio: fuera de su disco no hay líquido.
  if(drop > 0.5){
    float rho0 = length(qSurf.xz);
    float inside = 1.0 - smoothstep(wallR*0.86, wallR, rho0);
    surfaceSeen *= inside;
    tB = mix(tA, tB, inside);
  }
  float thick = max(0.0, tB - tA);
  float has = smoothstep(0.0, 0.030, thick);
  float hit = step(0.004, thick);

  float crystal = step(2.5, uMat) * step(uMat, 3.5);
  thick *= 1.0 - crystal;
  has *= 1.0 - crystal;
  hit *= 1.0 - crystal;
  surfaceSeen *= 1.0 - crystal;
  float depth = max(0.0, base - (qo.y + qd.y*(tA + tB)*0.5));
  vec3 hp = qo + qd*mix(tA, tB, 0.62);

  vec3 sigma = (vec3(1.0) - uLiq) * 1.55 + 0.16;
  vec3 Tl = exp(-sigma * depth * 1.45);
  vec3 body = mix(uDeep * 0.92, uLiq * 1.30, Tl);
  body *= 0.60 + 0.55 * clamp(thick * 1.15, 0.0, 1.0);
  // La gota es una lámina, y una lámina de líquido apenas tiñe: sin esto la
  // absorción de Beer-Lambert la devolvía casi con el pigmento puro, así que un
  // orbe VACÍO brillaba más que uno lleno — exactamente al revés.
  body *= 1.0 - drop * 0.45;

  // Las corrientes lentas se quedan, pero PESAN MUCHO MENOS y se mueven con el
  // líquido: eran parte del aspecto de «masa» cuando el agua estaba quieta.
  float flow = fbm(vec2(uv.x*2.3 + uTime*0.055, uv.y*2.7 - uTime*0.042));
  body *= 0.90 + (0.10 + 0.22*uWave)*flow;

  if(KIPU_TIER > 1.5){
    vec3 qFloor = qo + qd*tExit;
    float dBelow = max(0.0, base - qFloor.y);
    float onFloor = smoothstep(0.04, 0.34, dBelow) * smoothstep(0.05, -0.55, qFloor.y);
    vec3 lw = toWater(LKEY);
    vec2 entry = qFloor.xz + (lw.xz / max(lw.y, 0.30)) * dBelow;
    entry = rotY(vec3(entry.x, 0.0, entry.y), uSpin).xz;
    float A = waveAmp();
    float h1 = -A * 1.00 *  19.36 * sin(dot(entry, WD1)*4.40 + uTime*0.85);
    float h2 = -A * 0.75 *  10.24 * sin(dot(entry, WD2)*3.20 - uTime*0.66);
    float h3 = -A * 0.20 * 136.89 * sin(dot(entry, WD3)*11.70 - uTime*1.35);
    float h4 = -A * 0.20 *  86.49 * sin(dot(entry, WD4)*9.30 + uTime*1.12);
    float hxx = h1*WD1.x*WD1.x + h2*WD2.x*WD2.x + h3*WD3.x*WD3.x + h4*WD4.x*WD4.x;
    float hyy = h1*WD1.y*WD1.y + h2*WD2.y*WD2.y + h3*WD3.y*WD3.y + h4*WD4.y*WD4.y;
    float hxy = h1*WD1.x*WD1.y + h2*WD2.x*WD2.y + h3*WD3.x*WD3.y + h4*WD4.x*WD4.y;
    float f = dBelow * 3.4;
    float jac = abs((1.0 + f*hxx)*(1.0 + f*hyy) - f*f*hxy*hxy);
    float caus = clamp(1.0/max(jac, 0.11) - 1.0, 0.0, 4.0);
    // La cáustica es CONSECUENCIA de la superficie: si la superficie está
    // quieta, la luz no se concentra y no hay red. Antes brillaba igual.
    body += mix(uAcc, vec3(1.0), 0.46) * caus * hit * onFloor * (0.10 + 0.30*uWave);
  }

  // ── LA SUPERFICIE ES UNA INTERFAZ, NO UNA RAYA PINTADA ─────────────────────
  //
  // Acá estaba la mitad del problema. N3 sumaba un 'sheen' —un brillo dibujado
  // en el borde del disco—, y un brillo dibujado no es una superficie: por eso
  // el agua no se leía como agua. Una superficie de líquido REFLEJA el cuarto y
  // REFRACTA el fondo, y Fresnel decide cuánto de cada cosa según el ángulo. De
  // ahí sale sola la propiedad que el ojo reconoce al instante: el borde lejano
  // del disco es un espejo y el cercano deja ver el fondo.
  vec3 rdn = normalize(rdi);
  vec3 wn = waterNormal(qSurf, detail);
  vec3 wnv = normalize(fromWater(wn));
  float wcos = max(dot(wnv, -rdn), 0.0);
  float wfres = clamp(0.02 + 0.98*pow(1.0 - wcos, 5.0), 0.0, 1.0);
  // El agua a ras SÍ es un espejo —eso es física—, pero un espejo total borra
  // el nivel, que es lo único que este objeto tiene que decir. El reflejo entra
  // teñido por el pigmento de la capa, así que aporta el cuarto sin dejar de
  // ser AGUA DE ESA CAPA.
  vec3 wrefl = mix(envSample(reflect(rdn, wnv)), uLiq * 0.55, 0.24);
  body = mix(body, wrefl, wfres * surfaceSeen * 0.60);
  // El destello duro del panel sobre el agua: es el que dice «esto está mojado».
  float wspec = pow(max(dot(reflect(rdn, wnv), LKEY), 0.0), 300.0);
  // Medido: con ganancia 2.0 el fondo del orbe vacío llegaba a [255,255,233]
  // —recortado— y eso es lo que se veía como una mancha sucia. Un destello que
  // satura deja de ser un destello: es un agujero blanco.
  body += ENV_KEY * wspec * surfaceSeen * 0.95;

  // Y EL MENISCO, ahora como lo que es: la línea exacta donde el líquido toca el
  // vidrio. Fina, no una banda ancha del mismo material — que era la razón de
  // que el aire de arriba no se leyera como aire.
  float rho = length(qSurf.xz);
  float ring = smoothstep(wallR*0.90, wallR*1.005, rho)
             * (1.0 - smoothstep(wallR*1.005, wallR*1.06, rho));
  body += mix(uAcc, vec3(1.0), 0.55) * ring * surfaceSeen * 0.50;

  if(KIPU_TIER > 2.5){
    float motes = 0.0;
    for(int i=0;i<7;i++){
      float fi = float(i);
      vec3 mq = rotY(vec3(
        sin(uTime*0.11 + fi*2.13)*0.56,
        fract(uTime*0.020 + fi*0.1631)*1.72 - 0.86,
        cos(uTime*0.09 + fi*1.71)*0.56), uSpin);
      if(mq.y < base + dot(mq.xz, uTilt)){
        vec3 mp = fromWater(mq);
        motes += smoothstep(0.034, 0.004, length(cross(mp - pf, rdi)));
      }
    }
    body += mix(uAcc, vec3(1.0), 0.45) * motes * 0.52 * hit;
  }

  vec3 R = reflect(-V, N);
  float schlick = 0.04 + 0.96*pow(1.0 - ndv, 5.0);
  vec3 reflection = envSample(R) * schlick * mix(2.35, 1.45, uDay);
  float rimw = pow(1.0 - ndv, 5.0);

  vec3 core = vec3(0.0);
  float coreA = 0.0;
  if(uMat > 2.5 && uMat < 3.5){
    float cr = 0.38;
    float bb = dot(pf, rdi), cc2 = dot(pf,pf) - cr*cr, hh = bb*bb - cc2;
    if(hh > 0.0){
      hh = sqrt(hh);
      float ct0 = max(-bb - hh, 0.0);
      vec3 cn = normalize(pf + rdi*ct0);
      float rota = uTime*0.05 + uSpin;
      vec2 sph = vec2(atan(cn.z, cn.x) + rota, acos(clamp(cn.y,-1.0,1.0)));
      vec2 q = vec2(sph.x*1.55, sph.y*2.15);
      vec2 tri = vec2(q.x + q.y*0.577, q.y*1.155);
      float fx = fract(tri.x), fy = fract(tri.y);
      float sub = step(1.0, fx + fy);
      vec2 cell = floor(tri) + mix(vec2(0.3333), vec2(0.6667), sub);
      float qy = cell.y/1.155, qx = cell.x - qy*0.577;
      vec2 cs = vec2(qx/1.55, qy/2.15);
      vec3 fn = rotY(normalize(vec3(sin(cs.y)*cos(cs.x), cos(cs.y), sin(cs.y)*sin(cs.x))), -rota);
      float lam = max(dot(fn, LKEY), 0.0);
      float sp = pow(max(dot(reflect(rdi, fn), LKEY), 0.0), 24.0);
      float fh = hash21(floor(tri) + sub*17.0);
      core = uDeep*(0.75 + 0.35*fh) + uLiq*(0.16 + 0.80*lam*lam);
      core += vec3(0.94,0.98,1.0) * sp * 0.85;
      float cfres = pow(1.0 - max(dot(cn, -rdi), 0.0), 2.4);
      core += uAcc * cfres * 0.75;
      coreA = clamp(0.88 + cfres*0.28, 0.0, 1.0);
    }
  }

  // ── EL VIDRIO VACÍO, CON DISPERSIÓN ────────────────────────────────────────
  //
  // El rayo cruza la esfera y sale al cuarto. La novedad de N3B es que sale
  // TRES VECES, con un índice apenas distinto por canal: el vidrio real separa
  // los colores, y esa franja de color en el borde es la firma óptica que el ojo
  // asocia con cristal en vez de con plástico. Es lo que se ve en las gemas de
  // OPAL y lo que acá no había.
  vec3 backP = normalize(pf + rdi*tExit);
  vec3 empty;
  if(KIPU_TIER > 1.5){
    // LA DISPERSIÓN VIVE ACÁ Y EN NINGÚN OTRO LADO: el rayo sale tres veces con
    // un índice apenas distinto y cada canal se lee del suyo.
    //
    // Y LA SEPARACIÓN ES CHICA, porque medido con una separación grande esto
    // MIENTE. Con ±2,4 % los tres rayos aterrizaban en partes distintas del
    // cuarto cerca del borde: si el rojo pegaba en la ventana y el azul no,
    // salía ámbar puro — [199,161,64] en un orbe cuyo pigmento es turquesa. Un
    // vidrio real separa cerca del 1 % (número de Abbe ~58), no un 5 %. Y
    // además la franja se mezcla contra la muestra acromática, así que el color
    // es un BORDE y nunca puede pintar la esfera entera.
    vec3 eR = refract(rdi, -backP, 1.0/0.8955);
    vec3 eG = refract(rdi, -backP, 1.0/0.9000);
    vec3 eB = refract(rdi, -backP, 1.0/0.9045);
    if(dot(eR,eR) < 0.0001) eR = reflect(rdi, -backP);
    if(dot(eG,eG) < 0.0001) eG = reflect(rdi, -backP);
    if(dot(eB,eB) < 0.0001) eB = reflect(rdi, -backP);
    vec3 sG = envSample(eG);
    empty = mix(sG, vec3(envSample(eR).r, sG.g, envSample(eB).b), 0.55);
  } else {
    vec3 eG = refract(rdi, -backP, 1.0/0.900);
    if(dot(eG,eG) < 0.0001) eG = reflect(rdi, -backP);
    empty = envSample(eG);
  }
  // El cuarto nuevo trae MUCHA más luz que el degradado que reemplazó (tiene
  // ventana, horizonte y pared), así que la ganancia baja en la misma
  // proporción. Con la vieja, el vidrio vacío salía más brillante que el
  // líquido y el orbe se leía al revés: el aire pesaba más que el agua.
  empty = empty * mix(1.30, 0.78, uDay)
        + mix(uAcc, vec3(1.0), 0.42) * 0.070 * pow(1.0 - ndv, 1.6);

  // El borde es el ACENTO de la capa, y nada más. Intenté sumarle aquí la
  // dispersión otra vez y salió mal, medido: el término era 'sR - sB', o sea la
  // diferencia entre DOS MUESTRAS DEL ENTORNO EN DIRECCIONES DISTINTAS, no una
  // diferencia espectral. Cerca del borde de abajo los dos rayos divergen mucho,
  // así que teñía media esfera de rojo — [149,89,100] donde todo lo demás era
  // azul. La dispersión ya está donde corresponde: en 'empty', un canal por
  // índice. Sumarla dos veces no es más física, es un error de color.
  vec3 rim = uAcc * (fres*0.50 + rimw*0.85);

  vec3 col = body*has + empty*(1.0 - has*0.74) + core*coreA + rim + reflection;
  float alpha = clamp(has*(0.42 + 0.56*clamp(thick*1.25,0.0,1.0)) + coreA*0.90
                      + (1.0 - has)*mix(0.23, 0.12, uDay)
                      + fres*0.30 + rimw*0.62
                      + clamp(schlick*1.15, 0.0, 0.85) + 0.02, 0.0, 1.0);
  if(uDay > 0.5){ col *= 0.88; alpha = clamp(alpha*1.20, 0.0, 1.0); }

  // ── PROFUNDIDAD ENTRE ORBES (F7) ───────────────────────────────────────────
  //
  // El founder dijo que las capas «se pisan»: dos círculos traslúcidos que se
  // cruzan producen una lente más clara con dos bordes duros, y eso no se lee
  // como una esfera pasando delante de otra — se lee como dos calcomanías.
  // La que está detrás recibe perspectiva aérea: pierde contraste y se va hacia
  // el color del cuarto, exactamente como algo que está más lejos. Y la de
  // adelante gana opacidad, así que TAPA en vez de sumarse.
  if(uDepth > 0.001){
    vec3 air = mix(ENV_FLOOR, ENV_FLOOR_DAY, uDay) * 3.0;
    col = mix(col, air, uDepth*0.34);
    col *= 1.0 - uDepth*0.30;
  } else {
    alpha = clamp(alpha * 1.16, 0.0, 1.0);
  }

#ifdef GL_OES_standard_derivatives
  float aa = max(fwidth(r), 0.0015);
#else
  float aa = 0.006;
#endif
  float edge = 1.0 - smoothstep(1.0 - aa*1.3, 1.0 + aa*0.4, r);

  vec3 outCol = tonemap(col*edge + soul);
  float outA = clamp(alpha*edge + soulA + shadow*(1.0-edge), 0.0, 1.0);
  gl_FragColor = vec4(outCol * uPresence, outA * uPresence);
}`;

type Gl = WebGLRenderingContext | WebGL2RenderingContext;
type RenderTier = 1 | 2 | 3;

function compileShader(gl: Gl, type: number, source: string): WebGLShader | null {
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

interface ProgramBundle {
  tier: RenderTier;
  program: WebGLProgram;
  locations: {
    canvas: WebGLUniformLocation | null;
    center: WebGLUniformLocation | null;
    span: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    level: WebGLUniformLocation | null;
    energy: WebGLUniformLocation | null;
    day: WebGLUniformLocation | null;
    material: WebGLUniformLocation | null;
    voice: WebGLUniformLocation | null;
    presence: WebGLUniformLocation | null;
    spin: WebGLUniformLocation | null;
    wave: WebGLUniformLocation | null;
    bob: WebGLUniformLocation | null;
    depth: WebGLUniformLocation | null;
    env: WebGLUniformLocation | null;
    tilt: WebGLUniformLocation | null;
    liquid: WebGLUniformLocation | null;
    deep: WebGLUniformLocation | null;
    accent: WebGLUniformLocation | null;
  };
}

const RENDER_TIERS: readonly RenderTier[] = [1, 2, 3];

function linkTierProgram(
  gl: Gl,
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
  gl.bindAttribLocation(program, 0, "aQuad");
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
      canvas: uniform("uCanvas"),
      center: uniform("uCenter"),
      span: uniform("uSpan"),
      time: uniform("uTime"),
      level: uniform("uLevel"),
      energy: uniform("uEnergy"),
      day: uniform("uDay"),
      material: uniform("uMat"),
      voice: uniform("uVoice"),
      presence: uniform("uPresence"),
      spin: uniform("uSpin"),
      wave: uniform("uWave"),
      bob: uniform("uBob"),
      depth: uniform("uDepth"),
      env: uniform("uEnv"),
      tilt: uniform("uTilt"),
      liquid: uniform("uLiq"),
      deep: uniform("uDeep"),
      accent: uniform("uAcc"),
    },
  };
}

/**
 * §5.1 · «Trabajamos desde lo más alto posible», literal.
 *
 * Hasta N2 el orbe le PEDÍA a la GPU el camino de bajo consumo, sin antialiasing
 * y en WebGL1 — en un iPhone, dejar rendimiento sobre la mesa a propósito. Ahora
 * se pide WebGL2 con alto rendimiento, y WebGL1 queda como degradado honesto:
 * el shader está escrito en GLSL ES 1.00, que compila en los dos, así que la
 * rama de degradado es la MISMA que se ejecuta todos los días y no una segunda
 * versión que nadie probó nunca.
 */
function acquireContext(canvas: HTMLCanvasElement): { gl: Gl; version: 1 | 2 } | null {
  const attributes: WebGLContextAttributes = {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    depth: false,
    powerPreference: "high-performance",
    // N2 §5.1 · Un lienzo pausado no puede quedarse en blanco: cuando la hoja
    // de conversación tapa el orbe el bucle para, y el último cuadro tiene que
    // sobrevivir debajo.
    preserveDrawingBuffer: true,
  };
  const gl2 = canvas.getContext("webgl2", attributes);
  if (gl2) return { gl: gl2, version: 2 };
  const gl1 = canvas.getContext("webgl", attributes);
  if (gl1) return { gl: gl1, version: 1 };
  return null;
}

export function createOrbRenderer(canvas: HTMLCanvasElement): OrbRenderer | null {
  const acquired = acquireContext(canvas);
  if (!acquired) return null;
  const { gl, version } = acquired;
  // Core en WebGL2; en WebGL1 hay que pedirla, y si no está el shader cae a un
  // ancho de borde fijo en vez de mentir con una derivada que no existe.
  if (version === 1) gl.getExtension("OES_standard_derivatives");

  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  if (!vertex) return null;
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
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  let cssWidth = 1;
  let cssHeight = 1;
  let antialias = gl.getContextAttributes()?.antialias === true;
  let disposed = false;

  return {
    resize(nextCssWidth, nextCssHeight, requestedDpr) {
      const dpr = Math.min(Math.max(requestedDpr || 1, 1), 2);
      cssWidth = Math.max(1, nextCssWidth);
      cssHeight = Math.max(1, nextCssHeight);
      const width = Math.max(1, Math.round(cssWidth * dpr));
      const height = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.viewport(0, 0, width, height);
      antialias = gl.getContextAttributes()?.antialias === true;
      return { dpr, width, height, glVersion: version, antialias };
    },
    draw(frame) {
      if (disposed || gl.isContextLost()) return;
      const bundle = programs[frame.tier - 1];
      if (!bundle) return;
      const { locations } = bundle;
      gl.useProgram(bundle.program);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(locations.canvas, cssWidth, cssHeight);
      gl.uniform1f(locations.time, frame.time);
      gl.uniform1f(locations.day, frame.day);
      // Atrás primero: las vecinas quedan DEBAJO de la activa, así que al
      // solaparse durante el gesto la que mirás nunca queda tapada.
      const ordered = [...frame.orbs]
        .filter((orb) => orb.presence > 0.002 && orb.radius > 0.5)
        .sort((a, b) => b.presence - a.presence);
      for (let i = ordered.length - 1; i >= 0; i -= 1) {
        const orb = ordered[i]!;
        gl.uniform2f(locations.center, orb.centerX, orb.centerY);
        gl.uniform1f(locations.span, orb.radius * ORB_SPAN);
        gl.uniform1f(locations.level, orb.waterline);
        gl.uniform1f(locations.energy, orb.energy);
        gl.uniform1f(locations.material, orb.material);
        gl.uniform1f(locations.voice, orb.voice);
        gl.uniform1f(locations.presence, orb.presence);
        gl.uniform1f(locations.spin, orb.spin);
        gl.uniform1f(locations.wave, orb.wave);
        gl.uniform1f(locations.bob, orb.bob);
        gl.uniform1f(locations.depth, orb.depth);
        gl.uniform1f(locations.env, orb.env);
        gl.uniform2f(locations.tilt, orb.tiltX, orb.tiltZ);
        gl.uniform3fv(locations.liquid, orb.liquid);
        gl.uniform3fv(locations.deep, orb.deep);
        gl.uniform3fv(locations.accent, orb.accent);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gl.deleteBuffer(buffer);
      for (const compiled of programs) gl.deleteProgram(compiled.program);
    },
  };
}
