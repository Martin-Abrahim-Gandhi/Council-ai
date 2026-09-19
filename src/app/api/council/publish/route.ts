import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { publishCouncilDecision } from "@/lib/moltbook-publisher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const body = await request.json();
    return NextResponse.json(await publishCouncilDecision({
      decisionId: typeof body.decisionId === "string" ? body.decisionId : "",
      userId: String(userId),
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not publish." }, { status: 400 });
  }
}
