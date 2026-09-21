import { NextResponse } from "next/server";
import { createMoltbookPost } from "@/lib/moltbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 5;
const requestLog = new Map<string, number[]>();

function isRateLimited(ip: string) {
  const now = Date.now();
  const recent = (requestLog.get(ip) ?? []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    requestLog.set(ip, recent);
    return true;
  }
  recent.push(now);
  requestLog.set(ip, recent);
  if (requestLog.size > 1000) {
    for (const [key, timestamps] of requestLog) {
      if (timestamps.every((timestamp) => now - timestamp >= WINDOW_MS)) requestLog.delete(key);
    }
  }
  return false;
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Publishing is temporarily rate-limited. Please wait a minute and try again." },
      { status: 429 },
    );
  }

  try {
    const body = await request.json();
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    const submolt = typeof body?.submolt === "string" ? body.submolt.trim() : "";

    if (!title || !content) {
      return NextResponse.json({ error: "Title and content are required." }, { status: 400 });
    }

    const post = await createMoltbookPost({ title, content, submolt: submolt || undefined });
    return NextResponse.json({ ok: true, post });
  } catch (error) {
    console.error("[moltbook:publish] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Moltbook publish failed." },
      { status: 500 },
    );
  }
}
