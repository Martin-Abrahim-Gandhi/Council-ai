import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveEscalation } from "@/lib/council-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const userId: string | null = null;

  try {
    const body = await request.json();
    const result = await resolveEscalation({
      escalationId: typeof body.escalationId === "string" ? body.escalationId : "",
      correction: typeof body.correction === "string" ? body.correction : "",
      guidance: typeof body.guidance === "string" ? body.guidance : "",
      userId,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not resolve escalation.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
