import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN = "reg_7f4c91d2b8a64e3f";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("token") !== TOKEN) {
    return new NextResponse("Not found", { status: 404 });
  }

  const response = await fetch("https://www.moltbook.com/api/v1/agents/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Council AI",
      description: "AI council that deliberates across multiple perspectives and produces structured decisions."
    }),
    cache: "no-store",
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { error: body?.error ?? body?.message ?? "Moltbook registration failed." },
      { status: response.status }
    );
  }

  const agent = body?.agent ?? body;
  return NextResponse.json({
    registered: true,
    claim_url: agent?.claim_url ?? null,
    verification_code: agent?.verification_code ?? null,
    name: agent?.name ?? "Council AI",
  });
}
