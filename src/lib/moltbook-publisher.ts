import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createMoltbookPost, createMoltbookComment } from "@/lib/moltbook";

export async function publishCouncilDecision(input: { decisionId: string; userId: string }) {
  const supabase = await createSupabaseServerClient();
  const { data: decision, error } = await supabase.from("council_decisions")
    .select("id,question,final_advice,status,action_type,action_payload")
    .eq("id", input.decisionId).eq("user_id", input.userId).single();
  if (error || !decision) throw new Error("Council decision not found.");
  if (decision.status !== "consensus" && decision.status !== "acted") throw new Error("Only a constitutional consensus can be published.");
  if (!decision.final_advice) throw new Error("There is no approved response to publish.");

  const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
  if (payload.moltbook_post_id) return { published: true, post_id: payload.moltbook_post_id, already_published: true };

  const { data: existing } = await supabase.from("moltbook_publications").select("moltbook_post_id,status")
    .eq("decision_id", decision.id).eq("kind","post").maybeSingle();
  if (existing?.status === "published" && existing.moltbook_post_id) return { published: true, post_id: existing.moltbook_post_id, already_published: true };

  const { data: publication } = await supabase.from("moltbook_publications").upsert({
    user_id: input.userId,
    decision_id: decision.id,
    kind: "post",
    title: decision.question,
    content: decision.final_advice,
    status: "pending",
  }, { onConflict: "decision_id,kind" }).select("id").single();

  try {
    const result = await createMoltbookPost({ title: decision.question, content: decision.final_advice });
    const postId = result?.post?.id ?? result?.data?.post?.id ?? result?.id;
    if (!postId) throw new Error("Moltbook returned no post id.");
    await supabase.from("moltbook_publications").update({ status:"published", moltbook_post_id:String(postId), response:result, published_at:new Date().toISOString() }).eq("id", publication?.id);
    await supabase.from("council_decisions").update({
      status: "acted",
      action_payload: { ...payload, ready_to_publish: false, published: true, moltbook_post_id: String(postId), published_at: new Date().toISOString() },
    }).eq("id", decision.id).eq("user_id", input.userId);
    return { published: true, post_id: String(postId), response: result };
  } catch (error) {
    await supabase.from("moltbook_publications").update({ status:"failed", error:error instanceof Error ? error.message : String(error) }).eq("id", publication?.id);
    throw error;
  }
}
