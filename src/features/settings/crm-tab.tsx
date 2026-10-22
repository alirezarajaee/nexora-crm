"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FolderTree,
  Plus,
  SlidersHorizontal,
  Tags,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState, LoadingState } from "@/components/shared/states";
import { api, ApiRequestError } from "@/lib/client-api";
import { useApiToast, useWorkspaceId, useWorkspaceRole } from "@/hooks/use-workspace";
import { useAppStore } from "@/store/app-store";
import { formatNumber, parseLocalizedNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CustomFieldDef, CustomFieldEntity, CustomFieldType, Pipeline, Stage } from "@/types/api";

const STAGE_TYPES: Stage["type"][] = ["OPEN", "WON", "LOST"];
const FIELD_ENTITIES: CustomFieldEntity[] = ["contact", "company", "deal", "lead"];
const FIELD_TYPES: CustomFieldType[] = ["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT", "MULTI_SELECT", "URL"];
const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

// ================= Pipelines & stages =================

function StageRow({
  stage,
  canManage,
  onCommit,
  onDelete,
}: {
  stage: Stage;
  canManage: boolean;
  onCommit: (body: { stageId: string; name?: string; probability?: number; type?: Stage["type"] }) => void;
  onDelete: (stage: Stage) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(stage.name);
  const [probability, setProbability] = useState(String(stage.probability));

  // Sync local inputs when the stage record changes (state-during-render pattern)
  const [prevStage, setPrevStage] = useState(stage);
  if (stage !== prevStage) {
    setPrevStage(stage);
    setName(stage.name);
    setProbability(String(stage.probability));
  }

  const commitName = () => {
    const next = name.trim();
    if (!canManage) return;
    if (next && next !== stage.name) onCommit({ stageId: stage.id, name: next });
    else setName(stage.name);
  };

  const commitProbability = () => {
    if (!canManage) return;
    const n = parseLocalizedNumber(probability);
    if (n === null || !Number.isInteger(n) || n < 0 || n > 100) {
      setProbability(String(stage.probability));
      return;
    }
    if (n !== stage.probability) onCommit({ stageId: stage.id, probability: n });
    else setProbability(String(stage.probability));
  };

  return (
    <li className="flex flex-wrap items-center gap-2">
      <Input
        className="h-8 min-w-32 flex-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        disabled={!canManage}
        maxLength={60}
        aria-label={`${t("pipelines.stageName")} — ${stage.name}`}
      />
      <Input
        type="number"
        className="h-8 w-20"
        min={0}
        max={100}
        value={probability}
        onChange={(e) => setProbability(e.target.value)}
        onBlur={commitProbability}
        disabled={!canManage}
        aria-label={`${t("pipelines.stageProbability")} — ${stage.name}`}
      />
      <Select
        value={stage.type}
        onValueChange={(v) => {
          if (canManage && v !== stage.type) onCommit({ stageId: stage.id, type: v as Stage["type"] });
        }}
        disabled={!canManage}
      >
        <SelectTrigger className="h-8 w-28" aria-label={`${t("pipelines.stageType")} — ${stage.name}`}>
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
      {canManage ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(stage)}
          aria-label={`${t("common.delete")} — ${stage.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  );
}

function PipelineCard({
  pipeline,
  canManage,
  onCommitStage,
  onDeleteStage,
  onAddStage,
  onRename,
}: {
  pipeline: Pipeline;
  canManage: boolean;
  onCommitStage: (body: { stageId: string; name?: string; probability?: number; type?: Stage["type"] }) => void;
  onDeleteStage: (stage: Stage) => void;
  onAddStage: (body: { pipelineId: string; name: string; probability?: number; type?: Stage["type"] }) => void;
  onRename: (pipelineId: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const [nameInput, setNameInput] = useState(pipeline.name);
  const [addName, setAddName] = useState("");
  const [addProbability, setAddProbability] = useState("50");
  const [addType, setAddType] = useState<Stage["type"]>("OPEN");

  // Sync the pipeline name input when the record changes (state-during-render pattern)
  const [prevPipeline, setPrevPipeline] = useState(pipeline);
  if (pipeline !== prevPipeline) {
    setPrevPipeline(pipeline);
    setNameInput(pipeline.name);
  }

  const submitAddStage = (e: React.FormEvent) => {
    e.preventDefault();
    const name = addName.trim();
    if (!name) {
      toast.error(t("validation.required"));
      return;
    }
    const probability = parseLocalizedNumber(addProbability);
    onAddStage({
      pipelineId: pipeline.id,
      name,
      ...(probability !== null && probability >= 0 && probability <= 100 ? { probability } : {}),
      type: addType,
    });
    setAddName("");
    setAddProbability("50");
    setAddType("OPEN");
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b p-3">
        <Input
          className="h-9 max-w-64 flex-1"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onBlur={() => {
            const next = nameInput.trim();
            if (canManage && next && next !== pipeline.name) onRename(pipeline.id, next);
            else setNameInput(pipeline.name);
          }}
          disabled={!canManage}
          maxLength={80}
          aria-label={`${t("pipelines.pipelineName")} — ${pipeline.name}`}
        />
        {pipeline.isDefault ? (
          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
            {t("pipelines.defaultPipeline")}
          </Badge>
        ) : null}
      </div>
      <div className="space-y-2 p-3">
        <ul className="space-y-2">
          {pipeline.stages.map((stage) => (
            <StageRow
              key={stage.id}
              stage={stage}
              canManage={canManage}
              onCommit={onCommitStage}
              onDelete={onDeleteStage}
            />
          ))}
        </ul>
        {canManage ? (
          <form onSubmit={submitAddStage} className="flex flex-wrap items-center gap-2 pt-1">
            <Input
              className="h-8 min-w-32 flex-1"
              placeholder={t("pipelines.stageName")}
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              maxLength={60}
              aria-label={t("pipelines.stageName")}
            />
            <Input
              type="number"
              className="h-8 w-20"
              min={0}
              max={100}
              value={addProbability}
              onChange={(e) => setAddProbability(e.target.value)}
              aria-label={t("pipelines.stageProbability")}
            />
            <Select value={addType} onValueChange={(v) => setAddType(v as Stage["type"])}>
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
            <Button type="submit" variant="outline" size="sm" className="h-8">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t("pipelines.addStage")}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function PipelinesSection({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { apiError } = useApiToast();

  const [addPipelineOpen, setAddPipelineOpen] = useState(false);
  const [pipelineName, setPipelineName] = useState("");
  const [deletingStage, setDeletingStage] = useState<{ pipelineId: string; stage: Stage } | null>(null);

  const pipelinesQuery = useQuery({
    queryKey: ["pipelines", workspaceId],
    queryFn: () => api.get<Pipeline[]>("/pipelines", undefined, workspaceId),
    enabled: Boolean(workspaceId),
  });
  const pipelines = pipelinesQuery.data ?? [];

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["pipelines", workspaceId] });

  const createPipeline = useMutation({
    mutationFn: (name: string) => api.post("/pipelines", { workspaceId, name }, workspaceId),
    onSuccess: () => {
      toast.success(t("pipelines.pipelineCreated"));
      setAddPipelineOpen(false);
      setPipelineName("");
      invalidate();
    },
    onError: (err) => apiError(err),
  });

  const renamePipeline = useMutation({
    mutationFn: ({ pipelineId, name }: { pipelineId: string; name: string }) =>
      api.patch(`/pipelines/${pipelineId}`, { workspaceId, name }, workspaceId),
    onSuccess: () => invalidate(),
    onError: (err) => apiError(err),
  });

  const createStage = useMutation({
    mutationFn: (body: { pipelineId: string; name: string; probability?: number; type?: Stage["type"] }) =>
      api.post("/pipelines/stages", { workspaceId, ...body }, workspaceId),
    onSuccess: () => {
      toast.success(t("pipelines.stageCreated"));
      invalidate();
    },
    onError: (err) => apiError(err),
  });

  const patchStage = useMutation({
    mutationFn: (body: { stageId: string; name?: string; probability?: number; type?: Stage["type"] }) =>
      api.patch("/pipelines/stages", { workspaceId, ...body }, workspaceId),
    onSuccess: () => {
      invalidate();
    },
    onError: (err) => apiError(err),
  });

  const deleteStage = useMutation({
    mutationFn: (stageId: string) => api.delete("/pipelines/stages", { stageId }, workspaceId),
    onSuccess: () => {
      toast.success(t("pipelines.stageDeleted"));
      setDeletingStage(null);
      invalidate();
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.status === 409) {
        toast.error(t("pipelines.cannotDeleteStage"));
        setDeletingStage(null);
        return;
      }
      apiError(err);
    },
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderTree className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t("settings.crm.pipelines")}
          </CardTitle>
          <CardDescription>{t("pipelines.customStagesNote")}</CardDescription>
        </div>
        {canManage ? (
          <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => setAddPipelineOpen(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t("pipelines.addPipeline")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {pipelinesQuery.isLoading ? (
          <LoadingState rows={2} />
        ) : pipelines.length === 0 ? (
          <EmptyState title={t("common.noData")} />
        ) : (
          pipelines.map((pipeline) => (
            <PipelineCard
              key={pipeline.id}
              pipeline={pipeline}
              canManage={canManage}
              onCommitStage={(body) => patchStage.mutate(body)}
              onDeleteStage={(stage) => setDeletingStage({ pipelineId: pipeline.id, stage })}
              onAddStage={(body) => createStage.mutate(body)}
              onRename={(pipelineId, name) => renamePipeline.mutate({ pipelineId, name })}
            />
          ))
        )}
        <p className="text-xs text-muted-foreground">{t("settings.crm.leadStatusesNote")}</p>
      </CardContent>

      <EntityFormDialog
        open={addPipelineOpen}
        onOpenChange={setAddPipelineOpen}
        title={t("pipelines.addPipeline")}
        loading={createPipeline.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          if (!pipelineName.trim()) {
            toast.error(t("validation.required"));
            return;
          }
          createPipeline.mutate(pipelineName.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="pipeline-name">{t("pipelines.pipelineName")} *</Label>
          <Input
            id="pipeline-name"
            className="h-9"
            value={pipelineName}
            onChange={(e) => setPipelineName(e.target.value)}
            maxLength={80}
          />
        </div>
      </EntityFormDialog>

      <ConfirmDialog
        open={Boolean(deletingStage)}
        onOpenChange={(open) => {
          if (!open) setDeletingStage(null);
        }}
        title={t("common.deleteConfirmTitle")}
        description={t("pipelines.deleteStageWarn")}
        confirmLabel={t("common.delete")}
        destructive
        loading={deleteStage.isPending}
        onConfirm={() => {
          if (deletingStage) deleteStage.mutate(deletingStage.stage.id);
        }}
      />
    </Card>
  );
}

// ================= Tags =================

interface TagWithUsage {
  id: string;
  name: string;
  color: string;
  usageCount: number;
}

function TagsSection({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { apiError } = useApiToast();

  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#8B5CF6");

  const tagsQuery = useQuery({
    queryKey: ["tags", workspaceId],
    queryFn: () => api.get<TagWithUsage[]>("/tags", { workspaceId }, workspaceId),
    enabled: Boolean(workspaceId),
  });
  const tags = tagsQuery.data ?? [];

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["tags", workspaceId] });

  const createTag = useMutation({
    mutationFn: () =>
      api.post("/tags", { workspaceId, name: tagName.trim(), color: tagColor }, workspaceId),
    onSuccess: () => {
      toast.success(t("settings.crm.tagCreated"));
      setTagName("");
      setTagColor("#8B5CF6");
      invalidate();
    },
    onError: (err) => apiError(err),
  });

  const deleteTag = useMutation({
    mutationFn: (id: string) => api.delete("/tags", { workspaceId, id }, workspaceId),
    onSuccess: () => {
      toast.success(t("settings.crm.tagDeleted"));
      invalidate();
    },
    onError: (err) => apiError(err),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tagName.trim()) {
      toast.error(t("validation.required"));
      return;
    }
    createTag.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Tags className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("settings.crm.tags")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {tagsQuery.isLoading ? (
            <LoadingState rows={1} />
          ) : tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("common.noData")}</p>
          ) : (
            tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                style={{
                  borderColor: `${tag.color}55`,
                  backgroundColor: `${tag.color}18`,
                  color: tag.color,
                }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden="true" />
                {tag.name}
                <span className="rounded-full bg-background/70 px-1.5 text-[10px] text-muted-foreground">
                  {formatNumber(tag.usageCount, locale)}
                </span>
                {canManage ? (
                  <button
                    type="button"
                    className="rounded-full p-0.5 transition-colors hover:bg-destructive/15 hover:text-destructive"
                    onClick={() => deleteTag.mutate(tag.id)}
                    aria-label={`${t("common.delete")} — ${tag.name}`}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            ))
          )}
        </div>

        {canManage ? (
          <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1 space-y-1">
              <Label htmlFor="tag-name">{t("settings.crm.tagName")}</Label>
              <Input
                id="tag-name"
                className="h-9"
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                maxLength={40}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tag-color">{t("settings.crm.tagColor")}</Label>
              <Input
                id="tag-color"
                type="color"
                className="h-9 w-14 cursor-pointer p-1"
                value={tagColor}
                onChange={(e) => setTagColor(e.target.value)}
              />
            </div>
            <Button type="submit" className="h-9" disabled={createTag.isPending}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("settings.crm.tagCreate")}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ================= Custom fields =================

function CustomFieldsSection({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { apiError } = useApiToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [entityType, setEntityType] = useState<CustomFieldEntity>("contact");
  const [fieldType, setFieldType] = useState<CustomFieldType>("TEXT");
  const [optionsText, setOptionsText] = useState("");
  const [required, setRequired] = useState(false);
  const [deleting, setDeleting] = useState<CustomFieldDef | null>(null);

  const fieldsQuery = useQuery({
    queryKey: ["custom-fields", workspaceId],
    queryFn: () => api.get<CustomFieldDef[]>("/custom-fields", { workspaceId }, workspaceId),
    enabled: Boolean(workspaceId),
  });
  const fields = fieldsQuery.data ?? [];

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["custom-fields", workspaceId] });

  const createField = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post("/custom-fields", { workspaceId, ...body }, workspaceId),
    onSuccess: () => {
      toast.success(t("customFields.createdToast"));
      setCreateOpen(false);
      setLabel("");
      setKey("");
      setEntityType("contact");
      setFieldType("TEXT");
      setOptionsText("");
      setRequired(false);
      invalidate();
    },
    onError: (err) => apiError(err),
  });

  const patchField = useMutation({
    mutationFn: (body: { id: string; active?: boolean; required?: boolean }) =>
      api.patch("/custom-fields", { workspaceId, ...body }, workspaceId),
    onSuccess: () => {
      invalidate();
    },
    onError: (err) => apiError(err),
  });

  const deleteField = useMutation({
    mutationFn: (id: string) => api.delete("/custom-fields", { workspaceId, id }, workspaceId),
    onSuccess: () => {
      toast.success(t("customFields.deletedToast"));
      setDeleting(null);
      invalidate();
    },
    onError: (err) => apiError(err),
  });

  const submitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) {
      toast.error(t("validation.required"));
      return;
    }
    if (!KEY_PATTERN.test(key.trim())) {
      toast.error(t("validation.keyFormat"));
      return;
    }
    const options =
      fieldType === "SELECT" || fieldType === "MULTI_SELECT"
        ? optionsText.split("\n").map((s) => s.trim()).filter(Boolean)
        : undefined;
    createField.mutate({
      entityType,
      label: label.trim(),
      key: key.trim(),
      type: fieldType,
      required,
      ...(options ? { options } : {}),
    });
  };

  const columns: Column<CustomFieldDef>[] = [
    {
      key: "label",
      header: t("customFields.field.label"),
      cell: (f) => <span className="font-medium">{f.label}</span>,
    },
    {
      key: "key",
      header: t("customFields.field.key"),
      cell: (f) => (
        <span className="font-mono text-xs text-muted-foreground" dir="ltr">
          {f.key}
        </span>
      ),
    },
    {
      key: "entityType",
      header: t("customFields.field.entityType"),
      cell: (f) => t(`enums.entityType.${f.entityType}`),
    },
    {
      key: "type",
      header: t("customFields.field.type"),
      cell: (f) => t(`enums.customFieldType.${f.type}`),
    },
    {
      key: "required",
      header: t("customFields.field.required"),
      cell: (f) => (f.required ? t("common.yes") : t("common.no")),
    },
    {
      key: "active",
      header: t("common.status"),
      cell: (f) => (
        <Switch
          checked={f.active}
          disabled={!canManage || patchField.isPending}
          onCheckedChange={(v) => patchField.mutate({ id: f.id, active: v })}
          aria-label={`${t("common.status")} — ${f.label}`}
        />
      ),
    },
  ];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t("settings.crm.customFields")}
          </CardTitle>
        </div>
        {canManage ? (
          <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t("customFields.create")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          rows={fields}
          loading={fieldsQuery.isLoading}
          emptyState={<EmptyState title={t("customFields.empty")} />}
          rowActions={(field) =>
            canManage ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => setDeleting(field)}
                aria-label={`${t("common.delete")} — ${field.label}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : null
          }
        />
      </CardContent>

      <EntityFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("customFields.create")}
        loading={createField.isPending}
        wide
        onSubmit={submitCreate}
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cf-label">{t("customFields.field.label")} *</Label>
              <Input
                id="cf-label"
                className="h-9"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-key">{t("customFields.field.key")} *</Label>
              <Input
                id="cf-key"
                className="h-9"
                dir="ltr"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                maxLength={40}
              />
              <p className="text-xs text-muted-foreground">{t("validation.keyFormat")}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cf-entity">{t("customFields.field.entityType")}</Label>
              <Select value={entityType} onValueChange={(v) => setEntityType(v as CustomFieldEntity)}>
                <SelectTrigger id="cf-entity" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_ENTITIES.map((entity) => (
                    <SelectItem key={entity} value={entity}>
                      {t(`enums.entityType.${entity}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-type">{t("customFields.field.type")}</Label>
              <Select value={fieldType} onValueChange={(v) => setFieldType(v as CustomFieldType)}>
                <SelectTrigger id="cf-type" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`enums.customFieldType.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {fieldType === "SELECT" || fieldType === "MULTI_SELECT" ? (
            <div className="space-y-1.5">
              <Label htmlFor="cf-options">{t("customFields.field.options")}</Label>
              <Textarea
                id="cf-options"
                className="min-h-20"
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
              />
            </div>
          ) : null}
          <label className={cn("flex items-center gap-2 text-sm", canManage ? "cursor-pointer" : "")}>
            <Checkbox
              checked={required}
              onCheckedChange={(v) => setRequired(v === true)}
              aria-label={t("customFields.field.required")}
            />
            {t("customFields.field.required")}
          </label>
        </div>
      </EntityFormDialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("common.deleteConfirmTitle")}
        description={t("customFields.deleteWarn")}
        confirmLabel={t("common.delete")}
        destructive
        loading={deleteField.isPending}
        onConfirm={() => {
          if (deleting) deleteField.mutate(deleting.id);
        }}
      />
    </Card>
  );
}

// ================= Tab =================

export function CrmTab() {
  const role = useWorkspaceRole();
  const canManage = role === "OWNER" || role === "ADMIN";

  return (
    <div className="space-y-6">
      <PipelinesSection canManage={canManage} />
      <TagsSection canManage={canManage} />
      <CustomFieldsSection canManage={canManage} />
    </div>
  );
}
