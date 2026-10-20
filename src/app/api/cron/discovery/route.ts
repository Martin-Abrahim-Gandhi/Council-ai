import { discoverAndEngageMoltbook } from "@/lib/discussion-engine";
import { runMoltbookCronTask } from "@/lib/moltbook-cron-task";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: Request) {
  return runMoltbookCronTask(request, "discovery", async () => {
    // One relevant external discussion per run; no Topic Traffic sweep here.
    const discovery = await discoverAndEngageMoltbook();
    return { discovery, engaged: Number(discovery.engaged ?? 0), status: discovery.status };
  });
}
