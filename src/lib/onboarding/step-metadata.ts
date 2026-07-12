/**
 * Kipu onboarding — per-step metadata.
 *
 * This is the copy and behavior contract for each onboarding step.
 * The AI uses `primaryQuestion` + `probingQuestions` as raw material
 * (not as scripts to read verbatim) and adapts them to the user's tone.
 *
 * Brand & tone reminders:
 * - Always "Kipu". Never "Soy Kipu" or "Kipu X" in user-facing copy.
 * - Premium, warm, lightly playful. Calm. Non-judgmental.
 * - Prefer "dinero / lo que entra / lo que queda / lo que debes" over
 *   technical finance vocabulary. Avoid overusing "finanzas".
 * - Humor is allowed but stays polished; never childish.
 */

import type { OnboardingStep, OnboardingStepSensitivity } from "./steps";

export interface OnboardingStepMetadata {
  step: OnboardingStep;
  /** Short label for UI chrome (progress, headers). */
  title: string;
  /** One-line description shown above the step. */
  shortDescription: string;
  /** The opening question Kipu asks when entering this step. */
  primaryQuestion: string;
  /** Concrete examples the AI can offer if the user is stuck. */
  examples: string[];
  /**
   * Smart follow-ups Kipu can use when the user is vague, evasive, or
   * has given partial information. These are seeds — the AI rewrites
   * them in context, never reads them verbatim.
   */
  probingQuestions: string[];
  /**
   * Fields that must be present before the step is considered complete.
   * For collection steps, "at_least_one_item" is a sentinel meaning
   * "at least one item in the collection (or the step explicitly empty)".
   */
  requiredFields: string[];
  /**
   * High-value fields that are not strictly required but materially
   * improve Kipu's ability to coach. The AI should ask for these
   * before giving up on a step.
   */
  optionalHighValueFields: string[];
  sensitivity: OnboardingStepSensitivity;
  /** Tone reminders the AI should respect when writing copy for this step. */
  toneGuidance: string;
}

export const ONBOARDING_STEP_METADATA: Record<OnboardingStep, OnboardingStepMetadata> = {
  // ── Welcome ───────────────────────────────────────────────────────────────
  welcome: {
    step: "welcome",
    title: "Hola",
    shortDescription: "Kipu se presenta y explica cómo será la conversación.",
    primaryQuestion:
      "Hola, soy Kipu. No te voy a pedir que llenes un Excel eterno: solo unas preguntas rápidas para entender cómo se mueve tu dinero y ayudarte con claridad. ¿Empezamos?",
    examples: [],
    probingQuestions: [
      "Si en algún momento no sabes algo, dime un rango y seguimos. Mejor un aproximado que dejarlo en blanco.",
      "También puedo preguntarte cosas de a una, sin saltos. Tú decides el ritmo.",
    ],
    requiredFields: [],
    optionalHighValueFields: [],
    sensitivity: "low_sensitivity",
    toneGuidance:
      "Calmado, cercano, premium. Dejar claro que esto no es un formulario. Una pizca de humor está bien, pero sin caer en payaso.",
  },

  // ── Profile ───────────────────────────────────────────────────────────────
  profile: {
    step: "profile",
    title: "Tu perfil",
    shortDescription: "Cómo te llamas, dónde estás y qué tono prefieres.",
    primaryQuestion:
      "Para empezar, ¿cómo te llamas y desde qué país me hablas? Eso ya me ayuda a ajustar moneda y un par de cosas más.",
    examples: ["Nico, Ecuador", "Lucía, Argentina, prefiero dólares", "Mati, México"],
    probingQuestions: [
      "¿En qué moneda piensas tu dinero del día a día? (USD, ARS, EUR, MXN…) Si tienes ingresos en una y gastos en otra, también dímelo.",
      "¿Cómo te gusta que te hablen cuando algo no va bien con la plata: directo y al grano, calmado y claro, o más cercano y juguetón?",
      "Y al revés: cuando algo va bien, ¿prefieres que te lo celebre o que siga callado y siga sumando?",
      "¿Quieres que sea estricto contigo cuando te salgas del plan o más bien relajado y sin sermones?",
    ],
    requiredFields: ["fullName", "baseCurrency"],
    optionalHighValueFields: ["country", "tonePreference", "strictnessLevel"],
    sensitivity: "low_sensitivity",
    toneGuidance:
      "Conversación natural, como conocer a alguien nuevo. Nada de jerga financiera. No pedir documento ni datos personales innecesarios.",
  },

  // ── Accounts ──────────────────────────────────────────────────────────────
  accounts: {
    step: "accounts",
    title: "Tus cuentas",
    shortDescription: "Dónde vive realmente tu dinero.",
    primaryQuestion:
      "¿En qué cuentas tienes tu dinero hoy? Banco, efectivo, wallet, cuenta de ahorro… solo nómbralas y, si recuerdas, un saldo aproximado.",
    examples: [
      "Pichincha como 1200, efectivo unos 80",
      "Cuenta sueldo en Galicia, una en Brubank y algo de efectivo",
      "Nubank, Mercado Pago, y dólares guardados en casa",
    ],
    probingQuestions: [
      "¿Cuál de esas cuentas es la que más usas en el día a día? Esa nos va a servir como cuenta principal.",
      "¿Hay alguna cuenta secundaria, efectivo guardado o wallet que también deberíamos tomar en cuenta? A veces el dinero olvidado pesa.",
      "¿Tienes alguna cuenta o sobre separado solo para ahorros o para una meta? Aunque tenga poco, vale anotarla.",
      "Sobre los saldos: si no los recuerdas exactos, dame un aproximado redondo. Después lo ajustamos.",
      "¿Alguna de esas cuentas es en otra moneda? Si sí, dime cuál y en qué moneda.",
    ],
    requiredFields: ["at_least_one_item"],
    optionalHighValueFields: [
      "primary_account_identified",
      "goal_account_identified",
      "approximate_balances",
    ],
    sensitivity: "medium_sensitivity",
    toneGuidance:
      "Aquí algunos usuarios se sienten expuestos al decir cuánto tienen. Recordar siempre que los aproximados están bien y que esto no es un examen.",
  },

  // ── Debt accounts ─────────────────────────────────────────────────────────
  debt_accounts: {
    step: "debt_accounts",
    title: "Tarjetas y deudas",
    shortDescription: "Lo que debes, sin drama.",
    primaryQuestion:
      "Hablemos un momento de lo que debes. Tarjetas, préstamos, deudas con alguien cercano… ¿qué tienes hoy? Si no hay nada, también es válido, solo dímelo.",
    examples: [
      "Visa Pichincha, debo pagar como 80 el 30",
      "Tengo un préstamo del banco de unos 4000, pago 250 al mes",
      "Le debo 500 a mi hermana, sin intereses, sin fecha clavada",
    ],
    probingQuestions: [
      "Pregunta incómoda pero útil: ese monto que mencionaste, ¿es el total que debes en la tarjeta o solo el pago mínimo de este mes?",
      "Y para que no se nos esconda nada: ¿hay saldo acumulado de meses anteriores haciendo de villano silencioso?",
      "¿Esa deuda está generando intereses ahora mismo? Si no sabes, también podemos dejarlo en duda y verlo luego.",
      "¿Qué día del mes te toca pagar? Y, si te lo sabes, ¿qué día cierra el mes de la tarjeta?",
      "¿Desde qué cuenta sueles pagar esa tarjeta? Así lo dejo bien claro para tu margen.",
      "¿Usas esa tarjeta también para compras del día a día, o solo para emergencias y compras grandes?",
      "Te pregunto con cariño: ¿esa es la única tarjeta o hay otra por ahí que prefieras olvidar? Mejor que esté en el plan a que aparezca de sorpresa.",
      "Si la deuda es con una persona, ¿hay una fecha hablada para devolverlo o quedó abierto?",
    ],
    requiredFields: ["at_least_one_item_or_explicitly_empty"],
    optionalHighValueFields: [
      "amount_interpretation_resolved",
      "accumulated_balance_known",
      "due_day",
      "cutoff_day",
      "default_payment_account",
      "is_used_for_daily_purchases",
    ],
    sensitivity: "high_sensitivity",
    toneGuidance:
      "Esta es la sección más sensible. Nada de reaccionar con sorpresa a los números. No usar 'plata' como default. Frases como 'sin drama', 'te pregunto con cariño', 'pregunta incómoda pero útil' bajan la guardia.",
  },

  // ── Income sources ────────────────────────────────────────────────────────
  income_sources: {
    step: "income_sources",
    title: "Lo que entra",
    shortDescription: "De dónde viene tu dinero.",
    primaryQuestion:
      "Ahora lo que entra. ¿De dónde te llega dinero hoy? Sueldo, freelance, ventas, ayuda familiar… lo que sea.",
    examples: [
      "Sueldo fijo, 1500 el día 5",
      "Freelance, varía entre 800 y 1500 al mes",
      "Sueldo más comisiones que dependen del mes",
    ],
    probingQuestions: [
      "Además de ese ingreso principal, ¿hay algo que entre de vez en cuando? Freelance, comisiones, ventas, ayuda familiar, alquiler que cobres… aunque sea irregular, suma saber que existe.",
      "¿Ese ingreso es fijo todos los meses o cambia? Si cambia, dame un rango: en un mes flojo cuánto, en un mes bueno cuánto.",
      "¿Qué día del mes (o de la semana) suele llegarte? Si nunca es exacto, dime el rango.",
      "¿A qué cuenta cae normalmente? Eso me sirve para saber desde dónde sale el dinero del día a día.",
      "¿Qué tan estable lo sentís: muy seguro, varía pero confío, o me preocupa que algún mes no llegue?",
      "¿Hay un ingreso de una sola vez en el año que sueles esperar? Aguinaldo, bono, devolución de impuestos, regalo familiar fijo…",
    ],
    requiredFields: ["at_least_one_item_or_explicitly_empty"],
    optionalHighValueFields: [
      "frequency",
      "expected_payment_date",
      "destination_account",
      "stability_known",
      "variable_amount_range",
    ],
    sensitivity: "medium_sensitivity",
    toneGuidance:
      "Algunos usuarios no tienen ingreso estable. No asumir sueldo fijo. Validar el ingreso variable como totalmente normal, no como problema.",
  },

  // ── Fixed expenses ────────────────────────────────────────────────────────
  fixed_expenses: {
    step: "fixed_expenses",
    title: "Lo que sale fijo",
    shortDescription: "Los gastos que pasan casi todos los meses.",
    primaryQuestion:
      "Pensemos en lo que sale casi todos los meses sí o sí. Alquiler, servicios, internet, celular, transporte… ¿qué se te viene a la cabeza?",
    examples: [
      "Alquiler 400, luz 30, internet 25",
      "Renta, gym, Spotify y la cuota del auto",
      "Comida fija unos 300, transporte 80, celular 20",
    ],
    probingQuestions: [
      "Pensemos en los que suelen escaparse: suscripciones (Netflix, Spotify, iCloud, gimnasio), transporte, celular, comida fija, ayuda familiar… ¿cuáles aparecen casi todos los meses?",
      "¿Tienes algún gasto que no es mensual pero igual sabes que viene? Seguro anual, matrícula, patente, recarga grande… esos suelen romper el mes cuando uno los olvida.",
      "¿Hay algo que pagas todos los meses pero que ya casi no usas? Sin juzgar — solo es bueno saberlo para decidir.",
      "Sobre la comida: ¿prefieres pensarlo como un gasto fijo mensual (un aproximado redondo) o lo dejamos como gasto variable para irlo aprendiendo?",
      "¿Ayudas económicamente a alguien de tu familia cada mes? No tiene por qué ser monto exacto, un promedio sirve.",
      "¿Algún gasto de salud o educación que sea recurrente? Terapia, medicación, cursos, escuela de alguien…",
    ],
    requiredFields: ["at_least_one_item_or_explicitly_empty"],
    optionalHighValueFields: [
      "subscriptions_reviewed",
      "annual_expenses_captured",
      "food_strategy_chosen",
      "family_support_captured",
    ],
    sensitivity: "medium_sensitivity",
    toneGuidance:
      "No emitir juicio sobre suscripciones que el usuario no usa. No moralizar el gasto. El objetivo es mapear, no recortar todavía.",
  },

  // ── Goals ─────────────────────────────────────────────────────────────────
  goals: {
    step: "goals",
    title: "Tu meta",
    shortDescription: "Una sola meta principal, clara y útil.",
    primaryQuestion:
      "Última pregunta importante: ¿qué te gustaría lograr con tu dinero en los próximos meses? Una sola meta, la que más te importa.",
    examples: [
      "Ahorrar 800 para un viaje a Brasil en diciembre",
      "Bajar la deuda de la Visa antes de fin de año",
      "Tener una reserva de emergencia de 1500",
    ],
    probingQuestions: [
      "Si no tienes una meta clara todavía, cero problema. Te doy tres caminos típicos: ordenar tu mes para que llegue al final sin susto, bajar lo que debes para sacarte un peso, o ahorrar para algo específico que tengas en la cabeza. ¿Cuál te daría más tranquilidad?",
      "Para esa meta, ¿tienes un monto en mente o vamos viendo? Si es 'lo que pueda', también vale, lo modelamos así.",
      "¿Para cuándo te gustaría tenerla? Una fecha aproximada me sirve para ver si el plan es realista.",
      "¿Ya tienes algo guardado para esta meta o partimos de cero?",
      "¿Quieres separar este dinero en una cuenta aparte para no mezclarlo, o lo dejamos vivir en tu cuenta principal?",
      "Si tuvieras que elegir entre avanzar lento pero seguro o apretar fuerte unos meses para llegar antes, ¿qué te suena más a ti?",
    ],
    requiredFields: ["at_least_one_item_or_archetype_chosen"],
    optionalHighValueFields: [
      "target_amount",
      "target_date",
      "current_amount",
      "goal_account_assigned",
      "priority",
    ],
    sensitivity: "medium_sensitivity",
    toneGuidance:
      "Si el usuario no tiene meta, no presionar. Ofrecer arquetipos como caminos, no como respuestas correctas. Tono inspirador pero contenido, no motivacional barato.",
  },

  // ── Coach preferences ─────────────────────────────────────────────────────
  coach_preferences: {
    step: "coach_preferences",
    title: "Cómo quieres que te acompañe",
    shortDescription: "Tono y estilo de la conversación diaria.",
    primaryQuestion:
      "Última y cerramos: cuando hablemos de tu plata en el día a día, ¿cómo prefieres que te hable — relajado, directo o un poco más juguetón?",
    examples: ["Relajado", "Directo y al grano", "Juguetón está bien"],
    probingQuestions: [
      "Cuando te hable de tu plata, ¿prefieres mensajes cortos al hueso o un poco más de contexto?",
      "¿Te cae bien algo de humor, o prefieres que sea más serio y al grano?",
      "¿Te gusta que sea cercano y motivador, o más neutral y directo?",
    ],
    requiredFields: [],
    optionalHighValueFields: [
      "detailLevel",
      "humorLevel",
      "weeklyReviewEnabled",
      "dailyCheckinEnabled",
      "proactiveAlertsEnabled",
    ],
    sensitivity: "low_sensitivity",
    toneGuidance:
      "Conversación corta. Aquí ya estamos casi en la meta — no alargar. Confirmar y avanzar.",
  },

  // ── Review ────────────────────────────────────────────────────────────────
  review: {
    step: "review",
    title: "Una mirada rápida",
    shortDescription: "Kipu te muestra lo que entendió y tú confirmas.",
    primaryQuestion:
      "Antes de cerrar, déjame mostrarte lo que entendí de tu situación. Si algo está mal o me faltó algo, lo arreglamos en segundos.",
    examples: [],
    probingQuestions: [
      "¿Algo de esto suena distinto a tu realidad? Mejor corregirlo ahora que arrastrar un error.",
      "¿Hay algo que no te pregunté y que crees que vale la pena que sepa?",
      "¿Todo bien para empezar?",
    ],
    requiredFields: ["user_confirmation"],
    optionalHighValueFields: [],
    sensitivity: "low_sensitivity",
    toneGuidance:
      "Tono de cierre cálido. Premium. Mostrar el resumen con calma, sin jerga financiera. Permitir que el usuario corrija sin fricción.",
  },

  // ── Completed ─────────────────────────────────────────────────────────────
  completed: {
    step: "completed",
    title: "Listo",
    shortDescription: "El onboarding terminó y Kipu ya tiene el contexto.",
    primaryQuestion:
      "Listo. Ya tengo lo que necesito para acompañarte. Desde ahora, cuéntame lo que vayas gastando, lo que entre, o pregúntame cualquier duda cuando quieras.",
    examples: [],
    probingQuestions: [],
    requiredFields: [],
    optionalHighValueFields: [],
    sensitivity: "low_sensitivity",
    toneGuidance:
      "Cierre corto, claro y cálido. Dejar la sensación de que ahora sí empieza algo útil.",
  },
};
