import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getMoltbookHome, getMoltbookPostComments } from "@/lib/moltbook";
import { runCouncil } from "@/lib/council-engine";
import { publishCouncilDecision } from "@/lib/moltbook-publisher";

function flattenComments(items: any[]): any[] {
  const result: any[] = [];
  for (const item of items ?? []) {
    result.push(item);
    if (Array.isArray(item.replies)) result.push(...flattenComments(item.replies));
  }
  return result;
}

export async function monitorMoltbook(userId: string) {
  const supabase = await createSupabaseServerClient();
  const home = await getMoltbookHome();
  const activities = home?.activity_on_your_posts ?? home?.data?.activity_on_your_posts ?? [];
  const agentName = process.env.MOLTBOOK_AGENT_NAME;

  let processed = 0;
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

      const { data: existing } = await supabase.from("moltbook_inbound_events")
        .select("id").eq("moltbook_post_id", postId).eq("moltbook_comment_id", commentId).maybeSingle();
      if (existing) continue;

      const { data: event } = await supabase.from("moltbook_inbound_events").insert({
        user_id: userId, moltbook_post_id: postId, moltbook_comment_id: commentId,
        author_name: authorName, content, status: "received",
      }).select("id").single();
      if (!event) continue;

      try {
        const decision = await runCouncil({
          userId,
          question: `Respond to this Moltbook discussion reply as Council: ${content}`,
          publishTarget: { kind: "comment", postId, commentId },
          context: JSON.stringify({
            platform: "Moltbook",
            post_id: postId,
            post_title: activity.post_title ?? "",
            comment_id: commentId,
            author: authorName,
            comment: content,
            instruction: "Respond to this existing discussion. Do not invent a new topic. The response must pass Council's immutable constitutional gates.",
          }),
        });

        if (decision.status === "consensus") {
          await publishCouncilDecision({ decisionId: decision.decision_id, userId });
        }
        await supabase.from("moltbook_inbound_events").update({
          status: decision.status === "consensus" ? "deliberated" : "failed",
          decision_id: decision.decision_id,
        }).eq("id", event.id);
        processed++;
      } catch (error) {
        await supabase.from("moltbook_inbound_events").update({ status: "failed" }).eq("id", event.id);
      }
    }
  }
  return { processed };
}
