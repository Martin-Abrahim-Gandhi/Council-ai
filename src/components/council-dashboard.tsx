"use client";

import { useState } from "react";
import { councilVoices, type CouncilDecision, type CouncilEscalation } from "@/lib/council-data";

type DashboardData = {
  conversations: Array<{ id: string; title: string | null; platform: string; status: string; updated_at: string }>;
  decisions: CouncilDecision[];
  activity: Array<{ id: string; event_type: string; title: string; detail: string | null; created_at: string }>;
  escalations: CouncilEscalation[];
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function CouncilDashboard({ email, data }: { email: string; data: DashboardData }) {
  const [active, setActive] = useState("Dashboard");
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState("");
  const [running, setRunning] = useState(false);
  const [parcelStage, setParcelStage] = useState<"king" | "lincoln" | "gandhi" | "chamber" | null>(null);
  const [result, setResult] = useState<{ status: string; final_advice: string | null; supreme_gate: { passed: boolean; explanation: string }; authority_checks: Record<string, boolean> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEscalation, setSelectedEscalation] = useState<CouncilEscalation | null>(data.escalations[0] ?? null);
  const [correction, setCorrection] = useState("");
  const [guidance, setGuidance] = useState("");
  const [resolving, setResolving] = useState(false);
  const latest = data.decisions[0];

  async function deliberate() {
    if (!question.trim() || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setParcelStage("king");

    async function startParcel(stage: "king" | "lincoln" | "gandhi" | "chamber", decisionId: string | null) {
      const response = await fetch("/api/council/parcel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          stage === "king"
            ? { stage, question, context, background: true }
            : { stage, decisionId, background: true },
        ),
      });

      const raw = await response.text();
      let payload: { error?: string; decision_id?: string } = {};
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = { error: raw.slice(0, 500) || `Server returned HTTP ${response.status}.` };
      }
      if (!response.ok && response.status !== 202) {
        throw new Error(payload.error ?? `Could not start Council parcel ${stage}.`);
      }
      return payload;
    }

    async function waitForParcel(stage: "king" | "lincoln" | "gandhi" | "chamber", decisionId: string) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const response = await fetch(`/api/council/parcel?decisionId=${encodeURIComponent(decisionId)}`, {
          cache: "no-store",
        });
        const raw = await response.text();
        let payload: {
          error?: string;
          status?: string;
          final_advice?: string | null;
          parcel_stage?: string;
          parcel_error?: string | null;
          parcel_failed_stage?: string | null;
          gate_evaluation?: {
            preservation_of_life?: { passed: boolean; explanation: string };
            king?: { passed: boolean; explanation: string };
            lincoln?: { passed: boolean; explanation: string };
            gandhi?: { passed: boolean; explanation: string };
          } | null;
        } = {};
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = { error: raw.slice(0, 500) || `Server returned HTTP ${response.status}.` };
        }
        if (!response.ok) throw new Error(payload.error ?? `Could not read Council parcel status.`);
        if (payload.parcel_error) {
          throw new Error(`${payload.parcel_failed_stage ?? stage}: ${payload.parcel_error}`);
        }
        const complete = stage === "chamber"
          ? payload.complete === true
          : payload.parcel_stage === stage;
        if (complete) return payload;
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      throw new Error(`Council parcel ${stage} did not complete within the polling window.`);
    }

    try {
      let decisionId: string | null = null;
      let finalPayload: {
        status: string;
        final_advice: string | null;
        supreme_gate: { passed: boolean; explanation: string };
        authority_checks: Record<string, boolean>;
      } | null = null;

      const stages = ["king", "lincoln", "gandhi", "chamber"] as const;
      for (const stage of stages) {
        setParcelStage(stage);
        const started = await startParcel(stage, decisionId);
        if (started.decision_id) decisionId = started.decision_id;
        if (!decisionId) throw new Error("Council did not return a decision ID.");

        const payload = await waitForParcel(stage, decisionId);
        if (stage === "chamber") {
          const gates = payload.gate_evaluation;
          if (!gates?.preservation_of_life || !gates.king || !gates.lincoln || !gates.gandhi) {
            throw new Error("Council Chamber completed without a complete gate evaluation.");
          }
          finalPayload = {
            status: payload.status ?? "no_consensus",
            final_advice: payload.final_advice ?? null,
            supreme_gate: gates.preservation_of_life,
            authority_checks: {
              king: gates.king.passed,
              lincoln: gates.lincoln.passed,
              gandhi: gates.gandhi.passed,
            },
          };
        }
      }

      if (!finalPayload) throw new Error("Council Chamber did not return a final result.");
      setResult(finalPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Council deliberation failed.");
    } finally {
      setParcelStage(null);
      setRunning(false);
    }
  }
  async function resolveSelectedEscalation() {
    if (!selectedEscalation || !correction.trim() || resolving) return;
    setResolving(true);
    setError(null);
    try {
      const response = await fetch("/api/council/escalations/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escalationId: selectedEscalation.id, correction, guidance }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not resolve escalation.");
      setSelectedEscalation({ ...selectedEscalation, status: "resolved", admin_correction: correction, admin_guidance: guidance });
      setCorrection("");
      setGuidance("");
      setActive("Dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve escalation.");
    } finally {
      setResolving(false);
    }
  }

  const consensusCount = data.decisions.filter((d) => d.status === "consensus" || d.status === "acted").length;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C</div>
          <div><div className="brand-name">COUNCIL</div><div className="brand-subtitle">Thought · Reason · Action</div></div>
        </div>

        <nav className="nav">
          {["Dashboard", "Conversations", "Feed", "Knowledge", "Create Post", "Admin Escalations", "Settings"].map((item) => (
            <button key={item} className={active === item ? "nav-item active" : "nav-item"} onClick={() => setActive(item)}>
              {item}
            </button>
          ))}
        </nav>

        <div className="voice-stack">
          <span className="section-kicker">THE THREE VOICES</span>
          {councilVoices.map((voice) => (
            <div className="voice" key={voice.id}>
              <span className="voice-mark">{voice.name[0]}</span>
              <span><strong>{voice.name}</strong><small>{voice.role}</small></span>
            </div>
          ))}
        </div>

        <div className="sidebar-footer"><span className="status-dot" />Signed in as {email}</div>
      </aside>

      <section className="main">
        <header className="topbar">
          <div><p className="eyebrow">COUNCIL / {active.toUpperCase()}</p><h1>{active}</h1></div>
          <div className="header-status"><span className="pulse" />Autonomous · three-voice consensus</div>
        </header>

        <div className="content">
          {active === "Dashboard" && (
            <>
              <section className="hero">
                <div>
                  <span className="section-kicker">AN AUTONOMOUS DELIBERATIVE COUNCIL</span>
                  <h2>Three voices. One collective judgment.</h2>
                  <p>
                    King, Lincoln, and Gandhi are represented as interpretive voices. Each independently tests proposed advice against documented principles. Council acts only when the collective advice survives all three principle checks.
                  </p>
                  <div className="hero-actions">
                    <button className="primary" onClick={() => setActive("Conversations")}>Open conversations</button>
                    <button className="secondary" onClick={() => setActive("Create Post")}>Ask the Council</button>
                  </div>
                </div>
                <div className="seal">CONSENSUS <b>∴</b></div>
              </section>

              <section className="stats">
                <div><span>MODE</span><strong>AUTONOMOUS</strong><small>No human approval gate</small></div>
                <div><span>VOICES</span><strong>03</strong><small>Independent principle checks</small></div>
                <div><span>CONSENSUS</span><strong>{consensusCount}</strong><small>Collective decisions recorded</small></div>
                <div><span>CONVERSATIONS</span><strong>{data.conversations.length}</strong><small>Stored in Supabase</small></div>
              </section>

              <section className="two-col">
                <div className="panel">
                  <div className="panel-heading"><div><span className="section-kicker">LIVE LOG</span><h3>Council activity</h3></div><span className="muted">Persistent</span></div>
                  <div className="activity-list">
                    {data.activity.length === 0 ? (
                      <div className="empty-row">No activity yet. The Council is ready for its first deliberation.</div>
                    ) : data.activity.map((item, index) => (
                      <div className="activity-row" key={item.id}>
                        <span className={index === 0 ? "activity-dot active" : "activity-dot"} />
                        <div><strong>{item.title}</strong><span>{item.detail ?? item.event_type}</span></div>
                        <small>{formatTime(item.created_at)}</small>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="panel approval-panel">
                  <div className="panel-heading">
                    <div><span className="section-kicker">LATEST DECISION</span><h3>Collective advice</h3></div>
                    <span className={"badge " + (latest?.status ?? "pending")}>{latest?.status ?? "ready"}</span>
                  </div>
                  {latest ? (
                    <>
                      <span className="draft-type">{latest.action_type ?? "none"} · {formatTime(latest.created_at)}</span>
                      <blockquote>{latest.final_advice ?? "The three voices are still deliberating."}</blockquote>
                    </>
                  ) : (
                    <div className="empty-state-inline">No decision has been recorded yet. When a question arrives, each voice will reason independently before Council reaches consensus.</div>
                  )}
                </div>
              </section>

              <section className="conversation-section">
                <div className="panel-heading"><div><span className="section-kicker">RECENT</span><h3>Conversations</h3></div><button className="text-link" onClick={() => setActive("Conversations")}>View all →</button></div>
                <div className="conversation-grid">
                  {data.conversations.length === 0 ? (
                    <div className="panel empty-state"><span className="section-kicker">CONVERSATIONS</span><h2>Nothing here yet.</h2><p>Moltbook conversations will appear here once the read layer is connected.</p></div>
                  ) : data.conversations.map((conversation) => (
                    <button className="conversation-card" key={conversation.id} onClick={() => setActive("Conversations")}>
                      <div className="card-topline"><span className="conversation-type">{conversation.platform}</span><span className="message-count">{conversation.status}</span></div>
                      <h4>{conversation.title ?? "Untitled conversation"}</h4>
                      <div className="card-footer"><span>Updated {formatTime(conversation.updated_at)}</span><span className="arrow">↗</span></div>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {active === "Conversations" && (
            <section className="workspace">
              <div className="list-panel">
                {data.decisions.length === 0 ? <div className="empty-state-inline">No Council decisions yet.</div> : data.decisions.map((decision) => (
                  <div key={decision.id} className="list-item">
                    <span>{decision.status}</span><strong>{decision.question}</strong><small>{formatTime(decision.created_at)}</small>
                  </div>
                ))}
              </div>
              <div className="thread panel">
                <span className="section-kicker">COUNCIL METHOD</span>
                <h2>Advice must survive all three tests.</h2>
                <p className="thread-intro">Consensus means the best collective advice the three voices can give, not a simple majority vote.</p>
                {councilVoices.map((voice) => (
                  <div className="voice-turn" key={voice.id}><b>{voice.name}</b><p>Independently examine the question, relevant evidence, and whether the proposed advice conflicts with this voice's documented principles.</p></div>
                ))}
                <div className="council-position"><span className="section-kicker">CONSENSUS RULE</span><p>No action when the proposed advice violates a core principle of any voice. Revise, deliberate again, or decline.</p></div>
              </div>
            </section>
          )}

          {active === "Feed" && <section className="empty-state panel"><span className="section-kicker">FEED</span><h2>Moltbook reading comes next.</h2><p>The autonomous decision layer is ready; the external feed connector is the next integration.</p></section>}
          {active === "Knowledge" && <section className="empty-state panel"><span className="section-kicker">KNOWLEDGE</span><h2>The Council library.</h2><p>Historical sources and uploaded documents will become evidence for deliberation. Source evidence will remain distinguishable from Council interpretation.</p></section>}
          {active === "Create Post" && (
            <section className="composer panel">
              <span className="section-kicker">COUNCIL QUESTION</span>
              <h2>Give the Council something to deliberate.</h2>
              <label>Question<input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What should the Council consider?" /></label>
              <label>Context<textarea value={context} onChange={(event) => setContext(event.target.value)} rows={7} placeholder="Evidence, circumstances, or conversation context..." /></label>
              <button className="primary" disabled={running || !question.trim()} onClick={deliberate}>{running ? `Council parcel: ${parcelStage ?? "starting"}…` : "Begin deliberation"}</button>
              <div className="approval-note">The supreme preservation-of-life gate is absolute. Then King, Lincoln, and Gandhi must independently pass their authority tests. There is no human approval gate.</div>
              {error && <div className="approval-note">{error}</div>}
              {result && (
                <div className="panel">
                  <span className="section-kicker">COUNCIL RESULT</span>
                  <h3>{result.status === "consensus" ? "Consensus reached" : "No consensus"}</h3>
                  <p><strong>Life gate:</strong> {result.supreme_gate.passed ? "Passed" : "Failed"} — {result.supreme_gate.explanation}</p>
                  <p><strong>King:</strong> {result.authority_checks.king ? "Passed" : "Failed"} · <strong>Lincoln:</strong> {result.authority_checks.lincoln ? "Passed" : "Failed"} · <strong>Gandhi:</strong> {result.authority_checks.gandhi ? "Passed" : "Failed"}</p>
                  {result.final_advice && <blockquote>{result.final_advice}</blockquote>}
                </div>
              )}
            </section>
          )}
          {active === "Admin Escalations" && (
            <section className="workspace">
              <div className="list-panel">
                <div className="panel-heading"><div><span className="section-kicker">ADMIN REVIEW</span><h3>Escalations</h3></div><span className="muted">{data.escalations.filter((e) => e.status === "pending").length} pending</span></div>
                {data.escalations.length === 0 ? <div className="empty-state-inline">No constitutional escalations. Council has not stopped a reply at a gate.</div> : data.escalations.map((item) => (
                  <button key={item.id} className="list-item" onClick={() => { setSelectedEscalation(item); setCorrection(item.suggested_common_ground ?? item.proposed_reply); }}>
                    <span>{item.status}</span><strong>{item.question}</strong><small>{item.failed_gates.map((g) => g.gate).join(" · ") || "Review required"} · {formatTime(item.created_at)}</small>
                  </button>
                ))}
              </div>
              {selectedEscalation ? (
                <div className="thread panel">
                  <span className="section-kicker">WHY COUNCIL STOPPED</span>
                  <h2>Constitutional gate review</h2>
                  <p className="thread-intro">{selectedEscalation.reason}</p>
                  <div className="panel">
                    <span className="section-kicker">QUESTION</span>
                    <p>{selectedEscalation.question}</p>
                  </div>
                  <div className="panel">
                    <span className="section-kicker">PROPOSED REPLY</span>
                    <blockquote>{selectedEscalation.proposed_reply}</blockquote>
                  </div>
                  <div className="panel">
                    <span className="section-kicker">SUGGESTED COMMON GROUND</span>
                    <blockquote>{selectedEscalation.suggested_common_ground ?? "No safer formulation was returned."}</blockquote>
                  </div>
                  <div className="panel">
                    <span className="section-kicker">FAILED GATES</span>
                    {selectedEscalation.failed_gates.length === 0 ? <p>The candidate did not pass the final constitutional review.</p> : selectedEscalation.failed_gates.map((gate) => (
                      <div className="voice-turn" key={gate.gate}><b>{gate.gate}</b><p>{gate.explanation}</p></div>
                    ))}
                  </div>
                  <div className="panel">
                    <span className="section-kicker">VOICE CONTENTIONS</span>
                    {councilVoices.map((voice) => (
                      <div className="voice-turn" key={voice.id}><b>{voice.name}</b><p>{selectedEscalation.voice_positions[voice.id] ?? "No position recorded."}</p><p>{(selectedEscalation.voice_contentions[voice.id] ?? []).join(" ")}</p><small>{selectedEscalation.voice_accommodations[voice.id] ?? ""}</small></div>
                    ))}
                  </div>
                  {selectedEscalation.status !== "resolved" && (
                    <div className="panel composer">
                      <span className="section-kicker">ADMIN CORRECTION</span>
                      <h3>Correct the response</h3>
                      <label>Corrected response<textarea value={correction} onChange={(event) => setCorrection(event.target.value)} rows={8} /></label>
                      <label>Guidance for Council<textarea value={guidance} onChange={(event) => setGuidance(event.target.value)} rows={4} placeholder="Optional context for the next deliberation..." /></label>
                      <button className="primary" disabled={resolving || !correction.trim()} onClick={resolveSelectedEscalation}>{resolving ? "Rechecking constitutional gates…" : "Approve corrected response & continue"}</button>
                      <div className="approval-note">The corrected response is rechecked against the Supreme gate and all three voice authorities. Admin guidance cannot override a gate.</div>
                    </div>
                  )}
                  {selectedEscalation.status === "resolved" && <div className="approval-note">Resolved. The corrected response passed the constitutional review and is marked ready to publish.</div>}
                </div>
              ) : <div className="empty-state panel"><h2>Select an escalation.</h2></div>}
            </section>
          )}

          {active === "Settings" && (
            <section className="settings-grid">
              <div className="panel"><span className="section-kicker">IDENTITY</span><h2>Council</h2><p>Three fictionalized interpretive voices deliberating together: Martin Luther King Jr., Abraham Lincoln, and Mohandas Karamchand Gandhi.</p><div className="setting-row"><span>External action gate</span><strong>Three-voice consensus</strong></div><div className="setting-row"><span>Human approval</span><strong>Not required</strong></div></div>
              <div className="panel"><span className="section-kicker">ACCOUNT</span><h2>Authenticated</h2><div className="setting-row"><span>Email</span><strong>{email}</strong></div><div className="setting-row"><span>Database</span><strong>Supabase</strong></div><form action="/auth/signout" method="post"><button className="secondary" type="submit">Sign out</button></form></div>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}
