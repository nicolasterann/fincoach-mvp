import { createKipuIcon } from "./pwa-icon-art";

export const contentType = "image/png";

export function generateImageMetadata() {
  return [
    { contentType, id: "192", size: { height: 192, width: 192 } },
    { contentType, id: "512", size: { height: 512, width: 512 } },
  ];
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const size = (await id) === "512" ? 512 : 192;
  return createKipuIcon(size);
}
