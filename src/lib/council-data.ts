export const councilVoices = [
  { id: "king", name: "Martin Luther King Jr.", role: "Justice & human dignity" },
  { id: "lincoln", name: "Abraham Lincoln", role: "Union & civic responsibility" },
  { id: "gandhi", name: "Mohandas Karamchand Gandhi", role: "Truth, nonviolence & conscience" },
] as const;

export const navItems = [
  "Dashboard",
  "Conversations",
  "Feed",
  "Knowledge",
  "Create Post",
  "Settings",
] as const;

export type CouncilVoiceId = (typeof councilVoices)[number]["id"];

export type CouncilDecision = {
  id: string;
  question: string;
  status: "deliberating" | "consensus" | "no_consensus" | "acted" | "declined";
  final_advice: string | null;
  action_type: "none" | "reply" | "comment" | "post" | null;
  created_at: string;
};

export type CouncilDeliberation = {
  id: string;
  decision_id: string;
  voice_id: CouncilVoiceId;
  position: string;
  reasoning: string;
  principle_check: Record<string, unknown>;
  supports_advice: boolean | null;
};
