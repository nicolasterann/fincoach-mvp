import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Bloque N3 · Mutación con dientes — y el CABLE además de la conducta.
//
// La lección que costó tres niveles en este bloque: una función pura sujeta no
// alcanza si el argumento o la llamada se pueden cortar. Por eso cada defecto de
// abajo viene en dos sabores cuando aplica: romper LO QUE HACE, y cortar EL
// CABLE que lo conecta con lo que se ve.
//
// La vara es que la mutación mate una aserción POR SU NOMBRE. Que se caiga el
// build no prueba nada: prueba que el código no compila, no que alguien estaba
// mirando.

const TOTAL = 891;
const runner = ["scripts/qa/run-capture-gate.mjs"];

const CONTRACT = "src/app/app/components/shell/shell-orb-contract.ts";
const SHADER = "src/app/app/components/shell/orb-shader.ts";
const LIVE = "src/app/app/components/shell/LiveOrb.tsx";
const SHELL = "src/app/app/components/shell/SantuarioShell.tsx";
const TILT = "src/app/app/components/shell/useDeviceTilt.ts";
const CSS = "src/app/globals.css";
const SIM = "src/app/app/components/shell/orb-water-sim.ts";
const SPECIMEN = "src/app/app/components/shell/OrbSpecimen.tsx";
const PAYLOAD = "src/app/app/components/shell/shell-payload.ts";
const SAVE_ACTIONS = "src/app/onboarding/save-actions.ts";
const NOISE = "src/app/app/components/shell/orb-noise-texture.ts";
const REFERENCE = "src/app/app/components/shell/orb-reference-shader.ts";
const FLUID = "src/app/app/components/shell/orb-fluid.ts";

const mutations = [
  // ── N3B · el vidrio y el agua ────────────────────────────────────────────
  //
  // La vara sube en esta etapa por un motivo concreto: el defecto que el founder
  // vio —«se ve demasiado lleno»— sobrevivió a TODO el gate de N3. Pasaba porque
  // los pines miraban la constante del trazo, y lo que el ojo lee no es el trazo
  // sino la ALTURA VISIBLE, que sale de proyectar una elipse. Estas mutaciones
  // reponen ese defecto exacto y exigen que ahora sí muera con nombre.
  {
    name: "N3-1",
    result: "vuelve el CHARCO de N3: el piso del vaso al 7 % dibuja un cuarto de vaso",
    file: CONTRACT,
    from: "export const ORB_WATERLINE_FLOOR = 0.02;",
    to: "export const ORB_WATERLINE_FLOOR = 0.07;",
  },
  {
    name: "N3-1",
    result: "la proyección miente: el alto visible deja de seguir a la cámara",
    file: CONTRACT,
    from: "export const ORB_CAM_PITCH = -0.11;",
    to: "export const ORB_CAM_PITCH = 0;",
  },
  {
    name: "N3B-1",
    result: "el agua pierde la amortiguación: oscila para siempre y nunca se aquieta",
    file: SIM,
    from: "export const SLOSH_ZETA = 0.15;",
    to: "export const SLOSH_ZETA = 0;",
  },
  {
    name: "N3B-1",
    result: "el agua deja de tener masa: llega al ángulo sin pasarse, como una aguja",
    file: SIM,
    from: "export const SLOSH_ZETA = 0.15;",
    to: "export const SLOSH_ZETA = 1.4;",
  },
  {
    name: "N3B-1",
    result: "la ola vuelve a correr con el reloj: un agua quieta deja de ser un espejo",
    file: SIM,
    from: "  return Math.min(1, swirl * 0.42 + piston * 0.30);",
    to: "  return Math.min(1, 0.5 + swirl * 0.42 + piston * 0.30);",
  },
  {
    name: "N3B-1",
    result:
      "CABLE · el giroscopio vuelve a entrar CRUDO al shader, que es el defecto que N3 tenía escrito en una línea",
    file: LIVE,
    from: "          tiltX: water.tiltX,",
    to: "          tiltX: gyro.x,",
  },
  {
    name: "N3B-1",
    result: "CABLE · el shader recibe la ola y NO la usa: la amplitud vuelve a ser fija",
    file: SHADER,
    from: "  return WAVE_AMP * (0.17 + uWave*2.9 + uEnergy*1.5);",
    to: "  return WAVE_AMP * (1.0 + uEnergy*1.5);",
  },
  {
    name: "N3B-2",
    result: "la GOTA vuelve a perderse: un cero leído se dibuja con la materia de su capa",
    file: CONTRACT,
    from: "  if (input.fill === \"gota\") return ORB_MATERIAL_GOTA;",
    to: "  if (input.fill === \"gota\") return ORB_MATERIAL[input.kind];",
  },
  {
    name: "N3B-2",
    result: "CABLE · la probeta vuelve a traer su propia copia de la tabla de materias",
    file: SPECIMEN,
    from: "          material: orbPresentationMaterial({ kind, matter, fill }),",
    to: "          material: matter === \"cristal\" ? 3 : 0,",
  },
  {
    name: "N3B-3",
    result: "se quita el tope del radio: vuelven a pisarse con el radio que pide el santuario",
    file: CONTRACT,
    from: "  const radius = Math.min(geometry.radius, orbMaxRadius(geometry.trackWidth));",
    to: "  const radius = geometry.radius;",
  },
  {
    name: "N3B-3",
    result: "sin perspectiva: las vecinas vuelven al mismo plano y se intersecan",
    file: CONTRACT,
    from: "      depth: smoothstep(0, ORB_TRAVEL, Math.abs(offset)),",
    to: "      depth: 0,",
  },
  {
    name: "N3B-3",
    result: "CABLE · la colocación calcula la profundidad y el lienzo no la manda",
    file: LIVE,
    from: "          depth: slot.depth,",
    to: "          depth: 0,",
  },
  {
    name: "N3B-4",
    result:
      "Kipu INVENTA un techo de patrimonio cuando el usuario no lo declaró — la doctrina que no se relaja",
    file: CONTRACT,
    from: `export function wealthTargetFrom(input: {
  prefsError: boolean;
  raw: unknown;
}): number | null {
  if (input.prefsError) return null;
  if (input.raw == null) return null;`,
    to: `export function wealthTargetFrom(input: {
  prefsError: boolean;
  raw: unknown;
}): number | null {
  if (input.prefsError) return null;
  if (input.raw == null) return 100_000;`,
  },
  {
    name: "N3B-4",
    result: "CABLE · el nivel de Patrimonio se calcula y el orbe lo tira: nada se ve en pantalla",
    file: PAYLOAD,
    from: "      level: patrimonioNivel.level,",
    to: "      level: null,",
  },
  {
    name: "N3B-4",
    result: "CABLE · el onboarding deja de guardar el techo que el usuario acaba de escribir",
    file: SAVE_ACTIONS,
    from: "    prefsPatch.emergency_reserve_target = draft.profile.emergencyReserveTarget;",
    to: "    void draft.profile.emergencyReserveTarget;",
  },
  {
    name: "N3-1",
    result: "el lleno vuelve a tocar el borde: sin aire arriba, el menisco desaparece",
    file: CONTRACT,
    from: "export const ORB_WATERLINE_CEILING = 0.70;",
    to: "export const ORB_WATERLINE_CEILING = 1;",
  },
  {
    name: "N3-1",
    result: "el trazo se aplana contra el tope y los valores del medio dejan de distinguirse",
    file: CONTRACT,
    from: "  return ORB_WATERLINE_FLOOR * (1 - bounded) + ORB_WATERLINE_CEILING * bounded;",
    to: "  return ORB_WATERLINE_FLOOR * (1 - bounded) + ORB_WATERLINE_CEILING * Math.min(1, bounded * 4);",
  },
  {
    name: "N3-1",
    result: "CABLE · el payload acota el DATO con el mapeo de dibujo",
    file: "src/app/app/components/shell/shell-payload.ts",
    from: "  const orbs: ShellOrb[] = [",
    to: "  void orbWaterline;\n  const orbs: ShellOrb[] = [",
    also: {
      from: '} from "./shell-orb-contract";',
      to: '  orbWaterline,\n} from "./shell-orb-contract";',
    },
  },
  {
    name: "N3-2",
    result: "las vecinas se apagan de golpe: la salida deja de ser movimiento",
    file: CONTRACT,
    from: "      presence: 1 - smoothstep(ORB_PRESENCE_NEAR, ORB_PRESENCE_FAR, Math.abs(offset)),",
    to: "      presence: Math.abs(offset) < ORB_PRESENCE_FAR ? 1 : 0,",
  },
  {
    name: "N3-2",
    result: "la vecina se muestra DEGRADADA durante el gesto en vez de entera",
    file: CONTRACT,
    from: "export const ORB_PRESENCE_NEAR = 0.34;",
    to: "export const ORB_PRESENCE_NEAR = 0.02;",
  },
  {
    name: "N3-3",
    result: "CABLE · la capa activa se vuelve a derivar a mano y puede separarse del lienzo",
    file: SHELL,
    from: `    const observed = orbActiveIndex({
      count: payload.orbs.length,
      position: track.scrollLeft / track.clientWidth,
    });`,
    to: `    const observed = Math.max(
      0,
      Math.min(payload.orbs.length - 1, Math.round(track.scrollLeft / track.clientWidth)),
    );`,
  },
  {
    name: "N3-3",
    result: "el snap nativo se va y hay que reponer inercia, snap y accesibilidad a mano",
    file: CSS,
    from: "  scroll-snap-type: x mandatory;",
    to: "  scroll-snap-type: none;",
  },
  {
    name: "N3-4",
    result: "el lienzo dibuja agua donde el motor NO PUDO LEER",
    file: LIVE,
    from: '        if (orb.fill === "sin-dato") continue;',
    to: '        if (orb.fill === "sin-dato" && false) continue;',
  },
  {
    name: "N3-4",
    result: "el cristal recupera su línea de agua: un nivel que el motor no afirma",
    file: SHADER,
    from: "  surfaceSeen *= 1.0 - crystal;",
    to: "  surfaceSeen *= 1.0;",
  },
  {
    name: "N3-4",
    result: "CABLE · el DOM deja de apagarse y vuelven a existir dos orbes del mismo objeto",
    file: CSS,
    from: '  .kipu-shell-orb:not([data-orb-fill="sin-dato"]) { opacity: 0; }',
    to: '  .kipu-shell-orb[data-active="true"] { opacity: 0; }',
  },
  {
    name: "N3-5",
    result: "el orbe vuelve a pedirle a la GPU el camino de bajo consumo",
    file: SHADER,
    from: '    powerPreference: "high-performance",',
    to: '    powerPreference: "low-power",',
  },
  {
    name: "N3-5",
    result: "se deja de intentar WebGL2 y el degradado pasa a ser el único camino",
    file: SHADER,
    from: '  const gl2 = canvas.getContext("webgl2", attributes);',
    to: "  const gl2 = null;",
  },
  {
    name: "N3-6",
    result: "CABLE · el permiso deja de colgar del gesto y iOS no lo concede nunca",
    file: SHELL,
    from: "      onPointerDown={deviceTilt.armFromUserGesture}",
    to: "",
  },
  {
    name: "N3-6",
    result: "un rechazo de transporte se guarda como denegado y cierra la puerta para siempre",
    file: TILT,
    from: "        armed.current = false;",
    to: '        store("denied");',
  },
  {
    name: "N3-6",
    result: "el oleaje pasa a DEPENDER del giroscopio: sin permiso el agua se muere",
    file: SHADER,
    from: "const float WAVE_AMP = 0.026;",
    to: "const float WAVE_AMP_BASE = 0.026;\n#define WAVE_AMP (WAVE_AMP_BASE * length(uTilt))",
  },
  // ── N3C · el orbe de ElevenLabs, con nuestro líquido ──────────────────────
  //
  // La etapa adopta el look de un tercero, y eso trae una familia de defectos
  // que NO se ven mirando la pantalla: una textura descargada de un CDN ajeno
  // funciona perfecto en el escritorio del que la escribe y se cae en el avión;
  // un aviso de licencia borrado no cambia un píxel; una onda que está en la
  // altura pero no en la normal se ve casi igual y no es una onda. Todo eso se
  // repone acá y tiene que morir con nombre.
  {
    name: "N3C-1",
    result: "la tela del campo se aplana: los siete óvalos salen del mismo tamaño y el campo pierde su variedad",
    file: NOISE,
    from: "  return Math.min(1, Math.max(0, value * 0.5 + 0.5));",
    to: "  return 0.5;",
  },
  {
    name: "N3C-1",
    result: "CABLE · el shader deja de leer la tela que fabrica la función pura y lee un gris que nadie puede auditar",
    file: SHADER,
    from: "    orbNoiseTexture(ORB_NOISE_SIZE, ORB_NOISE_SEED),",
    to: "    new Uint8Array(ORB_NOISE_SIZE * ORB_NOISE_SIZE).fill(128),",
  },
  {
    name: "N3C-1",
    result: "la tela deja de repetirse: aparece una costura recorriendo el orbe en cada vuelta del flujo",
    file: SHADER,
    from: "  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);",
    to: "  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);",
  },
  {
    name: "N3C-2",
    result: "se borra el aviso de copyright MIT del porte fiel — no cambia un píxel, y es una infracción",
    file: REFERENCE,
    from: "//   MIT License · Copyright (c) 2025 ElevenLabs",
    to: "//   (porte del componente de orbe)",
  },
  {
    name: "N3C-3",
    result: "vuelve el pecado del 'sheen' de N3B: la onda vive en la ALTURA y no en la NORMAL, así que no refleja distinto",
    file: SHADER,
    from: "  float rho = max(length(p.xz), 0.0004);\n  g += (p.xz / rho) * WAVE_AMP * VOICE_AMP * uVoice * VOICE_FREQ\n     * cos(rho * VOICE_FREQ - uTime * VOICE_SPEED);\n",
    to: "",
  },
  {
    name: "N3C-3",
    result: "la onda deja de ser de la VOZ: el agua ondula igual estando callada, que es la textura animada que N3B mató",
    file: SHADER,
    from: "  w += WAVE_AMP * VOICE_AMP * uVoice",
    to: "  w += WAVE_AMP * VOICE_AMP * (0.35 + uVoice)",
  },
  {
    name: "N3C-4",
    result: "el reloj del campo corre siempre igual: el orbe deja de acelerar cuando hablás",
    file: SIM,
    from: "  return 1.55 + (1 - Math.pow(bounded - 1, 2)) * 2.60;",
    to: "  return 1.05;",
  },
  {
    name: "N3C-4",
    result: "CABLE · el orbe vivo acumula el reloj y no se lo pasa al lienzo: el campo queda congelado en producción",
    file: LIVE,
    from: "          field: fieldClock,",
    to: "          field: 0,",
  },
  {
    name: "N3C-5",
    result: "vuelve el horizonte duro de N3B: el vidrio refleja otra vez una línea reconocible",
    file: SHADER,
    from: "                  smoothstep(-0.85, 0.85, h));",
    to: "                  smoothstep(-0.012, 0.012, h));",
  },
  {
    name: "N3C-5",
    result: "el campo se va del líquido y el agua vuelve a ser pigmento: la etapa entera queda sin efecto",
    file: SHADER,
    from: "  vec3 body = mix(gField, uDeep * 0.28, (1.0 - uEnv))",
    to: "  vec3 body = mix(uLiq * 0.9, uDeep * 0.28, (1.0 - uEnv))",
  },
  {
    name: "N3C-6",
    result: "el porte fiel deja de inyectarse y la mesa de luz compara nuestro orbe contra sí mismo — el instrumento que miente",
    file: SPECIMEN,
    from: "      referenceFragmentSource: ORB_REFERENCE_FRAGMENT_SOURCE,",
    to: "      referenceFragmentSource: undefined,",
  },
  {
    name: "N3C-6",
    result: "el programa de referencia deja de depender de la inyección: el santuario compilaría un shader que nadie usa",
    file: SHADER,
    from: "  if (options.referenceFragmentSource) {",
    to: "  if (options.referenceFragmentSource !== null) {",
  },
  {
    name: "N3B-2",
    result: "RE-ANCLADO · el tercer dibujante de la probeta deja de pedir la materia a la función pura y se la inventa",
    file: SPECIMEN,
    from: "            material: orbPresentationMaterial({\n              kind: slot.kind,\n              matter: orbMatter(slot.kind),\n              fill: slot.fill ?? \"nivel\",\n            }),",
    to: "            material: slot.fill === \"gota\" ? 5 : 0,",
  },
  // ── N3C ronda 2 · lo que el founder vio en producción ─────────────────────
  //
  // Dos defectos que el gate de la ronda 1 no sólo dejó pasar: uno de ellos lo
  // estaba SUJETANDO en su sitio. El pin de N3-4 exigía que «sin techo» pidiera
  // el código de la capa Patrimonio — que es exactamente la colisión que dejaba
  // a Patrimonio sin poder dibujar líquido. Trampa 9 del spec, literal.
  {
    name: "N3-4",
    result:
      "vuelve la COLISIÓN: el cristal le pide prestado el número a la capa Patrimonio, y Patrimonio no puede dibujar líquido ni con techo declarado",
    file: CONTRACT,
    from: "    return ORB_MATERIAL_CRISTAL;",
    to: "    return ORB_MATERIAL.patrimonio;",
  },
  {
    name: "N3-4",
    result: "el shader vuelve a leer el número de una CAPA como cristal, que es la otra mitad de la misma colisión",
    file: SHADER,
    from: "  float crystal = step(5.5, uMat);",
    to: "  float crystal = step(2.5, uMat) * step(uMat, 3.5);",
  },
  {
    name: "N3-4",
    result: "la gota pierde su tope y se traga al cristal: un orbe sin techo se dibuja como una gota en el fondo",
    file: SHADER,
    from: "float isDrop(){ return step(4.5, uMat) * step(uMat, 5.5); }",
    to: "float isDrop(){ return step(4.5, uMat); }",
  },
  {
    name: "N3C-5",
    result:
      "muere la deformación de dominio: el campo vuelve a ser manchas redondas, que es lo que hace que NO se parezca al de ellos",
    file: SHADER,
    from: "  float f = fieldFbm(p + amount*(q - 0.5) + vec2(1.7, 9.2));",
    to: "  float f = fieldFbm(p + vec2(1.7, 9.2));",
  },
  {
    name: "N3C-5",
    result: "CABLE · el grano se calcula y no se suma: el campo pierde lo que más lo hace parecer material",
    file: SHADER,
    from: "    gField += fieldGrain(fq) * (0.030 + 0.012*uDay) * uEnv;",
    to: "",
  },
  // ── N3C ronda 3 · lo que el founder vio en el teléfono ────────────────────
  {
    name: "N3C-4",
    result:
      "vuelve el campo CASI QUIETO: la razón entre hablar y callar se conserva, pero una mancha tarda 45 s en cruzar — que es lo que se veía",
    file: SIM,
    from: "  return 1.55 + (1 - Math.pow(bounded - 1, 2)) * 2.60;",
    to: "  return 0.1 + (1 - Math.pow(bounded - 1, 2)) * 0.9;",
  },
  {
    name: "N3C-3",
    result: "vuelve la SEGUNDA línea de agua: se dibuja también el borde cercano de la elipse y aparecen dos arcos paralelos",
    file: SHADER,
    from: "  ring *= (1.0 + uVoice * ringNoise * 2.2) * ringFar;",
    to: "  ring *= (1.0 + uVoice * ringNoise * 2.2);",
  },
  {
    name: "N3C-5",
    result:
      "se va el muestreo quintico y vuelve la REJILLA: la tela se magnifica 5x y el filtrado bilineal dibuja los bordes de las celdas — las «manchas duras»",
    file: SHADER,
    from: "  f = f*f*f*(f*(f*6.0-15.0)+10.0);\n  return texture2D(uPerlin, (i + f - 0.5) / FIELD_TEX).r;",
    to: "  return texture2D(uPerlin, (i + f - 0.5) / FIELD_TEX).r;",
  },
  {
    name: "N3C-5",
    result: "muere el segundo campo: el color vuelve a moverse en un solo eje y las capas se leen como brillo, no como colores que se funden",
    file: SHADER,
    from: "  vec3 mid = mix(uLiq, uAcc, hue);",
    to: "  vec3 mid = uLiq;",
  },
  {
    name: "N3-1",
    result: "la cámara vuelve a mirar el agua desde arriba y con poca agua se dibuja un CUENCO en vez de una superficie plana",
    file: CONTRACT,
    from: "export const ORB_CAM_PITCH = -0.11;",
    to: "export const ORB_CAM_PITCH = -0.3;",
  },
  // ── N3C ronda 4 · el experimento del campo lleno ──────────────────────────
  {
    name: "N3C-7",
    result:
      "un cero LEIDO se dibuja como un orbe lleno y luminoso — que no es una decision estetica sino una afirmacion falsa sobre plata",
    file: CONTRACT,
    from: "  if (decided === ORB_MATERIAL_GOTA) return decided;",
    to: "",
  },
  {
    name: "N3C-7",
    result: "el experimento deja de delegar en la doctrina y la reemplaza: apagarlo ya no devolveria las materias correctas",
    file: CONTRACT,
    from: "  const decided = orbMaterialCode(input);",
    to: "  const decided = ORB_MATERIAL_CRISTAL;",
  },
  // ── N3C ronda 5 · el movimiento deja de ser transporte ────────────────────
  {
    name: "N3C-5",
    result:
      "vuelve el TRANSPORTE: el campo gira, y con rasgos seguibles cualquier giro se lee como «una capa que pasa» — el founder lo dijo con giro y con traslacion",
    file: SHADER,
    from: "  vec2 q = vec2(fieldFbm(p + vec2(anim*0.085, anim*0.052)),",
    to: "  float a_=anim*0.16, c_=cos(a_), s_=sin(a_); p = vec2(c_*p.x - s_*p.y, s_*p.x + c_*p.y);\n  vec2 q = vec2(fieldFbm(p + vec2(anim*0.085, anim*0.052)),",
  },
  // ── N3C ronda 6 · el fluido ───────────────────────────────────────────────
  {
    name: "N3C-8",
    result:
      "el fluido se queda sin empuje de fondo: en silencio se aquieta y no vuelve solo — «el nuestro es mucho mas estatico», otra vez",
    file: FLUID,
    from: "export const ORB_FLUID_AMBIENT_FORCE = 5.5;",
    to: "export const ORB_FLUID_AMBIENT_FORCE = 0;",
  },
  {
    name: "N3C-8",
    result: "la voz deja de empujar el fluido: el orbe se mueve igual hablando que callado",
    file: FLUID,
    from: "export const ORB_FLUID_VOICE_FORCE = 3.2;",
    to: "export const ORB_FLUID_VOICE_FORCE = 0.1;",
  },
  {
    name: "N3C-8",
    result:
      "la fuerza pasa a depender del CUADRO: un telefono de 120 Hz revuelve el fluido al doble que uno de 60",
    file: FLUID,
    from: "  const dt = Math.min(1 / 30, Math.max(1 / 240, finite(input.dtSeconds, 1 / 60)));",
    to: "  const dt = 1 / 60;",
  },
  {
    name: "N3C-8",
    result: "el fluido no se disipa: el empuje se acumula para siempre y el orbe termina hirviendo",
    file: FLUID,
    from: "export const ORB_FLUID_VELOCITY_DISSIPATION = 0.055;",
    to: "export const ORB_FLUID_VELOCITY_DISSIPATION = 0;",
  },
  {
    name: "N3C-8",
    result:
      "CABLE · el orbe vivo deja de pasarle la voz al fluido: el santuario nunca responde al hablar aunque el solver corra",
    file: LIVE,
    from: "        voice: animatedVoice,\n        wave: waveEnergy,",
    to: "        voice: 0,\n        wave: 0,",
  },
  {
    name: "N3C-5",
    result: "el shader deja de leer el fluido y vuelve al ruido aunque el solver este corriendo",
    file: SHADER,
    from: "  if(uHasFluid > 0.5) q += gFlow * 0.55;",
    to: "  if(uHasFluid > 0.5) q += gFlow * 0.0;",
  },
  {
    name: "N3C-5",
    result:
      "vuelve el RECORTE duro del rastro: pasado el tope el desplazamiento es constante y el campo se traba — el «patron trabado» que el founder vio tres veces",
    file: SHADER,
    from: "      gFlow = fw / (1.0 + abs(fw) * 0.72);",
    to: "      gFlow = clamp(fw, -1.35, 1.35);",
  },
  {
    name: "N3C-5",
    result: "muere el paso de saturacion: el mapeo tonal desatura y el color pasa de 0,91 a 0,50 — la mitad del de ellos",
    file: SHADER,
    from: "), 1.42) * uEnv;",
    to: "), 1.0) * uEnv;",
  },
  {
    name: "N3C-8",
    result:
      "vuelve el error de UNIDADES: la velocidad se inyecta en decimas y la adveccion la divide por 7680, asi que el fluido queda congelado",
    file: FLUID,
    from: "export const ORB_FLUID_GRID = 190;",
    to: "export const ORB_FLUID_GRID = 1;",
  },
  {
    name: "N3C-8",
    result:
      "la salpicadura se pasa del tope del solver: el recorte a ±1000 deja un salto duro donde empuja y la adveccion muestrea fuera del dominio — las rayas que el founder vio en produccion",
    file: FLUID,
    from: "export const ORB_FLUID_GRID = 190;",
    to: "export const ORB_FLUID_GRID = 5200;",
  },
  {
    name: "N3C-5",
    result: "el fluido vuelve a SUSTITUIR el desplazamiento propio en vez de sumarle: el movimiento de fondo queda atado a la simulacion",
    file: SHADER,
    from: "  if(uHasFluid > 0.5) q += vec2(-gFlow.y, gFlow.x) * 0.42;",
    to: "  if(uHasFluid > 0.5) q += vec2(-gFlow.y, gFlow.x) * 0.0;",
  },
];

function runGate() {
  const run = spawnSync(process.execPath, runner, { encoding: "utf8" });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

const baseline = runGate();
if (baseline.status !== 0 || !baseline.output.includes(`${TOTAL}/${TOTAL} capture checks`)) {
  process.stderr.write(`FAIL · N3 mutation baseline is not ${TOTAL}/${TOTAL}\n`);
  process.stderr.write(baseline.output);
  process.exit(1);
}
process.stdout.write(`línea base: ${TOTAL}/${TOTAL} capture checks\n`);

for (const mutation of mutations) {
  const touched = [mutation.file, ...(mutation.also ? [mutation.file] : [])];
  const original = readFileSync(mutation.file, "utf8");
  if (original.split(mutation.from).length !== 2) {
    process.stderr.write(`FAIL · ${mutation.name} anchor count is not one (${mutation.file})\n`);
    process.exitCode = 1;
    break;
  }
  try {
    let mutated = original.replace(mutation.from, mutation.to);
    if (mutation.also) {
      if (mutated.split(mutation.also.from).length !== 2) {
        process.stderr.write(`FAIL · ${mutation.name} secondary anchor is not one\n`);
        process.exitCode = 1;
        break;
      }
      mutated = mutated.replace(mutation.also.from, mutation.also.to);
    }
    writeFileSync(mutation.file, mutated);
    const killed = runGate();
    const namedFailure = killed.output.includes(`✗ ${mutation.name} ·`);
    if (killed.status === 0 || !namedFailure) {
      process.stderr.write(
        `FAIL · ${mutation.name} sobrevivió o murió sin su nombre — ${mutation.result}\n`,
      );
      process.stderr.write(killed.output);
      process.exitCode = 1;
      break;
    }
    const count = killed.output.match(/(\d+)\/(\d+) capture checks/u);
    process.stdout.write(
      `${mutation.name}: ${mutation.result} (${count ? count[0] : "sin conteo"})\n`,
    );
  } finally {
    writeFileSync(mutation.file, original);
    void touched;
  }
}

if (!process.exitCode) {
  const restored = runGate();
  if (restored.status !== 0 || !restored.output.includes(`${TOTAL}/${TOTAL} capture checks`)) {
    process.stderr.write(`FAIL · restoration did not return to ${TOTAL}/${TOTAL}\n`);
    process.stderr.write(restored.output);
    process.exit(1);
  }
  process.stdout.write(`restauración: ${TOTAL}/${TOTAL} capture checks\n`);
}
