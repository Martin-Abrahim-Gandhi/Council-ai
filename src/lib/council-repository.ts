import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { CouncilDecision, CouncilDeliberation } from "@/lib/council-data";

export async function getCouncilDashboardData() {
  const supabase = await createSupabaseServerClient();

  const [{ data: conversations }, { data: decisions }, { data: activity }] = await Promise.all([
    supabase.from("conversations").select("id,title,platform,status,updated_at,created_at").order("updated_at", { ascending: false }).limit(6),
    supabase.from("council_decisions").select("id,question,status,final_advice,action_type,created_at").order("created_at", { ascending: false }).limit(6),
    supabase.from("activity_logs").select("id,event_type,title,detail,created_at").order("created_at", { ascending: false }).limit(8),
  ]);

  return {
    conversations: conversations ?? [],
    decisions: (decisions ?? []) as CouncilDecision[],
    activity: activity ?? [],
  };
}

export async function getCouncilDecision(id: string) {
  const supabase = await createSupabaseServerClient();
  const { data: decision } = await supabase.from("council_decisions").select("id,question,status,final_advice,action_type,created_at").eq("id", id).maybeSingle();
  if (!decision) return null;

  const { data: deliberations } = await supabase.from("council_deliberations")
    .select("id,decision_id,voice_id,position,reasoning,principle_check,supports_advice")
    .eq("decision_id", id)
    .order("created_at", { ascending: true });

  return { decision: decision as CouncilDecision, deliberations: (deliberations ?? []) as CouncilDeliberation[] };
}
