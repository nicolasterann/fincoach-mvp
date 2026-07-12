import { redirect } from "next/navigation";

// Stage D — Pulso Kipu (0-100 score) was retired from the product face. Old
// links and bookmarks land on the Saldo Kipu, the one number that matters now.
export default function ReadinessRedirect() {
  redirect("/app/saldo");
}
