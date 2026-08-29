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
 * Patrimonio no lleva nivel y eso es correcto: **el patrimonio total no tiene
 * techo honesto**, así que un nivel sería una mentira. Conserva su núcleo de
 * cristal, que es su señal de vida propia.
 */
export function orbMatter(kind: OrbKind): OrbMatter {
  return kind === "patrimonio" ? "cristal" : "liquido";
}

/** Patrimonio nunca acepta un nivel, venga de donde venga. */
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
