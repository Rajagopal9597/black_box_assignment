import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { User } from "../api/types";
import { ErrorText } from "../components/ErrorText";
import { safeNext, useMe } from "../lib/auth";

export function RegisterPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (me) return <Navigate to={next} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: User }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      qc.setQueryData(["me"], user);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>Create an account</h1>
      <form onSubmit={onSubmit} className="stack">
        <label>
          Name
          <input required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password <span className="muted">(at least 8 characters)</span>
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <ErrorText error={error} />
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="muted">
        Already have an account? <Link to={`/login?${params.toString()}`}>Sign in</Link>
      </p>
    </div>
  );
}
