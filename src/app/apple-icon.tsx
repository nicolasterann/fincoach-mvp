import { createKipuIcon } from "./pwa-icon-art";

export const contentType = "image/png";
export const size = { height: 180, width: 180 };

export default function AppleIcon() {
  return createKipuIcon(size.width);
}
