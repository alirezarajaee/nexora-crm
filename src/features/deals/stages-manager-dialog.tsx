"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { api, ApiRequestError } from "@/lib/client-api";
import { useWorkspaceId, useApiToast } from "@/hooks/use-workspace";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNumber } from "@/lib/format";
import { useAppStore } from "@/store/app-store";
import type { Pipeline, Stage } from "@/types/api";

type StageType = "OPEN" | "WON" | "LOST";
const STAGE_TYPES: StageType[] = ["OPEN", "WON", "LOST"];

interface StageDraft {
  name: string;
  probability: number;
  type: StageType;
}

function draftOf(stage: Stage): StageDraft {
  return { name: stage.name, probability: stage.probability, type: stage.type };
}

function StageRow({
  stage,
  locale,
  wsId,
  t,
  onChanged,
  onDeleted,
}: {
  stage: Stage;
  locale: "fa" | "en";
  wsId: string;
  t: (key: string, params?: Record<string, unknown>) => string;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { apiError, success } = useApiToast();
  const [draft, setDraft] = useState<StageDraft>(() => draftOf(stage));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => setDraft(draftOf(stage)), [stage]);

  const dirty =
    draft.name.trim() !== stage.name ||
    draft.probability !== stage.probability ||
    draft.type !== stage.type;

  const save = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    try {
      await api.patch(
        "/pipelines/stages",
        {
          workspaceId: wsId,
          stageId: stage.id,
          name: draft.name.trim(),
          probability: draft.probability,
          type: draft.type,
        },
        wsId
      );
      success("pipelines.stageUpdated");
      onChanged();
    } catch (err) {
      apiError(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.delete("/pipelines/stages", { stageId: stage.id }, wsId);
      success("pipelines.stageDeleted");
      setConfirmDelete(false);
      onDeleted();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        toast.error(t("pipelines.cannotDeleteStage"));
      } else {
        apiError(err);
      }
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <li className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          className="h-9 min-w-32 flex-1"
          aria-label={t("pipelines.stageName")}
        />
        <Badge
          variant="outline"
          className={
            draft.type === "WON"
              ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
              : draft.type === "LOST"
                ? "border-red-500/40 text-red-600 dark:text-red-400"
                : "border-primary/40 text-primary"
          }
        >
          {t(`enums.stageType.${draft.type}`)}
        </Badge>
        <Button
          size="sm"
          className="h-9 gap-1"
          disabled={!dirty || saving || !draft.name.trim()}
          onClick={save}
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {t("common.save")}
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="h-9 w-9 shrink-0 text-destructive hover:bg-destructive/10"
          onClick={() => setConfirmDelete(true)}
          aria-label={t("common.delete")}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <div className="flex min-w-44 flex-1 items-center gap-2">
          <Slider
            value={[draft.probability]}
            min={0}
            max={100}
            step={5}
            onValueChange={(vals) => setDraft((d) => ({ ...d, probability: vals[0] ?? 0 }))}
            aria-label={t("pipelines.stageProbability")}
          />
          <span className="w-12 shrink-0 text-end text-xs tabular-nums text-muted-foreground">
            {formatNumber(draft.probability, locale)}%
          </span>
        </div>
        <Select
          value={draft.type}
          onValueChange={(v) => setDraft((d) => ({ ...d, type: v as StageType }))}
        >
          <SelectTrigger className="h-8 w-28" aria-label={t("pipelines.stageType")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAGE_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`enums.stageType.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("common.deleteConfirmTitle")}
        description={t("pipelines.deleteStageWarn")}
        confirmLabel={t("common.delete")}
        destructive
        loading={deleting}
        onConfirm={remove}
      />
    </li>
  );
}

export function StagesManagerDialog({
  open,
  onOpenChange,
  pipeline,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: Pipeline | null;
}) {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const wsId = useWorkspaceId();
  const { apiError, success } = useApiToast();
  const qc = useQueryClient();

  const [newName, setNewName] = useState("");
  const [newProbability, setNewProbability] = useState(50);
  const [newType, setNewType] = useState<StageType>("OPEN");
  const [adding, setAdding] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["pipelines", wsId] });
    qc.invalidateQueries({ queryKey: ["deals"] });
  };

  const addStage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pipeline || !newName.trim()) return;
    setAdding(true);
    try {
      await api.post(
        "/pipelines/stages",
        {
          workspaceId: wsId,
          pipelineId: pipeline.id,
          name: newName.trim(),
          probability: newProbability,
          type: newType,
        },
        wsId
      );
      success("pipelines.stageCreated");
      setNewName("");
      setNewProbability(50);
      setNewType("OPEN");
      refresh();
    } catch (err) {
      apiError(err);
    } finally {
      setAdding(false);
    }
  };

  const stages = [...(pipeline?.stages ?? [])].sort((a, b) => a.order - b.order);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" dir={undefined}>
        <DialogHeader>
          <DialogTitle>{t("pipelines.title")}</DialogTitle>
          <DialogDescription>{pipeline?.name}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto pe-1">
          <ul className="space-y-3">
            {stages.map((stage) => (
              <StageRow
                key={stage.id}
                stage={stage}
                locale={locale}
                wsId={wsId}
                t={t}
                onChanged={refresh}
                onDeleted={refresh}
              />
            ))}
          </ul>

          <form
            onSubmit={addStage}
            className="space-y-3 rounded-xl border border-dashed border-border bg-muted/30 p-3"
            aria-label={t("pipelines.addStage")}
          >
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("pipelines.addStage")}
            </Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("pipelines.stageName")}
                className="h-9 min-w-32 flex-1"
                aria-label={t("pipelines.stageName")}
              />
              <Select value={newType} onValueChange={(v) => setNewType(v as StageType)}>
                <SelectTrigger className="h-9 w-28" aria-label={t("pipelines.stageType")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`enums.stageType.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" size="sm" className="h-9 gap-1" disabled={adding || !newName.trim()}>
                {adding ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {t("common.add")}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Slider
                value={[newProbability]}
                min={0}
                max={100}
                step={5}
                onValueChange={(vals) => setNewProbability(vals[0] ?? 50)}
                aria-label={t("pipelines.stageProbability")}
              />
              <span className="w-12 shrink-0 text-end text-xs tabular-nums text-muted-foreground">
                {formatNumber(newProbability, locale)}%
              </span>
            </div>
          </form>
        </div>

        <div className="space-y-1 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">{t("pipelines.deleteStageWarn")}</p>
          <p className="text-xs text-muted-foreground">{t("pipelines.customStagesNote")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
