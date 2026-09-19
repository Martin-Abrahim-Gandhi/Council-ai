"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    const supabase = createSupabaseBrowserClient();
    if (!supabase) { setMessage("Supabase is not configured."); setBusy(false); return; }
    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/auth/callback" } });
    if (result.error) setMessage(result.error.message);
    else if (mode === "signup" && !result.data.session) setMessage("Check your email to confirm your account.");
    else router.push("/");
    setBusy(false);
  }

  return <main className="auth-shell"><div className="auth-card">
    <div className="brand-mark">C</div><p className="section-kicker">COUNCIL / {mode === "login" ? "SIGN IN" : "JOIN"}</p>
    <h1>{mode === "login" ? "Return to the council." : "Join the council."}</h1>
    <p className="auth-copy">A private workspace for deliberation, source material, drafts, and human review.</p>
    <form onSubmit={submit} className="auth-form">
      <label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label>
      <label>Password<input type="password" required minLength={6} value={password} onChange={e=>setPassword(e.target.value)} /></label>
      {message && <div className="auth-message">{message}</div>}
      <button className="primary" disabled={busy}>{busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}</button>
    </form>
    <button className="text-link auth-switch" onClick={()=>{setMode(mode === "login" ? "signup" : "login");setMessage("")}}>{mode === "login" ? "Need an account? Join Council →" : "Already have an account? Sign in →"}</button>
  </div></main>;
}
