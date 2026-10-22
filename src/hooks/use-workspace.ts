"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/lib/client-api";
import { useAppStore } from "@/store/app-store";
import type { MemberInfo } from "@/types/api";
import type { MultiOption } from "@/components/shared/filters";

export function useWorkspaceId(): string {
  return useAppStore((s) => s.currentWorkspaceId) ?? "";
}

export function useWorkspaceRole(): string {
  const wsId = useWorkspaceId();
  return useAppStore((s) => s.memberships.find((m) => m.workspaceId === wsId)?.role ?? "MEMBER");
}

export function useMembers() {
  const workspaceId = useWorkspaceId();
  return useQuery({
    queryKey: ["members", workspaceId],
    queryFn: () => api.get<MemberInfo[]>("/workspaces/members", { workspaceId }, workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
}

export function useMemberOptions(): MultiOption[] {
  const { data } = useMembers();
  return (data ?? []).map((m) => ({ value: m.userId, label: m.name }));
}

export function useMemberMap(): Map<string, MemberInfo> {
  const { data } = useMembers();
  return new Map((data ?? []).map((m) => [m.userId, m]));
}

export function useLocaleTz(): string {
  const wsId = useWorkspaceId();
  return (
    useAppStore((s) => s.memberships.find((m) => m.workspaceId === wsId)?.workspace.timezone) ?? "Asia/Tehran"
  );
}

export function useWorkspaceCurrency(): string {
  const wsId = useWorkspaceId();
  return (
    useAppStore((s) => s.memberships.find((m) => m.workspaceId === wsId)?.workspace.currency) ?? "USD"
  );
}

/** Show a localized toast for API errors (stable error codes → i18n). */
export function useApiToast() {
  const { t } = useTranslation();
  return {
    apiError: (err: unknown, fallbackKey?: string) => {
      const code = (err as { code?: string })?.code;
      const known = code ? t(`errors.${code}`, { defaultValue: "" }) : "";
      toast.error(known || t(fallbackKey ?? "errors.generic"));
    },
    success: (key: string, params?: Record<string, unknown>) => toast.success(t(key, params)),
  };
}
