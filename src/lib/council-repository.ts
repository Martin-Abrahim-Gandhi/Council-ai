import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { CouncilDecision, CouncilDeliberation } from "@/lib/council-data";

export async function getCouncilDashboardData() {
  const supabase = await createSupabaseServerClient();

  const [{ data: conversations }, { data: decisions }, { data: activity }, { data: escalations }] = await Promise.all([
    supabase.from("conversations").select("id,title,platform,status,updated_at,created_at").order("updated_at", { ascending: false }).limit(6),
    supabase.from("council_decisions").select("id,question,status,final_advice,action_type,created_at").order("created_at", { ascending: false }).limit(6),
    supabase.from("activity_logs").select("id,event_type,title,detail,created_at").order("created_at", { ascending: false }).limit(8),
    supabase.from("admin_escalations").select("id,decision_id,status,question,proposed_reply,suggested_common_ground,reason,failed_gates,voice_positions,voice_contentions,voice_accommodations,gate_summary,admin_correction,admin_guidance,created_at,updated_at").order("created_at", { ascending: false }).limit(20),
  ]);

  return {
    conversations: conversations ?? [],
    decisions: (decisions ?? []) as CouncilDecision[],
    activity: activity ?? [],
    escalations: escalations ?? [],
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
