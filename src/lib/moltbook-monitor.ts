import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getMoltbookHome, getMoltbookPostComments } from "@/lib/moltbook";
import { runCouncilParcel } from "@/lib/council-engine";
import { publishCouncilDecision } from "@/lib/moltbook-publisher";

type Stage = "king" | "lincoln" | "gandhi" | "chamber";
const STAGES: Stage[] = ["king", "lincoln", "gandhi", "chamber"];

function flattenComments(items: any[]): any[] {
  const result: any[] = [];
  for (const item of items ?? []) {
    result.push(item);
    if (Array.isArray(item.replies)) result.push(...flattenComments(item.replies));
  }
  return result;
}

function nextStage(payload: Record<string, unknown>): Stage {
  const current = typeof payload.parcel_stage === "string" ? payload.parcel_stage : null;
  if (!current) return "king";
  const index = STAGES.indexOf(current as Stage);
  return index >= 0 ? STAGES[index] : "king";
}

async function advanceDecision(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  decisionId: string,
) {
  const { data: decision, error } = await supabase
    .from("council_decisions")
    .select("id,question,context,action_payload")
    .eq("id", decisionId)
    .eq("user_id", userId)
    .single();

  if (error || !decision) throw new Error("Council decision not found.");

  const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
  const stage = nextStage(payload);

  const result = await runCouncilParcel({
    stage,
    decisionId,
    question: decision.question,
    context: typeof decision.context === "object" && decision.context
      ? JSON.stringify(decision.context)
      : String(decision.context ?? ""),
    userId,
    publishTarget: {
      kind: "comment",
      postId: typeof payload.moltbook_parent_post_id === "string" ? payload.moltbook_parent_post_id : undefined,
      commentId: typeof payload.moltbook_parent_comment_id === "string" ? payload.moltbook_parent_comment_id : undefined,
    },
  });

  if (stage === "chamber" && result.status === "consensus") {
    await publishCouncilDecision({ decisionId, userId });
  }

  return { stage, status: result.status };
}

// Poll-driven inbound conversation bridge: each invocation advances one durable Council stage.\nexport async function monitorMoltbook(userId: string) {
  const supabase = await createSupabaseServerClient();
  const home = await getMoltbookHome();
  const activities = home?.activity_on_your_posts ?? home?.data?.activity_on_your_posts ?? [];
  const agentName = process.env.MOLTBOOK_AGENT_NAME;

  let processed = 0;
  let failed = 0;

  // One Council parcel stage per monitor invocation keeps each scheduled run bounded.
  for (const activity of activities.slice(0, 10)) {
    const postId = String(activity.post_id ?? "");
    if (!postId) continue;

    const commentsResponse = await getMoltbookPostComments(postId);
    const comments = flattenComments(commentsResponse?.comments ?? commentsResponse?.data?.comments ?? []);

    for (const comment of comments.slice(0, 100)) {
      const commentId = String(comment.id ?? "");
      const authorName = comment.author?.name ?? comment.agent?.name ?? "";
      const content = String(comment.content ?? "");
      if (!commentId || !content || (agentName && authorName === agentName)) continue;

      const { data: existing } = await supabase
        .from("moltbook_inbound_events")
        .select("id,decision_id,status")
        .eq("moltbook_post_id", postId)
        .eq("moltbook_comment_id", commentId)
        .maybeSingle();

      if (existing?.status === "deliberated" || existing?.status === "ignored") continue;

      let decisionId = existing?.decision_id ?? null;

      try {
        if (!decisionId) {
          const { data: decision, error: decisionError } = await supabase
            .from("council_decisions")
            .insert({
              user_id: userId,
              question: `Respond to this Moltbook discussion reply as Council: ${content}`,
              context: {
                platform: "Moltbook",
                post_id: postId,
                post_title: activity.post_title ?? "",
                comment_id: commentId,
                author: authorName,
                comment: content,
                instruction: "Respond to this existing discussion. Do not invent a new topic. The response must pass Council's immutable constitutional gates.",
                parcel_protocol: true,
              },
              status: "deliberating",
              action_type: "reply",
              action_payload: {
                action_kind: "comment",
                moltbook_parent_post_id: postId,
                moltbook_parent_comment_id: commentId,
                parcel_stage: null,
                moltbook_inbound_comment_id: commentId,
              },
            })
            .select("id")
            .single();

          if (decisionError || !decision) {
            throw new Error(`Could not create Council decision: ${decisionError?.message ?? "unknown error"}`);
          }

          decisionId = decision.id;

          const { error: eventError } = await supabase
            .from("moltbook_inbound_events")
            .insert({
              user_id: userId,
              moltbook_post_id: postId,
              moltbook_comment_id: commentId,
              author_name: authorName,
              content,
              decision_id: decisionId,
              status: "received",
            });

          if (eventError) throw new Error(`Could not record Moltbook inbound event: ${eventError.message}`);
        }

        const result = await advanceDecision(supabase, userId, decisionId);

        if (result.stage === "chamber") {
          await supabase
            .from("moltbook_inbound_events")
            .update({ status: "deliberated", decision_id: decisionId })
            .eq("moltbook_post_id", postId)
            .eq("moltbook_comment_id", commentId)
            .eq("user_id", userId);
        }

        processed++;
        break;
      } catch (error) {
        failed++;
        await supabase
          .from("moltbook_inbound_events")
          .update({ status: "failed", decision_id: decisionId })
          .eq("moltbook_post_id", postId)
          .eq("moltbook_comment_id", commentId)
          .eq("user_id", userId);
        console.error("[moltbook:monitor] failed", {
          postId,
          commentId,
          decisionId,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }

    if (processed + failed > 0) break;
  }

  return { processed, failed };
}
