import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { runCouncilParcel } from "@/lib/council-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STAGES = ["king", "lincoln", "gandhi", "chamber"] as const;
type Stage = (typeof STAGES)[number];

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const stage = body.stage as Stage;
    if (!STAGES.includes(stage)) {
      return NextResponse.json({ error: "Invalid Council parcel." }, { status: 400 });
    }

    const result = await runCouncilParcel({
      stage,
      decisionId: typeof body.decisionId === "string" ? body.decisionId : null,
      question: typeof body.question === "string" ? body.question : "",
      context: typeof body.context === "string" ? body.context : "",
      conversationId: typeof body.conversationId === "string" ? body.conversationId : null,
      publishTarget: body.publishTarget && typeof body.publishTarget === "object" ? body.publishTarget : undefined,
      userId: String(userId),
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Council parcel failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
