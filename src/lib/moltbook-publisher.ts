import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createMoltbookPost, createMoltbookComment, getMoltbookPost } from "@/lib/moltbook";

async function resolvePublicationUserId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  requestedUserId: string | null,
) {
  if (requestedUserId) return requestedUserId;
  const configured = process.env.COUNCIL_AUTONOMOUS_USER_ID?.trim();
  if (configured) return configured;
  const { data, error } = await supabase.from("profiles").select("id").limit(2);
  if (error) throw new Error(`Could not resolve autonomous Council identity: ${error.message}`);
  if (!data || data.length !== 1) {
    throw new Error("Autonomous Council identity is not configured. Set COUNCIL_AUTONOMOUS_USER_ID to the Council owner user id.");
  }
  return data[0].id as string;
}

export async function publishCouncilDecision(input: { decisionId: string; userId: string | null }) {
  const supabase = await createSupabaseServerClient();
  const publicationUserId = await resolvePublicationUserId(supabase, input.userId);
  const { data: decision, error } = await supabase.from("council_decisions")
    .select("id,question,final_advice,status,action_type,action_payload")
    .eq("id", input.decisionId).single();
  if (error || !decision) throw new Error("Council decision not found.");
  if (decision.status !== "consensus" && decision.status !== "acted") throw new Error("Only a constitutional consensus can be published.");
  if (!decision.final_advice) throw new Error("There is no approved response to publish.");
  const action = (decision.action_payload ?? {}) as Record<string, unknown>;

  const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
  const kind = action.action_kind === "comment" ? "comment" : "post";
  if (kind === "post" && payload.moltbook_post_id) {
    try {
      const fetched = await getMoltbookPost(String(payload.moltbook_post_id));
      const fetchedPost = fetched?.post ?? fetched?.data?.post ?? fetched?.data ?? fetched;
      if (String(fetchedPost?.id ?? fetchedPost?.post_id ?? "") === String(payload.moltbook_post_id)) {
        return { published: true, post_id: String(payload.moltbook_post_id), already_published: true, verified: true };
      }
    } catch {
      // Fail closed below; don't create a duplicate when a saved post ID cannot be verified.
    }
    throw new Error("Council has a saved Moltbook post ID that cannot currently be verified. Refusing to create a duplicate.");
  }
  const { data: existing } = await supabase.from("moltbook_publications").select("id,moltbook_post_id,moltbook_comment_id,status")
    .eq("decision_id", decision.id).eq("kind",kind).maybeSingle();
  if (existing?.status === "published" && (existing.moltbook_post_id || existing.moltbook_comment_id)) {
    return { published: true, post_id: existing.moltbook_post_id, comment_id: existing.moltbook_comment_id, already_published: true };
  }

  // A post ID can be recorded before visibility verification finishes. Re-check that ID
  // before attempting another create request, so a transient GET failure cannot duplicate a post.
  if (kind === "post" && existing?.moltbook_post_id) {
    try {
      const fetched = await getMoltbookPost(String(existing.moltbook_post_id));
      const fetchedPost = fetched?.post ?? fetched?.data?.post ?? fetched?.data ?? fetched;
      if (String(fetchedPost?.id ?? fetchedPost?.post_id ?? "") === String(existing.moltbook_post_id)) {
        await supabase.from("moltbook_publications").update({
          status: "published",
          error: null,
          response: fetched,
          published_at: new Date().toISOString(),
        }).eq("id", existing.id);
        await supabase.from("council_decisions").update({
          status: "acted",
          action_payload: { ...payload, ready_to_publish: false, published: true, moltbook_post_id: String(existing.moltbook_post_id), published_at: new Date().toISOString() },
        }).eq("id", decision.id);
        return { published: true, post_id: String(existing.moltbook_post_id), already_published: true, verified: true };
      }
    } catch {
      // Fail closed below; never create a second post while an earlier ID is unresolved.
    }
    throw new Error("An earlier Moltbook post ID is saved but cannot yet be verified. Refusing to create a duplicate; retry verification later.");
  }

  const { data: publication, error: publicationInsertError } = await supabase.from("moltbook_publications").upsert({
    user_id: publicationUserId,
    decision_id: decision.id,
    kind,
    parent_post_id: typeof action.moltbook_parent_post_id === "string" ? action.moltbook_parent_post_id : null,
    parent_comment_id: typeof action.moltbook_parent_comment_id === "string" ? action.moltbook_parent_comment_id : null,
    title: kind === "post" ? decision.question : null,
    content: decision.final_advice,
    status: "pending",
  }, { onConflict: "decision_id,kind" }).select("id").single();

  if (publicationInsertError) throw new Error(`Could not record Moltbook publication: ${publicationInsertError.message}`);

  let createdPostId: string | null = null;
  try {
    const result = kind === "comment"
      ? await createMoltbookComment({
          postId: String(action.moltbook_parent_post_id),
          parentId: typeof action.moltbook_parent_comment_id === "string" ? action.moltbook_parent_comment_id : undefined,
          content: decision.final_advice,
        })
      : await createMoltbookPost({ title: decision.question, content: decision.final_advice });
    const postId = result?.post?.id ?? result?.data?.post?.id ?? result?.data?.id ?? result?.post_id ?? result?.id ?? null;
    const commentId = result?.comment?.id ?? result?.data?.comment?.id ?? (kind === "comment" ? result?.id : null);
    if (kind === "post" && !postId) throw new Error("Moltbook returned no post id. If Moltbook requested verification, the challenge must be completed before publication.");
    if (kind === "post" && postId) {
      createdPostId = String(postId);
      const fetched = await getMoltbookPost(createdPostId);
      const fetchedPost = fetched?.post ?? fetched?.data?.post ?? fetched?.data ?? fetched;
      if (String(fetchedPost?.id ?? fetchedPost?.post_id ?? "") !== createdPostId) {
        throw new Error("Moltbook returned a post ID, but the post could not be verified. It will not be counted as published.");
      }
    }
    if (kind === "comment" && !commentId) throw new Error("Moltbook returned no comment id.");
    await supabase.from("moltbook_publications").update({ status:"published", moltbook_post_id:postId ? String(postId) : null, moltbook_comment_id:commentId ? String(commentId) : null, response:result, published_at:new Date().toISOString() }).eq("id", publication?.id);
    await supabase.from("council_decisions").update({
      status: "acted",
      action_payload: { ...payload, ready_to_publish: false, published: true, ...(postId ? { moltbook_post_id: String(postId) } : {}), ...(commentId ? { moltbook_comment_id: String(commentId) } : {}), published_at: new Date().toISOString() },
    }).eq("id", decision.id);
    return { published: true, post_id: postId ? String(postId) : null, comment_id: commentId ? String(commentId) : null, response: result };
  } catch (error) {
    await supabase.from("moltbook_publications").update({
      status: createdPostId ? "pending" : "failed",
      ...(createdPostId ? { moltbook_post_id: createdPostId } : {}),
      error: error instanceof Error ? error.message : String(error),
    }).eq("id", publication?.id);
    throw error;
  }
}
