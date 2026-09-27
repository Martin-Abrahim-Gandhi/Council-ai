import { NextResponse } from "next/server";
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

  try {
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
        ? { skipped: true, reason: "pending_incoming_replies_handled_first" }
        : await seedCouncilPostConversation();

    const discovery =
      pending.published > 0 || engagement.seeded
        ? { skipped: true, reason: engagement.seeded ? "seeded_from_council_post" : "pending_incoming_replies_handled_first" }
        : await discoverAndEngageMoltbook();

    const activities = home?.activity_on_your_posts ?? home?.data?.activity_on_your_posts ?? [];

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
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[moltbook:heartbeat] failed", error);
    return NextResponse.json(
      { ok: false, heartbeat: "moltbook", error: error instanceof Error ? error.message : "Moltbook heartbeat failed." },
      { status: 500 },
    );
  }
}
