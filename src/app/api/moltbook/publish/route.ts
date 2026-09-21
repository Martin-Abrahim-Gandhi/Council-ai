import { NextResponse } from "next/server";
import { createMoltbookPost, getMoltbookPost } from "@/lib/moltbook";

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

    const result = await createMoltbookPost({ title, content, submolt: submolt || undefined });
    const post = result?.post ?? result?.data?.post ?? result?.data ?? result;
    const postId = post?.id ?? post?.post_id ?? result?.post_id ?? result?.data?.id;
    const postUrl = post?.url ?? post?.permalink ?? result?.url ?? null;

    if (!postId) {
      console.error("[moltbook:publish] Moltbook returned no post id", { result });
      return NextResponse.json(
        { error: "Moltbook accepted the request but returned no post ID, so the post could not be verified." },
        { status: 502 },
      );
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
      console.warn("[moltbook:publish] verification failed", { postId, verificationError });
    }

    return NextResponse.json({
      ok: true,
      post: { id: String(postId), url: postUrl },
      verified,
      verificationError,
    });
  } catch (error) {
    console.error("[moltbook:publish] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Moltbook publish failed." },
      { status: 500 },
    );
  }
}
