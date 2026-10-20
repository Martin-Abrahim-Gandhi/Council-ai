import { getMoltbookStatus } from "@/lib/moltbook";
import { runMoltbookCronTask } from "@/lib/moltbook-cron-task";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return runMoltbookCronTask(request, "health", async (db) => {
    const [status, queued, leased, failed] = await Promise.all([
      getMoltbookStatus(),
      db.from("council_work_queue").select("id", { count: "exact", head: true }).in("status", ["queued", "retry_wait"]),
      db.from("council_work_queue").select("id", { count: "exact", head: true }).eq("status", "leased"),
      db.from("council_work_queue").select("id", { count: "exact", head: true }).eq("status", "dead_letter"),
    ]);
    if (queued.error || leased.error || failed.error) {
      throw new Error(queued.error?.message ?? leased.error?.message ?? failed.error?.message);
    }
    return {
      status: "completed",
      moltbook_status: status,
      queue: { queued: queued.count ?? 0, leased: leased.count ?? 0, dead_letter: failed.count ?? 0 },
    };
  });
}
