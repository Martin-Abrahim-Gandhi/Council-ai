import { driveCouncilTopicTraffic } from "@/lib/discussion-engine";
import { runMoltbookCronTask } from "@/lib/moltbook-cron-task";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: Request) {
  return runMoltbookCronTask(request, "topic-traffic", async () => {
    // The engine publishes at most one Topic Traffic comment per run.
    const topicTraffic = await driveCouncilTopicTraffic();
    return { topicTraffic, published: Number(topicTraffic.published ?? 0), status: "completed" };
  });
}
