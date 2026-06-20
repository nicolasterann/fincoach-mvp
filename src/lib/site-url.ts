// Canonical public origin for building absolute URLs that must point at the
// real Kipu site (e.g. the Supabase email-confirmation redirect). Resolution
// order: an explicit env (production), then the Vercel-provided production
// host, then localhost for local dev. Never returns a trailing slash.
//
// IMPORTANT: this is what keeps signup confirmation emails off localhost. The
// value must also be present in the Supabase dashboard Redirect URLs allowlist.
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return stripTrailingSlash(explicit);

  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProd) return `https://${stripTrailingSlash(vercelProd)}`;

  return "http://localhost:3000";
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
