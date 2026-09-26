import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { Invitation, Member, Role, Workspace } from "../../api/types";
import { CopyField } from "../../components/CopyField";
import { ErrorText } from "../../components/ErrorText";
import { useMe } from "../../lib/auth";
import { formatDate } from "../../lib/format";

export function MembersTab({ workspace }: { workspace: Workspace }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const canManage = workspace.permissions.canManageMembers;
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["members", workspace.id] });
    qc.invalidateQueries({ queryKey: ["invitations", workspace.id] });
    qc.invalidateQueries({ queryKey: ["activity", workspace.id] });
  };

  const members = useQuery({
    queryKey: ["members", workspace.id],
    queryFn: async () => (await api<{ members: Member[] }>(`/workspaces/${workspace.id}/members`)).members,
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      api(`/workspaces/${workspace.id}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }),
    onSuccess: invalidate,
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api(`/workspaces/${workspace.id}/members/${userId}`, { method: "DELETE" }),
    onSuccess: (_d, userId) => {
      if (userId === me?.id) {
        qc.invalidateQueries({ queryKey: ["workspaces"] });
        navigate("/");
      } else {
        invalidate();
      }
    },
  });

  return (
    <div>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Joined</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.data?.map((m) => {
            const isMe = m.userId === me?.id;
            return (
              <tr key={m.userId}>
                <td>
                  {m.name} {isMe && <span className="muted">(you)</span>}
                </td>
                <td>{m.email}</td>
                <td>
                  {canManage ? (
                    <select
                      value={m.role}
                      disabled={changeRole.isPending}
                      onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value as Role })}
                    >
                      <option value="owner">owner</option>
                      <option value="editor">editor</option>
                      <option value="viewer">viewer</option>
                    </select>
                  ) : (
                    <span className={`badge badge-${m.role}`}>{m.role}</span>
                  )}
                </td>
                <td>{formatDate(m.joinedAt)}</td>
                <td>
                  <div className="actions">
                  {isMe ? (
                    <button
                      className="btn-link danger"
                      onClick={() => confirm("Leave this workspace?") && removeMember.mutate(m.userId)}
                    >
                      Leave
                    </button>
                  ) : (
                    canManage && (
                      <button
                        className="btn-link danger"
                        onClick={() => confirm(`Remove ${m.name}?`) && removeMember.mutate(m.userId)}
                      >
                        Remove
                      </button>
                    )
                  )}
                </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ErrorText error={members.error ?? changeRole.error ?? removeMember.error} />

      {canManage && <Invitations workspaceId={workspace.id} onChange={invalidate} />}
    </div>
  );
}

function Invitations({ workspaceId, onChange }: { workspaceId: string; onChange: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);

  const pending = useQuery({
    queryKey: ["invitations", workspaceId],
    queryFn: async () =>
      (await api<{ invitations: Invitation[] }>(`/workspaces/${workspaceId}/invitations`)).invitations,
  });

  const invite = useMutation({
    mutationFn: () =>
      api<{ inviteUrl: string; invitation: Invitation }>(`/workspaces/${workspaceId}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email, role }),
      }),
    onSuccess: (res) => {
      setLink({ email: res.invitation.email, url: res.inviteUrl });
      setEmail("");
      onChange();
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/workspaces/${workspaceId}/invitations/${id}`, { method: "DELETE" }),
    onSuccess: onChange,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    invite.mutate();
  }

  return (
    <div className="section">
      <h2>Invite someone</h2>
      <form onSubmit={onSubmit} className="row">
        <input type="email" required placeholder="colleague@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="editor">editor</option>
          <option value="viewer">viewer</option>
        </select>
        <button type="submit" className="btn-primary" disabled={invite.isPending}>
          Create invite
        </button>
      </form>
      <p className="muted small">
        Editors can upload, delete and share documents. Viewers can only view and download. To make someone an
        owner, invite them and then change their role.
      </p>
      <ErrorText error={invite.error ?? revoke.error} />

      {link && (
        <div className="callout">
          <p>
            <strong>Send this link to {link.email}.</strong> It works once, for that email address only, and expires in
            7 days. It is only shown now.
          </p>
          <CopyField value={link.url} />
        </div>
      )}

      {pending.data && pending.data.length > 0 && (
        <>
          <h3>Pending invitations</h3>
          <table className="table compact">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pending.data.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{i.role}</td>
                  <td>{formatDate(i.expiresAt)}</td>
                  <td>
                    <button className="btn-link danger" onClick={() => revoke.mutate(i.id)}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
