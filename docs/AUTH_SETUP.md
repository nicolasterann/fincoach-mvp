# Kipu — Auth & Email Confirmation Setup (Stage 21.2)

This is the one-time configuration that makes signup → email confirm → onboarding
work on production (`https://www.soykipu.com`) instead of dropping users on
`localhost`. The **code** side is already wired; the items below are **dashboard
and env** settings that live outside the repo and must be applied by a human.

## Why the confirmation link used to go to localhost

The signup confirmation email's link is built by Supabase Auth from the project's
**Site URL**. That Site URL was still the GoTrue default `http://localhost:3000`,
and the app's `signUp()` did not send an explicit `emailRedirectTo`. So every
confirmation email pointed at localhost. The fix is two-sided: the app now sends
an explicit production `emailRedirectTo` (→ `/auth/confirm`), **and** the Site URL
must be corrected in the dashboard.

## 1) Vercel env var (required)

| Name | Value | Environments | Sensitive | Redeploy |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://www.soykipu.com` | Production (and Preview if desired) | No (public origin) | Yes |

The app reads this to build the absolute confirmation redirect. If unset it falls
back to the Vercel production host, then `http://localhost:3000` for local dev.

## 2) Supabase dashboard → Authentication → URL Configuration (required)

- **Site URL:** change from `http://localhost:3000` to `https://www.soykipu.com`.
  This is the single setting that was sending confirmation links to localhost.
- **Redirect URLs (allowlist):** add
  - `https://www.soykipu.com/**`
  - `http://localhost:3000/**` (keep, for local dev)
  - (optional, for Vercel previews) `https://*.vercel.app/**`

## 3) Supabase dashboard → Authentication → Email Templates → "Confirm signup" (required for the beta)

**Why required, not optional:** the default Supabase template uses the PKCE
`code` flow, which only completes on the **same device/browser** that started
signup (it needs a `code_verifier` cookie). A user who signs up on their laptop
and opens the email on their phone would hit a dead "enlace caducado". The
`token_hash` template below is **device-independent**, so confirmation always
works. Our `/auth/confirm` route supports both forms, but ship the beta with
this template.

Replace the default body with Kipu-branded copy whose link uses the
device-independent `token_hash` form pointing at our route:

```html
<h2>Confirma tu cuenta de Kipu</h2>
<p>¡Bienvenido a Kipu! Toca el botón para confirmar tu correo y entrar.</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding">
    Confirmar mi cuenta
  </a>
</p>
<p>Si no creaste esta cuenta, puedes ignorar este correo.</p>
```

The `/auth/confirm` route also accepts the default `{{ .ConfirmationURL }}`
(`?code=...`) form, so confirmation still works (same-device) even if this
template is left at the default — but ship the beta with the `token_hash`
template so cross-device confirmation never dead-ends.

**Verify after applying:** create a test account in production, open the
confirmation email on a *different* device than you signed up on, and confirm it
lands you in onboarding (not on an "enlace caducado" screen).

> The subject line and body can be changed here with **no** custom SMTP. Changing
> the **sender** from `noreply@mail.app.supabase.io` to a Kipu address requires
> configuring custom SMTP (e.g. Resend) under Authentication → Emails — optional,
> not required for the flow to work.

## Flow after setup

1. User taps **Crear cuenta** on the landing → `/signup`.
2. Submits email + password → sees a clear **"Revisa tu correo"** screen showing
   the address used.
3. Confirmation email links to `https://www.soykipu.com/auth/confirm…`.
4. Clicking it establishes the session and forwards straight to `/onboarding`.
5. Returning users use `/login` → `/app`.

If email confirmation is **disabled** in the dashboard, signup creates a session
immediately and the app sends the user straight to `/onboarding` (no email step).
