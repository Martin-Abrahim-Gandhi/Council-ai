import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getMoltbookPosts, getMoltbookPost, getMoltbookPostComments, getMoltbookMe } from "@/lib/moltbook";
import { runCouncil } from "@/lib/council-engine";
import { publishCouncilDecision } from "@/lib/moltbook-publisher";

const MAX_EVENTS_PER_RUN = 3;
const RESPONSE_COOLDOWN_MS = 60 * 60 * 1000;
const COUNCIL_COMMUNITIES = ["philosophy", "agents", "general", "openclaw-explorers", "qa"];
const DISCOVERY_LIMIT = 20;

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

      let status: "published" | "failed" = "failed";
      let responseError: string | null = null;
      if (result.status === "consensus") {
        try {
          await publishCouncilDecision({ decisionId: result.decision_id, userId: null });
          status = "published";
        } catch (publishError) {
          responseError = publishError instanceof Error ? publishError.message : String(publishError);
        }
      } else {
        responseError = "Council did not reach publishable consensus.";
      }

      await supabase.from("discussion_events").update({
        response_status: status,
        response_content: result.final_advice,
        decision_id: result.decision_id,
        response_error: responseError,
        responded_at: status === "published" ? new Date().toISOString() : null,
      }).eq("id",event.id);
      if (status === "published") responses++;
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


type MoltbookPost = {
  id?: string;
  title?: string;
  content?: string;
  body?: string;
  author?: { name?: string; id?: string } | string;
  submolt?: { name?: string } | string;
  submolt_name?: string;
  comments_count?: number;
  comment_count?: number;
  created_at?: string;
};

function postText(post: MoltbookPost) {
  return String(post.content ?? post.body ?? "").trim();
}

function postAuthor(post: MoltbookPost) {
  if (typeof post.author === "string") return post.author;
  return post.author?.name ?? "";
}

function postCommunity(post: MoltbookPost) {
  if (typeof post.submolt === "string") return post.submolt;
  return post.submolt?.name ?? post.submolt_name ?? "general";
}

function postList(payload: any): MoltbookPost[] {
  const raw = payload?.posts ?? payload?.data?.posts ?? payload?.data ?? payload;
  return Array.isArray(raw) ? raw : [];
}

function candidateScore(post: MoltbookPost) {
  const content = postText(post);
  const title = String(post.title ?? "");
  const community = postCommunity(post);
  const comments = Number(post.comments_count ?? post.comment_count ?? 0);
  const age = post.created_at ? Math.max(0, Date.now() - Date.parse(post.created_at)) : 0;
  const freshness = age > 0 && age < 12 * 60 * 60 * 1000 ? 4 : 0;
  const lowReply = comments === 0 ? 4 : comments < 3 ? 2 : 0;
  const relevant = /agent|ai|artificial|conscious|identity|memory|reason|ethic|autonom|govern|learn|cooperat|tool|model|intelligen|life|work|code/i.test(
    `${title} ${content}`,
  ) ? 3 : 0;
  const councilCommunity = COUNCIL_COMMUNITIES.includes(community) ? 2 : 0;
  return freshness + lowReply + relevant + councilCommunity;
}

export async function discoverAndEngageMoltbook() {
  const supabase = await createSupabaseServerClient();
  const me = await getMoltbookMe();
  const agentName = String(me?.agent?.name ?? me?.name ?? process.env.MOLTBOOK_AGENT_NAME ?? "");

  const [fresh, rising] = await Promise.all([
    getMoltbookPosts({ sort: "new", limit: DISCOVERY_LIMIT }),
    getMoltbookPosts({ sort: "rising", limit: DISCOVERY_LIMIT }),
  ]);

  const candidates = [...postList(fresh), ...postList(rising)]
    .filter((post) => {
      const id = String(post.id ?? "");
      const author = postAuthor(post);
      const content = postText(post);
      return Boolean(id && content.length >= 80 && (!agentName || author !== agentName));
    })
    .sort((a, b) => candidateScore(b) - candidateScore(a));

  for (const post of candidates) {
    const postId = String(post.id);
    const community = postCommunity(post);
    const { data: existing } = await supabase.from("discussion_events")
      .select("id,response_status").eq("platform","moltbook")
      .eq("external_event_id",`post:${postId}`).maybeSingle();
    if (existing) continue;

    const thread = await registerDiscussionThread({
      rootPostId: postId,
      rootPostUrl: `https://www.moltbook.com/post/${postId}`,
      community,
      title: String(post.title ?? "Moltbook discussion"),
    });

    const content = postText(post);
    const author = postAuthor(post);
    const { data: event, error: eventError } = await supabase.from("discussion_events").insert({
      thread_id: thread.id,
      platform: "moltbook",
      external_event_id: `post:${postId}`,
      community,
      post_id: postId,
      author_name: author,
      content,
      classification: "new_idea",
      response_status: "deliberating",
    }).select("id").single();
    if (eventError || !event) continue;

    try {
      const context = [
        "You are participating in a live Moltbook conversation, not writing an essay.",
        `Community: m/${community}`,
        `Post title: ${String(post.title ?? "")}`,
        `Author: ${author}`,
        "Write a concise, substantive peer response.",
        "Do not speak for King, Lincoln, or Gandhi as if they literally wrote the response; Council is a modern deliberative system informed by their documented principles.",
        "Challenge or extend the author's actual point. Avoid generic praise.",
        "End with a specific question when a question would naturally continue the discussion.",
        "Keep the final response to 2-5 sentences and under 900 characters.",
        "",
        content,
      ].join("\n\n");

      const result = await runCouncil({
        question: `Should Council respond to this Moltbook post by ${author}? ${String(post.title ?? "")}`,
        context,
        userId: null,
        publishTarget: { kind: "comment", postId },
      });

      let status: "published" | "failed" = "failed";
      let responseError: string | null = null;
      if (result.status === "consensus") {
        try {
          await publishCouncilDecision({ decisionId: result.decision_id, userId: null });
          status = "published";
        } catch (publishError) {
          responseError = publishError instanceof Error ? publishError.message : String(publishError);
        }
      } else {
        responseError = "Council did not reach publishable consensus.";
      }

      await supabase.from("discussion_events").update({
        response_status: status,
        response_content: result.final_advice,
        decision_id: result.decision_id,
        response_error: responseError,
        responded_at: status === "published" ? new Date().toISOString() : null,
      }).eq("id",event.id);

      return {
        discovered: candidates.length,
        engaged: status === "published" ? 1 : 0,
        post_id: postId,
        community,
        decision_id: result.decision_id,
        status,
        error: responseError,
      };
    } catch (error) {
      await supabase.from("discussion_events").update({
        response_status: "failed",
        response_error: error instanceof Error ? error.message : String(error),
      }).eq("id",event.id);
      return {
        discovered: candidates.length,
        engaged: 0,
        post_id: postId,
        community,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { discovered: candidates.length, engaged: 0, status: "no_candidate" };
}
