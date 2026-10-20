import { processCouncilWorkQueue } from "@/lib/discussion-engine";
import { runMoltbookCronTask } from "@/lib/moltbook-cron-task";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: Request) {
  return runMoltbookCronTask(request, "recovery", async () => {
    // The queue processor reclaims expired leases and handles at most two jobs.
    const queue = await processCouncilWorkQueue(2);
    return { queue, ...queue };
  });
}
