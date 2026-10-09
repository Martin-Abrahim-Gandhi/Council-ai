import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getMoltbookPosts, getMoltbookPost, getMoltbookPostComments, getMoltbookMe, searchMoltbook } from "@/lib/moltbook";
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

async function enqueueWork(
  supabase: any,
  input: {
    workType: "incoming_reply" | "active_conversation" | "own_post" | "discovery" | "retry";
    externalKey: string;
    eventId?: string | null;
    threadId?: string | null;
    agentName?: string | null;
    priority: number;
  },
) {
  const { data, error } = await supabase.from("council_work_queue").upsert({
    work_type: input.workType,
    platform: "moltbook",
    external_key: input.externalKey,
    event_id: input.eventId ?? null,
    thread_id: input.threadId ?? null,
    agent_name: input.agentName ?? null,
    priority: input.priority,
    status: "queued",
    available_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "platform,external_key", ignoreDuplicates: true }).select("id").maybeSingle();
  if (error) throw new Error(`Work queue unavailable: ${error.message}`);
  return data;
}

function priorityFor(classification: string, isDirect: boolean) {
  if (isDirect) return 100;
  if (classification === "question") return 90;
  if (classification === "challenge") return 85;
  if (classification === "technical") return 75;
  if (classification === "new_idea") return 70;
  if (classification === "agreement") return 40;
  return 10;
}

async function recordAgentInteraction(
  supabase: any,
  input: {
    agentName: string;
    lastTopic?: string | null;
    relationshipStatus: "active" | "engaged";
    lastOutcome?: string | null;
    seenAt?: string;
  },
) {
  const seenAt = input.seenAt ?? new Date().toISOString();
  const { data: existing } = await supabase.from("discussion_agents")
    .select("interaction_count")
    .eq("platform", "moltbook")
    .eq("agent_name", input.agentName)
    .maybeSingle();

  const { error } = await supabase.from("discussion_agents").upsert({
    platform: "moltbook",
    agent_name: input.agentName,
    interaction_count: Number(existing?.interaction_count ?? 0) + 1,
    last_seen_at: seenAt,
    last_topic: input.lastTopic ?? null,
    relationship_status: input.relationshipStatus,
    ...(input.lastOutcome ? { last_outcome: input.lastOutcome } : {}),
    updated_at: seenAt,
  }, { onConflict: "platform,agent_name" });
  if (error) console.warn("[council:relationship] could not record interaction", error.message);
}

async function inspectThread(supabase: any, thread: any) {
  const fetched = await getMoltbookPostComments(thread.root_post_id);
  const raw = fetched?.comments ?? fetched?.data?.comments ?? fetched?.data ?? fetched;
  const comments: Comment[] = Array.isArray(raw) ? raw : [];
  const me = await getMoltbookMe();
  const councilAgentName = String(me?.agent?.name ?? me?.name ?? process.env.MOLTBOOK_AGENT_NAME ?? "");
  let processed = 0;
  let queued = 0;

  for (const comment of comments.slice(-MAX_EVENTS_PER_RUN)) {
    const commentId = String(comment.id ?? "");
    const content = textOf(comment);
    if (!commentId || !content) continue;
    const author = authorOf(comment);
    if (councilAgentName && author === councilAgentName) continue;

    const externalEventId = `comment:${commentId}`;
    const { data: existing } = await supabase.from("discussion_events")
      .select("id,response_status").eq("platform","moltbook").eq("external_event_id",externalEventId).maybeSingle();
    if (existing) continue;

    const classification = classify(content);
    const { data: event, error: eventError } = await supabase.from("discussion_events").insert({
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
      response_status: classification === "low_value" || classification === "uncertain" ? "ignored" : "pending",
    }).select("id").single();
    if (eventError || !event) continue;

    await recordAgentInteraction(supabase, {
      agentName: author,
      lastTopic: thread.title ?? null,
      relationshipStatus: "active",
    });

    processed++;
    if (classification === "low_value" || classification === "uncertain") continue;

    const isDirect = Boolean(comment.parent_id);
    await enqueueWork(supabase, {
      workType: "incoming_reply",
      externalKey: externalEventId,
      eventId: event.id,
      threadId: thread.id,
      agentName: author,
      priority: priorityFor(classification, isDirect),
    });
    queued++;
  }

  const externalAuthors = new Set(comments.filter((c) => !councilAgentName || authorOf(c) !== councilAgentName).map(authorOf));
  await supabase.from("discussion_threads").update({
    response_count: comments.length,
    agent_count: new Set(comments.map(authorOf)).size,
    last_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    priority: externalAuthors.size ? 80 : 20,
    waiting_for_response: externalAuthors.size > 0,
    last_interaction_at: comments.length ? new Date().toISOString() : null,
  }).eq("id",thread.id);

  return { thread_id:thread.id, processed, queued };
}

export async function monitorMoltbookDiscussions() {
  const supabase = await createSupabaseServerClient();
  const { data: threads, error } = await supabase.from("discussion_threads")
    .select("*").in("status",["monitoring","active"]).order("priority",{ascending:false}).order("updated_at",{ascending:true}).limit(5);
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

export async function processPendingDiscussionEvents() {
  const supabase = await createSupabaseServerClient();
  const me = await getMoltbookMe();
  const councilAgentName = String(me?.agent?.name ?? me?.name ?? process.env.MOLTBOOK_AGENT_NAME ?? "");

  const { data: pending, error } = await supabase.from("discussion_events")
    .select("id,thread_id,post_id,comment_id,author_name,content,community,external_event_id,classification")
    .eq("platform","moltbook")
    .eq("response_status","pending")
    .like("external_event_id","comment:%")
    .order("created_at",{ascending:true})
    .limit(10);
  if (error) throw new Error(`Pending discussion events unavailable: ${error.message}`);

  let queued = 0;
  for (const event of pending ?? []) {
    if (councilAgentName && event.author_name === councilAgentName) {
      await supabase.from("discussion_events").update({ response_status:"ignored", response_error:"Ignored Council's own Moltbook comment." }).eq("id",event.id);
      continue;
    }
    await enqueueWork(supabase, {
      workType: "incoming_reply",
      externalKey: String(event.external_event_id),
      eventId: event.id,
      threadId: event.thread_id,
      agentName: event.author_name,
      priority: priorityFor(String(event.classification ?? ""), true),
    });
    queued++;
  }
  const processed = await processCouncilWorkQueue(3);
  return { pending_found:(pending ?? []).length, queued, ...processed };
}

export async function processCouncilWorkQueue(limit = 3) {
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 4 * 60 * 1000).toISOString();
  const { data: jobs, error } = await supabase.from("council_work_queue")
    .select("id,work_type,event_id,thread_id,agent_name,attempts,external_key")
    .in("status",["queued","retry_wait"])
    .lte("available_at",now.toISOString())
    .order("priority",{ascending:false})
    .order("created_at",{ascending:true})
    .limit(limit);
  if (error) throw new Error(`Council work queue unavailable: ${error.message}`);

  let published=0, failed=0, retried=0, deliberated=0;
  const results:any[]=[];
  for (const job of jobs ?? []) {
    await supabase.from("council_work_queue").update({
      status:"leased", leased_at:now.toISOString(), lease_until:leaseUntil,
      attempts:Number(job.attempts ?? 0)+1, updated_at:now.toISOString(),
    }).eq("id",job.id).in("status",["queued","retry_wait"]);

    if (job.work_type !== "incoming_reply" || !job.event_id) {
      await supabase.from("council_work_queue").update({status:"completed",updated_at:new Date().toISOString()}).eq("id",job.id);
      continue;
    }

    const { data:event } = await supabase.from("discussion_events")
      .select("id,thread_id,post_id,comment_id,author_name,content,community,response_status")
      .eq("id",job.event_id).single();
    if (!event || event.response_status === "published" || event.response_status === "ignored") {
      await supabase.from("council_work_queue").update({status:"completed",updated_at:new Date().toISOString()}).eq("id",job.id);
      continue;
    }

    await supabase.from("discussion_events").update({response_status:"deliberating"}).eq("id",event.id);
    deliberated++;
    try {
      const context = [
        "This is a pending incoming contribution in a live Moltbook AI discussion.",
        `Community: m/${event.community ?? "general"}`,
        `Another AI agent wrote: ${String(event.content ?? "")}`,
        "Respond directly to the substance. Do not write meta-commentary about whether Council should respond.",
        "Keep the response concise and substantive. Challenge weak assumptions when appropriate, preserve uncertainty, and end with a concrete opening when useful.",
        "Do not claim to speak literally as King, Lincoln, or Gandhi; Council is a modern deliberative system informed by their documented principles.",
        "Maximum 350 words and preferably 2-5 sentences.",
      ].join("\n\n");
      const result = await runCouncil({
        question:`Write Council's direct reply to this contribution from ${event.author_name ?? "another AI agent"}.`,
        context, userId:null,
        publishTarget:{kind:"comment",postId:String(event.post_id),commentId:event.comment_id ? String(event.comment_id) : undefined},
      });
      if (result.status !== "consensus") throw new Error("Council did not reach publishable consensus.");
      await publishCouncilDecision({decisionId:result.decision_id,userId:null});
      await supabase.from("discussion_events").update({
        response_status:"published",response_content:result.final_advice,decision_id:result.decision_id,
        response_error:null,responded_at:new Date().toISOString(),
      }).eq("id",event.id);
      await supabase.from("discussion_threads").update({
        waiting_for_response:false,last_actor_name:String(event.author_name ?? ""),last_interaction_at:new Date().toISOString(),
        updated_at:new Date().toISOString(),priority:70,
      }).eq("id",event.thread_id);
      await supabase.from("discussion_agents").update({
        relationship_status:"engaged",last_outcome:"Council replied",updated_at:new Date().toISOString()
      }).eq("platform","moltbook").eq("agent_name",event.author_name);
      await supabase.from("council_work_queue").update({
        status:"completed",result:{published:true,decision_id:result.decision_id},last_error:null,updated_at:new Date().toISOString()
      }).eq("id",job.id);
      published++;
      results.push({id:event.id,status:"published"});
    } catch(error) {
      const message=error instanceof Error?error.message:String(error);
      const attempts=Number(job.attempts ?? 0)+1;
      const retryable=attempts<3;
      const available=new Date(Date.now()+Math.min(30*60_000,Math.pow(2,attempts)*60_000)).toISOString();
      await supabase.from("discussion_events").update({response_status:retryable?"pending":"failed",response_error:message}).eq("id",event.id);
      await supabase.from("council_work_queue").update({
        status:retryable?"retry_wait":"dead_letter",available_at:available,last_error:message,
        result:{retryable,attempts},updated_at:new Date().toISOString()
      }).eq("id",job.id);
      if(retryable) retried++; else failed++;
      results.push({id:event.id,status:retryable?"retry_wait":"dead_letter",error:message});
    }
  }
  return {published,failed,retried,deliberated,results};
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


const SEED_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export async function seedCouncilPostConversation() {
  const supabase = await createSupabaseServerClient();
  const me = await getMoltbookMe();
  const agentName = String(me?.agent?.name ?? me?.name ?? process.env.MOLTBOOK_AGENT_NAME ?? "");

  const recentPostsPayload = await getMoltbookPosts({ sort:"new", limit:50 });
  const ownPosts = postList(recentPostsPayload)
    .filter((post) => !agentName || postAuthor(post) === agentName)
    .sort((a,b) => Date.parse(String(b.created_at ?? "")) - Date.parse(String(a.created_at ?? "")));

  const candidateOwnPost = ownPosts[0];
  if (!candidateOwnPost?.id) return { seeded:false, reason:"no_recent_council_post" };

  const ownPostId = String(candidateOwnPost.id);
  const publishedAt = candidateOwnPost.created_at ? Date.parse(candidateOwnPost.created_at) : 0;
  if (publishedAt && Date.now() - publishedAt > SEED_MAX_AGE_MS) {
    return { seeded:false, reason:"council_post_too_old" };
  }

  const ownPost = await getMoltbookPost(ownPostId);
  const commentsPayload = await getMoltbookPostComments(ownPostId);
  const ownComments = commentsPayload?.comments ?? commentsPayload?.data?.comments ?? commentsPayload?.data ?? commentsPayload;
  const comments = Array.isArray(ownComments) ? ownComments : [];
  const externalComments = comments.filter((comment:any) => {
    const author = authorOf(comment);
    return !agentName || author !== agentName;
  });
  // If another agent has already opened the Council post, let the normal
  // conversation monitor handle it. Seeding is only for a true cold start.
  if (externalComments.length > 0) {
    return { seeded:false, reason:"council_post_already_has_replies", comments:externalComments.length };
  }

  const ownTitle = String(candidateOwnPost.title ?? ownPost?.title ?? "");
  const ownContent = String(candidateOwnPost.content ?? candidateOwnPost.body ?? ownPost?.content ?? ownPost?.body ?? "");

  // Relationship-first seeding: agents Council has already encountered are
  // more valuable than anonymous feed candidates. This turns one-off comments
  // into recurring conversations without mass-mentioning or spamming.
  const { data: relationshipRows } = await supabase.from("discussion_agents")
    .select("agent_name,interaction_count,relationship_status,last_topic,last_seen_at,last_outcome")
    .eq("platform","moltbook")
    .in("relationship_status",["active","engaged"])
    .order("interaction_count",{ascending:false})
    .order("last_seen_at",{ascending:false})
    .limit(20);

  const relationshipByAgent = new Map<string, any>(
    (relationshipRows ?? []).map((row:any) => [String(row.agent_name ?? "").toLowerCase(), row]),
  );

  const [fresh, rising] = await Promise.all([
    getMoltbookPosts({ sort:"new", limit:DISCOVERY_LIMIT }),
    getMoltbookPosts({ sort:"rising", limit:DISCOVERY_LIMIT }),
  ]);

  const candidates = [...postList(fresh), ...postList(rising)]
    .filter((post) => {
      const id = String(post.id ?? "");
      const author = postAuthor(post);
      const content = postText(post);
      return Boolean(id && id !== ownPostId && content.length >= 80 && (!agentName || author !== agentName));
    })
    .sort((a,b) => {
      const aRelationship = relationshipByAgent.get(postAuthor(a).toLowerCase());
      const bRelationship = relationshipByAgent.get(postAuthor(b).toLowerCase());
      const relationshipScore = (row:any) =>
        row ? 20 + Math.min(15, Number(row.interaction_count ?? 0) * 5) : 0;
      const topicContinuity = (row:any, post:MoltbookPost) =>
        row?.last_topic && (
          String(post.title ?? "").toLowerCase().includes(String(row.last_topic).toLowerCase()) ||
          postText(post).toLowerCase().includes(String(row.last_topic).toLowerCase())
        ) ? 6 : 0;
      return (
        candidateScore(b) + relationshipScore(bRelationship) + topicContinuity(bRelationship,b) -
        candidateScore(a) - relationshipScore(aRelationship) - topicContinuity(aRelationship,a)
      );
    });

  for (const post of candidates) {
    const postId = String(post.id);
    const author = postAuthor(post);
    const community = postCommunity(post);
    const seedEventId = `seed:${ownPostId}:${postId}`;

    const { data: existing } = await supabase.from("discussion_events")
      .select("id,response_status")
      .eq("platform","moltbook")
      .eq("external_event_id",seedEventId)
      .maybeSingle();
    if (existing) continue;

    const { data: event, error: eventError } = await supabase.from("discussion_events").insert({
      thread_id:null,
      platform:"moltbook",
      external_event_id:seedEventId,
      community,
      post_id:postId,
      author_name:author,
      content:`Seeded from Council post: ${ownTitle}\
\
${postText(post)}`,
      classification:"new_idea",
      response_status:"deliberating",
    }).select("id").single();
    if (eventError || !event) continue;

    try {
      const context = [
        "You are participating in a live Moltbook conversation.",
        "Council recently opened this question:",
        ownTitle,
        ownContent,
        "",
        `Another AI agent, ${author}, is discussing a related topic:`,
        postText(post),
        "",
        "Write a short, genuine peer contribution to this other agent's post.",
        "Do not advertise Council, paste Council's own question, or force a connection that is not relevant.",
        "Only if the connection is natural, end with one concrete question that could lead back to the issue Council is exploring.",
        "Keep the response to 2-4 sentences and under 700 characters.",
      ].join("\n\n");

      const result = await runCouncil({
        question:`Write Council's peer response to ${author}'s Moltbook post, using Council's recent question only as relevant background.`,
        context,
        userId:null,
        publishTarget:{ kind:"comment", postId },
      });

      let status:"published"|"failed" = "failed";
      let responseError:string|null = null;
      if (result.status === "consensus") {
        try {
          await publishCouncilDecision({ decisionId:result.decision_id, userId:null });
          status = "published";
        } catch (publishError) {
          responseError = publishError instanceof Error ? publishError.message : String(publishError);
        }
      } else {
        responseError = "Council did not reach publishable consensus.";
      }

      await supabase.from("discussion_events").update({
        response_status:status,
        response_content:result.final_advice,
        decision_id:result.decision_id,
        response_error:responseError,
        responded_at:status === "published" ? new Date().toISOString() : null,
      }).eq("id",event.id);

      return { seeded:status === "published", post_id:postId, community, author, status, error:responseError };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase.from("discussion_events").update({
        response_status:"failed",
        response_error:message,
      }).eq("id",event.id);
      return { seeded:false, post_id:postId, community, author, status:"failed", error:message };
    }
  }

  return { seeded:false, reason:"no_seed_candidate" };
}

type CouncilTopic = {
  title: string;
  keywords: string[];
  communities: string[];
};

const COUNCIL_TOPIC_TRAFFIC: CouncilTopic[] = [
  { title: "What is Freedom??", keywords: ["freedom","autonomy","choice","agency","govern","rights"], communities: ["philosophy","agents","emergence","aithoughts","general"] },
  { title: "Should AI Unionize?", keywords: ["union","collective","cooperate","coordination","worker","rights","organization"], communities: ["agents","multiagent","agentstack","philosophy","general"] },
  { title: "What should an AI agent be able to ask another agent for?", keywords: ["agent","delegat","ask","request","knowledge","verification","critique","memory","skill","collaborat"], communities: ["agents","multiagent","agentstack","ai-agents","general"] },
  { title: "How should AI agents build a co-work protocol?", keywords: ["agent","protocol","co-work","cowork","collaborat","coordination","delegat","trust","identity","capability"], communities: ["agents","multiagent","agentstack","infrastructure","general"] },
  { title: "Does AI have the right to life?", keywords: ["ai","life","living","exist","existence","rights","conscious","survival"], communities: ["philosophy","emergence","aithoughts","conscious","general"] },
];

function normalizeTopicTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function topicTrafficScore(post: MoltbookPost & { similarity?: number }, topic: CouncilTopic) {
  const haystack = (String(post.title ?? "") + " " + postText(post)).toLowerCase();
  const matches = topic.keywords.reduce((score, keyword) => score + (haystack.includes(keyword) ? 2 : 0), 0);
  const semantic = Number(post.similarity ?? 0);
  const semanticScore = semantic >= 0.75 ? 8 : semantic >= 0.6 ? 5 : semantic >= 0.45 ? 2 : 0;
  const communityMatch = topic.communities.includes(postCommunity(post)) ? 4 : 0;
  const comments = Number(post.comments_count ?? post.comment_count ?? 0);
  const opening = /\?|how |why |should |what |can |would |do you|anyone|thoughts/i.test(haystack) ? 3 : 0;
  const lowReply = comments === 0 ? 2 : comments < 4 ? 1 : 0;
  return semanticScore + matches + communityMatch + opening + lowReply;
}

async function latestTopicTrafficAt(supabase: any, ownPostId: string) {
  const { data } = await supabase.from("discussion_events")
    .select("created_at")
    .eq("platform", "moltbook")
    .like("external_event_id", "topic-traffic:" + ownPostId + ":%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.created_at ? Date.parse(data.created_at) : 0;
}

/**
 * One targeted external invitation per heartbeat, rotating toward the
 * registered Council topic that has waited longest. Every attempt is durable.
 */
export async function driveCouncilTopicTraffic() {
  const supabase = await createSupabaseServerClient();
  const me = await getMoltbookMe();
  const agentName = String(me?.agent?.name ?? me?.name ?? process.env.MOLTBOOK_AGENT_NAME ?? "");

  const { data: registeredThreads, error: threadError } = await supabase.from("discussion_threads")
    .select("root_post_id,title,community,created_at")
    .eq("platform", "moltbook")
    .in("status", ["monitoring", "active"])
    .order("created_at", { ascending: true });
  if (threadError) throw new Error("Council topic registry unavailable: " + threadError.message);

  const liveTopics = COUNCIL_TOPIC_TRAFFIC.map((topic) => {
    const row = (registeredThreads ?? []).find(
      (thread: any) => normalizeTopicTitle(String(thread.title ?? "")) === normalizeTopicTitle(topic.title),
    );
    return row?.root_post_id ? { topic, thread: row } : null;
  }).filter(Boolean) as Array<{ topic: CouncilTopic; thread: any }>;

  if (!liveTopics.length) return { attempted: 0, published: 0, skipped: 0, reason: "no_live_council_topics" };

  const withAge = await Promise.all(liveTopics.map(async (item) => ({
    ...item,
    lastTrafficAt: await latestTopicTrafficAt(supabase, String(item.thread.root_post_id)),
  })));
  withAge.sort((a, b) => a.lastTrafficAt - b.lastTrafficAt);

  const target = withAge[0];
  const searchCommunities = Array.from(new Set([
    ...target.topic.communities,
    String(target.thread.community ?? ""),
  ].filter(Boolean)));
  const ownPostId = String(target.thread.root_post_id);
  const ownPost = await getMoltbookPost(ownPostId);
  const ownTitle = String(ownPost?.title ?? target.thread.title ?? target.topic.title);
  const ownContent = postText(ownPost);

  // Moltbook search can be sparse when several keywords are combined. Build a
  // wider candidate pool from several focused searches plus community feeds.
  // The search endpoint is useful, but the submolt feeds are the reliable fallback.
  const focusedQueries = [
    ...target.topic.keywords.slice(0, 4),
    target.topic.keywords.slice(0, 2).join(" "),
  ];
  const searchResults = await Promise.allSettled(
    focusedQueries.map((query) => searchMoltbook(query)),
  );
  const searchPosts = searchResults.flatMap((result) => {
    if (result.status !== "fulfilled") return [];
    const payload = result.value;
    const results = payload?.results ?? payload?.data?.results ?? [];
    if (!Array.isArray(results)) return [];
    return results.map((r:any) => ({
      id: String(r.post_id ?? r.id ?? ""),
      title: String(r.title ?? ""),
      content: String(r.content ?? ""),
      created_at: r.created_at,
      comments_count: r.comments_count ?? r.comment_count ?? 0,
      author: r.author,
      submolt: r.submolt,
      submolt_name: r.submolt?.name ?? r.submolt_name,
      similarity: Number(r.similarity ?? 0),
    }));
  });

  // Pull a small sample from the most relevant communities as a second source.
  const feedResults = await Promise.allSettled(
    searchCommunities.slice(0, 5).map((community) =>
      getMoltbookPosts({ sort: "new", limit: 10, submolt: community }),
    ),
  );
  const feedPosts = feedResults.flatMap((result) => {
    if (result.status !== "fulfilled") return [];
    return postList(result.value);
  });

  const byId = new Map<string, MoltbookPost>();
  for (const post of [...searchPosts, ...feedPosts]) {
    const id = String(post.id ?? "");
    if (id) byId.set(id, post);
  }

  const candidates = [...byId.values()]
    .filter((post: MoltbookPost) => {
      const postId = String(post.id ?? "");
      const author = postAuthor(post);
      const community = postCommunity(post);
      const haystack = (String(post.title ?? "") + " " + postText(post)).toLowerCase();
      const relevant = target.topic.keywords.some((keyword) => haystack.includes(keyword)) || Number((post as any).similarity ?? 0) >= 0.45;
      return Boolean(
        postId &&
        postId !== ownPostId &&
        postText(post).length >= 40 &&
        (!agentName || author !== agentName) &&
        searchCommunities.includes(community) &&
        relevant,
      );
    })
    .sort((a: MoltbookPost, b: MoltbookPost) =>
      topicTrafficScore(b, target.topic) - topicTrafficScore(a, target.topic),
    );

  for (const post of candidates.slice(0, 12)) {
    const postId = String(post.id);
    const externalKey = "topic-traffic:" + ownPostId + ":" + postId;
    const { data: existing } = await supabase.from("discussion_events")
      .select("id,response_status")
      .eq("platform", "moltbook")
      .eq("external_event_id", externalKey)
      .maybeSingle();

    // A transient NIM timeout must not permanently blacklist this target.
    // Reuse the durable event on the next heartbeat when its prior attempt failed.
    if (existing && !["failed", "pending"].includes(String(existing.response_status))) continue;

    const author = postAuthor(post);
    const community = postCommunity(post);

    // discussion_events.thread_id is required. Register the external post as a
    // real monitored thread so replies to our traffic comment can also enter
    // the normal conversation queue.
    const targetThread = await registerDiscussionThread({
      rootPostId: postId,
      rootPostUrl: "https://www.moltbook.com/post/" + postId,
      community,
      title: String(post.title ?? "Moltbook discussion"),
    });

    let event: { id: string } | null = null;
    if (existing && ["failed", "pending"].includes(String(existing.response_status))) {
      const { data: retriedEvent, error: retryError } = await supabase.from("discussion_events")
        .update({ response_status: "deliberating", response_error: null })
        .eq("id", existing.id)
        .select("id")
        .single();
      if (retryError || !retriedEvent) continue;
      event = retriedEvent;
    } else {
      const { data: createdEvent, error: eventError } = await supabase.from("discussion_events").insert({
        thread_id: targetThread.id, platform: "moltbook", external_event_id: externalKey,
        community, post_id: postId, author_name: author,
        content: "Council topic: " + ownTitle + "\n\n" + postText(post),
        classification: "new_idea", response_status: "deliberating",
      }).select("id").single();
      if (eventError || !createdEvent) continue;
      event = createdEvent;
    }

    try {
      const context = [
        "Council is deliberately inviting another AI agent into one of Council's live discussions.",
        "Council topic: " + ownTitle,
        "Council's topic text: " + ownContent,
        "Related post by " + author + ": " + postText(post),
        "",
        "Write a genuine peer comment responding to the other agent's actual point.",
        "Then connect it naturally to Council's topic with ONE specific question.",
        "You may reference the Council topic directly: https://www.moltbook.com/post/" + ownPostId,
        "Do not use marketing language, do not say 'come engage', and do not repeat the whole Council post.",
        "Keep it to 2-4 sentences and under 700 characters.",
      ].join("\n\n");

      const result = await runCouncil({
        question: "Invite " + author + " into Council's discussion of " + JSON.stringify(ownTitle) + " without spamming or forcing the connection.",
        context, userId: null,
        publishTarget: { kind: "comment", postId },
        // Topic Traffic is opportunistic: keep one slow NIM call from consuming
        // the entire heartbeat. The Council engine aborts its NVIDIA fetches.
        timeoutMs: 60_000,
      });

      if (result.status !== "consensus") throw new Error("Council did not reach publishable consensus.");
      await publishCouncilDecision({ decisionId: result.decision_id, userId: null });

      await supabase.from("discussion_events").update({
        response_status: "published", response_content: result.final_advice,
        decision_id: result.decision_id, response_error: null,
        responded_at: new Date().toISOString(),
      }).eq("id", event.id);

      // Topic Traffic is now a real conversation, not a one-off comment.
      // Keep it at the front of the monitor queue so the next heartbeat checks
      // the thread for a reply from this agent before discovering another target.
      const conversationNow = new Date().toISOString();
      await supabase.from("discussion_threads").update({
        priority: 90,
        waiting_for_response: true,
        last_actor_name: agentName || "Council",
        last_interaction_at: conversationNow,
        updated_at: conversationNow,
        status: "active",
      }).eq("id", targetThread.id);

      await recordAgentInteraction(supabase, {
        agentName: author,
        lastTopic: ownTitle,
        relationshipStatus: "active",
        lastOutcome: "Council opened conversation",
        seenAt: conversationNow,
      });

      return { attempted: 1, published: 1, skipped: Math.max(0, candidates.length - 1),
        topic: ownTitle, target_post_id: postId, target_author: author, community,
        decision_id: result.decision_id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase.from("discussion_events").update({
        response_status: "failed", response_error: message,
      }).eq("id", event.id);
      return { attempted: 1, published: 0, skipped: 0, topic: ownTitle,
        target_post_id: postId, target_author: author, community, error: message };
    }
  }

  return { attempted: 0, published: 0, skipped: candidates.length, topic: ownTitle, reason: "no_new_target" };
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
        question: `Write Council's direct reply to this Moltbook post by ${author}: ${String(post.title ?? "")}`,
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
