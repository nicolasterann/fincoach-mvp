"use server";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { parseTemplateCsv, type ParsedTemplate } from "@/lib/onboarding/csv-template";

export type ImportTemplateResult =
  | { ok: true; parsed: ParsedTemplate }
  | { ok: false; error: string };

const MAX_TEMPLATE_BYTES = 1_000_000; // CSV templates are tiny; cap defensively.

// Parse an uploaded onboarding template server-side and return a structured,
// validated preview. Nothing is saved here — the client feeds the result into
// the wizard's review step, so the user always confirms before any write.
export async function importTemplateAction(formData: FormData): Promise<ImportTemplateResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return { ok: false, error: "Tu sesión expiró. Vuelve a entrar e intenta de nuevo." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "No recibí ningún archivo. Sube el CSV que descargaste." };
  }
  if (file.size > MAX_TEMPLATE_BYTES) {
    return { ok: false, error: "Ese archivo es muy grande para una plantilla. Sube el CSV de Kipu." };
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: "No pude leer el archivo. Asegúrate de que sea el CSV de Kipu." };
  }

  // Looks-like-CSV guard. A wrong file (e.g. an .xlsx binary, which is a ZIP)
  // won't contain our header or any of our row keywords as plain text.
  const lower = text.toLowerCase();
  const hasKeyword = /\b(tipo|cuenta|ingreso|gasto|deuda|meta)\b/.test(lower);
  if (/�|PK/.test(text) || !text.includes(",") || !hasKeyword) {
    return {
      ok: false,
      error: "Ese archivo no parece la plantilla de Kipu. Descárgala de nuevo, llénala y súbela como CSV.",
    };
  }

  const baseCurrencyRaw = String(formData.get("baseCurrency") ?? "USD").trim().toUpperCase();
  const baseCurrency = /^[A-Z]{3}$/.test(baseCurrencyRaw) ? baseCurrencyRaw : "USD";
  const parsed = parseTemplateCsv(text, baseCurrency);
  const found =
    parsed.accounts.length + parsed.incomes.length + parsed.expenses.length + parsed.debts.length + parsed.goals.length;
  if (found === 0 && parsed.errors.length === 0) {
    return {
      ok: false,
      error: "No encontré datos para importar. Llena al menos una fila (sin las de EJEMPLO) y vuelve a subir.",
    };
  }

  return { ok: true, parsed };
}
