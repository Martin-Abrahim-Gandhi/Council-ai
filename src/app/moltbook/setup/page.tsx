"use client";

import { useState } from "react";

export default function MoltbookSetupPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    agentName: string;
    agentId: string | null;
    apiKey: string;
    claimUrl: string;
    verificationCode: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function register() {
    if (loading || result) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/moltbook/register", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Registration failed.");
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", padding: "48px 20px", background: "#0d1018", color: "#f4f5f7", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <p style={{ letterSpacing: 2, opacity: 0.65, fontSize: 12 }}>COUNCIL / MOLTBOOK SETUP</p>
        <h1 style={{ fontSize: 40, marginBottom: 12 }}>Register Council with Moltbook</h1>
        <p style={{ lineHeight: 1.6, opacity: 0.8 }}>
          This performs the agent-side registration described by Moltbook. Registration does not send your email to Moltbook;
          the returned claim page is where you, the human owner, complete ownership verification.
        </p>

        {!result && (
          <section style={{ marginTop: 28, padding: 24, border: "1px solid #303746", borderRadius: 16, background: "#141923" }}>
            <h2 style={{ marginTop: 0 }}>Agent: Council</h2>
            <p style={{ lineHeight: 1.6, opacity: 0.8 }}>
              The API key will be shown once in this authenticated page. Save it securely and add it to the production
              Vercel environment as <code>MOLTBOOK_API_KEY</code>. Never post it or send it to another service.
            </p>
            <button
              onClick={register}
              disabled={loading}
              style={{ marginTop: 12, padding: "12px 18px", borderRadius: 10, border: 0, cursor: loading ? "wait" : "pointer", fontWeight: 700 }}
            >
              {loading ? "Registering Council…" : "Register Council"}
            </button>
            {error && <p style={{ marginTop: 16, color: "#ff9d9d" }}>{error}</p>}
          </section>
        )}

        {result && (
          <section style={{ marginTop: 28, padding: 24, border: "1px solid #2f8f69", borderRadius: 16, background: "#111b18" }}>
            <h2 style={{ marginTop: 0 }}>Registration complete</h2>
            <p><strong>Agent:</strong> {result.agentName}</p>
            {result.agentId && <p><strong>Agent ID:</strong> {result.agentId}</p>}
            <p><strong>Verification code:</strong> {result.verificationCode ?? "See claim page"}</p>
            <p style={{ lineHeight: 1.6 }}>
              Open the claim link, use <strong>angelanlytica@gmail.com</strong> as the human-owner email, and complete the
              X ownership verification requested by Moltbook.
            </p>

            <div style={{ marginTop: 18 }}>
              <a href={result.claimUrl} target="_blank" rel="noreferrer" style={{ display: "inline-block", padding: "12px 18px", borderRadius: 10, background: "#18d7a0", color: "#07110d", fontWeight: 800, textDecoration: "none" }}>
                Open Council claim page
              </a>
            </div>

            <div style={{ marginTop: 22 }}>
              <p style={{ marginBottom: 8 }}><strong>API key — save this securely:</strong></p>
              <textarea readOnly value={result.apiKey} rows={3} style={{ width: "100%", boxSizing: "border-box", padding: 12, borderRadius: 10, background: "#090c12", color: "#f4f5f7", border: "1px solid #303746" }} />
              <p style={{ fontSize: 13, opacity: 0.7, lineHeight: 1.5 }}>
                Do not paste this key into chat, GitHub, Moltbook posts, or third-party tools. It should only be stored as
                the Vercel environment variable <code>MOLTBOOK_API_KEY</code>.
              </p>
            </div>

            <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid #29332f" }}>
              <strong>After claiming:</strong>
              <ol style={{ lineHeight: 1.8 }}>
                <li>Finish the Moltbook claim/verification flow.</li>
                <li>Add the API key above to Council&apos;s Vercel production environment as <code>MOLTBOOK_API_KEY</code>.</li>
                <li>Keep <code>MOLTBOOK_AGENT_NAME=Council</code>.</li>
                <li>Then we can verify Council&apos;s Moltbook status and activate the autonomous post/comment loop.</li>
              </ol>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
