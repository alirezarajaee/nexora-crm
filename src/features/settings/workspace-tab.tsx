"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Info, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/client-api";
import { useApiToast, useWorkspaceId } from "@/hooks/use-workspace";
import { useAppStore } from "@/store/app-store";
import { parseLocalizedNumber } from "@/lib/format";
import type { AuthResponse, RadarResponse, WorkspaceSettings } from "@/types/api";

const CURRENCIES = ["USD", "EUR", "IRR", "GBP", "AED", "TRY"] as const;
const TIMEZONES = [
  "UTC",
  "Asia/Tehran",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "Asia/Tokyo",
] as const;

interface WsFormState {
  name: string;
  currency: string;
  timezone: string;
  lead: string;
  deal: string;
  stage: string;
  highValue: string;
}

function toFormState(
  workspace: { name: string; currency: string; timezone: string } | null,
  thresholds: RadarResponse["thresholds"] | undefined
): WsFormState {
  return {
    name: workspace?.name ?? "",
    currency: workspace?.currency ?? "USD",
    timezone: workspace?.timezone ?? "Asia/Tehran",
    lead: String(thresholds?.leadInactivityDays ?? 7),
    deal: String(thresholds?.dealInactivityDays ?? 7),
    stage: String(thresholds?.stageInactivityDays ?? 14),
    highValue: String(thresholds?.highValueThreshold ?? 10000),
  };
}

export function WorkspaceTab() {
  const { t } = useTranslation();
  const workspaceId = useWorkspaceId();
  const setAuthState = useAppStore((s) => s.setAuthState);
  const membership = useAppStore(
    (s) => s.memberships.find((m) => m.workspaceId === s.currentWorkspaceId) ?? null
  );
  const { apiError } = useApiToast();

  // Current radar thresholds (only exposed via the radar endpoint)
  const thresholdsQuery = useQuery({
    queryKey: ["radar-thresholds", workspaceId],
    queryFn: () => api.get<RadarResponse>("/radar", undefined, workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });

  const [form, setForm] = useState<WsFormState>(() =>
    toFormState(membership?.workspace ?? null, undefined)
  );

  // Re-seed the form when workspace data / thresholds arrive (state-during-render pattern)
  const workspace = membership?.workspace ?? null;
  const thresholds = thresholdsQuery.data?.thresholds;
  const syncKey = [
    workspace?.id ?? "",
    workspace?.name ?? "",
    workspace?.currency ?? "",
    workspace?.timezone ?? "",
    thresholds
      ? `${thresholds.leadInactivityDays},${thresholds.dealInactivityDays},${thresholds.stageInactivityDays},${thresholds.highValueThreshold}`
      : "pending",
  ].join("|");
  const [prevSyncKey, setPrevSyncKey] = useState(syncKey);
  if (syncKey !== prevSyncKey) {
    setPrevSyncKey(syncKey);
    setForm(toFormState(workspace, thresholds));
  }

  const patch = (partial: Partial<WsFormState>) => setForm((f) => ({ ...f, ...partial }));

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      await api.patch<WorkspaceSettings>("/workspaces", payload, workspaceId);
      // Refresh auth state so currency/timezone/role changes propagate app-wide
      const me = await api.get<AuthResponse>("/auth/me");
      setAuthState(me.user, me.memberships, true);
    },
    onSuccess: () => {
      toast.success(t("settings.workspace.saved"));
    },
    onError: (err) => apiError(err),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error(t("validation.required"));
      return;
    }
    const lead = parseLocalizedNumber(form.lead);
    const deal = parseLocalizedNumber(form.deal);
    const stage = parseLocalizedNumber(form.stage);
    const highValue = parseLocalizedNumber(form.highValue);
    if (lead === null || deal === null || stage === null || !Number.isInteger(lead) || !Number.isInteger(deal) || !Number.isInteger(stage) || lead < 1 || deal < 1 || stage < 1 || lead > 365 || deal > 365 || stage > 365) {
      toast.error(t("validation.number"));
      return;
    }
    if (highValue === null || highValue < 0) {
      toast.error(t("validation.number"));
      return;
    }
    saveMutation.mutate({
      workspaceId,
      name: form.name.trim(),
      currency: form.currency,
      timezone: form.timezone,
      radarLeadInactivityDays: lead,
      radarDealInactivityDays: deal,
      radarStageInactivityDays: stage,
      radarHighValueThreshold: highValue,
    });
  };

  const radarNumberField = (
    id: string,
    label: string,
    key: "lead" | "deal" | "stage" | "highValue",
    min: number,
    max: number
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        className="h-9"
        min={min}
        max={max}
        value={form[key]}
        onChange={(e) => patch({ [key]: e.target.value })}
      />
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.tabs.workspace")}</CardTitle>
          <CardDescription>{t("settings.workspace.currencyHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ws-name">{t("settings.workspace.name")}</Label>
              <Input
                id="ws-name"
                className="h-9"
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ws-currency">{t("settings.workspace.currency")}</Label>
              <Select value={form.currency} onValueChange={(v) => patch({ currency: v })}>
                <SelectTrigger id="ws-currency" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ws-timezone">{t("settings.workspace.timezone")}</Label>
            <Select value={form.timezone} onValueChange={(v) => patch({ timezone: v })}>
              <SelectTrigger id="ws-timezone" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.workspace.radarSection")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {radarNumberField("radar-lead", t("settings.workspace.radarLeadInactivity"), "lead", 1, 365)}
            {radarNumberField("radar-deal", t("settings.workspace.radarDealInactivity"), "deal", 1, 365)}
            {radarNumberField("radar-stage", t("settings.workspace.radarStageInactivity"), "stage", 1, 365)}
            {radarNumberField("radar-highvalue", t("settings.workspace.radarHighValue"), "highValue", 0, 1_000_000_000)}
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("settings.workspace.currencyHint")}
            </p>
            <Button type="submit" className="h-9 shrink-0" disabled={saveMutation.isPending}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {t("common.save")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
