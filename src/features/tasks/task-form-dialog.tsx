"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { useWorkspaceId, useApiToast, useLocaleTz, useMemberOptions } from "@/hooks/use-workspace";
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
import type {
  Contact,
  Deal,
  Paginated,
  Priority,
  Task,
} from "@/types/api";
import {
  dateTimeInputToIso,
  isoToDateTimeInput,
} from "@/features/tasks/time-utils";

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH"];
const RECURRENCES = ["NONE", "DAILY", "WEEKLY", "MONTHLY"] as const;
type Recurrence = (typeof RECURRENCES)[number];

// Radix Select forbids empty-string item values; sentinel maps the "None" option to "".
const NONE = "__none__";
const fromSelect = (v: string) => (v === NONE ? "" : v);

interface FormState {
  title: string;
  description: string;
  priority: Priority;
  dueAt: string; // datetime-local value
  assigneeId: string;
  recurrence: Recurrence;
  dealId: string;
  contactId: string;
}

function emptyState(): FormState {
  return {
    title: "",
    description: "",
    priority: "MEDIUM",
    dueAt: "",
    assigneeId: "",
    recurrence: "NONE",
    dealId: "",
    contactId: "",
  };
}

export function TaskFormDialog({
  open,
  onOpenChange,
  task,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task | null; // null → create
}) {
  const { t } = useTranslation();
  const wsId = useWorkspaceId();
  const tz = useLocaleTz();
  const { apiError, success } = useApiToast();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [titleError, setTitleError] = useState("");
  const [form, setForm] = useState<FormState>(emptyState);
  const members = useMemberOptions();

  const dealQuery = useQuery({
    queryKey: ["deal-options", wsId],
    queryFn: () =>
      api.get<Paginated<Deal>>("/deals", { pageSize: 100, sort: "createdAt", dir: "desc" }, wsId),
    enabled: open && Boolean(wsId),
    staleTime: 60_000,
  });
  const contactQuery = useQuery({
    queryKey: ["contact-options", wsId],
    queryFn: () => api.get<Paginated<Contact>>("/contacts", { pageSize: 100, sort: "name", dir: "asc" }, wsId),
    enabled: open && Boolean(wsId),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    setTitleError("");
    if (task) {
      setForm({
        title: task.title,
        description: task.description ?? "",
        priority: task.priority,
        dueAt: isoToDateTimeInput(task.dueAt, tz),
        assigneeId: task.assigneeId ?? "",
        recurrence: (task.recurrence as Recurrence) || "NONE",
        dealId: task.dealId ?? "",
        contactId: task.contactId ?? "",
      });
    } else {
      setForm(emptyState());
    }
  }, [open, task?.id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = form.title.trim();
    if (!title) {
      setTitleError(t("validation.titleRequired"));
      return;
    }
    const dueIso = form.dueAt ? dateTimeInputToIso(form.dueAt, tz) : null;
    setSaving(true);
    try {
      if (task) {
        await api.patch(
          `/tasks/${task.id}`,
          {
            workspaceId: wsId,
            title,
            description: form.description || "",
            priority: form.priority,
            dueAt: dueIso,
            assigneeId: form.assigneeId || null,
            recurrence: form.recurrence,
            dealId: form.dealId || "",
            contactId: form.contactId || "",
          },
          wsId
        );
        success("tasks.updatedToast");
      } else {
        await api.post(
          "/tasks",
          {
            workspaceId: wsId,
            title,
            description: form.description || "",
            priority: form.priority,
            dueAt: dueIso,
            assigneeId: form.assigneeId || "",
            recurrence: form.recurrence,
            dealId: form.dealId || "",
            contactId: form.contactId || "",
          },
          wsId
        );
        success("tasks.createdToast");
      }
      qc.invalidateQueries({ queryKey: ["tasks", wsId] });
      qc.invalidateQueries({ queryKey: ["calendar-tasks"] });
      qc.invalidateQueries({ queryKey: ["deal", wsId] });
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
      title={task ? t("tasks.editTitle") : t("tasks.createTitle")}
      loading={saving}
      onSubmit={onSubmit}
      wide
    >
      <div className="space-y-1.5">
        <Label htmlFor="task-title">{t("common.title")} *</Label>
        <Input
          id="task-title"
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          aria-invalid={Boolean(titleError)}
        />
        {titleError ? <p className="text-xs text-destructive">{titleError}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="task-due">{t("tasks.field.dueAt")}</Label>
          <Input
            id="task-due"
            type="datetime-local"
            value={form.dueAt}
            onChange={(e) => set("dueAt", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("common.priority")}</Label>
          <Select value={form.priority} onValueChange={(v) => set("priority", v as Priority)}>
            <SelectTrigger aria-label={t("common.priority")}>
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
          <Label>{t("common.assignee")}</Label>
          <Select value={form.assigneeId || NONE} onValueChange={(v) => set("assigneeId", fromSelect(v))}>
            <SelectTrigger aria-label={t("common.assignee")}>
              <SelectValue placeholder={t("common.selectPlaceholder")} />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value={NONE}>{t("common.none")}</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("tasks.field.recurrence")}</Label>
          <Select value={form.recurrence} onValueChange={(v) => set("recurrence", v as Recurrence)}>
            <SelectTrigger aria-label={t("tasks.field.recurrence")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RECURRENCES.map((r) => (
                <SelectItem key={r} value={r}>
                  {t(`enums.recurrence.${r}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("nav.deals")}</Label>
          <Select value={form.dealId || NONE} onValueChange={(v) => set("dealId", fromSelect(v))}>
            <SelectTrigger aria-label={t("nav.deals")}>
              <SelectValue placeholder={t("common.selectPlaceholder")} />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value={NONE}>{t("common.none")}</SelectItem>
              {(dealQuery.data?.items ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("nav.contacts")}</Label>
          <Select value={form.contactId || NONE} onValueChange={(v) => set("contactId", fromSelect(v))}>
            <SelectTrigger aria-label={t("nav.contacts")}>
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
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="task-description">{t("common.description")}</Label>
        <Textarea
          id="task-description"
          rows={3}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>
    </EntityFormDialog>
  );
}
