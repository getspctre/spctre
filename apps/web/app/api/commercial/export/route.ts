import { redirect } from "next/navigation";

function handleGetApiCommercialExport() {
  redirect("/api/usage-billing/export");
}

export { handleGetApiCommercialExport as GET };
