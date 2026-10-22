"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { useWorkspaceId, useApiToast, useLocaleTz, useWorkspaceCurrency } from "@/hooks/use-workspace";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseLocalizedNumber } from "@/lib/format";
import type { Deal, Paginated, Pipeline, Priority, Company, Contact } from "@/types/api";
import { dateInputToIso, isoToDateInput } from "@/features/tasks/time-utils";

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH"];

// Radix Select forbids empty-string item values; sentinel maps the "None" option to "".
const NONE = "__none__";
const fromSelect = (v: string) => (v === NONE ? "" : v);

interface FormState {
  title: string;
  value: string;
  pipelineId: string;
  stageId: string;
  contactId: string;
  companyId: string;
  ownerId: string;
  expectedCloseDate: string; // yyyy-mm-dd (workspace tz calendar)
  priority: Priority;
  description: string;
}

function emptyState(pipeline?: Pipeline, defaultStageId?: string): FormState {
  const firstOpen = pipeline?.stages.find((s) => s.type === "OPEN") ?? pipeline?.stages[0];
  return {
    title: "",
    value: "",
    pipelineId: pipeline?.id ?? "",
    stageId: defaultStageId || firstOpen?.id || "",
    contactId: "",
    companyId: "",
    ownerId: "",
    expectedCloseDate: "",
    priority: "MEDIUM",
    description: "",
  };
}

export function DealFormDialog({
  open,
  onOpenChange,
  deal,
  pipelines,
  defaultStageId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: Deal | null; // null → create
  pipelines: Pipeline[];
  defaultStageId?: string;
}) {
  const { t } = useTranslation();
  const wsId = useWorkspaceId();
  const tz = useLocaleTz();
  const currency = useWorkspaceCurrency();
  const { apiError, success } = useApiToast();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [titleError, setTitleError] = useState("");

  const memberQuery = useQuery({
    queryKey: ["members", wsId],
    queryFn: () => api.get<{ userId: string; name: string }[]>("/workspaces/members", { workspaceId: wsId }, wsId),
    enabled: open && Boolean(wsId),
    staleTime: 60_000,
  });
  const contactQuery = useQuery({
    queryKey: ["contact-options", wsId],
    queryFn: () => api.get<Paginated<Contact>>("/contacts", { pageSize: 100, sort: "name", dir: "asc" }, wsId),
    enabled: open && Boolean(wsId),
    staleTime: 60_000,
  });
  const companyQuery = useQuery({
    queryKey: ["company-options", wsId],
    queryFn: () => api.get<Paginated<Company>>("/companies", { pageSize: 100, sort: "name", dir: "asc" }, wsId),
    enabled: open && Boolean(wsId),
    staleTime: 60_000,
  });

  const [form, setForm] = useState<FormState>(() => emptyState(pipelines[0], defaultStageId));

  useEffect(() => {
    if (!open) return;
    setTitleError("");
    if (deal) {
      setForm({
        title: deal.title,
        value: deal.value ? String(deal.value) : "",
        pipelineId: deal.pipelineId,
        stageId: deal.stageId,
        contactId: deal.contactId ?? "",
        companyId: deal.companyId ?? "",
        ownerId: deal.ownerId ?? "",
        expectedCloseDate: isoToDateInput(deal.expectedCloseDate, tz),
        priority: deal.priority,
        description: deal.description ?? "",
      });
    } else {
      // When creating from a specific stage's "+", prefer the pipeline that owns it.
      const preferred = defaultStageId
        ? pipelines.find((p) => p.stages.some((s) => s.id === defaultStageId)) ??
          pipelines.find((p) => p.isDefault) ??
          pipelines[0]
        : pipelines.find((p) => p.isDefault) ?? pipelines[0];
      setForm(emptyState(preferred, defaultStageId));
    }
  }, [open, deal?.id, defaultStageId]);

  const selectedPipeline = useMemo(
    () => pipelines.find((p) => p.id === form.pipelineId) ?? null,
    [pipelines, form.pipelineId]
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) {
      setTitleError(t("validation.titleRequired"));
      return;
    }
    const value = parseLocalizedNumber(form.value) ?? 0;
    setSaving(true);
    try {
      const common = {
        title,
        value,
        pipelineId: form.pipelineId || undefined,
        stageId: form.stageId || undefined,
        contactId: form.contactId || "",
        companyId: form.companyId || "",
        ownerId: form.ownerId || "",
        expectedCloseDate: form.expectedCloseDate ? dateInputToIso(form.expectedCloseDate, tz) : null,
        priority: form.priority,
        description: form.description || "",
      };
      if (deal) {
        await api.patch(`/deals/${deal.id}`, { workspaceId: wsId, ...common }, wsId);
        success("deals.updatedToast");
        qc.invalidateQueries({ queryKey: ["deals"] });
        qc.invalidateQueries({ queryKey: ["deal", wsId] });
      } else {
        await api.post("/deals", { workspaceId: wsId, ...common }, wsId);
        success("deals.createdToast");
        qc.invalidateQueries({ queryKey: ["deals"] });
      }
      onOpenChange(false);
    } catch (err) {
      apiError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <EntityFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={deal ? t("deals.editTitle") : t("deals.createTitle")}
      loading={saving}
      onSubmit={onSubmit}
      wide
    >
      <div className="space-y-1.5">
        <Label htmlFor="deal-title">{t("common.title")} *</Label>
        <Input
          id="deal-title"
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          aria-invalid={Boolean(titleError)}
        />
        {titleError ? <p className="text-xs text-destructive">{titleError}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="deal-value">{t("common.value")}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="deal-value"
              inputMode="decimal"
              value={form.value}
              onChange={(e) => set("value", e.target.value)}
              placeholder="0"
            />
            <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
              {currency}
            </span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal-priority">{t("common.priority")}</Label>
          <Select value={form.priority} onValueChange={(v) => set("priority", v as Priority)}>
            <SelectTrigger id="deal-priority" aria-label={t("common.priority")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`enums.priority.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("deals.field.pipeline")}</Label>
          <Select
            value={form.pipelineId}
            onValueChange={(v) => {
              const p = pipelines.find((x) => x.id === v);
              const firstOpen = p?.stages.find((s) => s.type === "OPEN") ?? p?.stages[0];
              setForm((f) => ({ ...f, pipelineId: v, stageId: firstOpen?.id ?? "" }));
            }}
          >
            <SelectTrigger aria-label={t("deals.field.pipeline")}>
              <SelectValue placeholder={t("common.selectPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("deals.field.stage")}</Label>
          <Select value={form.stageId} onValueChange={(v) => set("stageId", v)}>
            <SelectTrigger aria-label={t("deals.field.stage")}>
              <SelectValue placeholder={t("common.selectPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {(selectedPipeline?.stages ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("deals.field.contact")}</Label>
          <Select value={form.contactId || NONE} onValueChange={(v) => set("contactId", fromSelect(v))}>
            <SelectTrigger aria-label={t("deals.field.contact")}>
              <SelectValue placeholder={t("common.selectPlaceholder")} />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value={NONE}>{t("common.none")}</SelectItem>
              {(contactQuery.data?.items ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("deals.field.company")}</Label>
          <Select value={form.companyId || NONE} onValueChange={(v) => set("companyId", fromSelect(v))}>
            <SelectTrigger aria-label={t("deals.field.company")}>
              <SelectValue placeholder={t("common.selectPlaceholder")} />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value={NONE}>{t("common.none")}</SelectItem>
              {(companyQuery.data?.items ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("common.owner")}</Label>
          <Select value={form.ownerId || NONE} onValueChange={(v) => set("ownerId", fromSelect(v))}>
            <SelectTrigger aria-label={t("common.owner")}>
              <SelectValue placeholder={t("common.selectPlaceholder")} />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value={NONE}>{t("common.none")}</SelectItem>
              {(memberQuery.data ?? []).map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal-close-date">{t("deals.field.expectedCloseDate")}</Label>
          <Input
            id="deal-close-date"
            type="date"
            value={form.expectedCloseDate}
            onChange={(e) => set("expectedCloseDate", e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="deal-description">{t("common.description")}</Label>
        <Textarea
          id="deal-description"
          rows={3}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>
    </EntityFormDialog>
  );
}
