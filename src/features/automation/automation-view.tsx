"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  History,
  MinusCircle,
  Pencil,
  Plus,
  Shield,
  Trash2,
  Zap,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/client-api";
import { useApiToast, useLocaleTz, useMemberOptions, useWorkspaceId } from "@/hooks/use-workspace";
import { useAppStore } from "@/store/app-store";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  AutomationActionType,
  AutomationExecution,
  AutomationRule,
  AutomationTrigger,
} from "@/types/api";

// ---- Stable enums (must match backend) ----
const TRIGGERS: AutomationTrigger[] = [
  "LEAD_CREATED",
  "DEAL_CREATED",
  "DEAL_STAGE_CHANGED",
  "TASK_OVERDUE",
  "DEAL_INACTIVE",
  "RECORD_ASSIGNED",
  "STATUS_ENTERED",
];
const CONDITION_FIELDS = ["value", "stage", "source", "owner", "priority", "status"] as const;
const OPERATORS = ["equals", "notEquals", "greaterThan", "lessThan", "contains"] as const;
const ACTION_TYPES: AutomationActionType[] = [
  "CREATE_TASK",
  "ADD_TAG",
  "ASSIGN",
  "NOTIFY",
  "UPDATE_FIELD",
  "LOG_EVENT",
];
const UPDATE_FIELD_TARGETS = ["value", "priority", "status"] as const;
const MAX_ITEMS = 5;

type ConditionRow = { field: string; operator: (typeof OPERATORS)[number]; value: string };
type ActionRow = { type: AutomationActionType; params: Record<string, string> };

interface RuleFormState {
  name: string;
  description: string;
  triggerType: AutomationTrigger;
  conditions: ConditionRow[];
  actions: ActionRow[];
  enabled: boolean;
}

const DEFAULT_FORM: RuleFormState = {
  name: "",
  description: "",
  triggerType: "LEAD_CREATED",
  conditions: [],
  actions: [{ type: "CREATE_TASK", params: {} }],
  enabled: true,
};

function ruleToForm(rule: AutomationRule): RuleFormState {
  return {
    name: rule.name,
    description: rule.description ?? "",
    triggerType: rule.triggerType,
    conditions: rule.conditions.map((c) => ({
      field: c.field,
      operator: c.operator,
      value: c.value,
    })),
    actions: rule.actions.map((a) => ({ type: a.type, params: { ...a.params } })),
    enabled: rule.enabled,
  };
}

// ================= Rule form dialog =================

function ActionParamsInputs({
  action,
  onParamChange,
}: {
  action: ActionRow;
  onParamChange: (key: string, value: string) => void;
}) {
  const { t } = useTranslation();
  const memberOptions = useMemberOptions();

  switch (action.type) {
    case "CREATE_TASK":
      return (
        <>
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="text-xs">{t("automation.actionParam.title")}</Label>
            <Input
              className="h-9"
              value={action.params.title ?? ""}
              onChange={(e) => onParamChange("title", e.target.value)}
            />
          </div>
          <div className="w-24 space-y-1">
            <Label className="text-xs">{t("automation.actionParam.dueInDays")}</Label>
            <Input
              className="h-9"
              type="number"
              min={0}
              value={action.params.dueInDays ?? ""}
              onChange={(e) => onParamChange("dueInDays", e.target.value)}
            />
          </div>
          <div className="w-32 space-y-1">
            <Label className="text-xs">{t("automation.actionParam.priority")}</Label>
            <Select
              value={action.params.priority ?? "MEDIUM"}
              onValueChange={(v) => onParamChange("priority", v)}
            >
              <SelectTrigger className="h-9" aria-label={t("automation.actionParam.priority")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["LOW", "MEDIUM", "HIGH"] as const).map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(`enums.priority.${p}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      );
    case "ADD_TAG":
      return (
        <div className="min-w-0 flex-1 space-y-1">
          <Label className="text-xs">{t("automation.actionParam.tagName")}</Label>
          <Input
            className="h-9"
            value={action.params.tagName ?? ""}
            onChange={(e) => onParamChange("tagName", e.target.value)}
          />
        </div>
      );
    case "ASSIGN":
      return (
        <div className="min-w-0 flex-1 space-y-1">
          <Label className="text-xs">{t("automation.actionParam.userId")}</Label>
          <Select value={action.params.userId ?? ""} onValueChange={(v) => onParamChange("userId", v)}>
            <SelectTrigger className="h-9" aria-label={t("automation.actionParam.userId")}>
              <SelectValue placeholder={t("common.selectPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {memberOptions.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    case "UPDATE_FIELD":
      return (
        <>
          <div className="w-36 space-y-1">
            <Label className="text-xs">{t("automation.actionParam.field")}</Label>
            <Select
              value={action.params.field ?? "value"}
              onValueChange={(v) => onParamChange("field", v)}
            >
              <SelectTrigger className="h-9" aria-label={t("automation.actionParam.field")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UPDATE_FIELD_TARGETS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {t(`common.${f}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="text-xs">{t("automation.actionParam.value")}</Label>
            <Input
              className="h-9"
              value={action.params.value ?? ""}
              onChange={(e) => onParamChange("value", e.target.value)}
            />
          </div>
        </>
      );
    case "NOTIFY":
    case "LOG_EVENT":
      return (
        <div className="min-w-0 flex-1 space-y-1">
          <Label className="text-xs">{t("automation.actionParam.message")}</Label>
          <Input
            className="h-9"
            value={action.params.message ?? ""}
            onChange={(e) => onParamChange("message", e.target.value)}
          />
        </div>
      );
    default:
      return null;
  }
}

function RuleFormDialog({
  open,
  onOpenChange,
  editing,
  onSubmit,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: AutomationRule | null;
  onSubmit: (form: RuleFormState) => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<RuleFormState>(DEFAULT_FORM);

  // Adjust form state when the dialog opens (state-during-render pattern)
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setForm(editing ? ruleToForm(editing) : DEFAULT_FORM);
  }

  const patch = (partial: Partial<RuleFormState>) => setForm((f) => ({ ...f, ...partial }));

  return (
    <EntityFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? t("automation.editRule") : t("automation.createRule")}
      loading={saving}
      wide
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rule-name">{t("automation.field.name")} *</Label>
            <Input
              id="rule-name"
              className="h-9"
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rule-trigger">{t("automation.field.trigger")} *</Label>
            <Select
              value={form.triggerType}
              onValueChange={(v) => patch({ triggerType: v as AutomationTrigger })}
            >
              <SelectTrigger id="rule-trigger" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRIGGERS.map((tr) => (
                  <SelectItem key={tr} value={tr}>
                    {t(`automation.trigger.${tr}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rule-description">{t("automation.field.description")}</Label>
          <Textarea
            id="rule-description"
            className="min-h-16"
            value={form.description}
            onChange={(e) => patch({ description: e.target.value })}
            maxLength={500}
          />
        </div>

        {/* Conditions builder */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t("automation.field.conditions")}</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={form.conditions.length >= MAX_ITEMS}
              onClick={() =>
                patch({
                  conditions: [
                    ...form.conditions,
                    { field: "value", operator: "equals", value: "" },
                  ],
                })
              }
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t("common.add")}
            </Button>
          </div>
          {form.conditions.length === 0 ? (
            <p className="text-xs text-muted-foreground">— {t("common.none")} —</p>
          ) : (
            <div className="space-y-2">
              {form.conditions.map((cond, idx) => (
                <div key={idx} className="flex flex-wrap items-end gap-2 rounded-lg border p-2">
                  <div className="w-36 space-y-1">
                    <Label className="text-xs">{t("automation.field.conditions")}</Label>
                    <Select
                      value={cond.field}
                      onValueChange={(v) =>
                        setForm((f) => ({
                          ...f,
                          conditions: f.conditions.map((c, i) =>
                            i === idx ? { ...c, field: v } : c
                          ),
                        }))
                      }
                    >
                      <SelectTrigger className="h-9" aria-label={t("automation.field.conditions")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONDITION_FIELDS.map((f) => (
                          <SelectItem key={f} value={f}>
                            {t(`automation.conditionField.${f}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-40 space-y-1">
                    <Label className="text-xs">{t("common.filter")}</Label>
                    <Select
                      value={cond.operator}
                      onValueChange={(v) =>
                        setForm((f) => ({
                          ...f,
                          conditions: f.conditions.map((c, i) =>
                            i === idx ? { ...c, operator: v as ConditionRow["operator"] } : c
                          ),
                        }))
                      }
                    >
                      <SelectTrigger className="h-9" aria-label={t("common.filter")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OPERATORS.map((op) => (
                          <SelectItem key={op} value={op}>
                            {t(`automation.operator.${op}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label className="text-xs">{t("common.value")}</Label>
                    <Input
                      className="h-9"
                      value={cond.value}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          conditions: f.conditions.map((c, i) =>
                            i === idx ? { ...c, value: e.target.value } : c
                          ),
                        }))
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={t("common.delete")}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        conditions: f.conditions.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions builder */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t("automation.field.actions")} *</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={form.actions.length >= MAX_ITEMS}
              onClick={() =>
                patch({ actions: [...form.actions, { type: "CREATE_TASK", params: {} }] })
              }
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t("common.add")}
            </Button>
          </div>
          {form.actions.length === 0 ? (
            <p className="text-xs text-destructive">{t("automation.validation.needAction")}</p>
          ) : (
            <div className="space-y-2">
              {form.actions.map((action, idx) => (
                <div key={idx} className="flex flex-wrap items-end gap-2 rounded-lg border p-2">
                  <div className="w-44 space-y-1">
                    <Label className="text-xs">{t("automation.field.actions")}</Label>
                    <Select
                      value={action.type}
                      onValueChange={(v) =>
                        setForm((f) => ({
                          ...f,
                          actions: f.actions.map((a, i) =>
                            i === idx ? { type: v as AutomationActionType, params: {} } : a
                          ),
                        }))
                      }
                    >
                      <SelectTrigger className="h-9" aria-label={t("automation.field.actions")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTION_TYPES.map((a) => (
                          <SelectItem key={a} value={a}>
                            {t(`automation.actionType.${a}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <ActionParamsInputs
                    action={action}
                    onParamChange={(key, value) =>
                      setForm((f) => ({
                        ...f,
                        actions: f.actions.map((a, i) =>
                          i === idx ? { ...a, params: { ...a.params, [key]: value } } : a
                        ),
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={t("common.delete")}
                    onClick={() =>
                      setForm((f) => ({ ...f, actions: f.actions.filter((_, i) => i !== idx) }))
                    }
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <Label htmlFor="rule-enabled">{t("automation.field.enabled")}</Label>
          <Switch
            id="rule-enabled"
            checked={form.enabled}
            onCheckedChange={(v) => patch({ enabled: v })}
          />
        </div>
      </div>
    </EntityFormDialog>
  );
}

// ================= Rule card =================

const EXEC_STATUS_STYLES: Record<AutomationExecution["status"], string> = {
  SUCCESS: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
  FAILED: "bg-red-500/12 text-red-600 dark:text-red-400 border-red-500/25",
  SKIPPED: "bg-slate-500/12 text-slate-500 dark:text-slate-400 border-slate-500/20",
};

function ExecutionsCard({ executions, loading }: { executions: AutomationExecution[]; loading: boolean }) {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const tz = useLocaleTz();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("automation.executions.title")}
        </CardTitle>
        <CardDescription>{t("automation.executions.scanHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingState rows={3} />
        ) : executions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("automation.executions.empty")}</p>
        ) : (
          <ol className="max-h-96 space-y-3 overflow-y-auto pe-1" aria-label={t("automation.executions.title")}>
            {executions.map((exec) => {
              const StatusIcon =
                exec.status === "SUCCESS" ? CheckCircle2 : exec.status === "FAILED" ? AlertCircle : MinusCircle;
              return (
                <li key={exec.id} className="relative flex gap-3 border-b pb-3 last:border-b-0 last:pb-0">
                  <span
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                      EXEC_STATUS_STYLES[exec.status]
                    )}
                  >
                    <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium">{exec.ruleName}</span>
                      <Badge variant="outline" className={cn("text-[11px]", EXEC_STATUS_STYLES[exec.status])}>
                        {t(`automation.executions.${exec.status}`)}
                      </Badge>
                    </div>
                    {exec.detail ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{exec.detail}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {formatDateTime(exec.createdAt, locale, tz)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

// ================= Main view =================

export function AutomationView() {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { apiError } = useApiToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [deleting, setDeleting] = useState<AutomationRule | null>(null);

  const rulesQuery = useQuery({
    queryKey: ["automation-rules", workspaceId],
    queryFn: () => api.get<AutomationRule[]>("/automation/rules", undefined, workspaceId),
    enabled: Boolean(workspaceId),
  });
  const executionsQuery = useQuery({
    queryKey: ["automation-executions", workspaceId],
    queryFn: () =>
      api.get<AutomationExecution[]>("/automation/executions", { limit: 30 }, workspaceId),
    enabled: Boolean(workspaceId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["automation-rules", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["automation-executions", workspaceId] });
  };

  const saveMutation = useMutation({
    mutationFn: (form: RuleFormState) => {
      const payload = {
        workspaceId,
        name: form.name.trim(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        triggerType: form.triggerType,
        conditions: form.conditions
          .filter((c) => c.value.trim() !== "")
          .map((c) => ({ field: c.field, operator: c.operator, value: c.value.trim() })),
        actions: form.actions.map((a) => ({
          type: a.type,
          params: Object.fromEntries(
            Object.entries(a.params).filter(([, v]) => v !== undefined && v.trim() !== "")
          ),
        })),
        enabled: form.enabled,
      };
      if (editing) {
        return api.patch(`/automation/rules/${editing.id}`, payload, workspaceId);
      }
      return api.post("/automation/rules", payload, workspaceId);
    },
    onSuccess: () => {
      toast.success(editing ? t("automation.updatedToast") : t("automation.createdToast"));
      setDialogOpen(false);
      setEditing(null);
      invalidate();
    },
    onError: (err) => apiError(err),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ rule, enabled }: { rule: AutomationRule; enabled: boolean }) =>
      api.patch(`/automation/rules/${rule.id}`, { workspaceId, enabled }, workspaceId),
    onSuccess: (_data, vars) => {
      toast.success(vars.enabled ? t("automation.enabledToast") : t("automation.disabledToast"));
      invalidate();
    },
    onError: (err) => apiError(err),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete("/automation/rules", { id }, workspaceId),
    onSuccess: () => {
      toast.success(t("automation.deletedToast"));
      setDeleting(null);
      invalidate();
    },
    onError: (err) => apiError(err),
  });

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (rule: AutomationRule) => {
    setEditing(rule);
    setDialogOpen(true);
  };

  const submitForm = (form: RuleFormState) => {
    if (!form.name.trim()) {
      toast.error(t("automation.validation.needName"));
      return;
    }
    if (!form.triggerType) {
      toast.error(t("automation.validation.needTrigger"));
      return;
    }
    if (form.conditions.some((c) => c.value.trim() === "")) {
      toast.error(t("automation.validation.conditionValue"));
      return;
    }
    if (form.actions.length === 0) {
      toast.error(t("automation.validation.needAction"));
      return;
    }
    saveMutation.mutate(form);
  };

  const rules = rulesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("automation.title")}
        subtitle={t("automation.subtitle")}
        actions={
          <Button onClick={openNew} className="h-9">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("automation.createRule")}
          </Button>
        }
      />

      <div
        className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm text-muted-foreground"
        role="note"
      >
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span>{t("automation.userCodeNote")}</span>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-5">
        <section className="space-y-3 lg:col-span-3" aria-label={t("automation.title")}>
          {rulesQuery.isLoading ? (
            <LoadingState rows={4} />
          ) : rulesQuery.isError ? (
            <ErrorState
              title={t("common.errorStateTitle")}
              description={t("common.errorStateDescription")}
              retryLabel={t("common.retry")}
              onRetry={() => void rulesQuery.refetch()}
            />
          ) : rules.length === 0 ? (
            <EmptyState
              icon={Zap}
              title={t("automation.empty.title")}
              description={t("automation.empty.description")}
              action={
                <Button onClick={openNew} className="h-9">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {t("automation.createRule")}
                </Button>
              }
            />
          ) : (
            rules.map((rule) => (
              <Card key={rule.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{rule.name}</p>
                      {rule.description ? (
                        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                          {rule.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(v) => toggleMutation.mutate({ rule, enabled: v })}
                        disabled={toggleMutation.isPending}
                        aria-label={`${t("automation.field.enabled")} — ${rule.name}`}
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            onClick={() => openEdit(rule)}
                            aria-label={`${t("common.edit")} — ${rule.name}`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("common.edit")}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleting(rule)}
                            aria-label={`${t("common.delete")} — ${rule.name}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("common.delete")}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/10 text-primary">
                      <Zap className="h-3 w-3" aria-hidden="true" />
                      {t(`automation.trigger.${rule.triggerType}`)}
                    </Badge>
                    {rule.actions.map((a, i) => (
                      <Badge key={i} variant="secondary" className="font-normal">
                        {t(`automation.actionType.${a.type}`)}
                      </Badge>
                    ))}
                  </div>

                  {rule.conditions.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {rule.conditions.map((c, i) => (
                        <span
                          key={i}
                          className="rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {t(`automation.conditionField.${c.field}`)}{" "}
                          {t(`automation.operator.${c.operator}`)}{" "}
                          <span className="font-medium text-foreground">{c.value}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {t("automation.field.runCount")}: {formatNumber(rule.runCount, locale)}
                    </span>
                    <span>
                      {t("automation.field.lastRun")}: {formatRelative(rule.lastRunAt, locale, t)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </section>

        <section className="lg:col-span-2" aria-label={t("automation.executions.title")}>
          <ExecutionsCard
            executions={executionsQuery.data ?? []}
            loading={executionsQuery.isLoading}
          />
        </section>
      </div>

      <RuleFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        saving={saveMutation.isPending}
        onSubmit={submitForm}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("common.deleteConfirmTitle")}
        description={t("common.deleteConfirmDescription", { name: deleting?.name ?? "" })}
        confirmLabel={t("common.delete")}
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting.id);
        }}
      />
    </div>
  );
}
