import { after, NextResponse } from "next/server";
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

    const input = {
      stage,
      decisionId: typeof body.decisionId === "string" ? body.decisionId : null,
      question: typeof body.question === "string" ? body.question : "",
      context: typeof body.context === "string" ? body.context : "",
      conversationId: typeof body.conversationId === "string" ? body.conversationId : null,
      publishTarget: body.publishTarget && typeof body.publishTarget === "object" ? body.publishTarget : undefined,
      userId: String(userId),
    } as const;

    if (body.background === true) {
      let decisionId = input.decisionId;

      if (stage === "king" && !decisionId) {
        const { data, error } = await supabase.from("council_decisions").insert({
          user_id: input.userId,
          conversation_id: input.conversationId,
          question: input.question.trim(),
          context: { text: input.context, engine_version: "3.0.0", parcel_protocol: true },
          status: "deliberating",
          action_type: input.publishTarget?.kind === "comment" ? "reply" : "post",
          action_payload: input.publishTarget ? {
            action_kind: input.publishTarget.kind,
            ...(input.publishTarget.postId ? { moltbook_parent_post_id: input.publishTarget.postId } : {}),
            ...(input.publishTarget.commentId ? { moltbook_parent_comment_id: input.publishTarget.commentId } : {}),
          } : {},
        }).select("id").single();

        if (error || !data) {
          throw new Error(`Could not create Council decision: ${error?.message ?? "unknown error"}`);
        }
        decisionId = data.id;
      }

      if (!decisionId) {
        throw new Error("decisionId is required for this Council parcel.");
      }

      after(async () => {
        try {
          await runCouncilParcel({ ...input, decisionId });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Council parcel failed.";
          console.error("[council:parcel] background failure", { stage, decisionId, error: message });
          await supabase.from("council_decisions").update({
            action_payload: {
              ...(typeof input.decisionId === "string" ? {} : {}),
              parcel_error: message,
              parcel_failed_stage: stage,
            },
          }).eq("id", decisionId).eq("user_id", input.userId);
        }
      });

      return NextResponse.json({ decision_id: decisionId, stage, queued: true }, { status: 202 });
    }

    const result = await runCouncilParcel(input);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Council parcel failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const decisionId = new URL(request.url).searchParams.get("decisionId");
  if (!decisionId) {
    return NextResponse.json({ error: "decisionId is required." }, { status: 400 });
  }

  const { data: decision, error } = await supabase
    .from("council_decisions")
    .select("id,status,final_advice,action_payload")
    .eq("id", decisionId)
    .eq("user_id", String(userId))
    .single();

  if (error || !decision) {
    return NextResponse.json({ error: "Council decision not found." }, { status: 404 });
  }

  const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    decision_id: decision.id,
    status: decision.status,
    final_advice: decision.final_advice,
    parcel_stage: typeof payload.parcel_stage === "string" ? payload.parcel_stage : "created",
    parcel_error: typeof payload.parcel_error === "string" ? payload.parcel_error : null,
    parcel_failed_stage: typeof payload.parcel_failed_stage === "string" ? payload.parcel_failed_stage : null,
    complete: payload.parcel_stage === "chamber",
    gate_evaluation: payload.gate_evaluation ?? null,
    voice_support: payload.voice_support ?? null,
  });
}
