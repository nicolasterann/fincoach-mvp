import type { FinancialCategory } from "@/types/financial";

// Stage 16 — MERCHANT NORMALIZATION. Messy bank/statement descriptors
// (PAYU*AR*UBER, DLC*UBER RIDES, AMZN Mktp, NETFLIX.COM) become a clean,
// readable merchant FAMILY (Uber, Amazon, Netflix) with a likely category and a
// confidence. PURE. User corrections (merchant memory) are applied first so Kipu
// LEARNS; unknown local merchants keep a readable name and low confidence. It
// never fabricates a family it can't see — when unsure it falls back to the raw,
// cleaned text.

export interface MerchantOverride {
  matchPattern: string; // normalized substring to match (from user memory)
  family?: string;
  category?: FinancialCategory;
  isRecurring?: boolean | null;
}

export interface NormalizedMerchant {
  raw: string;
  key: string; // normalized grouping token (lowercase, no codes/digits)
  family: string; // human, readable
  category: FinancialCategory | null; // a likely category (null when unsure)
  confidence: "high" | "medium" | "low";
  source: "memory" | "rule" | "fallback";
  // true when `family` is a CATEGORY BUCKET (many distinct real merchants), not a single
  // brand — so callers never treat the family as a per-merchant identity. Mirrors the
  // matched FAMILY_RULES `generic` flag; fallback (unknown merchant) is generic too.
  generic: boolean;
}

// Payment-processor / aggregator prefixes that wrap the real merchant.
const PROCESSOR_PREFIXES = /^(payu|dlc|sq|tst|pp|paypal|mp|mercadopago|amzn mktp|amzn|stripe|adyen|ppro|ebanx|kushki|niubiz|izipay)\b[\s*._-]*/i;

// Known merchant families (ordered: most specific first). Each maps a regex over
// the cleaned descriptor to a readable family + a likely category. `generic`
// marks a CATEGORY BUCKET (many distinct real merchants), NOT a single brand —
// those must NOT become a shared grouping key, or subscription/duplicate
// detection would merge two different supermarkets / transport apps into one.
const FAMILY_RULES: { re: RegExp; family: string; category: FinancialCategory; generic?: boolean }[] = [
  { re: /uber\s*eats|ubereats/i, family: "Uber Eats", category: "food" },
  { re: /\buber\b|uber\s*(trip|rides|bv|technologies)/i, family: "Uber", category: "transport" },
  { re: /rappi/i, family: "Rappi", category: "food" },
  { re: /pedidosya|pedidos ya/i, family: "PedidosYa", category: "food" },
  { re: /didi\s*food/i, family: "DiDi Food", category: "food" },
  { re: /glovo/i, family: "Glovo", category: "food" },
  { re: /\bdidi\b|cabify|indriver|in driver|beat\b/i, family: "Apps de transporte", category: "transport", generic: true },
  { re: /amazon|amzn/i, family: "Amazon", category: "shopping" },
  { re: /mercado\s*libre|mercadolibre|meli\b/i, family: "Mercado Libre", category: "shopping" },
  { re: /aliexpress|alibaba|shein|temu|wish\b/i, family: "Compras online", category: "shopping", generic: true },
  { re: /netflix/i, family: "Netflix", category: "subscriptions" },
  { re: /spotify/i, family: "Spotify", category: "subscriptions" },
  { re: /disney\s*\+?|disneyplus|hbo\s*max|max\.com|paramount\+?|star\+?|crunchyroll|deezer|youtube\s*premium|apple\s*(tv|music|one)/i, family: "Streaming", category: "subscriptions", generic: true },
  { re: /\bicloud|google\s*(one|storage|drive)|dropbox|onedrive/i, family: "Almacenamiento en la nube", category: "subscriptions", generic: true },
  { re: /openai|chatgpt|claude|anthropic|notion|canva|adobe|figma|github|midjourney/i, family: "Software / IA", category: "subscriptions", generic: true },
  { re: /gym|smartfit|smart fit|fitness|crossfit|world\s*gym/i, family: "Gimnasio", category: "health", generic: true },
  { re: /netflix|hbo/i, family: "Streaming", category: "subscriptions", generic: true },
  { re: /starbucks|juan valdez|dunkin|tim hortons|cafe\b|coffee/i, family: "Cafetería", category: "food", generic: true },
  { re: /mcdonald|burger king|kfc|pizza|subway|wendy|popeyes|taco/i, family: "Comida rápida", category: "food", generic: true },
  { re: /supermaxi|megamaxi|mi comisariato|tia\b|coral|walmart|carrefour|jumbo|exito|d1\b|ara\b|santa isabel|wong|plaza vea|tottus/i, family: "Supermercado", category: "food", generic: true },
  { re: /uber|lyft/i, family: "Uber", category: "transport" },
  { re: /shell|primax|petroe?cuador|terpel|texaco|mobil|gasolin|combustible|estacion de servicio/i, family: "Gasolinera", category: "transport", generic: true },
  { re: /claro|movistar|tigo|entel|cnt\b|telefonica|att\b|at&t|directv/i, family: "Telefonía / Internet", category: "utilities", generic: true },
  { re: /agua|epmaps|emaap|luz\b|electric|enel|cnel\b|energia/i, family: "Servicios básicos", category: "utilities", generic: true },
  { re: /farmacia|pharmacy|fybeca|cruz azul|sana sana|inkafarma|mifarma/i, family: "Farmacia", category: "health", generic: true },
  { re: /comision|membres[ií]a|mantenimiento de cuenta|cargo por servicio|interes|iva\b|impuesto|retencion|fee\b/i, family: "Comisiones e impuestos", category: "other", generic: true },
];

function clean(raw: string): string {
  let s = (raw ?? "").toLowerCase().trim();
  s = s.replace(PROCESSOR_PREFIXES, ""); // strip processor wrappers
  s = s.replace(/[*#]+/g, " "); // separators
  s = s.replace(/\b[a-z0-9]{6,}\b(?=\s*$)/i, (m) => (/[a-z]/.test(m) && /\d/.test(m) ? "" : m)); // trailing auth codes (mixed alnum)
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function titleCase(s: string): string {
  return s
    .split(" ")
    .filter(Boolean)
    .slice(0, 4)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// A stable grouping token: cleaned, digits removed, collapsed — so the same
// merchant under different descriptors groups together.
export function merchantKey(raw: string): string {
  return clean(raw).replace(/\d+/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
}

// A canonical slug for a resolved FAMILY name — so every descriptor variant of a
// known merchant (NETFLIX.COM, Netflix, "netflix 123") collapses to ONE grouping
// token. This is what makes recurring/duplicate detection actually work.
function familySlug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 40);
}

export function normalizeMerchant(description: string | null | undefined, overrides: MerchantOverride[] = []): NormalizedMerchant {
  const raw = (description ?? "").trim();
  const cleaned = clean(raw);
  const key = merchantKey(raw);

  // 1. User memory wins (Kipu learned this from a correction). Group by the
  // learned family so every variant collapses to one token.
  for (const o of overrides) {
    const pat = o.matchPattern?.toLowerCase().trim();
    if (pat && (cleaned.includes(pat) || key.includes(pat))) {
      const family = o.family ?? titleCase(cleaned) ?? raw;
      // A user correction is a SPECIFIC merchant grouping (they told us "this = that
      // merchant") → not generic.
      return { raw, key: o.family ? familySlug(o.family) : key, family, category: o.category ?? null, confidence: "high", source: "memory", generic: false };
    }
  }

  // 2. Known family rules. For a SPECIFIC brand the grouping key becomes the
  // family slug so "NETFLIX.COM", "Netflix" and "netflix 123" all group together.
  // For a GENERIC category bucket (many real merchants) we keep the raw-derived
  // key so two different supermarkets / transport apps never merge into one.
  for (const rule of FAMILY_RULES) {
    if (rule.re.test(cleaned) || rule.re.test(raw)) {
      return { raw, key: rule.generic ? key : familySlug(rule.family), family: rule.family, category: rule.category, confidence: "high", source: "rule", generic: !!rule.generic };
    }
  }

  // 3. Readable fallback for local/unknown merchants — keep it human, low conf.
  // Unknown merchant → treat as generic (never collapse two unknowns by a shared family).
  const family = titleCase(cleaned) || raw.slice(0, 30) || "Movimiento";
  return { raw, key, family, category: null, confidence: cleaned.length >= 3 ? "low" : "low", source: "fallback", generic: true };
}

// A TIGHT grouping token for duplicate detection: collapses apostrophe / space /
// case / accent / punctuation / digit variants of the SAME merchant so "McDonald's"
// and "McDonalds" produce the identical token. For a SPECIFIC brand (a non-generic
// rule, or a user's merchant memory) the family drives the token so descriptor variants
// of that brand collapse too ("NETFLIX.COM" == "Netflix 123"). For a GENERIC bucket
// (Cafetería, Comida rápida, Supermercado, Apps de transporte…) or an unknown merchant
// we key on the raw text instead — otherwise two DIFFERENT cafés / supermarkets would
// share a token and near-duplicate detection would nag on genuinely separate purchases
// (mirrors normalizeMerchant.key, which keeps generic buckets separate for the same
// reason). Bare letters only (auth codes / numbers dropped). Returns "" when there's
// too little to trust — callers must treat "" as "no confident merchant" and never
// match on it.
export function merchantDedupeToken(description: string | null | undefined, overrides: MerchantOverride[] = []): string {
  const bare = (s: string): string =>
    (s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z]+/g, "");
  const norm = normalizeMerchant(description, overrides);
  const useFamily = (norm.source === "rule" || norm.source === "memory") && !norm.generic;
  const token = useFamily ? bare(norm.family) : bare(norm.raw);
  return token.length >= 3 ? token.slice(0, 40) : "";
}
