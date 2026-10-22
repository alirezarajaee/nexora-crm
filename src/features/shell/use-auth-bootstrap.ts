"use client";

import { useEffect } from "react";
import { api } from "@/lib/client-api";
import { useAppStore } from "@/store/app-store";
import type { AuthResponse } from "@/types/api";
import { readInitialLocale } from "@/i18n";

/**
 * Bootstraps the auth state on app load:
 * - fetches /auth/me
 * - restores workspace selection
 * - applies language precedence: explicit local choice > account preference > default
 */
export function useAuthBootstrap() {
  const setAuthState = useAppStore((s) => s.setAuthState);
  const authLoaded = useAppStore((s) => s.authLoaded);
  const switchLocale = useAppStore((s) => s.switchLocale);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await api.get<AuthResponse>("/auth/me");
        if (cancelled) return;
        setAuthState(res.user, res.memberships);
        // Language precedence: explicit local choice wins; otherwise account preference.
        const local = readInitialLocale();
        if (typeof window !== "undefined" && window.localStorage.getItem("nexora-lang")) {
          switchLocale(local);
        } else if (res.user.locale && res.user.locale !== local) {
          switchLocale(res.user.locale);
        }
      } catch {
        if (!cancelled) setAuthState(null, [], true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [setAuthState, switchLocale]);

  return { authLoaded };
}
