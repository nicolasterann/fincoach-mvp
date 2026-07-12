import { redirect } from "next/navigation";

// Stage D — Precisión stopped being a graded metric. When something is stale
// the home shows ONE action card; the place to update your data is Mis datos.
export default function PrecisionRedirect() {
  redirect("/app/mis-datos");
}
