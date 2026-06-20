import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Landing route for the Supabase email-confirmation link. The email link is
// configured (Site URL + emailRedirectTo) to come back to THIS route on the
// production domain — never localhost. It establishes the session (so the user
// continues straight into onboarding) and handles both supported link shapes:
//
//   • token_hash + type  → verifyOtp  (recommended; device-independent, works
//                           when the email is opened on a different device)
//   • code               → exchangeCodeForSession  (PKCE; same-device fallback)
//
// On success we forward to `next` (default /onboarding). On any failure the user
// gets a calm, humanized message on /login — never a raw error or a dead end.
//
// This is a Route Handler (not a Server Component), so the Supabase client's
// cookie writes persist on the redirect response. `next` is constrained to a
// same-origin internal path to avoid open-redirects: backslashes and
// protocol-relative ("//") forms get normalized by browsers into an external
// origin, so we resolve `next` against a sentinel origin and require it to
// stay there.
function safeNext(next: string | null): string {
  if (!next || next.includes("\\")) return "/onboarding";
  try {
    const sentinel = "https://kipu.internal";
    const u = new URL(next, sentinel);
    if (u.origin !== sentinel) return "/onboarding";
    if (!u.pathname.startsWith("/") || u.pathname.startsWith("//")) return "/onboarding";
    return u.pathname + u.search;
  } catch {
    return "/onboarding";
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");
  const next = safeNext(params.get("next"));

  const supabase = await createSupabaseServerClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      redirect(next);
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      redirect(next);
    }
  }

  redirect("/login?message=link-expired");
}
