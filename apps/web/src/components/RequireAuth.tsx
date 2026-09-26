import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useMe } from "../lib/auth";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) return <p className="muted">Loading…</p>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}
