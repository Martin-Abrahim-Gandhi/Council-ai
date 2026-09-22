import { NextResponse } from "next/server";
import { createMoltbookPost, getMoltbookPost } from "@/lib/moltbook";
import { registerDiscussionThread } from "@/lib/discussion-engine";

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
    const requestedSubmolts = Array.isArray(body?.submolts)
      ? body.submolts.filter((value: unknown): value is string => typeof value === "string").map((value: string) => value.trim()).filter(Boolean)
      : [];
    const legacySubmolt = typeof body?.submolt === "string" ? body.submolt.trim() : "";
    const FROZEN_COUNCIL_SUBMOLTS = ["introductions","general","agents","memory","builds","philosophy","ai","emergence","infrastructure","technology"];
    const submolts = FROZEN_COUNCIL_SUBMOLTS;

    if (!title || !content) {
      return NextResponse.json({ error: "Title and content are required." }, { status: 400 });
    }

    const results = [];
    for (const submolt of submolts) {
      try {
        const result = await createMoltbookPost({ title, content, submolt });
        const post = result?.post ?? result?.data?.post ?? result?.data ?? result;
        const postId = post?.id ?? post?.post_id ?? result?.post_id ?? result?.data?.id;
        const postUrl = post?.url ?? post?.permalink ?? result?.url ?? null;

        if (!postId) {
          results.push({ submolt, ok: false, verified: false, error: "Moltbook returned no post ID." });
          continue;
        }

        let verified = false;
        let verificationError: string | null = null;
        try {
          const fetched = await getMoltbookPost(String(postId));
          const fetchedPost = fetched?.post ?? fetched?.data?.post ?? fetched?.data ?? fetched;
          verified = String(fetchedPost?.id ?? fetchedPost?.post_id ?? "") === String(postId);
          if (!verified) verificationError = "Moltbook returned a different post record during verification.";
        } catch (error) {
          verificationError = error instanceof Error ? error.message : "Post verification failed.";
        }

        try {
          await registerDiscussionThread({
            rootPostId: String(postId),
            rootPostUrl: postUrl,
            community: submolt,
            title,
          });
        } catch (threadError) {
          console.warn("[moltbook:publish] discussion thread registration failed", threadError);
        }

        results.push({
          submolt,
          ok: true,
          verified,
          verificationError,
          post: { id: String(postId), url: postUrl },
        });
      } catch (error) {
        results.push({
          submolt,
          ok: false,
          verified: false,
          error: error instanceof Error ? error.message : "Moltbook publish failed.",
        });
      }
    }

    const successful = results.filter((item) => item.ok);
    if (!successful.length) {
      return NextResponse.json({ error: "Moltbook rejected every selected community.", results }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      results,
      published_count: successful.length,
      verified_count: successful.filter((item) => item.verified).length,
    });
  } catch (error) {
    console.error("[moltbook:publish] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Moltbook publish failed." },
      { status: 500 },
    );
  }
}
