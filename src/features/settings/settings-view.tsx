"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Github, Info, KeyRound, UserCog } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiRequestError } from "@/lib/client-api";
import { useApiToast, useWorkspaceRole } from "@/hooks/use-workspace";
import { useAppStore } from "@/store/app-store";
import type { AuthResponse, Locale, Me } from "@/types/api";

import { WorkspaceTab } from "./workspace-tab";
import { MembersTab } from "./members-tab";
import { CrmTab } from "./crm-tab";
import { DataTab } from "./data-tab";

const TAB_KEYS = ["account", "workspace", "members", "crm", "data", "about"] as const;
type TabKey = (typeof TAB_KEYS)[number];

// ================= Account tab =================

function AccountTab() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const memberships = useAppStore((s) => s.memberships);
  const setAuthState = useAppStore((s) => s.setAuthState);
  const locale = useAppStore((s) => s.locale);
  const switchLocale = useAppStore((s) => s.switchLocale);
  const { theme, setTheme } = useTheme();
  const { apiError } = useApiToast();

  const [name, setName] = useState(user?.name ?? "");
  // Keep the name input in sync with the store user (state-during-render pattern)
  const [prevUserName, setPrevUserName] = useState(user?.name ?? "");
  if ((user?.name ?? "") !== prevUserName) {
    setPrevUserName(user?.name ?? "");
    setName(user?.name ?? "");
  }

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const profileMutation = useMutation({
    mutationFn: (nextName: string) => api.patch<{ user: Me }>("/auth/me", { name: nextName }),
    onSuccess: (res) => {
      setAuthState(res.user, memberships, true);
      toast.success(t("settings.account.profileSaved"));
    },
    onError: (err) => apiError(err),
  });

  const passwordMutation = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.post("/auth/password", body),
    onSuccess: () => {
      toast.success(t("settings.account.passwordChanged"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.code === "WRONG_PASSWORD") {
        toast.error(t("settings.account.wrongPassword"));
        return;
      }
      apiError(err);
    },
  });

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      toast.error(t("validation.required"));
      return;
    }
    if (newPassword.length < 8) {
      toast.error(t("validation.passwordLength"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("validation.passwordMatch"));
      return;
    }
    passwordMutation.mutate({ currentPassword, newPassword });
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCog className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t("settings.tabs.account")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="account-name">{t("settings.account.name")}</Label>
            <div className="flex gap-2">
              <Input
                id="account-name"
                className="h-9"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
              <Button
                className="h-9 shrink-0"
                disabled={profileMutation.isPending || name.trim() === (user?.name ?? "")}
                onClick={() => profileMutation.mutate(name.trim())}
              >
                {t("settings.account.saveProfile")}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="account-email">{t("settings.account.email")}</Label>
            <Input id="account-email" className="h-9" value={user?.email ?? ""} disabled readOnly />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="account-language">{t("settings.account.languagePref")}</Label>
              <Select
                value={locale}
                onValueChange={(v) => switchLocale(v as Locale)}
              >
                <SelectTrigger id="account-language" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fa">فارسی</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("settings.account.languagePrefHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-theme">{t("settings.account.themePref")}</Label>
              <Select value={theme ?? "system"} onValueChange={(v) => setTheme(v)}>
                <SelectTrigger id="account-theme" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">{t("common.theme.light")}</SelectItem>
                  <SelectItem value="dark">{t("common.theme.dark")}</SelectItem>
                  <SelectItem value="system">{t("common.theme.system")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t("settings.account.passwordChange")}
          </CardTitle>
          <CardDescription>{t("auth.passwordNote")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitPassword} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pwd-current">{t("settings.account.currentPassword")}</Label>
              <Input
                id="pwd-current"
                type="password"
                className="h-9"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pwd-new">{t("settings.account.newPassword")}</Label>
              <Input
                id="pwd-new"
                type="password"
                className="h-9"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pwd-confirm">{t("settings.account.confirmPassword")}</Label>
              <Input
                id="pwd-confirm"
                type="password"
                className="h-9"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" className="h-9" disabled={passwordMutation.isPending}>
              {t("settings.account.changePassword")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ================= About tab =================

function AboutTab() {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);

  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <div className="flex items-center gap-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-lg font-bold text-white"
            aria-hidden="true"
          >
            N
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold">{t("settings.about.title")}</p>
            <p className="text-sm text-muted-foreground">
              {t("settings.about.version")}: {t("common.appVersion")}
            </p>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">{t("settings.about.description")}</p>

        <div
          className="rounded-xl border border-primary/25 bg-primary/5 p-4"
          aria-label={t("settings.about.builtBy")}
        >
          <p className="text-lg font-semibold">
            {locale === "fa" ? "ساخته‌شده توسط علیرضا رجائی" : "Built by Alireza Rajaee"}
          </p>
          <a
            href="https://github.com/alirezarajaee"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex h-9 items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            <Github className="h-4 w-4" aria-hidden="true" />
            {locale === "fa" ? "مشاهده پروفایل گیت‌هاب" : t("settings.about.githubLabel")}
          </a>
        </div>

        <p className="text-xs text-muted-foreground">{t("settings.about.copyright")}</p>

        <div className="space-y-2 border-t pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("settings.about.techTitle")}
          </p>
          <p className="font-mono text-xs text-muted-foreground" dir="ltr">
            {t("settings.about.techList")}
          </p>
          <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("settings.about.languagesTitle")}
          </p>
          <p className="text-xs text-muted-foreground">{t("settings.about.languagesList")}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ================= Main view =================

export function SettingsView() {
  const { t } = useTranslation();
  const viewParams = useAppStore((s) => s.viewParams);
  const navigate = useAppStore((s) => s.navigate);
  const role = useWorkspaceRole();
  const canManage = role === "OWNER" || role === "ADMIN";

  const param = viewParams.tab ?? "";
  const tab: TabKey = (TAB_KEYS as readonly string[]).includes(param) ? (param as TabKey) : "account";

  return (
    <div className="space-y-6">
      <PageHeader title={t("settings.title")} subtitle={t("settings.members.roleHint")} />

      <Tabs value={tab} onValueChange={(v) => navigate("settings", { params: { tab: v } })}>
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
          {TAB_KEYS.map((key) => (
            <TabsTrigger key={key} value={key} className="min-h-9">
              {t(`settings.tabs.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="account" className="mt-4">
          <AccountTab />
        </TabsContent>

        <TabsContent value="workspace" className="mt-4">
          {canManage ? (
            <WorkspaceTab />
          ) : (
            <div
              className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
              role="note"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t("errors.FORBIDDEN")}</span>
            </div>
          )}
        </TabsContent>

        <TabsContent value="members" className="mt-4">
          <MembersTab />
        </TabsContent>

        <TabsContent value="crm" className="mt-4">
          <CrmTab />
        </TabsContent>

        <TabsContent value="data" className="mt-4">
          <DataTab />
        </TabsContent>

        <TabsContent value="about" className="mt-4">
          <AboutTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
