import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Settings — verified export of the user's core financial dataset. Every table
// is read to a PROVEN end (keyset + exact count). A failed/truncated table fails
// the whole request: a partial archive must never be labelled as an export.
const EXPORT_PAGE = 500;
const EXPORT_MAX_PAGES = 200;
type ExportTable =
  | "accounts"
  | "income_sources"
  | "fixed_expenses"
  | "debt_accounts"
  | "goals"
  | "budget_categories"
  | "transactions"
  | "scheduled_payments";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const userId = session.user.id;
  const readAllRows = async (table: ExportTable): Promise<Record<string, unknown>[]> => {
    const rows = new Map<string, Record<string, unknown>>();
    let afterId: string | null = null;
    let provedEnd = false;
    for (let page = 0; page < EXPORT_MAX_PAGES; page += 1) {
      let query = supabase
        .from(table)
        .select("*")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .limit(EXPORT_PAGE);
      if (afterId) query = query.gt("id", afterId);
      const { data, error } = await query;
      if (error || !data) {
        throw new Error(`EXPORT_READ_FAILED:${table}`);
      }
      for (const raw of data) {
        const row = raw as Record<string, unknown>;
        const id = typeof row.id === "string" ? row.id : null;
        if (!id) throw new Error(`EXPORT_ROW_WITHOUT_ID:${table}`);
        rows.set(id, row);
      }
      if (data.length < EXPORT_PAGE) {
        provedEnd = true;
        break;
      }
      const last = data[data.length - 1] as Record<string, unknown>;
      afterId = typeof last.id === "string" ? last.id : null;
      if (!afterId) throw new Error(`EXPORT_CURSOR_FAILED:${table}`);
    }
    if (!provedEnd) throw new Error(`EXPORT_PAGE_CAP:${table}`);

    // Keyset pages are separate snapshots. The exact post-read count catches an
    // insert/delete that would otherwise let a moving dataset masquerade as a
    // complete archive. A concurrent change costs a retry, never silent loss.
    const counted = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (counted.error || counted.count == null || counted.count !== rows.size) {
      throw new Error(`EXPORT_COUNT_MISMATCH:${table}`);
    }
    return [...rows.values()];
  };

  try {
    const profile = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (profile.error) throw new Error("EXPORT_READ_FAILED:profiles");
    const [
      accounts,
      incomeSources,
      fixedExpenses,
      debtAccounts,
      goals,
      budgetCategories,
      transactions,
      scheduledPayments,
    ] = await Promise.all([
      readAllRows("accounts"),
      readAllRows("income_sources"),
      readAllRows("fixed_expenses"),
      readAllRows("debt_accounts"),
      readAllRows("goals"),
      readAllRows("budget_categories"),
      readAllRows("transactions"),
      readAllRows("scheduled_payments"),
    ]);
    transactions.sort((a, b) =>
      String(b.occurred_at ?? "").localeCompare(String(a.occurred_at ?? "")),
    );
    const payload = {
      exportedAt: new Date().toISOString(),
      scope:
        "Exportación verificada del núcleo financiero: perfil, cuentas, fuentes de ingreso, gastos fijos, deudas/tarjetas, metas, presupuestos, movimientos y pagos programados. No incluye mensajes del chat ni registros técnicos internos.",
      note:
        "Los movimientos y cuentas conservan su moneda original (original_*) y su re-expresión en moneda base (base_*).",
      profile: profile.data ?? null,
      accounts,
      incomeSources,
      fixedExpenses,
      debtAccounts,
      goals,
      budgetCategories,
      transactions,
      scheduledPayments,
    };
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="kipu-datos-financieros.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "No pude demostrar que leyera completa la exportación financiera. No entregué un archivo parcial; reintenta.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
