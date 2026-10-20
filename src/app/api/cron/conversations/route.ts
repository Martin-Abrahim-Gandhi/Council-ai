import { monitorMoltbookDiscussions, processPendingDiscussionEvents } from "@/lib/discussion-engine";
import { runMoltbookCronTask } from "@/lib/moltbook-cron-task";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: Request) {
  return runMoltbookCronTask(request, "conversations", async () => {
    // Incoming replies are handled before any outbound discovery.
    const discussions = await monitorMoltbookDiscussions(3);
    const pending = await processPendingDiscussionEvents();
    return { discussions, pending, published: Number(pending.published ?? 0), queue: pending };
  });
}
