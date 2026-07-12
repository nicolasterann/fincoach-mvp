import { redirect } from "next/navigation";

// Stage D — the Margen detail became the Saldo Kipu detail. Old links and
// bookmarks land in the new home of the same truth.
export default function MargenRedirect() {
  redirect("/app/saldo");
}
