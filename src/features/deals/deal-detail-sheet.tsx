"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Building2,
  CheckCircle2,
  CircleDot,
  Loader2,
  Pencil,
  Phone,
  Trash2,
  User,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/client-api";
import { useWorkspaceId, useApiToast, useLocaleTz, useWorkspaceCurrency } from "@/hooks/use-workspace";
import { useAppStore } from "@/store/app-store";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PriorityBadge, TagBadges } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate, formatDateInputValue, formatDateTime, formatMoney } from "@/lib/format";
import type { Activity, Deal, Pipeline, Stage } from "@/types/api";

interface DealDetail extends Deal {
  activities: Activity[];
  tasks: { id: string; title: string; status: "OPEN" | "DONE"; dueAt: string | null }[];
  stageHistory: Activity[];
}

const ACTIVITY_TYPES = ["NOTE", "CALL", "MEETING", "EMAIL"] as const;

function parseStageMeta(meta: string | null): { from?: string; to?: string } {
  if (!meta) return {};
  try {
    const parsed = JSON.parse(meta) as { from?: string; to?: string };
    return { from: parsed.from, to: parsed.to };
  } catch {
    return {};
  }
}

export function DealDetailSheet({
  dealId,
  open,
  onOpenChange,
  pipelines,
  onEdit,
}: {
  dealId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelines: Pipeline[];
  onEdit: (deal: Deal) => void;
}) {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const wsId = useWorkspaceId();
  const tz = useLocaleTz();
  const currency = useWorkspaceCurrency();
  const { apiError, success } = useApiToast();
  const qc = useQueryClient();

  const [logType, setLogType] = useState<(typeof ACTIVITY_TYPES)[number]>("NOTE");
  const [logTitle, setLogTitle] = useState("");
  const [logging, setLogging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lostDialog, setLostDialog] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [busy, setBusy] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["deal", wsId, dealId],
    queryFn: () => api.get<DealDetail>(`/deals/${dealId}`, undefined, wsId),
    enabled: open && Boolean(wsId && dealId),
  });
  const deal = detailQuery.data ?? null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["deals"] });
    qc.invalidateQueries({ queryKey: ["deal", wsId, dealId] });
  };

  const pipeline = pipelines.find((p) => p.id === deal?.pipelineId) ?? null;
  const wonStage: Stage | undefined = pipeline?.stages.find((s) => s.type === "WON");
  const lostStage: Stage | undefined = pipeline?.stages.find((s) => s.type === "LOST");

  const moveStage = async (stage: Stage, reason?: string) => {
    if (!deal) return;
    setBusy(true);
    try {
      await api.patch(
        `/deals/${deal.id}`,
        {
          workspaceId: wsId,
          stageId: stage.id,
          ...(stage.type === "LOST" ? { lostReason: reason ?? "" } : {}),
        },
        wsId
      );
      if (stage.type === "WON") success("deals.actions.wonToast");
      else if (stage.type === "LOST") success("deals.actions.lostToast");
      else success("deals.actions.stageChangedToast");
      invalidate();
    } catch (err) {
      apiError(err);
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async () => {
    if (!deal) return;
    setBusy(true);
    try {
      await api.patch(`/deals/${deal.id}`, { workspaceId: wsId, archived: !deal.archived }, wsId);
      success(deal.archived ? "deals.restoredToast" : "deals.archivedToast");
      invalidate();
    } catch (err) {
      apiError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deal) return;
    setBusy(true);
    try {
      await api.delete(`/deals/${deal.id}`, undefined, wsId);
      success("deals.deletedToast");
      setConfirmDelete(false);
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.removeQueries({ queryKey: ["deal", wsId, deal.id] });
    } catch (err) {
      apiError(err);
      setBusy(false);
    }
  };

  const logActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deal || !logTitle.trim()) return;
    setLogging(true);
    try {
      await api.post(
        "/activities",
        { workspaceId: wsId, type: logType, title: logTitle.trim(), dealId: deal.id },
        wsId
      );
      success("activities.createdToast");
      setLogTitle("");
      invalidate();
    } catch (err) {
      apiError(err);
    } finally {
      setLogging(false);
    }
  };

  const daysInStage = deal
    ? Math.max(0, Math.floor((Date.now() - new Date(deal.stageEnteredAt).getTime()) / 86400000))
    : 0;

  const infoRow = (label: string, value: React.ReactNode) => (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-end font-medium">{value}</span>
    </div>
  );

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={locale === "fa" ? "left" : "right"}
          className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        >
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle className="flex items-center gap-2 text-base">
              <span className="truncate">{deal?.title ?? "…"}</span>
              {deal?.archived ? (
                <Badge variant="outline" className="shrink-0">
                  {t("common.archived")}
                </Badge>
              ) : null}
            </SheetTitle>
            <SheetDescription className="flex items-center gap-2">
              {deal ? (
                <>
                  <span className="font-semibold text-foreground">
                    {formatMoney(deal.value, locale, deal.currency || currency)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{deal.stage?.name}</span>
                  <span aria-hidden="true">·</span>
                  <span>{t("deals.detail.daysInStage", { count: daysInStage })}</span>
                </>
              ) : null}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {!deal ? (
              <div className="flex items-center justify-center py-16" aria-busy="true">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
            ) : (
              <div className="space-y-5">
                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => onEdit(deal)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("common.edit")}
                  </Button>
                  {wonStage && deal.stageId !== wonStage.id ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 gap-1.5 border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                      disabled={busy}
                      onClick={() => moveStage(wonStage)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("deals.actions.markWon")}
                    </Button>
                  ) : null}
                  {lostStage && deal.stageId !== lostStage.id ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 gap-1.5 border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                      disabled={busy}
                      onClick={() => {
                        setLostReason("");
                        setLostDialog(true);
                      }}
                    >
                      <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("deals.actions.markLost")}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5"
                    disabled={busy}
                    onClick={toggleArchive}
                  >
                    {deal.archived ? (
                      <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {deal.archived ? t("common.restore") : t("common.archive")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("common.delete")}
                  </Button>
                </div>

                {/* Info */}
                <div className="space-y-2.5 rounded-xl border border-border bg-card p-4">
                  {infoRow(t("common.priority"), <PriorityBadge priority={deal.priority} />)}
                  {infoRow(t("common.owner"), deal.owner?.name ?? "—")}
                  {infoRow(
                    t("deals.field.contact"),
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      {deal.contact?.name ?? "—"}
                    </span>
                  )}
                  {infoRow(
                    t("deals.field.company"),
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      {deal.company?.name ?? "—"}
                    </span>
                  )}
                  {infoRow(
                    t("deals.field.expectedCloseDate"),
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      {formatDate(deal.expectedCloseDate, locale, tz)}
                    </span>
                  )}
                  {infoRow(t("deals.field.probability"), `${deal.probability}%`)}
                  {infoRow(t("common.created"), formatDate(deal.createdAt, locale, tz))}
                  {deal.lostReason
                    ? infoRow(t("deals.field.lostReason"), <span className="text-destructive">{deal.lostReason}</span>)
                    : null}
                  <div className="flex items-start justify-between gap-3 pt-1">
                    <span className="shrink-0 text-sm text-muted-foreground">{t("common.tags")}</span>
                    <TagBadges tags={deal.tags} />
                  </div>
                </div>

                {deal.description ? (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("common.description")}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{deal.description}</p>
                  </div>
                ) : null}

                {/* Log activity */}
                <form
                  onSubmit={logActivity}
                  className="space-y-2 rounded-xl border border-border bg-card p-4"
                  aria-label={t("activities.logActivity")}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("activities.logActivity")}
                  </p>
                  <div className="flex gap-2">
                    <Select
                      value={logType}
                      onValueChange={(v) => setLogType(v as (typeof ACTIVITY_TYPES)[number])}
                    >
                      <SelectTrigger className="h-9 w-32 shrink-0" aria-label={t("activities.field.type")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTIVITY_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {t(`enums.activityType.${type}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={logTitle}
                      onChange={(e) => setLogTitle(e.target.value)}
                      placeholder={t("common.title")}
                      className="h-9"
                      aria-label={t("common.title")}
                    />
                    <Button type="submit" size="sm" className="h-9 shrink-0" disabled={logging || !logTitle.trim()}>
                      {logging ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                      {t("common.add")}
                    </Button>
                  </div>
                </form>

                {/* Tasks of this deal */}
                {deal.tasks.length > 0 ? (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("nav.tasks")}
                    </p>
                    <ul className="space-y-1.5">
                      {deal.tasks.map((task) => (
                        <li key={task.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className={task.status === "DONE" ? "text-muted-foreground line-through" : ""}>
                            {task.title}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatDateTime(task.dueAt, locale, tz)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* Stage history */}
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <CircleDot className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("deals.detail.stageHistory")}
                  </p>
                  {deal.stageHistory.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("common.noData")}</p>
                  ) : (
                    <ul className="space-y-2.5">
                      {deal.stageHistory.map((h) => {
                        const meta = parseStageMeta(h.metadata);
                        return (
                          <li key={h.id} className="flex items-center justify-between gap-2 text-sm">
                            <span className="inline-flex min-w-0 items-center gap-1.5">
                              <Phone className="h-3 w-3 rotate-45 text-muted-foreground" aria-hidden="true" />
                              <span className="truncate">
                                {meta.from ?? "—"} → {meta.to ?? "—"}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatDateTime(h.createdAt, locale, tz)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* Recent activities */}
                {deal.activities.length > 0 ? (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("activities.title")}
                    </p>
                    <ul className="space-y-2.5">
                      {deal.activities.slice(0, 10).map((a) => (
                        <li key={a.id} className="flex items-start justify-between gap-2 text-sm">
                          <span className="min-w-0">
                            <Badge variant="secondary" className="me-1.5 text-[10px]">
                              {t(`enums.activityType.${a.type}`)}
                            </Badge>
                            <span className="align-middle">{a.title}</span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatDateTime(a.createdAt, locale, tz)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <Separator className="opacity-0" />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Lost reason dialog */}
      <Dialog open={lostDialog} onOpenChange={setLostDialog}>
        <DialogContent className="sm:max-w-md" dir={undefined}>
          <DialogHeader>
            <DialogTitle>{t("deals.actions.markLostTitle")}</DialogTitle>
            <DialogDescription>{deal?.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="lost-reason">{t("deals.actions.markLostReason")}</Label>
            <Input
              id="lost-reason"
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              maxLength={500}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLostDialog(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (lostStage) void moveStage(lostStage, lostReason.trim());
                setLostDialog(false);
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {t("deals.actions.markLost")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("common.deleteConfirmTitle")}
        description={t("common.deleteConfirmDescription", { name: deal?.title ?? "" })}
        confirmLabel={t("common.delete")}
        loading={busy}
        destructive
        onConfirm={remove}
      />
    </>
  );
}
