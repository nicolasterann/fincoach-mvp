import { buildTemplateCsv, TEMPLATE_FILENAME } from "@/lib/onboarding/csv-template";

// Downloadable onboarding template (Stage 22). Plain CSV (no xlsx/zip lib in the
// stack) with a UTF-8 BOM so Excel/Numbers open it with correct accents. No user
// data — it's a blank template — so no auth is needed.
export async function GET(): Promise<Response> {
  return new Response(buildTemplateCsv(), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${TEMPLATE_FILENAME}"`,
      "Cache-Control": "no-store",
    },
  });
}
