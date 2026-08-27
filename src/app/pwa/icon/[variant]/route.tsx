import { createKipuIcon } from "@/app/pwa-icon-art";

const ICON_VARIANTS = {
  "192": { maskable: false, size: 192 },
  "512": { maskable: false, size: 512 },
  maskable: { maskable: true, size: 512 },
} as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ variant: string }> },
) {
  const { variant } = await params;
  const config = ICON_VARIANTS[variant as keyof typeof ICON_VARIANTS];
  if (!config) return new Response("Not found", { status: 404 });

  const response = createKipuIcon(config.size, config.maskable);
  response.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return response;
}
