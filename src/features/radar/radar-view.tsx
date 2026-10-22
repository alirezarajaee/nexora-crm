"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { SeverityBadge } from "@/components/shared/badges";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { FilterBar, MultiSelectFilter } from "@/components/shared/filters";
import { api } from "@/lib/client-api";
import { formatDateTime, formatRelative } from "@/lib/format";
import {
  useApiToast,
  useLocaleTz,
  useMemberOptions,
  useWorkspaceCurrency,
  useWorkspaceId,
} from "@/hooks/use-workspace";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import type { RadarItem, RadarResponse, RadarSeverity } from "@/types/api";
import {
  RADAR_RULE_KEYS,
  RADAR_SEVERITIES,
  RADAR_SEVERITY_COLORS,
  parseActionLink,
  radarExplanation,
} from "@/features/radar/radar-utils";

const SEVERITY_CHIP_CLASSES: Record<RadarSeverity, { idle: string; active: string }> = {
  CRITICAL: {
    idle: "border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400",
    active: "border-red-500/60 bg-red-500/15 text-red-600 dark:text-red-400",
  },
  HIGH: {
    idle: "border-orange-500/30 bg-orange-500/5 text-orange-600 dark:text-orange-400",
    active: "border-orange-500/60 bg-orange-500/15 text-orange-600 dark:text-orange-400",
  },
  MEDIUM: {
    idle: "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400",
    active: "border-amber-500/60 bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  LOW: {
    idle: "border-sky-500/30 bg-sky-500/5 text-sky-600 dark:text-sky-400",
    active: "border-sky-500/60 bg-sky-500/15 text-sky-600 dark:text-sky-400",
  },
};

export function RadarView() {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const navigate = useAppStore((s) => s.navigate);
  const workspaceId = useWorkspaceId();
  const currency = useWorkspaceCurrency();
  const tz = useLocaleTz();
  const { apiError } = useApiToast();
  const queryClient = useQueryClient();
  const memberOptions = useMemberOptions();

  const [severity, setSeverity] = useState<RadarSeverity | null>(null);
  const [ruleKeys, setRuleKeys] = useState<string[]>([]);
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [logTarget, setLogTarget] = useState<RadarItem | null>(null);
  const [logType, setLogType] = useState<"CALL" | "NOTE">("CALL");
  const [logContent, setLogContent] = useState("");

  const q = useQuery({
    queryKey: ["radar", workspaceId],
    queryFn: () => api.get<RadarResponse>("/radar", { workspaceId }, workspaceId),
    enabled: Boolean(workspaceId),
  });

  const invalidateRadar = () => {
    void queryClient.invalidateQueries({ queryKey: ["radar", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard", workspaceId] });
  };

  const scan = useMutation({
    mutationFn: () => api.post<{ success: boolean }>("/radar", undefined, workspaceId),
    onSuccess: () => {
      toast.success(t("radar.scannedToast"));
      invalidateRadar();
    },
    onError: (err) => apiError(err),
  });

  const completeTask = useMutation({
    mutationFn: (taskId: string) =>
      api.patch(`/tasks/${taskId}`, { workspaceId, status: "DONE" }, workspaceId),
    onSuccess: () => {
      toast.success(t("tasks.completedToast"));
      invalidateRadar();
    },
    onError: (err) => apiError(err),
  });

  const logActivity = useMutation({
    mutationFn: (item: RadarItem) => {
      const body: Record<string, unknown> = {
        workspaceId,
        type: logType,
        title: t(`radar.rules.${item.ruleKey}.name`),
      };
      if (logContent.trim()) body.content = logContent.trim();
      if (item.entityType === "lead") body.leadId = item.entityId;
      else if (item.entityType === "contact") body.contactId = item.entityId;
      else if (item.entityType === "company") body.companyId = item.entityId;
      else if (item.entityType === "deal") body.dealId = item.entityId;
      return api.post("/activities", body, workspaceId);
    },
    onSuccess: () => {
      toast.success(t("activities.createdToast"));
      setLogTarget(null);
      setLogContent("");
      invalidateRadar();
    },
    onError: (err) => apiError(err),
  });

  const items = useMemo(() => {
    const all = q.data?.items ?? [];
    return all.filter(
      (i) =>
        (!severity || i.severity === severity) &&
        (ruleKeys.length === 0 || ruleKeys.includes(i.ruleKey)) &&
        (ownerIds.length === 0 || (i.entity.ownerId != null && ownerIds.includes(i.entity.ownerId)))
    );
  }, [q.data, severity, ruleKeys, ownerIds]);

  const hasFilters = severity !== null || ruleKeys.length > 0 || ownerIds.length > 0;
  const counts = q.data?.counts;

  const goToEntity = (item: RadarItem) => {
    const target = parseActionLink(item.actionLink);
    if (target) navigate(target.view, { params: target.params });
  };

  const runAction = (item: RadarItem) => {
    switch (item.suggestedAction) {
      case "completeTask":
        completeTask.mutate(item.entityId);
        break;
      case "logFollowUp":
      case "logActivity":
        setLogType(item.entityType === "task" ? "NOTE" : "CALL");
        setLogContent("");
        setLogTarget(item);
        break;
      default:
        // reviewDeal / completeInfo → open the entity
        goToEntity(item);
    }
  };

  const ruleOptions = RADAR_RULE_KEYS.map((k) => ({
    value: k,
    label: t(`radar.rules.${k}.name`),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("radar.title")}
        subtitle={t("radar.subtitle")}
        actions={
          <>
            {RADAR_SEVERITIES.map((sev) => {
              const active = severity === sev;
              const cls = active ? SEVERITY_CHIP_CLASSES[sev].active : SEVERITY_CHIP_CLASSES[sev].idle;
              return (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setSeverity(active ? null : sev)}
                  aria-pressed={active}
                  aria-label={`${t(`enums.severity.${sev}`)}: ${counts?.[sev] ?? 0}`}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    cls
                  )}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: RADAR_SEVERITY_COLORS[sev] }}
                    aria-hidden="true"
                  />
                  {t(`enums.severity.${sev}`)}
                  <span className="rounded-full bg-background/60 px-1.5 text-[11px] font-semibold tabular-nums">
                    {counts ? counts[sev] : 0}
                  </span>
                </button>
              );
            })}
            <Button
              size="sm"
              className="h-9"
              onClick={() => scan.mutate()}
              disabled={scan.isPending}
            >
              <RefreshCw className={cn("h-4 w-4", scan.isPending && "animate-spin")} aria-hidden="true" />
              {t("radar.scanNow")}
            </Button>
          </>
        }
      />

      {/* Filters + meta */}
      <FilterBar>
        <MultiSelectFilter
          label={t("radar.filters.type")}
          options={ruleOptions}
          selected={ruleKeys}
          onChange={setRuleKeys}
        />
        <MultiSelectFilter
          label={t("radar.filters.owner")}
          options={memberOptions}
          selected={ownerIds}
          onChange={setOwnerIds}
        />
      </FilterBar>
      <p className="text-xs text-muted-foreground">
        {t("radar.thresholdsNote")}
        {q.data ? (
          <>
            {" · "}
            {t("radar.lastChecked", { time: formatDateTime(q.data.generatedAt, locale, tz) })}
          </>
        ) : null}
      </p>

      {/* List */}
      {q.isLoading ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
          <LoadingState rows={2} />
        </div>
      ) : q.isError ? (
        <ErrorState
          title={t("common.errorStateTitle")}
          description={t("common.errorStateDescription")}
          retryLabel={t("common.retry")}
          onRetry={() => void q.refetch()}
        />
      ) : items.length === 0 ? (
        hasFilters ? (
          <EmptyState
            title={t("common.noData")}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSeverity(null);
                  setRuleKeys([]);
                  setOwnerIds([]);
                }}
              >
                {t("common.clearFilters")}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Sparkles}
            title={t("radar.empty.title")}
            description={t("radar.empty.description")}
          />
        )
      ) : (
        <ul className="space-y-3" aria-label={t("radar.title")}>
          {items.map((item) => (
            <li key={item.id}>
              <Card
                className="border-s-4 border-border bg-card transition-shadow hover:shadow-md"
                style={{ borderInlineStartColor: RADAR_SEVERITY_COLORS[item.severity] }}
              >
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={item.severity} />
                    <span className="text-xs font-semibold">{t(`radar.rules.${item.ruleKey}.name`)}</span>
                    <span className="text-xs text-muted-foreground" aria-hidden="true">·</span>
                    <span className="text-xs text-muted-foreground">
                      {t(`enums.entityType.${item.entityType}`)}
                    </span>
                    <span className="ms-auto flex items-center gap-3 text-xs text-muted-foreground">
                      {item.entity.ownerName ? (
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3.5 w-3.5" aria-hidden="true" />
                          {item.entity.ownerName}
                        </span>
                      ) : null}
                      <span>{formatRelative(item.date, locale, t)}</span>
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => goToEntity(item)}
                    className="mt-2 block text-start text-base font-bold tracking-tight transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {item.entity.title}
                  </button>
                  {item.entity.subtitle ? (
                    <p className="text-xs text-muted-foreground">{item.entity.subtitle}</p>
                  ) : null}

                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {radarExplanation(item, locale, currency, t)}
                  </p>

                  <div className="mt-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => runAction(item)}
                      disabled={completeTask.isPending || logActivity.isPending}
                    >
                      {t(`radar.actions.${item.suggestedAction}`)}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* Log activity inline dialog (logFollowUp / logActivity) */}
      <Dialog open={logTarget !== null} onOpenChange={(open) => (!open ? setLogTarget(null) : undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("activities.logActivity")}</DialogTitle>
            <DialogDescription>
              {logTarget ? logTarget.entity.title : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="radar-log-type">{t("activities.field.type")}</Label>
              <Select value={logType} onValueChange={(v) => setLogType(v as "CALL" | "NOTE")}>
                <SelectTrigger id="radar-log-type" aria-label={t("activities.field.type")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CALL">{t("activities.logCall")}</SelectItem>
                  <SelectItem value="NOTE">{t("activities.logNote")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="radar-log-content">{t("activities.field.content")}</Label>
              <Textarea
                id="radar-log-content"
                value={logContent}
                onChange={(e) => setLogContent(e.target.value)}
                rows={3}
                placeholder={t("common.optional")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setLogTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => logTarget && logActivity.mutate(logTarget)}
              disabled={logActivity.isPending}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
