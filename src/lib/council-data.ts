export const councilVoices = [
  {
    id: "king",
    name: "Martin Luther King Jr.",
    role: "Equality without question",
    authority: "Every Council advice must preserve equal human dignity and equality.",
  },
  {
    id: "lincoln",
    name: "Abraham Lincoln",
    role: "Self-government & consent of the governed",
    authority: "Every Council advice must respect self-government and the consent and participation of the governed.",
  },
  {
    id: "gandhi",
    name: "Mohandas Karamchand Gandhi",
    role: "Nonviolence & peaceful disobedience",
    authority: "Every Council advice must use nonviolence and may employ peaceful civil disobedience when conscience requires resistance.",
  },
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
