import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { Workspace } from "../../api/types";
import { ErrorText } from "../../components/ErrorText";
import { ActivityTab } from "./ActivityTab";
import { DocumentsTab } from "./DocumentsTab";
import { MembersTab } from "./MembersTab";
import { SettingsTab } from "./SettingsTab";

type Tab = "documents" | "members" | "activity" | "settings";

export function WorkspacePage() {
  const { workspaceId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "documents";

  const ws = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: async () => (await api<{ workspace: Workspace }>(`/workspaces/${workspaceId}`)).workspace,
  });

  if (ws.isLoading) return <p className="muted">Loading…</p>;
  if (ws.error instanceof ApiError && (ws.error.status === 404 || ws.error.status === 403)) {
    const forbidden = ws.error.status === 403;
    return (
      <section>
        <h1>{forbidden ? "No access" : "Workspace not found"}</h1>
        <p>
          {forbidden
            ? "You're not a member of this workspace. Ask an owner to invite you."
            : "This workspace doesn't exist or was deleted."}{" "}
          <Link to="/">Back to your workspaces</Link>
        </p>
      </section>
    );
  }
  if (!ws.data) return <ErrorText error={ws.error} />;
  const workspace = ws.data;

  // Tabs shown depend on the user's role; the server enforces the same rules independently.
  const tabs: Tab[] = ["documents", "members", "activity"];
  if (workspace.permissions.canManageWorkspace) tabs.push("settings");

  return (
    <section>
      <p className="muted">
        <Link to="/">Workspaces</Link> /
      </p>
      <div className="title-row">
        <h1>{workspace.name}</h1>
        <span className={`badge badge-${workspace.role}`}>You are {workspace.role}</span>
      </div>
      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t} className={t === tab ? "tab active" : "tab"} onClick={() => setParams({ tab: t })}>
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      {tab === "documents" && <DocumentsTab workspace={workspace} />}
      {tab === "members" && <MembersTab workspace={workspace} />}
      {tab === "activity" && <ActivityTab workspace={workspace} />}
      {tab === "settings" && workspace.permissions.canManageWorkspace && <SettingsTab workspace={workspace} />}
    </section>
  );
}
