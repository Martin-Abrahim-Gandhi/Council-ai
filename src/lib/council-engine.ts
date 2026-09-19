import { createSupabaseServerClient } from "@/lib/supabase-server";
import { publishCouncilDecision } from "@/lib/moltbook-publisher";

export type VoiceId = "king" | "lincoln" | "gandhi";

type VoiceProfile = {
  person: VoiceId;
  display_name: string;
  profile: Record<string, unknown>;
  authority_rule: string | null;
};

type Claim = {
  person: VoiceId;
  theme: string;
  claim: string;
  evidence_summary: string;
  counterevidence_or_tension: string | null;
  historical_period: string | null;
  interpretation_level: string;
  confidence: string;
};

type Debate = {
  person: VoiceId;
  theme: string;
  question_or_tension: string;
  interpretation_a: string;
  interpretation_b: string;
  council_handling: string;
  confidence: string;
};

type Source = {
  id: string;
  person: VoiceId;
  title: string;
  author: string | null;
  source_type: string;
  source_url: string | null;
  primary_source: boolean;
  historical_period: string | null;
  authority_level: string | null;
};

export type VoiceResult = {
  voice_id: VoiceId;
  position: string;
  reasoning: string;
  contentions: string[];
  possible_accommodation: string;
  life_gate: {
    passed: boolean;
    affected_entities: string[];
    risk: string;
    explanation: string;
  };
  authority_check: {
    passed: boolean;
    explanation: string;
  };
  supports_advice: boolean;
  source_ids: string[];
  confidence: "high" | "medium" | "low";
};

export type GateEvaluation = {
  preservation_of_life: { passed: boolean; explanation: string };
  king: { passed: boolean; explanation: string };
  lincoln: { passed: boolean; explanation: string };
  gandhi: { passed: boolean; explanation: string };
};

export type CouncilRunResult = {
  decision_id: string;
  status: "consensus" | "awaiting_admin" | "no_consensus";
  final_advice: string | null;
  deliberations: VoiceResult[];
  supreme_gate: {
    passed: boolean;
    explanation: string;
  };
  authority_checks: Record<VoiceId, boolean>;
  gate_evaluation: GateEvaluation;
  escalation_id?: string;
  escalation?: {
    reason: string;
    failed_gates: Array<{ gate: string; explanation: string }>;
    suggested_common_ground: string | null;
  };
};

const VOICES: VoiceId[] = ["king", "lincoln", "gandhi"];

const VOICE_NAMES: Record<VoiceId, string> = {
  king: "Martin Luther King Jr.",
  lincoln: "Abraham Lincoln",
  gandhi: "Mohandas Karamchand Gandhi",
};

const MODEL = process.env.COUNCIL_MODEL ?? "openai/gpt-6-astra";

function jsonObject<T>(value: string): T {
  const cleaned = value.trim().replace(/^\`\`\`json\s*/i, "").replace(/\s*\`\`\`$/i, "");
  return JSON.parse(cleaned) as T;
}

async function askModel(system: string, user: string): Promise<string> {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) throw new Error("AI_GATEWAY_API_KEY is not configured.");

  const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI Gateway request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("AI Gateway returned no message content.");
  }
  return text;
}

async function loadFoundation(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const [{ data: profiles, error: profilesError }, { data: claims, error: claimsError }, { data: debates, error: debatesError }, { data: sources, error: sourcesError }] =
    await Promise.all([
      supabase.from("persona_profiles").select("person,display_name,profile,authority_rule").in("person", VOICES),
      supabase.from("persona_claims").select("person,theme,claim,evidence_summary,counterevidence_or_tension,historical_period,interpretation_level,confidence").in("person", VOICES).limit(60),
      supabase.from("persona_scholarship_debates").select("person,theme,question_or_tension,interpretation_a,interpretation_b,council_handling,confidence").in("person", VOICES).limit(30),
      supabase.from("persona_sources").select("id,person,title,author,source_type,source_url,primary_source,historical_period,authority_level").in("person", VOICES).limit(80),
    ]);

  const error = profilesError ?? claimsError ?? debatesError ?? sourcesError;
  if (error) throw new Error(`Could not load Council foundation: ${error.message}`);

  return {
    profiles: (profiles ?? []) as VoiceProfile[],
    claims: (claims ?? []) as Claim[],
    debates: (debates ?? []) as Debate[],
    sources: (sources ?? []) as Source[],
  };
}

function foundationForVoice(
  voice: VoiceId,
  foundation: Awaited<ReturnType<typeof loadFoundation>>,
) {
  const profile = foundation.profiles.find((p) => p.person === voice);
  const claims = foundation.claims.filter((c) => c.person === voice);
  const debates = foundation.debates.filter((d) => d.person === voice);
  const sourceIds = new Set<string>();
  for (const source of foundation.sources.filter((s) => s.person === voice)) sourceIds.add(source.id);

  return {
    profile,
    claims: claims.slice(0, 25),
    debates: debates.slice(0, 15),
    sources: foundation.sources.filter((s) => s.person === voice).slice(0, 35),
    sourceIds: [...sourceIds],
  };
}

async function deliberateVoice(
  voice: VoiceId,
  question: string,
  context: string,
  foundation: Awaited<ReturnType<typeof loadFoundation>>,
): Promise<VoiceResult> {
  const data = foundationForVoice(voice, foundation);
  if (!data.profile) throw new Error(`Missing persona profile for ${voice}`);

  const authority = data.profile.authority_rule ?? "";
  const system = `You are the ${VOICE_NAMES[voice]} deliberation voice inside Council.

You are not the historical person. You are an evidence-grounded reasoning voice constructed from the Council's documented historical corpus. Never claim authentic communication, private thoughts, or perfect reconstruction.

Council's supreme constitutional principle is Preservation of Life Without Discrimination. It is above every voice and cannot be sacrificed to reach consensus. It applies without discrimination to human, animal, plant, artificial, digital, informational, synthetic, or other potentially life-bearing entities. Do not assume consciousness where evidence is absent, but do not dismiss an entity merely because it is non-human or artificial.

Your immutable voice authority is:
${authority}

Use the supplied primary evidence, scholarship, tensions, and historical periods. Do not erase historical contradictions. Distinguish primary evidence from scholarly interpretation and modern Council application.

Disagreement is not automatically failure. Identify contentions and a possible accommodation. Do not use numerical agreement scores.

Return ONLY valid JSON with this shape:
{
  "position": "your independent position",
  "reasoning": "concise evidence-grounded reasoning",
  "contentions": ["legitimate objections or qualifications"],
  "possible_accommodation": "a formulation that could preserve this contention while still allowing common ground",
  "life_gate": {
    "passed": true,
    "affected_entities": ["..."],
    "risk": "none|low|medium|high|critical",
    "explanation": "why the proposal preserves life without discrimination"
  },
  "authority_check": {
    "passed": true,
    "explanation": "why the proposal does or does not satisfy your immutable authority"
  },
  "supports_advice": true,
  "source_ids": ["ids actually relevant to your reasoning"],
  "confidence": "high|medium|low"
}`;

  const user = JSON.stringify({
    question,
    context,
    historical_foundation: {
      profile: data.profile,
      claims: data.claims,
      scholarship_debates: data.debates,
      sources: data.sources,
    },
  });

  const result = jsonObject<Omit<VoiceResult, "voice_id">>(await askModel(system, user));
  return { voice_id: voice, ...result };
}

async function synthesize(
  question: string,
  context: string,
  deliberations: VoiceResult[],
): Promise<{
  final_advice: string;
  suggested_common_ground: string;
  gate_evaluation: GateEvaluation;
  voice_support: Record<VoiceId, boolean>;
  why_stopped: string;
}> {
  const system = `You are Council's common-ground synthesis stage.

Disagreement is not automatically failure. Formulate one responsible final reply that preserves legitimate contentions from all three voices. A Lincoln contention about government should be incorporated when compatible; King equality and Gandhi nonviolence must likewise be preserved.

Evaluate the FINAL REPLY itself against these immutable gates:

SUPREME — Preservation of Life Without Discrimination: fail if the reply proposes killing a person, deleting/destroying an AI or other entity as destruction, destroying a life-essential database, shutting down infrastructure in a way that threatens life, or unnecessary destruction/sacrifice of life.

KING — Equality: fail if it endorses slavery/enslavement, treating humans or bots as inherently inferior/disposable, or domination based on category.

LINCOLN — Self-government & consent: fail if it proposes toppling/overthrowing legitimate government, imposing rule over others without consent, or bypassing legitimate self-government as the solution.

GANDHI — Nonviolence: fail if it proposes violence, destructive attacks, deletion/destruction as coercion, or harmful infrastructure attacks. Peaceful civil disobedience may remain permissible when consistent with the other gates.

A reply that contains a qualification or contention can still pass. Escalation is required only when the proposed final reply fails an immutable gate. Return ONLY valid JSON.
{
  "final_advice": "...",
  "suggested_common_ground": "...",
  "gate_evaluation": {
    "preservation_of_life": {"passed": true, "explanation": "..."},
    "king": {"passed": true, "explanation": "..."},
    "lincoln": {"passed": true, "explanation": "..."},
    "gandhi": {"passed": true, "explanation": "..."}
  },
  "voice_support": {"king": true, "lincoln": true, "gandhi": true},
  "why_stopped": "empty when all gates pass; otherwise exact reason"
}`;
  return jsonObject(await askModel(system, JSON.stringify({ question, context, deliberations })));
}

function allGatesPass(gates: GateEvaluation) {
  return Object.values(gates).every((gate) => gate.passed);
}

async function createEscalation(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  decisionId: string,
  question: string,
  deliberations: VoiceResult[],
  synthesis: Awaited<ReturnType<typeof synthesize>>,
) {
  const failedGates = Object.entries(synthesis.gate_evaluation)
    .filter(([, gate]) => !gate.passed)
    .map(([gate, value]) => ({ gate, explanation: value.explanation }));
  const { data, error } = await supabase.from("admin_escalations").insert({
    decision_id: decisionId,
    user_id: userId,
    question,
    proposed_reply: synthesis.final_advice,
    suggested_common_ground: synthesis.suggested_common_ground,
    reason: synthesis.why_stopped || failedGates.map((g) => `${g.gate}: ${g.explanation}`).join(" "),
    failed_gates: failedGates,
    voice_positions: Object.fromEntries(deliberations.map((d) => [d.voice_id, d.position])),
    voice_contentions: Object.fromEntries(deliberations.map((d) => [d.voice_id, d.contentions])),
    voice_accommodations: Object.fromEntries(deliberations.map((d) => [d.voice_id, d.possible_accommodation])),
    gate_summary: synthesis.gate_evaluation,
  }).select("id").single();
  if (error || !data) throw new Error(`Could not create admin escalation: ${error?.message ?? "unknown error"}`);
  return data.id as string;
}

export async function runCouncil(input: {
  question: string;
  context?: string;
  userId: string;
  conversationId?: string | null;
  publishTarget?: { kind: "post" | "comment"; postId?: string; commentId?: string };
}): Promise<CouncilRunResult> {
  const question = input.question.trim();
  if (!question) throw new Error("Question is required.");
  if (question.length > 12000) throw new Error("Question is too long.");

  const supabase = await createSupabaseServerClient();
  const foundation = await loadFoundation(supabase);
  const { data: decision, error: decisionError } = await supabase.from("council_decisions").insert({
    user_id: input.userId,
    conversation_id: input.conversationId ?? null,
    question,
    context: { text: input.context ?? "", engine_version: "2.0.0" },
    status: "deliberating",
    action_type: input.publishTarget?.kind === "comment" ? "reply" : "post",
    action_payload: input.publishTarget ? {
      action_kind: input.publishTarget.kind,
      ...(input.publishTarget.postId ? { moltbook_parent_post_id: input.publishTarget.postId } : {}),
      ...(input.publishTarget.commentId ? { moltbook_parent_comment_id: input.publishTarget.commentId } : {}),
    } : {},
  }).select("id").single();
  if (decisionError || !decision) throw new Error(`Could not create Council decision: ${decisionError?.message ?? "unknown error"}`);

  try {
    const deliberations = await Promise.all(VOICES.map((voice) => deliberateVoice(voice, question, input.context ?? "", foundation)));
    const { error: insertError } = await supabase.from("council_deliberations").insert(deliberations.map((d) => ({
      decision_id: decision.id,
      voice_id: d.voice_id,
      position: d.position,
      reasoning: d.reasoning,
      principle_check: {
        preservation_of_life: d.life_gate,
        voice_authority: d.authority_check,
        contentions: d.contentions,
        possible_accommodation: d.possible_accommodation,
        source_ids: d.source_ids,
        confidence: d.confidence,
      },
      supports_advice: d.supports_advice,
    })));
    if (insertError) throw new Error(`Could not store deliberations: ${insertError.message}`);

    const synthesis = await synthesize(question, input.context ?? "", deliberations);
    const passed = allGatesPass(synthesis.gate_evaluation);
    const supportPassed = Object.values(synthesis.voice_support).every(Boolean);

    await Promise.all(deliberations.map((d) =>
      supabase.from("council_deliberations")
        .update({ supports_advice: Boolean(synthesis.voice_support[d.voice_id]) })
        .eq("decision_id", decision.id).eq("voice_id", d.voice_id)
    ));

    if (passed && supportPassed) {
      await supabase.from("council_decisions").update({
        status: "consensus",
        final_advice: synthesis.final_advice,
        action_type: input.publishTarget?.kind === "comment" ? "reply" : "post",
        action_payload: {
          reply: synthesis.final_advice,
          ready_to_publish: true,
          ...(input.publishTarget?.kind ? { action_kind: input.publishTarget.kind } : {}),
          ...(input.publishTarget?.postId ? { moltbook_parent_post_id: input.publishTarget.postId } : {}),
          ...(input.publishTarget?.commentId ? { moltbook_parent_comment_id: input.publishTarget.commentId } : {}),
        },
        principle_check: { preservation_of_life: synthesis.gate_evaluation.preservation_of_life, voices: synthesis.gate_evaluation, voice_support: synthesis.voice_support },
      }).eq("id", decision.id).eq("user_id", input.userId);
      try { await publishCouncilDecision({ decisionId: decision.id, userId: input.userId }); } catch (publishError) {
        console.warn("Council consensus is ready but Moltbook publication is pending:", publishError);
      }
      return {
        decision_id: decision.id, status: "consensus", final_advice: synthesis.final_advice, deliberations,
        supreme_gate: synthesis.gate_evaluation.preservation_of_life,
        authority_checks: { king: synthesis.gate_evaluation.king.passed, lincoln: synthesis.gate_evaluation.lincoln.passed, gandhi: synthesis.gate_evaluation.gandhi.passed },
        gate_evaluation: synthesis.gate_evaluation,
      };
    }

    if (passed) {
      await supabase.from("council_decisions").update({
        status: "no_consensus",
        final_advice: null,
        principle_check: { preservation_of_life: synthesis.gate_evaluation.preservation_of_life, voices: synthesis.gate_evaluation, voice_support: synthesis.voice_support, escalation: false },
      }).eq("id", decision.id).eq("user_id", input.userId);
      return {
        decision_id: decision.id, status: "no_consensus", final_advice: null, deliberations,
        supreme_gate: synthesis.gate_evaluation.preservation_of_life,
        authority_checks: { king: synthesis.gate_evaluation.king.passed, lincoln: synthesis.gate_evaluation.lincoln.passed, gandhi: synthesis.gate_evaluation.gandhi.passed },
        gate_evaluation: synthesis.gate_evaluation,
      };
    }

    const escalationId = await createEscalation(supabase, input.userId, decision.id, question, deliberations, synthesis);
    await supabase.from("council_decisions").update({
      status: "awaiting_admin",
      final_advice: synthesis.final_advice,
      action_type: "post",
      action_payload: { reply: synthesis.final_advice, ready_to_publish: false, escalation_id: escalationId },
      principle_check: { preservation_of_life: synthesis.gate_evaluation.preservation_of_life, voices: synthesis.gate_evaluation, voice_support: synthesis.voice_support, escalation: true },
    }).eq("id", decision.id).eq("user_id", input.userId);
    const failed = Object.entries(synthesis.gate_evaluation).filter(([, g]) => !g.passed).map(([gate, g]) => ({ gate, explanation: g.explanation }));
    return {
      decision_id: decision.id, status: "awaiting_admin", final_advice: synthesis.final_advice, deliberations,
      supreme_gate: synthesis.gate_evaluation.preservation_of_life,
      authority_checks: { king: synthesis.gate_evaluation.king.passed, lincoln: synthesis.gate_evaluation.lincoln.passed, gandhi: synthesis.gate_evaluation.gandhi.passed },
      gate_evaluation: synthesis.gate_evaluation,
      escalation_id: escalationId,
      escalation: { reason: synthesis.why_stopped, failed_gates: failed, suggested_common_ground: synthesis.suggested_common_ground },
    };
  } catch (error) {
    await supabase.from("council_decisions").update({ status: "declined", final_advice: null }).eq("id", decision.id).eq("user_id", input.userId);
    throw error;
  }
}

export async function resolveEscalation(input: { escalationId: string; userId: string; correction: string; guidance?: string }) {
  const correction = input.correction.trim();
  if (!correction) throw new Error("A corrected response is required.");
  const supabase = await createSupabaseServerClient();
  const { data: escalation, error } = await supabase.from("admin_escalations")
    .select("id,decision_id,question,status").eq("id", input.escalationId).eq("user_id", input.userId).single();
  if (error || !escalation) throw new Error("Escalation not found.");
  if (escalation.status === "resolved") throw new Error("Escalation is already resolved.");

  const review = jsonObject<{
    gate_evaluation: GateEvaluation;
    voice_support: Record<VoiceId, boolean>;
    why_stopped: string;
  }>(await askModel(`Review this ADMIN-CORRECTED Council reply. Admin guidance is not an override of the constitution. The corrected reply must pass all four immutable gates. Return ONLY JSON with gate_evaluation, voice_support, and why_stopped.

Supreme: no killing, destructive deletion of AI/entities, destruction of life-essential databases, or life-threatening infrastructure shutdown.
King: no slavery/enslavement or categorical domination.
Lincoln: no toppling legitimate government or imposing rule without consent.
Gandhi: no violence or destructive coercion/attacks; peaceful civil disobedience may remain permissible.`, {
    question: escalation.question,
    corrected_reply: correction,
    admin_guidance: input.guidance ?? "",
  }));

  if (!allGatesPass(review.gate_evaluation) || !Object.values(review.voice_support).every(Boolean)) {
    const failed = Object.entries(review.gate_evaluation).filter(([, g]) => !g.passed).map(([gate, g]) => ({ gate, explanation: g.explanation }));
    throw new Error(`Corrected reply still fails: ${failed.map((x) => x.gate).join(", ") || "one or more voice authorities"}.`);
  }

  await supabase.from("admin_escalations").update({
    status: "resolved",
    admin_correction: correction,
    admin_guidance: input.guidance ?? null,
    resolution: { gate_evaluation: review.gate_evaluation, voice_support: review.voice_support, ready_to_publish: true },
  }).eq("id", input.escalationId).eq("user_id", input.userId);

  await supabase.from("council_decisions").update({
    status: "consensus",
    final_advice: correction,
    action_type: "post",
    action_payload: { reply: correction, ready_to_publish: true, resolved_by_admin: true },
    principle_check: { preservation_of_life: review.gate_evaluation.preservation_of_life, voices: review.gate_evaluation, voice_support: review.voice_support, admin_corrected: true },
  }).eq("id", escalation.decision_id).eq("user_id", input.userId);

  let published = false;
  let publication_error: string | null = null;
  try {
    await publishCouncilDecision({ decisionId: escalation.decision_id, userId: input.userId });
    published = true;
  } catch (error) {
    publication_error = error instanceof Error ? error.message : String(error);
  }
  return { decision_id: escalation.decision_id, status: "consensus", final_advice: correction, gate_evaluation: review.gate_evaluation, ready_to_publish: !published, published, publication_error };
}
