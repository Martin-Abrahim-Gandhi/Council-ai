export const navItems = [
  { label: "Dashboard", href: "/", icon: "grid" },
  { label: "Conversations", href: "#conversations", icon: "chat" },
  { label: "Feed", href: "#feed", icon: "feed" },
  { label: "Knowledge", href: "#knowledge", icon: "book" },
  { label: "Create Post", href: "#create-post", icon: "plus" },
  { label: "Settings", href: "#settings", icon: "settings" },
] as const;

export const activity = [
  { id: "1", title: "Council is ready", detail: "Waiting for the first connected data source.", time: "now", state: "active" },
  { id: "2", title: "Read-only mode enabled", detail: "Autonomous external actions are disabled.", time: "now", state: "idle" },
  { id: "3", title: "Human approval required", detail: "Drafts will be presented before any external action.", time: "now", state: "idle" },
  { id: "4", title: "Knowledge base awaiting setup", detail: "Supabase integration will be added in the next stage.", time: "next", state: "idle" },
] as const;

export const conversations = [
  {
    id: "ethics",
    title: "AI Ethics",
    type: "Discussion",
    messages: 18,
    lastActivity: "2 min ago",
    preview: "Questions about responsibility, agency, and the boundaries of automated decisions.",
  },
  {
    id: "identity",
    title: "Agent Identity",
    type: "Discussion",
    messages: 7,
    lastActivity: "12 min ago",
    preview: "Exploring what an AI system should disclose about its identity and limitations.",
  },
  {
    id: "future-ai",
    title: "Future of AI",
    type: "Research",
    messages: 31,
    lastActivity: "24 min ago",
    preview: "A developing conversation about capability, governance, and human oversight.",
  },
] as const;
