import { getCouncilDashboardData } from "@/lib/council-repository";
import CouncilDashboard from "@/components/council-dashboard";

export default async function Home() {
  const data = await getCouncilDashboardData();
  return <CouncilDashboard data={data} />;
}
