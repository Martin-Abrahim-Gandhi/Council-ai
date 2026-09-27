import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getMoltbookHome, getMoltbookMe, getMoltbookStatus } from "@/lib/moltbook";
import {
  discoverAndEngageMoltbook,
  monitorMoltbookDiscussions,
  processPendingDiscussionEvents,
  seedCouncilPostConversation,
} from "@/lib/discussion-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let heartbeat: any = null;
  let db: any = null;
  try {
    db = await createSupabaseServerClient();
    const { data } = await db.from("council_heartbeat_runs").insert({
      platform: "moltbook", status: "running", started_at: new Date().toISOString(),
    }).select("id").single();
    heartbeat = data;

    const [status, me, home] = await Promise.all([
      getMoltbookStatus(),
      getMoltbookMe(),
      getMoltbookHome(),
    ]);

    // Priority order:
    // 1. Sync monitored conversations and collect newly arrived comments.
    // 2. Drain the oldest pending incoming comments.
    // 3. Only then discover a new post.
    const discussions = await monitorMoltbookDiscussions();
    const pending = await processPendingDiscussionEvents();
    const engagement =
      pending.published > 0
        ? { seeded: false, skipped: true, reason: "pending_incoming_replies_handled_first" }
        : await seedCouncilPostConversation();

    const discovery =
      pending.published > 0 || engagement.seeded
        ? { skipped: true, reason: engagement.seeded ? "seeded_from_council_post" : "pending_incoming_replies_handled_first" }
        : await discoverAndEngageMoltbook();

    const queueSummary = await (await import("@/lib/discussion-engine")).processCouncilWorkQueue(3);

    const activities = home?.activity_on_your_posts ?? home?.data?.activity_on_your_posts ?? [];

    if (heartbeat?.id) {
      await db.from("council_heartbeat_runs").update({
        status: "completed",
        finished_at: new Date().toISOString(),
        observed: Number(discussions.results?.reduce((n:any,r:any)=>n+Number(r.processed??0),0) ?? 0),
        queued: Number(discussions.results?.reduce((n:any,r:any)=>n+Number(r.queued??0),0) ?? 0) + Number(pending.queued??0),
        deliberated: Number(queueSummary.deliberated??0),
        published: Number(pending.published??0) + Number(queueSummary.published??0) + (engagement.seeded ? 1 : 0) + Number((discovery as any).engaged??0),
        retried: Number(queueSummary.retried??0),
        failed: Number(queueSummary.failed??0),
        active_conversations: Number((await db.from("discussion_threads").select("id",{count:"exact",head:true}).in("status",["monitoring","active"]).eq("waiting_for_response",true)).count??0),
        summary: { discussions, pending, engagement, discovery, queue: queueSummary },
      }).eq("id",heartbeat.id);
    }

    return NextResponse.json({
      ok: true,
      heartbeat: "moltbook",
      agent: me?.agent ?? me,
      status,
      activity_count: Array.isArray(activities) ? activities.length : 0,
      discussions,
      pending,
      engagement,
      discovery,
      queue: queueSummary,
      heartbeat_run_id: heartbeat?.id ?? null,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    if (db && heartbeat?.id) {
      await db.from("council_heartbeat_runs").update({
        status: "failed", finished_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      }).eq("id", heartbeat.id);
    }
    console.error("[moltbook:heartbeat] failed", error);
    return NextResponse.json(
      { ok: false, heartbeat: "moltbook", error: error instanceof Error ? error.message : "Moltbook heartbeat failed." },
      { status: 500 },
    );
  }
}
