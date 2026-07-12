import { redirect } from "next/navigation";

// Stage D — Realidad stopped being a graded metric. Its useful truth (how your
// real spending behaves) lives in the spending view.
export default function RealityRedirect() {
  redirect("/app/spending");
}
