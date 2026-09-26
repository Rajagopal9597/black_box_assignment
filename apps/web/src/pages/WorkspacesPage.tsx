import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Workspace, WorkspaceSummary } from "../api/types";
import { ErrorText } from "../components/ErrorText";

export function WorkspacesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const list = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => (await api<{ workspaces: WorkspaceSummary[] }>("/workspaces")).workspaces,
  });
  const create = useMutation({
    mutationFn: (n: string) =>
      api<{ workspace: Workspace }>("/workspaces", { method: "POST", body: JSON.stringify({ name: n }) }),
    onSuccess: ({ workspace }) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      navigate(`/workspaces/${workspace.id}`);
    },
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  }

  return (
    <section>
      <h1>Your workspaces</h1>
      {list.isLoading && <p className="muted">Loading…</p>}
      <ErrorText error={list.error} />
      <ul className="card-list">
        {list.data?.map((w) => (
          <li key={w.id}>
            <Link to={`/workspaces/${w.id}`} className="card">
              <strong>{w.name}</strong>
              <span className={`badge badge-${w.role}`}>{w.role}</span>
              <span className="muted">
                {w.documentCount} document{w.documentCount === 1 ? "" : "s"} · {w.memberCount} member
                {w.memberCount === 1 ? "" : "s"}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <h2>New workspace</h2>
      <form onSubmit={onCreate} className="row">
        <input placeholder="e.g. Finance team" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        <button type="submit" className="btn-primary" disabled={create.isPending || !name.trim()}>
          Create
        </button>
      </form>
      <ErrorText error={create.error} />
    </section>
  );
}
