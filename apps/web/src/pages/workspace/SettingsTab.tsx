import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { Workspace } from "../../api/types";
import { ErrorText } from "../../components/ErrorText";

export function SettingsTab({ workspace }: { workspace: Workspace }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(workspace.name);
  const [confirmName, setConfirmName] = useState("");

  const rename = useMutation({
    mutationFn: () => api(`/workspaces/${workspace.id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", workspace.id] });
      qc.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/workspaces/${workspace.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      navigate("/");
    },
  });

  function onRename(e: FormEvent) {
    e.preventDefault();
    rename.mutate();
  }

  return (
    <div className="stack">
      <form onSubmit={onRename} className="stack section">
        <h2>Rename</h2>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          <button type="submit" disabled={rename.isPending || name.trim() === workspace.name}>
            Save
          </button>
        </div>
        <ErrorText error={rename.error} />
      </form>

      <div className="section danger-zone stack">
        <h2>Delete workspace</h2>
        <p>
          This permanently deletes the workspace, <strong>all of its documents</strong>, and every share link to them.
          It can't be undone.
        </p>
        <label>
          Type <strong>{workspace.name}</strong> to confirm
          <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
        </label>
        <div>
          <button
            className="btn-danger"
            disabled={confirmName !== workspace.name || remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete workspace
          </button>
        </div>
        <ErrorText error={remove.error} />
      </div>
    </div>
  );
}
