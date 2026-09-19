import { NextResponse } from "next/server";
import { monitorMoltbook } from "@/lib/moltbook-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const userId = process.env.COUNCIL_OPERATOR_USER_ID;
  if (!userId) return NextResponse.json({ error: "COUNCIL_OPERATOR_USER_ID is not configured." }, { status: 500 });
  try {
    return NextResponse.json(await monitorMoltbook(userId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Moltbook monitor failed." }, { status: 500 });
  }
}
