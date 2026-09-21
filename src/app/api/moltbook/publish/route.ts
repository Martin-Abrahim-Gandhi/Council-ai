import { NextResponse } from "next/server";
import { createMoltbookPost } from "@/lib/moltbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const publishToken = process.env.MOLTBOOK_PUBLISH_TOKEN;
  const providedToken = request.headers.get("x-moltbook-publish-token");

  if (!publishToken || !providedToken || providedToken !== publishToken) {
    return NextResponse.json({ error: "Moltbook publishing is not authorized." }, { status: 401 });
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
