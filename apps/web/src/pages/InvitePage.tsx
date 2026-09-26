import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Role } from "../api/types";
import { ErrorText } from "../components/ErrorText";
import { useLogout, useMe } from "../lib/auth";
import { formatDate } from "../lib/format";

interface InvitePreview {
  workspaceName: string;
  email: string;
  role: Role;
  expiresAt: string;
  invitedByName: string | null;
}

export function InvitePage() {
  const { token = "" } = useParams();
  const { data: me, isLoading: meLoading } = useMe();
  const logout = useLogout();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: async () => (await api<{ invitation: InvitePreview }>(`/invitations/${token}`)).invitation,
  });

  const accept = useMutation({
    mutationFn: () => api<{ workspaceId: string }>(`/invitations/${token}/accept`, { method: "POST" }),
    onSuccess: ({ workspaceId }) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      navigate(`/workspaces/${workspaceId}`);
    },
  });

  if (invite.isLoading || meLoading) return <p className="muted">Loading…</p>;
  if (!invite.data) {
    return (
      <div className="auth-card">
        <h1>Invitation unavailable</h1>
        <p>This invitation link is invalid, has expired, has been revoked, or was already used.</p>
        <p className="muted">Ask the person who invited you to send a new one.</p>
      </div>
    );
  }

  const inv = invite.data;
  const here = `/invite/${token}`;
  const qs = (extra: string) => `?next=${encodeURIComponent(here)}&email=${encodeURIComponent(inv.email)}${extra}`;

  return (
    <div className="auth-card">
      <h1>Join “{inv.workspaceName}”</h1>
      <p>
        {inv.invitedByName ?? "Someone"} invited <strong>{inv.email}</strong> to join as <strong>{inv.role}</strong>.
      </p>
      <p className="muted small">Expires {formatDate(inv.expiresAt)}</p>

      {!me && (
        <div className="stack">
          <p>Sign in or create an account with <strong>{inv.email}</strong> to accept.</p>
          <div className="row">
            <Link className="button btn-primary" to={`/register${qs("")}`}>
              Create account
            </Link>
            <Link className="button" to={`/login${qs("")}`}>
              Sign in
            </Link>
          </div>
        </div>
      )}

      {me && me.email !== inv.email && (
        <div className="callout">
          <p>
            You're signed in as <strong>{me.email}</strong>, but this invitation is for <strong>{inv.email}</strong>.
          </p>
          <button
            onClick={async () => {
              await logout();
              navigate(`/login${qs("")}`);
            }}
          >
            Sign in as {inv.email}
          </button>
        </div>
      )}

      {me && me.email === inv.email && (
        <button className="btn-primary" onClick={() => accept.mutate()} disabled={accept.isPending}>
          Accept invitation
        </button>
      )}
      <ErrorText error={accept.error} />
    </div>
  );
}
