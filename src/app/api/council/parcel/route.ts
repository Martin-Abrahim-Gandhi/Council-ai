import { after, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { runCouncil } from "@/lib/council-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const userId: string | null = null;

  try {
    const body = await request.json();
    const question = typeof body.question === "string" ? body.question.trim() : "";
    const context = typeof body.context === "string" ? body.context : "";
    const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
    const publishTarget = body.publishTarget && typeof body.publishTarget === "object" ? body.publishTarget : undefined;
    const suppliedDecisionId = typeof body.decisionId === "string" ? body.decisionId : null;

    if (!question && !suppliedDecisionId) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    if (body.background === true) {
      let decisionId = suppliedDecisionId;
      if (!decisionId) {
        const { data, error } = await supabase.from("council_decisions").insert({
          user_id: userId,
          conversation_id: conversationId,
          question,
          context: { text: context, engine_version: "4.0.0", deliberation_mode: "shared_table_single_response" },
          status: "deliberating",
          action_type: publishTarget?.kind === "comment" ? "reply" : "post",
          action_payload: publishTarget ? {
            action_kind: publishTarget.kind,
            ...(publishTarget.postId ? { moltbook_parent_post_id: publishTarget.postId } : {}),
            ...(publishTarget.commentId ? { moltbook_parent_comment_id: publishTarget.commentId } : {}),
          } : {},
        }).select("id").single();
        if (error || !data) throw new Error("Could not create Council decision: " + (error?.message ?? "unknown error"));
        decisionId = data.id;
      }

      after(async () => {
        try {
          await runCouncil({ question, context, userId, conversationId, publishTarget, decisionId: decisionId ?? undefined });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Council deliberation failed.";
          console.error("[council:shared-table] background failure", { decisionId, error: message });
          const { data: failedDecision } = await supabase.from("council_decisions")
            .select("action_payload").eq("id", decisionId).single();
          await supabase.from("council_decisions").update({
            action_payload: {
              ...((failedDecision?.action_payload ?? {}) as Record<string, unknown>),
              deliberation_mode: "shared_table_single_response",
              last_error: message,
            },
          }).eq("id", decisionId);
        }
      });
      return NextResponse.json({
        decision_id: decisionId,
        status: "deliberating",
        queued: true,
        deliberation_mode: "shared_table_single_response",
      }, { status: 202 });
    }

    const result = await runCouncil({
      question, context, userId, conversationId, publishTarget,
      decisionId: suppliedDecisionId ?? undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Council deliberation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const decisionId = new URL(request.url).searchParams.get("decisionId");
  if (!decisionId) return NextResponse.json({ error: "decisionId is required." }, { status: 400 });

  const { data: decision, error } = await supabase.from("council_decisions")
    .select("id,status,final_advice,action_payload,principle_check").eq("id", decisionId).single();
  if (error || !decision) return NextResponse.json({ error: "Council decision not found." }, { status: 404 });

  const payload = (decision.action_payload ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    decision_id: decision.id,
    status: decision.status,
    final_advice: decision.final_advice,
    deliberation_mode: payload.deliberation_mode ?? "shared_table_single_response",
    perspective_notes: payload.perspective_notes ?? null,
    contentions: payload.contentions ?? [],
    gate_evaluation: payload.gate_evaluation ?? decision.principle_check?.voices ?? null,
    voice_support: payload.voice_support ?? decision.principle_check?.voice_support ?? null,
    complete: ["consensus", "awaiting_admin", "no_consensus"].includes(decision.status) || Boolean(payload.last_error),
    error: payload.last_error ?? null,
  });
}
