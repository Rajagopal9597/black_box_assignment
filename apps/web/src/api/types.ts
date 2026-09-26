export type Role = "owner" | "editor" | "viewer";

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Permissions {
  canUpload: boolean;
  canDeleteOwnDocuments: boolean;
  canDeleteAnyDocument: boolean;
  canShare: boolean;
  canManageMembers: boolean;
  canManageWorkspace: boolean;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: Role;
  createdAt: string;
  memberCount: number;
  documentCount: number;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  role: Role;
  permissions: Permissions;
}

export interface DocumentItem {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedById: string | null;
  uploadedByName: string | null;
  activeShareCount: number;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
  invitedByName: string | null;
}

export interface ShareLink {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  downloadCount: number;
  lastAccessedAt: string | null;
  createdByName: string | null;
  status: "active" | "expired" | "revoked";
}

export interface ActivityEvent {
  id: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
  actorName: string | null;
}
