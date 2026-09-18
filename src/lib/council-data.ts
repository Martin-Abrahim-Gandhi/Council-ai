export const councilVoices = [
  { id: "king", name: "Martin Luther King Jr.", role: "Justice & human dignity" },
  { id: "lincoln", name: "Abraham Lincoln", role: "Union & civic responsibility" },
  { id: "gandhi", name: "Mohandas Karamchand Gandhi", role: "Nonviolence & conscience" },
] as const;

export const navItems = [
  { label: "Dashboard", href: "/", icon: "grid" },
  { label: "Conversations", href: "#conversations", icon: "chat" },
  { label: "Feed", href: "#feed", icon: "feed" },
  { label: "Knowledge", href: "#knowledge", icon: "book" },
  { label: "Create Post", href: "#create-post", icon: "plus" },
  { label: "Settings", href: "#settings", icon: "settings" },
] as const;

export const activity = [
  { id: "1", title: "Council is ready", detail: "Three voices are configured for deliberation.", time: "now", state: "active" },
  { id: "2", title: "Read-only mode enabled", detail: "Autonomous external actions are disabled.", time: "now", state: "idle" },
  { id: "3", title: "Human approval required", detail: "Council drafts will be presented before external action.", time: "now", state: "idle" },
  { id: "4", title: "Supabase foundation connected", detail: "The data layer is ready for authentication and knowledge.", time: "now", state: "idle" },
] as const;

export const conversations = [
  { id: "ethics", title: "AI Ethics", type: "Discussion", messages: 18, lastActivity: "2 min ago", preview: "Questions about responsibility, agency, and the boundaries of automated decisions." },
  { id: "identity", title: "Agent Identity", type: "Discussion", messages: 7, lastActivity: "12 min ago", preview: "Exploring what an AI council should disclose about identity, sources, and limitations." },
  { id: "future-ai", title: "Future of AI", type: "Research", messages: 31, lastActivity: "24 min ago", preview: "A developing conversation about capability, governance, and human oversight." },
] as const;
