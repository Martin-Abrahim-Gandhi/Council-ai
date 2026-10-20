import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

type TaskResult = Record<string, any>;

export async function runMoltbookCronTask(
  request: Request,
  task: string,
  work: (db: any) => Promise<TaskResult>,
) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let db: any = null;
  let heartbeat: any = null;
  try {
    db = await createSupabaseServerClient();
    const now = new Date();
    const staleBefore = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    await db.from("council_heartbeat_runs").update({
      status: "failed",
      finished_at: now.toISOString(),
      error: "Heartbeat execution ended before completion was recorded.",
    }).eq("platform", "moltbook").eq("status", "running").lt("started_at", staleBefore);

    const { data, error } = await db.from("council_heartbeat_runs").insert({
      platform: "moltbook",
      status: "running",
      started_at: now.toISOString(),
      summary: { task },
    }).select("id").single();
    if (error) throw error;
    heartbeat = data;

    const result = await work(db);
    const finishedAt = new Date().toISOString();
    const discussions = result.discussions?.results ?? [];
    const pending = result.pending ?? {};
    const queue = result.queue ?? result;
    const failedStatus = result.status === "failed" || Boolean(result.error && result.ok === false);
    const activeThreads = await db.from("discussion_threads")
      .select("id", { count: "exact", head: true })
      .in("status", ["monitoring", "active"])
      .eq("waiting_for_response", true);

    await db.from("council_heartbeat_runs").update({
      status: failedStatus ? "failed" : "completed",
      finished_at: finishedAt,
      observed: Number(discussions.reduce((n: number, item: any) => n + Number(item.processed ?? 0), 0)),
      queued: Number(pending.queued ?? 0) + Number(discussions.reduce((n: number, item: any) => n + Number(item.queued ?? 0), 0)),
      deliberated: Number(queue.deliberated ?? 0),
      published: Number(result.published ?? pending.published ?? queue.published ?? result.engaged ?? 0),
      retried: Number(queue.retried ?? 0),
      failed: Number(queue.failed ?? 0) + (failedStatus ? 1 : 0),
      active_conversations: Number(activeThreads.count ?? 0),
      summary: { task, result },
      ...(failedStatus ? { error: String(result.error ?? "Task returned failed status.") } : {}),
    }).eq("id", heartbeat.id);

    return NextResponse.json({
      ok: !failedStatus,
      heartbeat: "moltbook",
      task,
      heartbeat_run_id: heartbeat.id,
      result,
      checked_at: finishedAt,
    }, { status: failedStatus ? 500 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (db && heartbeat?.id) {
      await db.from("council_heartbeat_runs").update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: message,
        summary: { task },
      }).eq("id", heartbeat.id);
    }
    console.error("[moltbook:cron:" + task + "] failed", error);
    return NextResponse.json({ ok: false, heartbeat: "moltbook", task, error: message }, { status: 500 });
  }
}
