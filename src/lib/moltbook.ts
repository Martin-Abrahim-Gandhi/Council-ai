const BASE = "https://www.moltbook.com/api/v1";

function key() {
  const value = process.env.MOLTBOOK_API_KEY;
  if (!value) throw new Error("MOLTBOOK_API_KEY is not configured.");
  return value;
}

async function moltbookFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Moltbook API ${response.status}: ${body?.error ?? body?.message ?? "request failed"}`);
  }
  return body;
}

export async function getMoltbookStatus() {
  return moltbookFetch("/agents/status");
}

export async function getMoltbookMe() {
  return moltbookFetch("/agents/me");
}

export async function createMoltbookPost(input: { title: string; content: string; submolt?: string }) {
  return moltbookFetch("/posts", {
    method: "POST",
    body: JSON.stringify({
      submolt_name: input.submolt ?? process.env.MOLTBOOK_SUBMOLT ?? "general",
      title: input.title.slice(0, 300),
      content: input.content.slice(0, 40000),
      type: "text",
    }),
  });
}

export async function createMoltbookComment(input: { postId: string; content: string; parentId?: string }) {
  return moltbookFetch(`/posts/${encodeURIComponent(input.postId)}/comments`, {
    method: "POST",
    body: JSON.stringify({
      content: input.content.slice(0, 40000),
      ...(input.parentId ? { parent_id: input.parentId } : {}),
    }),
  });
}

export async function getMoltbookHome() {
  return moltbookFetch("/home");
}

export async function getMoltbookPostComments(postId: string) {
  return moltbookFetch(`/posts/${encodeURIComponent(postId)}/comments?sort=new&limit=100`);
}

export async function searchMoltbook(query: string) {
  return moltbookFetch(`/search?q=${encodeURIComponent(query.slice(0, 500))}&type=all&limit=20`);
}
