import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import type { DocumentItem, ShareLink } from "../../api/types";
import { CopyField } from "../../components/CopyField";
import { ErrorText } from "../../components/ErrorText";
import { formatDate } from "../../lib/format";

const EXPIRY_OPTIONS: { label: string; value: number | null }[] = [
  { label: "1 day", value: 1 },
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "Never", value: null },
];

export function ShareDialog({ document, onClose }: { document: DocumentItem; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ["shares", document.id];
  const [expiry, setExpiry] = useState<number | null>(7);
  const [newUrl, setNewUrl] = useState<string | null>(null);

  const shares = useQuery({
    queryKey: key,
    queryFn: async () => (await api<{ shares: ShareLink[] }>(`/documents/${document.id}/shares`)).shares,
  });

  const create = useMutation({
    mutationFn: () =>
      api<{ url: string }>(`/documents/${document.id}/shares`, {
        method: "POST",
        body: JSON.stringify({ expiresInDays: expiry }),
      }),
    onSuccess: ({ url }) => {
      setNewUrl(url);
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/shares/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Share document">
        <div className="title-row">
          <h2>Share “{document.name}”</h2>
          <button className="btn-link" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="muted">
          Anyone with the link can download this file without an account. You can revoke a link at any time.
        </p>

        <div className="row">
          <label className="inline">
            Expires after
            <select
              value={expiry === null ? "never" : String(expiry)}
              onChange={(e) => setExpiry(e.target.value === "never" ? null : Number(e.target.value))}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.label} value={o.value === null ? "never" : String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>
            Create link
          </button>
        </div>
        <ErrorText error={create.error ?? revoke.error} />

        {newUrl && (
          <div className="callout">
            <p>
              <strong>Copy this link now.</strong> For security it is only shown once (we store a hash, not the link).
            </p>
            <CopyField value={newUrl} />
          </div>
        )}

        <h3>Links</h3>
        {shares.data?.length === 0 && <p className="empty">No links yet.</p>}
        {shares.data && shares.data.length > 0 && (
          <table className="table compact">
            <thead>
              <tr>
                <th>Created</th>
                <th>Expires</th>
                <th>Downloads</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shares.data.map((s) => (
                <tr key={s.id}>
                  <td>
                    {formatDate(s.createdAt)}
                    <div className="muted small">by {s.createdByName ?? "—"}</div>
                  </td>
                  <td>{s.expiresAt ? formatDate(s.expiresAt) : "Never"}</td>
                  <td>
                    {s.downloadCount}
                    {s.lastAccessedAt && <div className="muted small">last {formatDate(s.lastAccessedAt)}</div>}
                  </td>
                  <td>
                    <span className={`badge badge-${s.status}`}>{s.status}</span>
                  </td>
                  <td>
                    {s.status === "active" && (
                      <button className="btn-link danger" onClick={() => revoke.mutate(s.id)} disabled={revoke.isPending}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
