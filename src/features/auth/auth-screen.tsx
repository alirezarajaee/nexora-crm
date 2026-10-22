"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Radar, KanbanSquare, BarChart3, Languages } from "lucide-react";
import { api, ApiRequestError, setStoredToken } from "@/lib/client-api";
import { useAppStore } from "@/store/app-store";
import type { AuthResponse } from "@/types/api";

type Mode = "login" | "register";

export function AuthScreen() {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const switchLocale = useAppStore((s) => s.switchLocale);
  const setAuthState = useAppStore((s) => s.setAuthState);
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    workspaceName: "",
  });

  const setField = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    // Client-side validation with localized messages
    if (mode === "register") {
      if (form.name.trim().length < 2) {
        toast.error(t("validation.minChars", { count: 2 }));
        return;
      }
      if (form.password.length < 8) {
        toast.error(t("validation.passwordLength"));
        return;
      }
      if (form.password !== form.confirmPassword) {
        toast.error(t("validation.passwordMatch"));
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === "login") {
        const res = await api.post<AuthResponse>("/auth/login", {
          email: form.email,
          password: form.password,
        });
        // Persist the session token for Bearer-header auth (iframe-safe)
        setStoredToken(res.token);
        setAuthState(res.user, res.memberships);
      } else {
        const res = await api.post<AuthResponse>("/auth/register", {
          name: form.name,
          email: form.email,
          password: form.password,
          workspaceName: form.workspaceName || undefined,
          locale,
        });
        setStoredToken(res.token);
        setAuthState(res.user, res.memberships);
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        const localized = t(`errors.${err.code}`, { defaultValue: "" });
        toast.error(localized || t("errors.generic"));
      } else {
        toast.error(t("errors.network"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background" dir={undefined}>
      <div className="flex min-h-screen">
        {/* Brand / marketing side */}
        <div className="relative hidden w-[42%] flex-col justify-between border-e border-border bg-card p-10 lg:flex">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-white">
              <Radar className="h-4.5 w-4.5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-base font-bold tracking-tight">NEXORA CRM</p>
              <p className="text-xs text-muted-foreground">{t("auth.tagline")}</p>
            </div>
          </div>

          <div className="space-y-6">
            <h2 className="max-w-md text-2xl font-semibold leading-snug text-foreground">
              {t("auth.feature1")} · {t("auth.feature2")} · {t("auth.feature3")}
            </h2>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <Radar className="h-4 w-4 text-primary" aria-hidden="true" /> {t("nav.radar")}
              </li>
              <li className="flex items-center gap-2">
                <KanbanSquare className="h-4 w-4 text-primary" aria-hidden="true" /> {t("nav.deals")}
              </li>
              <li className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" aria-hidden="true" /> {t("nav.reports")}
              </li>
            </ul>
          </div>

          <p className="text-xs text-muted-foreground">{t("auth.heroNote")}</p>
        </div>

        {/* Form side */}
        <div className="flex flex-1 flex-col">
          <div className="flex items-center justify-end p-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => switchLocale(locale === "fa" ? "en" : "fa")}
              aria-label={t("a11y.switchLanguage")}
            >
              <Languages className="h-4 w-4" aria-hidden="true" />
              {locale === "fa" ? "English" : "فارسی"}
            </Button>
          </div>

          <div className="flex flex-1 items-center justify-center p-4">
            <Card className="w-full max-w-md border-border bg-card">
              <CardContent className="p-6 sm:p-8">
                <div className="mb-6 flex items-center gap-2 lg:hidden">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
                    <Radar className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <p className="text-sm font-bold">NEXORA CRM</p>
                </div>

                <h1 className="text-xl font-semibold tracking-tight">
                  {mode === "login" ? t("auth.loginTitle") : t("auth.registerTitle")}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {mode === "login" ? t("auth.loginSubtitle") : t("auth.registerSubtitle")}
                </p>

                <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
                  {mode === "register" ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="auth-name">{t("auth.nameField")}</Label>
                      <Input
                        id="auth-name"
                        value={form.name}
                        onChange={setField("name")}
                        placeholder={t("auth.namePlaceholder")}
                        autoComplete="name"
                        required
                      />
                    </div>
                  ) : null}

                  <div className="space-y-1.5">
                    <Label htmlFor="auth-email">{t("auth.emailField")}</Label>
                    <Input
                      id="auth-email"
                      type="email"
                      dir="ltr"
                      value={form.email}
                      onChange={setField("email")}
                      placeholder={t("auth.emailPlaceholder")}
                      autoComplete="email"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="auth-password">{t("auth.passwordField")}</Label>
                    <Input
                      id="auth-password"
                      type="password"
                      dir="ltr"
                      value={form.password}
                      onChange={setField("password")}
                      placeholder={t("auth.passwordPlaceholder")}
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      required
                      minLength={mode === "register" ? 8 : undefined}
                    />
                  </div>

                  {mode === "register" ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="auth-confirm">{t("auth.confirmPasswordField")}</Label>
                        <Input
                          id="auth-confirm"
                          type="password"
                          dir="ltr"
                          value={form.confirmPassword}
                          onChange={setField("confirmPassword")}
                          autoComplete="new-password"
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="auth-ws">
                          {t("auth.workspaceNameField")} <span className="text-muted-foreground">({t("common.optional")})</span>
                        </Label>
                        <Input
                          id="auth-ws"
                          value={form.workspaceName}
                          onChange={setField("workspaceName")}
                          placeholder={t("auth.workspaceNamePlaceholder")}
                        />
                      </div>
                    </>
                  ) : null}

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                    {mode === "login"
                      ? loading
                        ? t("auth.loggingIn")
                        : t("auth.loginButton")
                      : loading
                        ? t("auth.registering")
                        : t("auth.registerButton")}
                  </Button>
                </form>

                <div className="mt-6 text-center text-sm">
                  {mode === "login" ? (
                    <>
                      <span className="text-muted-foreground">{t("auth.noAccount")} </span>
                      <button
                        type="button"
                        className="font-semibold text-primary hover:underline"
                        onClick={() => setMode("register")}
                      >
                        {t("auth.goToRegister")}
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-muted-foreground">{t("auth.hasAccount")} </span>
                      <button
                        type="button"
                        className="font-semibold text-primary hover:underline"
                        onClick={() => setMode("login")}
                      >
                        {t("auth.goToLogin")}
                      </button>
                    </>
                  )}
                </div>

                {mode === "login" ? (
                  <p className="mt-4 text-center text-xs text-muted-foreground">{t("auth.passwordNote")}</p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
