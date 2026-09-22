import { NextResponse } from "next/server";
import { moltbookFetch } from "@/lib/moltbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await moltbookFetch("/submolts");
    const raw = result?.submolts ?? result?.data?.submolts ?? result?.data ?? result;
    const list = Array.isArray(raw) ? raw : [];

    const submolts = list
      .map((item: any) => ({
        name: typeof item?.name === "string" ? item.name : "",
        display_name: typeof item?.display_name === "string" ? item.display_name : undefined,
        description: typeof item?.description === "string" ? item.description : undefined,
        subscriber_count: typeof item?.subscriber_count === "number" ? item.subscriber_count : undefined,
      }))
      .filter((item: any) => item.name);

    return NextResponse.json({ ok: true, submolts });
  } catch (error) {
    console.error("[moltbook:submolts] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load Moltbook communities." },
      { status: 500 },
    );
  }
}
