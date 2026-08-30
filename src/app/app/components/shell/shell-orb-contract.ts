// Bloque N2 — el orbe, en lógica pura.
//
// Deliberadamente SIN `import "server-only"`: el gate headless tiene que poder
// EJECUTAR esto (lección M3 O1, y el patrón que ya usan `state-contract.ts` y
// `cintaState`). Aquí no hay efectos ni lecturas: sólo la decisión de qué nivel
// y qué materia le corresponden a cada capa con lo que el motor ya afirmó.
//
// LA DOCTRINA QUE SALE DE N2, y que N3–N7 heredan:
//
//   Si el motor no puede afirmar un nivel, se cambia la MATERIA —
//   no se apaga el orbe.
//
// Es la corrección de un error mío de M1. Entonces ordené que «un orbe no puede
// afirmar un hecho que el motor no afirma» y concluí mal: preferí el vacío a la
// mentira, y **el vacío también comunica algo falso**. Un usuario con 4.311$ de
// respaldo veía una bola de vidrio hueca y concluía que no tenía nada, o que la
// app estaba rota. Sin nivel no se apaga el agua: se cambia por otra materia
// que sí sea verdad.

import { cardStatementSettled } from "@/lib/financial/card-cycle";

export type OrbKind = "saldo" | "reserva" | "metas" | "patrimonio" | "deuda";

/** La naturaleza de la capa, no su estado de hoy. */
export type OrbMatter = "liquido" | "cristal";

/**
 * Qué dibuja el vidrio HOY.
 *  · `nivel`    — hay denominador: agua hasta su altura.
 *  · `gota`     — LEÍ y da cero: una gota y su menisco en el fondo. El vacío
 *                 deliberado del §5.4, idea del founder.
 *  · `nucleo`   — hay materia pero no hay techo honesto: núcleo suspendido.
 *                 Patrimonio siempre; cualquier capa sin denominador, mientras
 *                 no lo tenga.
 *  · `sin-dato` — no se pudo leer. NO es un estado del orbe: lo dibuja
 *                 `KipuNoData`, y por eso jamás puede parecerse a `gota`.
 */
export type OrbFill = "nivel" | "gota" | "nucleo" | "sin-dato";

export interface OrbLevelReading {
  /** 0–1 para el agua, o `null` si el motor no puede afirmar una altura. */
  level: number | null;
  /** La frase con su denominador declarado. Un porcentaje sin denominador es
   * un defecto (doctrina de M6). */
  note: string | null;
}

export const ORB_KINDS: readonly OrbKind[] = [
  "saldo",
  "reserva",
  "metas",
  "patrimonio",
  "deuda",
] as const;

const NO_LEVEL: OrbLevelReading = { level: null, note: null };

/** Cero de dinero: por debajo de medio centavo no hay nada que dibujar. */
const ZERO = 0.005;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function percent(ratio: number): number {
  return Math.round(ratio * 100);
}

/**
 * N3B · SE REVIERTE D-N2 — decisión del founder, textual:
 *
 *   «Confirmo que tenemos que usar las metas para que reservas y patrimonio
 *   tengan tope, lo podemos preguntar siempre en el onboarding y sino también
 *   se pueden preguntar y establecer por chat.»
 *
 * N2 había decidido que Patrimonio no lleva nivel «porque el patrimonio total
 * no tiene techo honesto». Era verdad a medias: no tiene un techo que Kipu
 * pueda *deducir*, pero sí puede tener uno que el usuario **declare** — y eso
 * es lo que `wealth_target` guarda desde antes de este bloque.
 *
 * Así que el cristal deja de ser una NATURALEZA y pasa a ser un ESTADO. Las
 * cinco capas son líquidas por naturaleza; el cristal aparece cuando falta el
 * techo, en cualquiera de las cinco, y desaparece en cuanto el techo se
 * declara. Es la doctrina de N2 aplicada más a fondo que en N2: la materia
 * sigue al conocimiento, no a la etiqueta de la capa.
 *
 * Quién dibuja qué no cambia de manos: `orbFill` devuelve `nucleo` cuando hay
 * materia sin techo, y `orbMaterialCode` lo convierte en cristal.
 */
export function orbMatter(kind: OrbKind): OrbMatter {
  // Las cinco son líquidas por naturaleza. `kind` sigue en la firma porque la
  // frontera es esta función: si mañana una capa volviera a tener materia
  // propia, se decide ACÁ y no en la superficie que dibuja.
  void kind;
  return "liquido";
}

/**
 * Ya no hay capa que rechace un nivel por ser quien es: lo que decide es si hay
 * un techo declarado, y eso lo mira `orbFill`.
 */
export function orbAcceptsLevel(kind: OrbKind): boolean {
  return orbMatter(kind) === "liquido";
}

/**
 * N2 ronda 2 (O1) · La MATERIA se decide con la afirmación del motor, no
 * adivinando el significado de un `null`.
 *
 * El defecto que esto arregla se veía en pantalla, sin mutar nada, en el día
 * uno: `metasAmount` usaba `null` para dos cosas opuestas —«no hay ninguna meta»
 * y «no pude leer»— y `orbFill` no podía distinguirlas, así que dibujaba el
 * anillo fantasma de `sin-dato` MIENTRAS el texto invitaba a crear la primera
 * meta. La materia contradecía al texto, y la materia equivocada era justo la
 * que significa «algo está roto».
 *
 * Ahora `readOk` es un argumento explícito. Con `readOk: true` un monto ausente
 * ES un cero leído —gota—, porque el motor ya afirmó que miró.
 */
export function orbFill(input: {
  kind: OrbKind;
  amount: number | null | undefined;
  level: number | null | undefined;
  /** El veredicto de LECTURA del motor. `false` es «no sé», no «no hay». */
  readOk: boolean;
}): OrbFill {
  if (!input.readOk) return "sin-dato";
  if (input.amount == null || !Number.isFinite(input.amount)) return "gota";
  if (Math.abs(input.amount) <= ZERO) return "gota";
  if (input.level != null && Number.isFinite(input.level)) return "nivel";
  return "nucleo";
}

/** Lo que una capa afirma: si se pudo leer, y cuánto. */
export interface OrbLayerRead {
  /** `false` = no se pudo leer. Distinto de `amount: null` con `ok: true`. */
  ok: boolean;
  amount: number | null;
}

/**
 * Saldo, Reserva y Deuda · Llegar hasta aquí **ES** el veredicto: el briefing
 * lanza `KipuSaldoUnavailableError` cuando no puede afirmar el saldo, y esa rama
 * devuelve niebla mucho antes de que se arme un orbe. Existe como función —y no
 * como un `true` escrito a mano en la superficie— para que ninguna capa pueda
 * declarar su lectura con un literal: el gate exige que las cinco salgan de aquí.
 */
export function briefedRead(amount: number): OrbLayerRead {
  return { ok: true, amount };
}

/**
 * Metas · `ctx.assetsAvailable` es el veredicto de lectura de metas y activos —
 * el MISMO con el que el payload elige entre invitar y disculparse. Con él en
 * `false`, la ausencia de metas es «no sé»; con él en `true`, es un cero leído.
 */
export function metasRead(input: {
  /** Suma de las capas reservadas, o `null` si no hay ninguna capa. */
  reservedTotal: number | null | undefined;
  /** ¿Existe alguna meta, activo o partida protegida? */
  hasEntity: boolean;
  assetsAvailable: boolean;
}): OrbLayerRead {
  if (input.reservedTotal != null && Number.isFinite(input.reservedTotal)) {
    return { ok: true, amount: input.reservedTotal };
  }
  if (input.hasEntity || input.assetsAvailable) return { ok: true, amount: 0 };
  return { ok: false, amount: null };
}

/**
 * Patrimonio · `briefing.goalsIntel.wealthAvailable` es su veredicto de lectura,
 * y el motor lo dice con todas las letras en `coaching-signals.ts`: «con false,
 * netWorth null es "no pude leer" y ningún tool afirma ausencia». Con él en
 * `true`, un patrimonio ausente vale cero — que es lo que el propio motor
 * escribe en su foto diaria (`netWorth?.totalNetWorth ?? 0`).
 */
export function patrimonioRead(input: {
  netWorth: number | null | undefined;
  wealthAvailable: boolean;
}): OrbLayerRead {
  if (!input.wealthAvailable) return { ok: false, amount: null };
  const value = input.netWorth;
  return {
    ok: true,
    amount: value != null && Number.isFinite(value) ? value : 0,
  };
}

// ── Los tres denominadores (N2 §5.3, decisión D-N2 del founder) ─────────────
// Los tres YA ESTÁN CALCULADOS por el motor. N2 los MUESTRA; no los inventa ni
// los recalcula, y no agrega una sola lectura a la base.

// ── O2 · Las DERIVACIONES, también puras y ejecutables ─────────────────────
//
// N1 dejó dicho el patrón y N2 lo pagó a medias: la función pura estaba sujeta,
// pero **los argumentos que se le pasan no**. Un `reserveTarget = 1000` cableado
// a mano, o un `statementCovered: true` literal, pasaban el gate — y son
// denominadores de DINERO: el segundo fabrica cobertura de deuda, que es la
// clase exacta de defecto que el Bloque J pagó con diez migraciones.
//
// Ahora el eslabón de arriba también vive aquí, así que el gate lo ejecuta y no
// queda dónde escribir un literal sin que la llamada desaparezca.

/**
 * La meta de respaldo declarada. Dos ausencias distintas colapsan al mismo
 * resultado —sin denominador— pero por motivos distintos, y ninguno de los dos
 * se rellena con un número: no se pudo leer la fila, o el usuario no la declaró.
 */
export function reserveTargetFrom(input: {
  prefsError: boolean;
  raw: unknown;
}): number | null {
  if (input.prefsError) return null;
  if (input.raw == null) return null;
  const value = Number(input.raw);
  return Number.isFinite(value) && value > ZERO ? value : null;
}

/**
 * El aporte del mes. Sumar las tres partidas protegidas no es un detalle: el
 * numerador (`metasAmount`) suma las capas `metas` Y `ahorro_inversion`, así que
 * con sólo `.goals` el nivel pasaría del 100 % en cuanto hubiera ahorro.
 */
export function goalsPlannedFrom(monthlyProtected: {
  goals: number;
  savings: number;
  investment: number;
}): number {
  return (
    monthlyProtected.goals +
    monthlyProtected.savings +
    monthlyProtected.investment
  );
}

/** La forma mínima de una deuda que le importa al ciclo de tarjeta. */
export interface DebtAccountLike {
  type: string;
  currency: string | null | undefined;
  statementTotalDue?: number | null;
  fullPaymentDue?: number | null;
  fullPaymentDueOriginal?: number | null;
  statementCovered?: boolean | null;
}

/**
 * Las tarjetas del ciclo, tal como salen de `ctx.debtAccounts`.
 *
 * Dos cosas que no se negocian y que por eso viven aquí y no en la superficie:
 * sólo las tarjetas tienen corte (`type === "credit_card"`), y el remanente se
 * compara en la moneda NATIVA — el builder de contexto reexpresa
 * `fullPaymentDue` a la moneda base y preserva el nativo en
 * `fullPaymentDueOriginal`. Mezclar los dos compararía peras con manzanas.
 */
export function debtCycleCardsFrom(
  debts: readonly DebtAccountLike[],
): DebtCycleCard[] {
  return debts
    .filter((debt) => debt.type === "credit_card")
    .map((debt) => ({
      currency: debt.currency ?? null,
      statementTotalDue: debt.statementTotalDue ?? null,
      remainingNative: debt.fullPaymentDueOriginal ?? debt.fullPaymentDue ?? null,
      statementCovered: debt.statementCovered ?? null,
    }));
}

/**
 * N3B · Patrimonio contra la meta que el usuario DECLARÓ
 * (`prefs.wealth_target`).
 *
 * Misma forma que `reserveLevel` a propósito: son la misma clase de hecho —una
 * cifra del motor contra un techo declarado por el usuario— y tratarlas
 * distinto sería inventar una diferencia que no existe. Sin techo declarado no
 * hay nivel, y entonces cambia la materia: Kipu **no inventa un techo**, lo
 * pregunta.
 *
 * `wealth_target` ya existe como columna guardada, `setGoalPrefs` ya la
 * escribe y la herramienta `set_wealth_target` ya la fija desde el chat. Esta
 * etapa no agrega ni una migración ni una lectura: usa lo que ya estaba.
 */
export function wealthLevel(input: {
  amount: number | null | undefined;
  target: number | null | undefined;
}): OrbLevelReading {
  const { amount, target } = input;
  if (amount == null || !Number.isFinite(amount)) return NO_LEVEL;
  if (target == null || !Number.isFinite(target) || target <= ZERO) return NO_LEVEL;
  // Un patrimonio NEGATIVO es un hecho posible y no se puede dibujar como agua
  // en un vaso: se acota el trazo en cero, y la frase sigue diciendo la verdad.
  const ratio = amount / target;
  return { level: clamp01(ratio), note: `${percent(ratio)}% de tu meta` };
}

/**
 * N3B · La meta de patrimonio declarada. Idéntica en forma a
 * `reserveTargetFrom`, y por el mismo motivo: dos ausencias distintas —no se
 * pudo leer la fila, o el usuario no la declaró— colapsan a «sin denominador»,
 * y ninguna de las dos se rellena con un número.
 */
export function wealthTargetFrom(input: {
  prefsError: boolean;
  raw: unknown;
}): number | null {
  if (input.prefsError) return null;
  if (input.raw == null) return null;
  const value = Number(input.raw);
  return Number.isFinite(value) && value > ZERO ? value : null;
}

/**
 * N3B · ¿Ya llegó a la meta? Pedido explícito del founder: «al alcanzar la meta,
 * ofrecer una nueva». Es una función y no un `>=` suelto en la superficie
 * porque decide QUÉ SE LE DICE al usuario sobre su dinero, y eso se prueba.
 */
export function orbTargetReached(input: {
  amount: number | null | undefined;
  target: number | null | undefined;
}): boolean {
  const { amount, target } = input;
  if (amount == null || !Number.isFinite(amount)) return false;
  if (target == null || !Number.isFinite(target) || target <= ZERO) return false;
  return amount >= target;
}

/** Reserva contra su meta de respaldo (`prefs.emergency_reserve_target`). */
export function reserveLevel(input: {
  amount: number | null | undefined;
  target: number | null | undefined;
}): OrbLevelReading {
  const { amount, target } = input;
  if (amount == null || !Number.isFinite(amount)) return NO_LEVEL;
  if (target == null || !Number.isFinite(target) || target <= ZERO) return NO_LEVEL;
  const ratio = amount / target;
  // El porcentaje se dice ENTERO aunque pase de 100: quien llegó a 120% de su
  // meta merece verlo. Lo que se acota es el agua, que no puede desbordar.
  return { level: clamp01(ratio), note: `${percent(ratio)}% de tu meta` };
}

/**
 * Metas contra el aporte del mes
 * (`briefing.margenKipu.capacity.monthlyProtected`).
 *
 * `pending` es lo que TODAVÍA está apartado por aportar, así que el orbe DRENA
 * a medida que aportás — igual que el Saldo, y coherente con la cifra que lo
 * acompaña («Por aportar este mes»): número grande, orbe lleno.
 */
export function goalsLevel(input: {
  pending: number | null | undefined;
  planned: number | null | undefined;
}): OrbLevelReading {
  const { pending, planned } = input;
  if (pending == null || !Number.isFinite(pending)) return NO_LEVEL;
  if (planned == null || !Number.isFinite(planned) || planned <= ZERO) return NO_LEVEL;
  const ratio = pending / planned;
  return { level: clamp01(ratio), note: `queda ${percent(ratio)}% del aporte del mes` };
}

export interface DebtCycleCard {
  /** Moneda NATIVA de la tarjeta. */
  currency: string | null | undefined;
  /** Total declarado del corte vigente (migración 065). NO encoge al pagar. */
  statementTotalDue: number | null | undefined;
  /** Lo que falta del corte, en la MISMA moneda que `statementTotalDue`. */
  remainingNative: number | null | undefined;
  /** Bandera autoritativa del motor: un parcial NO cubre el corte. */
  statementCovered: boolean | null | undefined;
}

/**
 * Deuda contra el ciclo cubierto (`ctx.debtAccounts[]`).
 *
 * OJO — `briefing.debtHealth.cards` NO sirve: `CardHealth` expone
 * `fullPaymentDue` y `balance`, pero **no** la cobertura del corte. El camino es
 * `ctx.debtAccounts`, que sí trae `statementTotalDue` y `statementCovered`.
 *
 * Y una regla de moneda que este proyecto pagó caro en el Bloque J: sumar
 * cortes de monedas distintas sin una tasa **inventa dinero**. Si las tarjetas
 * con corte abierto no comparten moneda, el motor no puede afirmar un ratio ⇒
 * no hay nivel ⇒ cambia la materia. No se estima.
 */
export function debtCycleLevel(
  cards: readonly DebtCycleCard[],
): OrbLevelReading {
  const open = cards.filter(
    (card) =>
      card.statementTotalDue != null &&
      Number.isFinite(card.statementTotalDue) &&
      card.statementTotalDue > ZERO,
  );
  if (open.length === 0) return NO_LEVEL;
  const currencies = new Set(
    open.map((card) => (card.currency ?? "").trim().toUpperCase()),
  );
  if (currencies.size !== 1 || currencies.has("")) return NO_LEVEL;

  let total = 0;
  let covered = 0;
  for (const card of open) {
    const statement = card.statementTotalDue as number;
    total += statement;
    // La pregunta «¿este ciclo está cubierto?» ya la contesta el motor.
    if (
      cardStatementSettled({
        statementCovered: card.statementCovered ?? null,
        fullPaymentDue: card.remainingNative ?? null,
      })
    ) {
      covered += statement;
      continue;
    }
    const remaining =
      card.remainingNative != null && Number.isFinite(card.remainingNative)
        ? Math.min(statement, Math.max(0, card.remainingNative))
        : statement;
    covered += statement - remaining;
  }
  if (total <= ZERO) return NO_LEVEL;
  const ratio = covered / total;
  return { level: clamp01(ratio), note: `Ciclo cubierto ${percent(ratio)}%` };
}

// ── Un orbe pausado nunca muestra la capa equivocada ────────────────────────
// Pausar el orbe por un gesto es legítimo (ahorra cuadros mientras deslizás).
// Mostrar la capa ANTERIOR mientras la cifra, los chips y el acento ya son los
// de la nueva, no: el orbe estaría afirmando que estás mirando otra cosa.
//
// El founder lo fotografió: Patrimonio con el orbe naranja de Deuda, y Deuda
// con el núcleo azul de Patrimonio. La causa fue `preserveDrawingBuffer`, que
// N2 agregó para que pausar no dejara el lienzo en blanco — y que de paso deja
// congelado el último cuadro, que es el de la capa que acabás de dejar.
export function orbMustRedraw(input: {
  /** Por qué está pausado el bucle, o `null` si está corriendo. */
  pauseReason: string | null;
  /** La capa que el lienzo está mostrando DE VERDAD. */
  drawnKind: OrbKind | null;
  /** La capa activa ahora. */
  activeKind: OrbKind;
}): boolean {
  // Nada rancio que corregir.
  if (input.drawnKind === input.activeKind) return false;
  // Si no está pausado, el bucle ya va a dibujar solo: no se le debe nada.
  if (input.pauseReason == null) return false;
  // Sólo la pausa POR GESTO se salda. Sin tier, sin lienzo, oculto o fuera de
  // pantalla no se puede (o no se debe) dibujar — y ahí no hay nada visible
  // que corregir.
  return input.pauseReason === "inactive";
}

// ── N3 · El DIBUJO del orbe, en lógica pura ────────────────────────────────
//
// Todo lo de abajo decide TRAZO, jamás dato. Es la línea que N3 no puede
// cruzar y la razón de que viva aquí, donde el gate la ejecuta: si el mapeo
// del vaso o el reparto del carrusel vivieran dentro del shader o dentro de un
// `useEffect`, nadie podría probar que no le tocaron el valor a nadie.

/**
 * EL TOPE DEL VASO (D-N3.1) — **mapeo de dibujo, no cambio de dato.**
 *
 * El founder lo diagnosticó exacto: hoy lleno y vacío se confunden porque un
 * orbe al 100 % no muestra agua, muestra un orbe de color. Un vaso real no se
 * llena hasta el borde, así que el lleno visual deja aire arriba y **el menisco
 * siempre se ve**.
 *
 * La regla que no se relaja: esto acota EL TRAZO, nunca el valor. `orbWaterline`
 * no toca `level`, no lo devuelve, y nadie la llama antes de la cifra ni de la
 * frase — «Ciclo cubierto 100 %» sigue diciendo 100 %. Lo único que cambia es a
 * qué altura del vidrio se dibuja ese 100 %.
 *
 * Entre el piso —donde vive la gota de N2— y el techo hay recorrido de sobra
 * para que los valores del medio se distingan a simple vista.
 */
export const ORB_WATERLINE_FLOOR = 0.02;
export const ORB_WATERLINE_CEILING = 0.70;

// ── N3B · LA ALTURA QUE SE VE NO ES LA ALTURA QUE SE PIDE ───────────────────
//
// El founder vio esto y lo dijo sin rodeos: «en el saldo que se supone que está
// acabado se ve demasiado lleno». Medí su orbe vacío en píxeles antes de
// creerle o desmentirlo, y tenía razón con números: con `FLOOR = 0.07` la
// superficie del nivel CERO aterrizaba al **26 % de la altura** del vidrio. Un
// vaso vacío dibujaba un cuarto de vaso.
//
// Y no era un número mal elegido: es GEOMETRÍA, y por eso no se arregla
// bajando la constante a ojo. La cámara mira el agua un poco desde arriba
// (`CAM_PITCH`), así que la superficie no es una cuerda recta sino una ELIPSE,
// y **el borde lejano de esa elipse queda más alto que el plano del agua**. Lo
// que el ojo lee como «el nivel» es el punto más alto de la elipse, no el
// plano. Sumale el menisco trepando la pared y el 7 % se convierte en 26 %.
//
// Esta función es esa proyección, en la única forma en la que se puede AUDITAR:
// pura, acá, donde el gate la ejecuta. El shader dibuja exactamente esto —las
// mismas constantes, la misma cuenta— así que el pin deja de mirar una
// constante y pasa a mirar **lo que se ve**, que es lo que el founder puntúa.

/** La inclinación de la cámara sobre el agua. El shader usa este mismo valor. */
export const ORB_CAM_PITCH = -0.11;
/** Distancia de la cámara al centro del orbe, en radios. */
export const ORB_CAM_DISTANCE = 3.4;
/** Los dos factores del rayo: `vec3(uv*0.94, -3.2)` en el shader. */
export const ORB_CAM_SPREAD = 0.94;
export const ORB_CAM_FOCAL = 3.2;

/**
 * A qué ALTURA DE LA IMAGEN llega el punto más alto del agua, de 0 (el fondo
 * del vidrio) a 1 (el tope). Recibe una altura de TRAZO —la que devuelve
 * `orbWaterline`—, nunca un valor del motor.
 *
 * Sigue sin acotar un dato: proyecta un trazo. Es la misma frontera de N3, sólo
 * que ahora también se puede medir del lado del dibujo.
 *
 * ES UNA COTA INFERIOR, Y ESO ESTÁ MEDIDO. La cuenta proyecta el plano del agua
 * y NO incluye el menisco ni la ola, que en el shader levantan un poco más el
 * borde. Contra el renderer real, con la misma sonda de píxeles:
 *
 *     dato 60 %  → esta función 56,0 %   · medido 58,1 %   (+2,1)
 *     dato 100 % → esta función 77,0 %   · medido 83,5 %   (+6,5)
 *
 * Se deja como cota inferior a propósito, en vez de copiar el menisco acá: el
 * menisco depende del oleaje, y duplicar lógica del shader en el contrato es
 * exactamente cómo las dos mitades se separan. Lo que sí se hace es dejarle
 * MARGEN a los pines, para que «queda aire arriba» siga siendo verdad de lo que
 * se dibuja y no sólo de lo que se calcula.
 *
 * Y no describe la GOTA: un cero leído se dibuja con otra materia, con su propio
 * disco chico apoyado en el fondo (medido: 4,9 % de la altura).
 */
export function orbWaterApex(waterline: number): number {
  const line = clamp01(Number.isFinite(waterline) ? waterline : ORB_WATERLINE_FLOOR);
  // El plano del agua, en coordenadas de la esfera de radio 1.
  const base = line * 2 - 1;
  // El radio del disco de agua a esa altura: donde el plano corta el vidrio.
  const wallR = Math.sqrt(Math.max(0, 1 - base * base));
  const cos = Math.cos(ORB_CAM_PITCH);
  const sin = Math.sin(ORB_CAM_PITCH);
  let apex = -1;
  // El máximo se busca sobre el borde del disco. Analíticamente sale de una
  // cuadrática, pero el borde es una curva cerrada y corta: barrerlo es exacto
  // hasta el píxel y no esconde la cuenta detrás de un despeje.
  for (let step = 0; step <= 180; step += 1) {
    const w = wallR * (step / 90 - 1);
    // Del marco del agua al marco de la vista (el `fromWater` del shader).
    const y = cos * base + sin * w;
    const z = -sin * base + cos * w;
    // Y de ahí a la pantalla: la misma proyección en perspectiva del shader.
    const screenY = (y * ORB_CAM_FOCAL) / (ORB_CAM_SPREAD * (ORB_CAM_DISTANCE - z));
    if (screenY > apex) apex = screenY;
  }
  return clamp01((apex + 1) / 2);
}

export function orbWaterline(level: number | null | undefined): number {
  if (level == null || !Number.isFinite(level)) return ORB_WATERLINE_FLOOR;
  const bounded = clamp01(level);
  // Interpolación exacta en los extremos: `a + t*(b-a)` no devuelve `b` con
  // t = 1 en coma flotante, y el techo del vaso es justo el valor que hay que
  // poder afirmar sin tolerancias.
  return ORB_WATERLINE_FLOOR * (1 - bounded) + ORB_WATERLINE_CEILING * bounded;
}

/**
 * N3B · QUÉ MATERIA LE TOCA AL SHADER — una sola decisión, y ejecutable.
 *
 * Existía por duplicado: un `MATERIAL_BY_KIND` en `LiveOrb` y otro idéntico en
 * `OrbSpecimen`, cada uno con su propio `? :` para el cristal. Dos copias de una
 * regla no son una regla, y en este caso escondían un defecto REAL que el
 * founder vio y nombró: **`gota` no llegaba nunca al dibujo.**
 *
 * N2 había decidido que un orbe leído en cero se dibuja como una gota
 * deliberada. N3 movió el dibujo al lienzo y esa decisión se perdió por el
 * camino: `orbFill` seguía devolviendo `"gota"`, pero el lienzo sólo miraba
 * `matter` y `fill === "nucleo"`, así que un cero terminaba con la materia de
 * agua y con `orbWaterline(null)` — el piso del mapeo. Y el piso del mapeo,
 * proyectado, dibujaba un cuarto de vaso. De ahí salió *«en el saldo que se
 * supone que está acabado se ve demasiado lleno»*: no era un tope mal elegido,
 * era una materia que no llegaba.
 *
 * Ahora la decisión es una sola función, la piden los dos dibujantes, y el gate
 * la ejecuta — así que perder la gota otra vez cuesta un test rojo.
 */
export const ORB_MATERIAL: Record<OrbKind, number> = {
  saldo: 0,
  reserva: 1,
  metas: 2,
  patrimonio: 3,
  deuda: 4,
};

/** La materia del vacío deliberado. No es una capa: es un ESTADO del vidrio. */
export const ORB_MATERIAL_GOTA = 5;

/**
 * N3C ronda 2 · EL CRISTAL ES UN ESTADO, Y AHORA TIENE SU PROPIO NÚMERO.
 *
 * El founder lo vio en producción: Patrimonio decía «36% de tu meta» y dibujaba
 * una bola de cristal con un núcleo facetado. El texto afirmaba un nivel y la
 * materia decía que no había ninguno.
 *
 * La causa estaba acá, y era una COLISIÓN DE CÓDIGOS. N3B escribió la doctrina
 * correcta —«el cristal aparece cuando falta el techo, en cualquiera de las
 * cinco, y desaparece en cuanto el techo se declara»— y la codificó devolviendo
 * `ORB_MATERIAL.patrimonio` para el caso sin techo. Pero ése es TAMBIÉN el
 * número de la capa Patrimonio, y el shader lee ese número como cristal. Así
 * que «Patrimonio» y «sin techo» eran indistinguibles: la capa entera quedó
 * condenada a cristal, con techo o sin él.
 *
 * El cristal deja de tomar prestada la identidad de una capa. Es un estado del
 * vidrio, como la gota, y lleva su propio código.
 */
export const ORB_MATERIAL_CRISTAL = 6;

export function orbMaterialCode(input: {
  kind: OrbKind;
  matter: OrbMatter;
  fill: OrbFill;
}): number {
  // Un cero LEÍDO es una gota, y gana sobre todo lo demás: es lo único que
  // distingue «miré y no hay nada» de «hay poco».
  if (input.fill === "gota") return ORB_MATERIAL_GOTA;
  // Sin techo honesto, cristal: la doctrina de N2 — y con SU número, no con el
  // de una capa. Devolver el de Patrimonio era lo que la volvía inalcanzable.
  if (input.matter === "cristal" || input.fill === "nucleo") {
    return ORB_MATERIAL_CRISTAL;
  }
  return ORB_MATERIAL[input.kind];
}

/**
 * ── N3C r4 · EL EXPERIMENTO DEL CAMPO LLENO ────────────────────────────────
 *
 * **Temporal, y declarado como tal.** Decisión del founder, textual:
 *
 *   «Vamos con el campo llena el orbe entero, sólo porque quiero ver con eso
 *   qué tanto nos logramos parecer al de ellos, y después de eso probamos
 *   opciones como el tono sin superficie o seguimos tratando con el agua.»
 *
 * Con esto encendido todos los orbes dibujan el CAMPO ENTERO —el material de
 * ellos, sin línea de agua, sin menisco y sin aire—, para poder juzgar el
 * parecido sin la variable del agua encima.
 *
 * QUÉ CUESTA, y hay que decirlo: **el orbe deja de mostrar el nivel.** La
 * cifra y la frase de abajo lo siguen diciendo enteras —no cambia un solo
 * número—, pero el vidrio deja de afirmarlo. Es el precio del experimento y
 * por eso vive en UN interruptor, no repartido por el código.
 *
 * LA EXCEPCIÓN QUE NO ES ESTÉTICA: un cero LEÍDO sigue siendo una gota.
 * Dibujar un cero como un orbe lleno y luminoso no es un gusto distinto, es
 * una afirmación falsa sobre plata. Eso no entra en un experimento visual.
 *
 * Cómo se apaga: `false`, y vuelve todo. `orbMaterialCode` no se toca — sigue
 * siendo la decisión de doctrina, con sus pines, debajo de esto.
 */
export const ORB_FIELD_ONLY = true;

/**
 * Qué materia dibuja el vidrio HOY, incluido el experimento. Es la única
 * función que los dibujantes piden; la doctrina sigue viviendo entera en
 * `orbMaterialCode`, que ésta consulta primero.
 */
export function orbPresentationMaterial(input: {
  kind: OrbKind;
  matter: OrbMatter;
  fill: OrbFill;
}): number {
  const decided = orbMaterialCode(input);
  if (!ORB_FIELD_ONLY) return decided;
  // el cero leído conserva su materia: ver arriba
  if (decided === ORB_MATERIAL_GOTA) return decided;
  return ORB_MATERIAL_CRISTAL;
}

/**
 * LAS VECINAS (D-N3.2) — su presencia es una función PURA de su distancia al
 * centro, y por eso no hay apagón posible.
 *
 * La regla del founder tiene dos mitades: durante el gesto las vecinas se ven
 * SIN CAMBIOS —no una versión barata—, y en reposo no se ven. Escrito como un
 * booleano («¿está deslizando?») la segunda mitad sería un apagón: la vecina
 * desaparecería de golpe al asentarse, que es una sustitución con otro nombre,
 * justo la clase que N2 pagó y que esta forma existe para eliminar.
 *
 * Escrito como función de la posición, la salida ES el movimiento: la vecina se
 * va yendo mientras el gesto termina, porque irse y apagarse son el mismo
 * número. Y la meseta llega hasta `NEAR`, así que en todo el tramo donde de
 * verdad se la mira vale exactamente 1 — sin degradar.
 */
export const ORB_TRAVEL = 0.66;
/** Cuánto encoge el orbe más lejano. Es perspectiva, no decoración. */
export const ORB_DEPTH_SHRINK = 0.2;
/** El aire que queda entre dos orbes vecinos cuando están lo más juntos posible. */
export const ORB_CLEARANCE = 0.06;
export const ORB_PRESENCE_NEAR = 0.34;
export const ORB_PRESENCE_FAR = 0.6;

export interface OrbSlot {
  index: number;
  /** Desplazamiento del centro del orbe, en anchos de vía. */
  offset: number;
  /** 0–1. En reposo la activa vale 1 y ninguna otra se ve. */
  presence: number;
  /**
   * N3B · 0 = el orbe que mirás; 1 = el más lejano.
   *
   * El founder dijo que las capas «se pisan». Dos discos traslúcidos que se
   * cruzan producen una lente más clara con DOS bordes duros, y eso no se lee
   * como una esfera pasando delante de otra: se lee como dos calcomanías
   * superpuestas. La profundidad es lo que lo arregla, y sale de la MISMA
   * distancia al centro que ya decide la presencia — así que no hay dos fuentes
   * que puedan discrepar, y una vecina no puede estar cerca y lejos a la vez.
   */
  depth: number;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * `position` es la posición REAL de la vía —`scrollLeft / clientWidth`—, no un
 * índice redondeado: es lo que hace que el paso entre capas sea continuo.
 */
export function orbSlots(input: {
  count: number;
  position: number;
}): OrbSlot[] {
  const position = Number.isFinite(input.position) ? input.position : 0;
  const slots: OrbSlot[] = [];
  for (let index = 0; index < input.count; index += 1) {
    const offset = (index - position) * ORB_TRAVEL;
    slots.push({
      index,
      offset,
      presence: 1 - smoothstep(ORB_PRESENCE_NEAR, ORB_PRESENCE_FAR, Math.abs(offset)),
      // EL CARRUSEL ES UN ARCO, NO UNA FILA. Cada orbe está lo más cerca del
      // ojo cuando está centrado, y se va hacia atrás al salir. Por eso la
      // profundidad arranca en el centro y no después de una meseta: un arco no
      // tiene tramos planos.
      //
      // Y no es una «versión barata» de la vecina, que es lo que D-N3.2
      // prohíbe: su presencia sigue valiendo 1 en todo el gesto —se la ve
      // ENTERA— y lo único que cambia es a qué distancia está. Estar más lejos
      // no es estar degradado.
      depth: smoothstep(0, ORB_TRAVEL, Math.abs(offset)),
    });
  }
  return slots;
}

/**
 * La capa activa sale de la MISMA posición que dibuja los orbes, así que el
 * lienzo no puede discrepar del chip, del acento, del nudo ni de la cifra: no
 * hay dos fuentes que puedan separarse. Es la paridad de M2/B12, ahora con un
 * solo origen.
 */
export function orbActiveIndex(input: { count: number; position: number }): number {
  if (input.count <= 0) return 0;
  const position = Number.isFinite(input.position) ? input.position : 0;
  return Math.max(0, Math.min(input.count - 1, Math.round(position)));
}

/**
 * DÓNDE VA CADA ORBE EN EL LIENZO — puro, y por eso auditable.
 *
 * Vive aquí y no dentro del bucle de dibujo por la lección que este bloque pagó
 * tres veces: lo que sólo existe adentro de un `requestAnimationFrame` no se
 * puede probar en un entorno que no compone cuadros, y entonces «se ve bien» es
 * una afirmación de fe. Con la colocación afuera, el santuario y la probeta de
 * `/dev/sistema` piden la MISMA función, así que la maqueta que se mira no puede
 * separarse de la que se envía.
 */
export interface OrbFieldGeometry {
  /** Centro horizontal del lienzo, en píxeles CSS. */
  centerX: number;
  /** Altura del centro del orbe, en píxeles CSS. */
  centerY: number;
  /** Radio del orbe, en píxeles CSS. */
  radius: number;
  /** Ancho de la vía: la unidad en la que viaja el carrusel. */
  trackWidth: number;
}

export interface OrbFieldPlacement {
  index: number;
  centerX: number;
  centerY: number;
  radius: number;
  presence: number;
  depth: number;
}

/**
 * EL RADIO MÁXIMO QUE NO SE PISA (F7) — y por qué esto es una garantía y no un
 * ajuste.
 *
 * El founder dijo que las capas «se pisan», y medido resultó ser GEOMETRÍA, no
 * un problema de dibujo: el santuario pide `orbRadius ≈ 0,35 × ancho` y coloca
 * los centros a `ORB_TRAVEL × ancho` — con los números de N3, 0,62 × 390 = 242 px
 * de separación para dos círculos que necesitan 272 px para no tocarse. Se
 * pisaban **siempre**, y ninguna cantidad de sombreado lo iba a arreglar: dos
 * discos traslúcidos que se cruzan dan una lente más clara con dos bordes duros,
 * y eso se lee como dos calcomanías.
 *
 * Podría haberse arreglado eligiendo mejor un radio en la superficie. No sirve:
 * el radio del santuario sale del DOM (`boxRect.width / 2`), así que un cambio
 * de maquetación lo volvería a romper y nadie se enteraría hasta la próxima
 * foto. La regla vive acá, la aplica quien coloca, y el gate la ejecuta contra
 * el peor caso — el gesto a mitad de camino, que es donde dos vecinas están lo
 * más cerca que pueden estar.
 */
export function orbMaxRadius(trackWidth: number): number {
  const width = Number.isFinite(trackWidth) && trackWidth > 0 ? trackWidth : 0;
  // A mitad del gesto ambas vecinas están a `ORB_TRAVEL/2` del centro, o sea
  // separadas por `ORB_TRAVEL` enteros, y ambas encogidas a la mitad de la
  // perspectiva. Ese es el caso más apretado que existe.
  const shrunk = 1 - 0.5 * ORB_DEPTH_SHRINK;
  return (width * ORB_TRAVEL * (1 - ORB_CLEARANCE)) / (2 * shrunk);
}

export function orbFieldPlacements(input: {
  count: number;
  position: number;
  geometry: OrbFieldGeometry;
}): OrbFieldPlacement[] {
  const { geometry } = input;
  // El radio se acota UNA vez, acá, antes de repartirlo: si se acotara por orbe
  // el tamaño dependería de dónde está cada uno y el carrusel respiraría.
  const radius = Math.min(geometry.radius, orbMaxRadius(geometry.trackWidth));
  return orbSlots({ count: input.count, position: input.position }).map((slot) => ({
    index: slot.index,
    centerX: geometry.centerX + slot.offset * geometry.trackWidth,
    centerY: geometry.centerY,
    // Lo que está más lejos se ve MÁS CHICO. Es la otra mitad de la
    // profundidad: sin ella la vecina tiene el tamaño de la activa y el ojo la
    // lee en el mismo plano, por muy apagada que esté.
    radius: radius * (1 - slot.depth * ORB_DEPTH_SHRINK),
    presence: slot.presence,
    depth: slot.depth,
  }));
}
