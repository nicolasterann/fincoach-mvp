import { createSupabaseAdminClient } from "@/lib/supabase-admin";

// Auditoría 4 (punto 3) — la MONEDA BASE del usuario es un hecho que se PRUEBA o
// no hay write. El patrón roto vivía repetido: `const { data: prof } = await
// sb.from("profiles")...` con el `error` ignorado y un `?? "USD"` — ante una
// lectura caída, un booking recurrente en moneda extranjera se registraba con
// base USD fabricada. Una sola lectura tipada para todos los consumidores:
// error, fila ausente o base vacía ⇒ {ok:false} ⇒ el caller REHÚSA el write.
// (El gemelo del applier general lanza KIPU_PROFILE_REQUIRED; el legacy usa
// resolveLegacyRepaymentBase — misma doctrina, tres puertas.)

export type ProfileBaseRead = { ok: true; base: string } | { ok: false };

/** El motor de decisión, inyectable para que el gate recorra los cuatro caminos
 *  (error / fila ausente / base vacía / sana) sin base de datos. */
export async function readProfileBaseCurrencyWith(
  fetch: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<ProfileBaseRead> {
  try {
    const { data, error } = await fetch();
    if (error || !data) return { ok: false };
    const base = String((data as { base_currency?: string | null }).base_currency ?? "")
      .trim()
      .toUpperCase();
    if (!base) return { ok: false };
    return { ok: true, base };
  } catch {
    return { ok: false };
  }
}

export async function readProfileBaseCurrency(userId: string): Promise<ProfileBaseRead> {
  return readProfileBaseCurrencyWith(() => {
    const sb = createSupabaseAdminClient();
    return sb.from("profiles").select("base_currency").eq("id", userId).maybeSingle();
  });
}
