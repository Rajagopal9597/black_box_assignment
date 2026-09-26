import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api/client";
import type { User } from "../api/types";

/** Current user, or null when signed out. Single source of truth for auth state in the UI. */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api<{ user: User }>("/auth/me")).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api("/auth/logout", { method: "POST" });
    qc.clear();
    qc.setQueryData(["me"], null);
  };
}

/** Only allow same-app relative redirects after login (no open redirect to other sites). */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
