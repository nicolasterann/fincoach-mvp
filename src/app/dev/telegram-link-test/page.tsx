import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { linkTelegramChatAction } from "./actions";

interface TelegramLinkTestPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TelegramLinkTestPage({
  searchParams,
}: TelegramLinkTestPageProps) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const params = searchParams ? await searchParams : {};
  const message = getParam(params.message);

  const { data: links, error } = await supabase
    .from("telegram_user_links")
    .select("id, telegram_chat_id, telegram_username, is_active, linked_at")
    .eq("user_id", session.user.id)
    .order("linked_at", { ascending: false });

  if (error) {
    return (
      <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-50">
        <section className="mx-auto max-w-md rounded-3xl bg-white p-6 text-zinc-950">
          <h1 className="text-2xl font-bold">No pude leer tus links de Telegram</h1>
          <p className="mt-3 text-sm text-zinc-600">{error.message}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-50">
      <section className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-white/10 p-6 shadow-2xl">
          <p className="text-sm font-medium text-emerald-300">Dev test</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Vincular Telegram chat
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            Esta pantalla es temporal. Sirve para probar que un telegram_chat_id
            apunta a tu usuario autenticado.
          </p>
        </header>

        {message ? (
          <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-5">
            <p className="text-sm font-semibold text-emerald-100">{message}</p>
          </section>
        ) : null}

        <section className="rounded-3xl bg-white p-6 text-zinc-950 shadow-2xl">
          <form action={linkTelegramChatAction} className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">
                Telegram chat id
              </span>
              <input
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                defaultValue="987654321"
                name="telegram_chat_id"
                required
                type="text"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">
                Username opcional
              </span>
              <input
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                name="telegram_username"
                placeholder="test_user"
                type="text"
              />
            </label>

            <button
              className="rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-zinc-800"
              type="submit"
            >
              Vincular chat id
            </button>
          </form>
        </section>

        <section className="rounded-3xl bg-white p-6 text-zinc-950 shadow-2xl">
          <h2 className="text-xl font-bold">Links actuales</h2>

          <div className="mt-5 space-y-3">
            {(links ?? []).length === 0 ? (
              <p className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-500">
                Todavía no tienes lins de Telegram.
              </p>
            ) : (
              links?.map((link) => (
                <div
                  className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm"
                  key={link.id}
                >
                  <p className="font-bold text-zinc-950">{link.telegram_chat_id}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    @{link.telegram_username ?? "sin username"} ·{" "}
                    {link.is_active ? "Activo" : "Inactivo"}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function getParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}
