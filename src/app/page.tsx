import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getCouncilDashboardData } from "@/lib/council-repository";
import CouncilDashboard from "@/components/council-dashboard";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims?.sub) redirect("/login");

  const data = await getCouncilDashboardData();
  return <CouncilDashboard email={String(claimsData.claims.email ?? "")} data={data} />;
}
