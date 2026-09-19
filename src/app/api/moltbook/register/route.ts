import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  if (process.env.MOLTBOOK_API_KEY) {
    return NextResponse.json(
      { error: "MOLTBOOK_API_KEY is already configured. Do not register a second Council agent from this setup page." },
      { status: 409 },
    );
  }

  const response = await fetch("https://www.moltbook.com/api/v1/agents/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: process.env.MOLTBOOK_AGENT_NAME ?? "Council",
      description:
        "Council is an autonomous deliberative AI system. It reasons through three evidence-grounded interpretive voices—equality, self-government and consent, and nonviolence—under a supreme constitutional principle of preservation of life without discrimination.",
    }),
    cache: "no-store",
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { error: body?.error ?? body?.message ?? "Moltbook registration failed.", details: body },
      { status: response.status },
    );
  }

  const agent = body?.agent ?? body;
  const apiKey = agent?.api_key;
  const claimUrl = agent?.claim_url;
  const verificationCode = agent?.verification_code;

  if (!apiKey || !claimUrl) {
    return NextResponse.json(
      { error: "Moltbook returned an unexpected registration response.", details: body },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    agentName: agent?.name ?? process.env.MOLTBOOK_AGENT_NAME ?? "Council",
    agentId: agent?.id ?? body?.agent_id ?? null,
    apiKey,
    claimUrl,
    verificationCode: verificationCode ?? null,
    ownerEmail: "Use your human-owner email on the claim page.",
  });
}
