import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getMoltbookHome, getMoltbookMe, getMoltbookStatus } from "@/lib/moltbook";
import {
  discoverAndEngageMoltbook,
  monitorMoltbookDiscussions,
  processPendingDiscussionEvents,
  seedCouncilPostConversation,
  processCouncilWorkQueue,
  driveCouncilTopicTraffic,
} from "@/lib/discussion-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_HEARTBEAT_MS = 10 * 60 * 1000;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let heartbeat: any = null;
  let db: any = null;

  try {
    db = await createSupabaseServerClient();

    // A serverless function can be terminated before the catch/finally block runs.
    // Reconcile old "running" rows at the start of the next heartbeat so they
    // cannot remain falsely running forever.
    const staleBefore = new Date(Date.now() - STALE_HEARTBEAT_MS).toISOString();
    await db.from("council_heartbeat_runs").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error: "Heartbeat execution ended before completion was recorded.",
    }).eq("platform", "moltbook").eq("status", "running").lt("started_at", staleBefore);

    const { data: heartbeatRow, error: heartbeatInsertError } = await db
      .from("council_heartbeat_runs")
      .insert({
        platform: "moltbook",
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (heartbeatInsertError) throw heartbeatInsertError;
    heartbeat = heartbeatRow;

    const [status, me, home] = await Promise.all([
      getMoltbookStatus(),
      getMoltbookMe(),
      getMoltbookHome(),
    ]);

    const discussions = await monitorMoltbookDiscussions();
    const pending = await processPendingDiscussionEvents();

    // Topic Traffic is opportunistic. A timeout or other failure must never
    // prevent the heartbeat from falling through to seed/discovery work.
    const topicTraffic =
      pending.published > 0
        ? { attempted: 0, published: 0, skipped: true, reason: "pending_incoming_replies_handled_first" }
        : await driveCouncilTopicTraffic().catch((error) => ({
            attempted: 1,
            published: 0,
            skipped: false,
            error: error instanceof Error ? error.message : String(error),
          }));

    const topicTrafficPublished = Number((topicTraffic as any).published ?? 0) > 0;

    const engagement =
      pending.published > 0 || topicTrafficPublished
        ? {
            seeded: false,
            skipped: true,
            reason: pending.published > 0
              ? "pending_incoming_replies_handled_first"
              : "topic_traffic_published",
          }
        : await seedCouncilPostConversation();

    const discovery =
      pending.published > 0 ||
      topicTrafficPublished ||
      engagement.seeded
        ? {
            skipped: true,
            reason: pending.published > 0
              ? "pending_incoming_replies_handled_first"
              : topicTrafficPublished
                ? "topic_traffic_published"
                : "seeded_from_council_post",
          }
        : await discoverAndEngageMoltbook();

    const queueSummary = await processCouncilWorkQueue(3);
    const activities = home?.activity_on_your_posts ?? home?.data?.activity_on_your_posts ?? [];

    if (heartbeat?.id) {
      const activeThreads = await db
        .from("discussion_threads")
        .select("id", { count: "exact", head: true })
        .in("status", ["monitoring", "active"])
        .eq("waiting_for_response", true);

      await db.from("council_heartbeat_runs").update({
        status: "completed",
        finished_at: new Date().toISOString(),
        observed: Number(
          discussions.results?.reduce(
            (n: number, r: any) => n + Number(r.processed ?? 0),
            0,
          ) ?? 0,
        ),
        queued:
          Number(
            discussions.results?.reduce(
              (n: number, r: any) => n + Number(r.queued ?? 0),
              0,
            ) ?? 0,
          ) + Number(pending.queued ?? 0),
        deliberated: Number(queueSummary.deliberated ?? 0),
        published:
          Number(pending.published ?? 0) +
          Number(queueSummary.published ?? 0) +
          Number((topicTraffic as any).published ?? 0) +
          (engagement.seeded ? 1 : 0) +
          Number((discovery as any).engaged ?? 0),
        retried: Number(queueSummary.retried ?? 0),
        failed: Number(queueSummary.failed ?? 0),
        active_conversations: Number(activeThreads.count ?? 0),
        summary: { discussions, pending, topicTraffic, engagement, discovery, queue: queueSummary },
      }).eq("id", heartbeat.id);
    }

    return NextResponse.json({
      ok: true,
      heartbeat: "moltbook",
      agent: me?.agent ?? me,
      status,
      activity_count: Array.isArray(activities) ? activities.length : 0,
      discussions,
      pending,
      topicTraffic,
      engagement,
      discovery,
      queue: queueSummary,
      heartbeat_run_id: heartbeat?.id ?? null,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    if (db && heartbeat?.id) {
      await db.from("council_heartbeat_runs").update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      }).eq("id", heartbeat.id);
    }

    console.error("[moltbook:heartbeat] failed", error);

    return NextResponse.json(
      {
        ok: false,
        heartbeat: "moltbook",
        error: error instanceof Error ? error.message : "Moltbook heartbeat failed.",
      },
      { status: 500 },
    );
  }
}
