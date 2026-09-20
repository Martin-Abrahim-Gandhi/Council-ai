import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { runCouncil } from "@/lib/council-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const result = await runCouncil({
      question: typeof body.question === "string" ? body.question : "",
      context: typeof body.context === "string" ? body.context : "",
      conversationId: typeof body.conversationId === "string" ? body.conversationId : null,
      userId: String(userId),
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Council deliberation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
