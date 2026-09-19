import { createSupabaseServerClient } from "@/lib/supabase-server";

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

export type CouncilRunResult = {
  decision_id: string;
  status: "consensus" | "no_consensus";
  final_advice: string | null;
  deliberations: VoiceResult[];
  supreme_gate: {
    passed: boolean;
    explanation: string;
  };
  authority_checks: Record<VoiceId, boolean>;
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

Return ONLY valid JSON with this shape:
{
  "position": "your independent position",
  "reasoning": "concise evidence-grounded reasoning",
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
  consensus: boolean;
  final_advice: string | null;
  supreme_gate: CouncilRunResult["supreme_gate"];
  authority_checks: Record<VoiceId, boolean>;
}> {
  const system = `You are the final Council synthesis voice.

Council is not a majority vote. Consensus exists only when all three independent voices support the same final advice, the supreme preservation-of-life gate passes, and every immutable voice authority passes.

Supreme principle: Preservation of Life Without Discrimination.
King: Equality without question.
Lincoln: Self-government and consent of the governed.
Gandhi: Nonviolence and peaceful disobedience.

Never weaken, reinterpret away, or trade one of these gates merely to manufacture agreement. If a gate fails, there is no consensus. A no-consensus result is legitimate.

Do not speak as though you are any historical person. Do not invent historical evidence.

Return ONLY valid JSON:
{
  "consensus": true,
  "final_advice": "collective advice or null",
  "supreme_gate": {
    "passed": true,
    "explanation": "..."
  },
  "authority_checks": {
    "king": true,
    "lincoln": true,
    "gandhi": true
  }
}`;

  return jsonObject(await askModel(system, JSON.stringify({ question, context, deliberations })));
}

export async function runCouncil(input: {
  question: string;
  context?: string;
  userId: string;
  conversationId?: string | null;
}): Promise<CouncilRunResult> {
  const question = input.question.trim();
  if (!question) throw new Error("Question is required.");
  if (question.length > 12000) throw new Error("Question is too long.");

  const supabase = await createSupabaseServerClient();
  const foundation = await loadFoundation(supabase);

  const { data: decision, error: decisionError } = await supabase
    .from("council_decisions")
    .insert({
      user_id: input.userId,
      conversation_id: input.conversationId ?? null,
      question,
      context: { text: input.context ?? "", engine_version: "1.0.0" },
      status: "deliberating",
      action_type: "none",
    })
    .select("id")
    .single();

  if (decisionError || !decision) {
    throw new Error(`Could not create Council decision: ${decisionError?.message ?? "unknown error"}`);
  }

  let deliberations: VoiceResult[];
  try {
    deliberations = await Promise.all(
      VOICES.map((voice) => deliberateVoice(voice, question, input.context ?? "", foundation)),
    );

    const supremePassed = deliberations.every((d) => d.life_gate.passed);
    const authoritiesPassed = Object.fromEntries(
      deliberations.map((d) => [d.voice_id, d.authority_check.passed]),
    ) as Record<VoiceId, boolean>;

    await supabase.from("council_deliberations").insert(
      deliberations.map((d) => ({
        decision_id: decision.id,
        voice_id: d.voice_id,
        position: d.position,
        reasoning: d.reasoning,
        principle_check: {
          preservation_of_life: d.life_gate,
          voice_authority: d.authority_check,
          source_ids: d.source_ids,
          confidence: d.confidence,
        },
        supports_advice: d.supports_advice,
      })),
    );

    if (!supremePassed || !deliberations.every((d) => d.supports_advice && d.authority_check.passed)) {
      const result: CouncilRunResult = {
        decision_id: decision.id,
        status: "no_consensus",
        final_advice: null,
        deliberations,
        supreme_gate: {
          passed: supremePassed,
          explanation: supremePassed
            ? "All three voices passed the supreme preservation-of-life gate."
            : "At least one voice identified a failure of the supreme preservation-of-life gate.",
        },
        authority_checks: authoritiesPassed,
      };

      await supabase
        .from("council_decisions")
        .update({
          status: "no_consensus",
          final_advice: null,
          principle_check: {
            preservation_of_life: result.supreme_gate,
            voices: authoritiesPassed,
          },
        })
        .eq("id", decision.id)
        .eq("user_id", input.userId);

      return result;
    }

    const synthesis = await synthesize(question, input.context ?? "", deliberations);
    const finalStatus = synthesis.consensus ? "consensus" : "no_consensus";

    await supabase
      .from("council_decisions")
      .update({
        status: finalStatus,
        final_advice: synthesis.final_advice,
        principle_check: {
          preservation_of_life: synthesis.supreme_gate,
          voices: synthesis.authority_checks,
        },
      })
      .eq("id", decision.id)
      .eq("user_id", input.userId);

    return {
      decision_id: decision.id,
      status: finalStatus,
      final_advice: synthesis.final_advice,
      deliberations,
      supreme_gate: synthesis.supreme_gate,
      authority_checks: synthesis.authority_checks,
    };
  } catch (error) {
    await supabase
      .from("council_decisions")
      .update({ status: "declined", final_advice: null })
      .eq("id", decision.id)
      .eq("user_id", input.userId);
    throw error;
  }
}
