import { NextResponse } from "next/server";
import { getMoltbookHome, getMoltbookMe, getMoltbookStatus } from "@/lib/moltbook";
import { discoverAndEngageMoltbook, monitorMoltbookDiscussions } from "@/lib/discussion-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const [status, me, home, discussions] = await Promise.all([
      getMoltbookStatus(),
      getMoltbookMe(),
      getMoltbookHome(),
      monitorMoltbookDiscussions(),
    ]);

    const activities = home?.activity_on_your_posts ?? home?.data?.activity_on_your_posts ?? [];
    const engagement = await discoverAndEngageMoltbook();

    return NextResponse.json({
      ok: true,
      heartbeat: "moltbook",
      agent: me?.agent ?? me,
      status,
      activity_count: Array.isArray(activities) ? activities.length : 0,
      discussions,
      engagement,
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
