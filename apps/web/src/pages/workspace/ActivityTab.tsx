import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { ActivityEvent, Workspace } from "../../api/types";
import { ErrorText } from "../../components/ErrorText";
import { formatDate } from "../../lib/format";

function describe(e: ActivityEvent): string {
  const d = e.details as Record<string, string>;
  switch (e.action) {
    case "workspace.created":
      return `created the workspace “${d.name}”`;
    case "workspace.renamed":
      return `renamed the workspace to “${d.name}”`;
    case "document.uploaded":
      return `uploaded “${d.document}”`;
    case "document.deleted":
      return `deleted “${d.document}”`;
    case "share.created":
      return `created a share link for “${d.document}”${d.expiresAt ? ` (expires ${formatDate(d.expiresAt)})` : " (no expiry)"}`;
    case "share.revoked":
      return `revoked a share link for “${d.document}”`;
    case "share.downloaded":
      return `downloaded “${d.document}” via a share link`;
    case "member.invited":
      return `invited ${d.email} as ${d.role}`;
    case "member.invite_revoked":
      return `revoked the invitation for ${d.email}`;
    case "member.joined":
      return `joined as ${d.role}`;
    case "member.removed":
      return `removed ${d.member}`;
    case "member.left":
      return "left the workspace";
    case "member.role_changed":
      return `changed ${d.member}'s role from ${d.from} to ${d.to}`;
    default:
      return e.action;
  }
}

export function ActivityTab({ workspace }: { workspace: Workspace }) {
  const events = useQuery({
    queryKey: ["activity", workspace.id],
    queryFn: async () => (await api<{ events: ActivityEvent[] }>(`/workspaces/${workspace.id}/activity`)).events,
  });

  return (
    <div>
      <p className="muted">The last 100 things that happened in this workspace, including downloads via share links.</p>
      <ErrorText error={events.error} />
      <ul className="activity">
        {events.data?.map((e) => (
          <li key={e.id}>
            <span className="muted small">{formatDate(e.createdAt)}</span>
            <span>
              <strong>{e.actorName ?? (e.action === "share.downloaded" ? "Someone" : "A former user")}</strong>{" "}
              {describe(e)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
