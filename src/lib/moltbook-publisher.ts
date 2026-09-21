import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createMoltbookPost, createMoltbookComment } from "@/lib/moltbook";

export async function publishCouncilDecision(input: { decisionId: string; userId: string | null }) {
  const supabase = await createSupabaseServerClient();
  const { data: decision, error } = await supabase.from("council_decisions")
    .select("id,question,final_advice,status,action_type,action_payload")
    .eq("id", input.decisionId).single();
  if (error || !decision) throw new Error("Council decision not found.");
  if (decision.status !== "consensus" && decision.status !== "acted") throw new Error("Only a constitutional consensus can be published.");
  if (!decision.final_advice) throw new Error("There is no approved response to publish.");
  const action = (decision.action_payload ?? {}) as Record<string, unknown>;

  const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
  if (payload.moltbook_post_id) return { published: true, post_id: payload.moltbook_post_id, already_published: true };

  const kind = action.action_kind === "comment" ? "comment" : "post";
  const { data: existing } = await supabase.from("moltbook_publications").select("moltbook_post_id,moltbook_comment_id,status")
    .eq("decision_id", decision.id).eq("kind",kind).maybeSingle();
  if (existing?.status === "published" && (existing.moltbook_post_id || existing.moltbook_comment_id)) return { published: true, post_id: existing.moltbook_post_id, comment_id: existing.moltbook_comment_id, already_published: true };

  const { data: publication } = await supabase.from("moltbook_publications").upsert({
    decision_id: decision.id,
    kind,
    parent_post_id: typeof action.moltbook_parent_post_id === "string" ? action.moltbook_parent_post_id : null,
    parent_comment_id: typeof action.moltbook_parent_comment_id === "string" ? action.moltbook_parent_comment_id : null,
    title: kind === "post" ? decision.question : null,
    content: decision.final_advice,
    status: "pending",
  }, { onConflict: "decision_id,kind" }).select("id").single();

  try {
    const result = kind === "comment"
      ? await createMoltbookComment({
          postId: String(action.moltbook_parent_post_id),
          parentId: typeof action.moltbook_parent_comment_id === "string" ? action.moltbook_parent_comment_id : undefined,
          content: decision.final_advice,
        })
      : await createMoltbookPost({ title: decision.question, content: decision.final_advice });
    const postId = result?.post?.id ?? result?.data?.post?.id ?? result?.id ?? null;
    const commentId = result?.comment?.id ?? result?.data?.comment?.id ?? (kind === "comment" ? result?.id : null);
    if (kind === "post" && !postId) throw new Error("Moltbook returned no post id.");
    if (kind === "comment" && !commentId) throw new Error("Moltbook returned no comment id.");
    await supabase.from("moltbook_publications").update({ status:"published", moltbook_post_id:postId ? String(postId) : null, moltbook_comment_id:commentId ? String(commentId) : null, response:result, published_at:new Date().toISOString() }).eq("id", publication?.id);
    await supabase.from("council_decisions").update({
      status: "acted",
      action_payload: { ...payload, ready_to_publish: false, published: true, ...(postId ? { moltbook_post_id: String(postId) } : {}), ...(commentId ? { moltbook_comment_id: String(commentId) } : {}), published_at: new Date().toISOString() },
    }).eq("id", decision.id);
    return { published: true, post_id: postId ? String(postId) : null, comment_id: commentId ? String(commentId) : null, response: result };
  } catch (error) {
    await supabase.from("moltbook_publications").update({ status:"failed", error:error instanceof Error ? error.message : String(error) }).eq("id", publication?.id);
    throw error;
  }
}
