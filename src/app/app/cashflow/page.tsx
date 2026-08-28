import { redirect } from "next/navigation";

// The month perspective absorbed the old duplicate cash-flow surface. Keep the
// route as a compatibility door for saved links; it must not perform a money read.
export default function CashflowRedirect() {
  redirect("/app/mes");
}
