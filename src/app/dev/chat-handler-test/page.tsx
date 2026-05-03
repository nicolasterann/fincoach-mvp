import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { testChatHandlerAction } from "./actions";

interface ChatHandlerTestPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ChatHandlerTestPage({
  searchParams,
}: ChatHandlerTestPageProps) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const params = searchParams ? await searchParams : {};
  const status = getParam(params.status);
  const code = getParam(params.code);
  const response = getParam(params.response);

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-50">
      <section className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-white/10 p-6 shadow-2xl">
          <p className="text-sm font-medium text-emerald-300">Dev test</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Channel-agnostic chat handler
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            Esta pantalla prueba el mismo handler que después podrá usar Telegram.
            No es UI final del producto.
          </p>
        </header>

        <section className="rounded-3xl bg-white p-6 text-zinc-950 shadow-2xl">
          <form action={testChatHandlerAction} className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-zinc-700">
                Mensaje de prueba
              </span>
              <input
                className="rounded-2xl border border-zinc-200 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                name="message"
                placeholr="café 3 pichincha"
                required
                type="text"
              />
            </label>

            <button
              className="rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-zinc-800"
              type="submit"
            >
              Probar handler
            </button>
          </form>
        </section>

        {response ? (
          <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-6">
            <p className="text-sm font-medium text-emerald-200">
              Respuesta conversacional
            </p>
            <p className="mt-3 text-lg font-semibold leading-7">{response}</p>

            <div className="mt-5 rounded-2xl bg-black/20 p-4 text-xs text-emerald-50/80">
              <p>
                <strong>Status:</strong> {status}
              </p>
              <p className="mt-1">
                <strong>Redirect code:</strong> {code}
              </p>
            </div>
          </section>
        ) : null}
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
