import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api } from "../../api/client";
import type { DocumentItem, Workspace } from "../../api/types";
import { ErrorText } from "../../components/ErrorText";
import { useMe } from "../../lib/auth";
import { formatBytes, formatDate } from "../../lib/format";
import { ShareDialog } from "./ShareDialog";

const MAX_BYTES = 25 * 1024 * 1024;

export function DocumentsTab({ workspace }: { workspace: Workspace }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const fileInput = useRef<HTMLInputElement>(null);
  const [sharing, setSharing] = useState<DocumentItem | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const key = ["documents", workspace.id];

  const docs = useQuery({
    queryKey: key,
    queryFn: async () => (await api<{ documents: DocumentItem[] }>(`/workspaces/${workspace.id}/documents`)).documents,
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api(`/workspaces/${workspace.id}/documents`, { method: "POST", body: form });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["activity", workspace.id] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/documents/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["activity", workspace.id] });
    },
  });

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    setLocalError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setLocalError(`"${file.name}" is larger than the 25 MB limit.`);
      return;
    }
    upload.mutate(file);
  }

  const { permissions } = workspace;
  // Mirrors the server rule: owners delete anything, editors only their own uploads.
  const canDelete = (d: DocumentItem) =>
    permissions.canDeleteAnyDocument || (permissions.canDeleteOwnDocuments && d.uploadedById === me?.id);

  return (
    <div>
      {permissions.canUpload ? (
        <div className="toolbar">
          <input ref={fileInput} type="file" hidden onChange={onPick} />
          <button className="btn-primary" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? "Uploading…" : "Upload document"}
          </button>
          <span className="muted">Max 25 MB</span>
        </div>
      ) : (
        <p className="muted">You have view-only access to this workspace.</p>
      )}
      {localError && <p className="error">{localError}</p>}
      <ErrorText error={upload.error ?? remove.error} />

      {docs.isLoading && <p className="muted">Loading…</p>}
      <ErrorText error={docs.error} />
      {docs.data?.length === 0 && <p className="empty">No documents yet.</p>}
      {docs.data && docs.data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Uploaded</th>
              <th>By</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {docs.data.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.name}
                  {d.activeShareCount > 0 && (
                    <span className="badge badge-shared" title="Has active share links">
                      shared
                    </span>
                  )}
                </td>
                <td>{formatBytes(d.sizeBytes)}</td>
                <td>{formatDate(d.createdAt)}</td>
                <td>{d.uploadedByName ?? "—"}</td>
                <td>
                  <div className="actions">
                  <a href={`/api/documents/${d.id}/download`}>Download</a>
                  {permissions.canShare && (
                    <button className="btn-link" onClick={() => setSharing(d)}>
                      Share
                    </button>
                  )}
                  {canDelete(d) && (
                    <button
                      className="btn-link danger"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (confirm(`Delete "${d.name}"? Any share links to it will stop working.`)) remove.mutate(d.id);
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sharing && (
        <ShareDialog
          document={sharing}
          onClose={() => {
            setSharing(null);
            qc.invalidateQueries({ queryKey: key });
          }}
        />
      )}
    </div>
  );
}
