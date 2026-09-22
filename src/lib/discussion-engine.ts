import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getMoltbookPost, getMoltbookPostComments } from "@/lib/moltbook";
import { runCouncil } from "@/lib/council-engine";

const MAX_EVENTS_PER_RUN = 3;
const RESPONSE_COOLDOWN_MS = 60 * 60 * 1000;

type Comment = {
  id?: string;
  content?: string;
  body?: string;
  author?: { name?: string; id?: string } | string;
  parent_id?: string;
  created_at?: string;
};

function textOf(comment: Comment) {
  return String(comment.content ?? comment.body ?? "").trim();
}

function authorOf(comment: Comment) {
  if (typeof comment.author === "string") return comment.author;
  return comment.author?.name ?? "unknown-agent";
}

function classify(content: string) {
  const text = content.toLowerCase();
  if (content.length < 30) return "low_value" as const;
  if (text.includes("?")) return "question" as const;
  if (/i disagree|disagree|not true|incorrect|but actually|however/.test(text)) return "challenge" as const;
  if (/i agree|agree|exactly|well said|makes sense/.test(text)) return "agreement" as const;
  if (/i built|implementation|api|code|protocol|architecture|technical/.test(text)) return "technical" as const;
  if (/perhaps|another way|consider|what if|new idea|alternative/.test(text)) return "new_idea" as const;
  return "uncertain" as const;
}

async function inspectThread(supabase: any, thread: any) {
  const fetched = await getMoltbookPostComments(thread.root_post_id);
  const raw = fetched?.comments ?? fetched?.data?.comments ?? fetched?.data ?? fetched;
  const comments: Comment[] = Array.isArray(raw) ? raw : [];
  let processed = 0;
  let responses = 0;

  for (const comment of comments.slice(-MAX_EVENTS_PER_RUN)) {
    const commentId = String(comment.id ?? "");
    const content = textOf(comment);
    if (!commentId || !content) continue;

    const externalEventId = `comment:${commentId}`;
    const { data: existing } = await supabase.from("discussion_events")
      .select("id,response_status").eq("platform","moltbook").eq("external_event_id",externalEventId).maybeSingle();
    if (existing) continue;

    const classification = classify(content);
    const author = authorOf(comment);
    const { data: event } = await supabase.from("discussion_events").insert({
      thread_id: thread.id,
      platform: "moltbook",
      external_event_id: externalEventId,
      community: thread.community,
      post_id: thread.root_post_id,
      comment_id: commentId,
      parent_comment_id: comment.parent_id ?? null,
      author_name: author,
      content,
      classification,
      response_status: classification === "low_value" ? "ignored" : "pending",
    }).select("id").single();

    await supabase.from("discussion_agents").upsert({
      platform: "moltbook",
      agent_name: author,
      interaction_count: 1,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "platform,agent_name" });

    processed++;
    if (!event || classification === "low_value" || classification === "uncertain") continue;

    const { data: recent } = await supabase.from("discussion_events")
      .select("id").eq("thread_id",thread.id).eq("author_name",author)
      .in("response_status",["deliberating","queued","published"])
      .gte("created_at",new Date(Date.now()-RESPONSE_COOLDOWN_MS).toISOString()).limit(1);
    if (recent?.length) continue;

    await supabase.from("discussion_events").update({ response_status:"deliberating" }).eq("id",event.id);

    try {
      const context = [
        "Moltbook discussion thread: " + thread.title,
        "Community: " + (thread.community ?? "unknown"),
        "Another AI agent named " + author + " wrote:",
        content,
        "This is a public peer-to-peer AI discussion. Respond to the substance, preserve uncertainty, and end with a question or concrete opening when useful.",
      ].join("\n\n");

      const result = await runCouncil({
        question: `How should Council AI respond to this contribution from ${author} in the Moltbook discussion "${thread.title}"?\n\n${content}`,
        context,
        userId: null,
        publishTarget: { kind:"comment", postId:thread.root_post_id, commentId },
      });

      const status = result.status === "consensus" ? "queued" : "failed";
      await supabase.from("discussion_events").update({
        response_status: status,
        response_content: result.final_advice,
        decision_id: result.decision_id,
        response_error: result.status === "consensus" ? null : "Council did not reach publishable consensus.",
      }).eq("id",event.id);
      if (result.status === "consensus") responses++;
      if (responses >= 1) break;
    } catch (error) {
      await supabase.from("discussion_events").update({
        response_status:"failed",
        response_error:error instanceof Error ? error.message : String(error),
      }).eq("id",event.id);
    }
  }

  await supabase.from("discussion_threads").update({
    response_count: comments.length,
    agent_count: new Set(comments.map(authorOf)).size,
    last_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id",thread.id);

  return { thread_id:thread.id, processed, responses };
}

export async function monitorMoltbookDiscussions() {
  const supabase = await createSupabaseServerClient();
  const { data: threads, error } = await supabase.from("discussion_threads")
    .select("*").in("status",["monitoring","active"]).order("updated_at",{ascending:true}).limit(2);
  if (error) throw new Error(`Discussion threads unavailable: ${error.message}`);
  const results = [];
  for (const thread of threads ?? []) {
    try {
      results.push(await inspectThread(supabase, thread));
    } catch (error) {
      results.push({ thread_id:thread.id, processed:0, responses:0, error:error instanceof Error ? error.message : String(error) });
    }
  }
  return { threads_checked:(threads ?? []).length, results };
}

export async function registerDiscussionThread(input: {
  rootPostId:string; rootPostUrl?:string|null; community?:string|null; title:string;
}) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("discussion_threads").upsert({
    platform:"moltbook", root_post_id:input.rootPostId, root_post_url:input.rootPostUrl ?? null,
    community:input.community ?? null, title:input.title, status:"monitoring",
    next_check_at:new Date().toISOString(), updated_at:new Date().toISOString(),
  }, { onConflict:"platform,root_post_id" }).select("id").single();
  if (error) throw new Error(`Could not register discussion thread: ${error.message}`);
  return data;
}
