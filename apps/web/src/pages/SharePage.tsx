import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { formatBytes, formatDate } from "../lib/format";

interface SharedDoc {
  name: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: string | null;
}

/** Public page for share-link recipients. No account needed; shows only what the link grants. */
export function SharePage() {
  const { token = "" } = useParams();
  const doc = useQuery({
    queryKey: ["share", token],
    queryFn: async () => (await api<{ document: SharedDoc }>(`/s/${token}`)).document,
  });

  if (doc.isLoading) return <p className="muted">Loading…</p>;
  if (!doc.data) {
    return (
      <div className="auth-card">
        <h1>Link unavailable</h1>
        <p>This link is invalid, has expired, or was revoked by the person who shared it.</p>
      </div>
    );
  }

  const d = doc.data;
  return (
    <div className="auth-card">
      <p className="muted small">Someone shared a file with you</p>
      <h1 className="filename">{d.name}</h1>
      <p className="muted">
        {formatBytes(d.sizeBytes)} · {d.mimeType}
      </p>
      <a className="button btn-primary" href={`/api/s/${token}/download`}>
        Download
      </a>
      <p className="muted small">{d.expiresAt ? `This link expires ${formatDate(d.expiresAt)}.` : "This link does not expire."}</p>
    </div>
  );
}
