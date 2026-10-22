"use client";

import { create } from "zustand";
import type { Locale, Me, MembershipInfo } from "@/types/api";
import { changeLocale, readInitialLocale } from "@/i18n";
import { getAuthHeaders } from "@/lib/client-api";

export type AppView =
  | "overview"
  | "radar"
  | "leads"
  | "contacts"
  | "companies"
  | "deals"
  | "tasks"
  | "calendar"
  | "activities"
  | "reports"
  | "automation"
  | "settings";

export interface NavigateOptions {
  params?: Record<string, string>;
}

interface AppState {
  view: AppView;
  viewParams: Record<string, string>;
  navigate: (view: AppView, options?: NavigateOptions) => void;

  user: Me | null;
  memberships: MembershipInfo[];
  authLoaded: boolean;
  setAuthState: (user: Me | null, memberships: MembershipInfo[], loaded?: boolean) => void;

  currentWorkspaceId: string | null;
  setCurrentWorkspaceId: (id: string | null) => void;

  locale: Locale;
  switchLocale: (locale: Locale) => void;
}

const WS_KEY = "nexora-ws";

function readStoredWorkspace(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(WS_KEY);
  } catch {
    return null;
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  view: "overview",
  viewParams: {},
  navigate: (view, options) => {
    set({ view, viewParams: options?.params ?? {} });
  },

  user: null,
  memberships: [],
  authLoaded: false,
  setAuthState: (user, memberships, loaded = true) =>
    set((state) => {
      // Auto-select workspace: previous choice → first membership
      let currentWorkspaceId = state.currentWorkspaceId;
      if (user && memberships.length > 0) {
        if (!currentWorkspaceId || !memberships.some((m) => m.workspaceId === currentWorkspaceId)) {
          currentWorkspaceId = memberships.find((m) => m.workspaceId === currentWorkspaceId)
            ? currentWorkspaceId
            : memberships[0].workspaceId;
        }
      }
      if (!user) currentWorkspaceId = null;
      if (currentWorkspaceId) {
        try {
          window.localStorage.setItem(WS_KEY, currentWorkspaceId);
        } catch {
          // ignore
        }
      }
      return { user, memberships, authLoaded: loaded, currentWorkspaceId };
    }),

  currentWorkspaceId: readStoredWorkspace(),
  setCurrentWorkspaceId: (id) => {
    try {
      if (id) window.localStorage.setItem(WS_KEY, id);
      else window.localStorage.removeItem(WS_KEY);
    } catch {
      // ignore
    }
    set({ currentWorkspaceId: id });
  },

  locale: readInitialLocale(),
  switchLocale: (locale) => {
    changeLocale(locale);
    set({ locale });
    // Sync to account when signed in (fire-and-forget; local remains authoritative)
    const { user } = get();
    if (user && user.locale !== locale) {
      fetch("/api/v1/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ locale }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { user?: Me } | null) => {
          if (data?.user) set((s) => ({ user: { ...s.user!, locale: data.user!.locale } }));
        })
        .catch(() => {
          // offline — local preference already applied, keep app usable
        });
    }
  },
}));

export function currentMembership(state: AppState): MembershipInfo | null {
  if (!state.currentWorkspaceId) return null;
  return state.memberships.find((m) => m.workspaceId === state.currentWorkspaceId) ?? null;
}
