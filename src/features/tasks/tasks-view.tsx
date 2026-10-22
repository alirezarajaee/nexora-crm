"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  Handshake,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";
import {
  useApiToast,
  useLocaleTz,
  useWorkspaceId,
} from "@/hooks/use-workspace";
import { useAppStore } from "@/store/app-store";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { PriorityBadge } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatDateTime,
  formatNumber,
} from "@/lib/format";
import type { Paginated, Task } from "@/types/api";
import {
  todayKey,
  todayStartIso,
  tomorrowStartIso,
  zonedDayKey,
} from "@/features/tasks/time-utils";
import { TaskFormDialog } from "@/features/tasks/task-form-dialog";

type SectionKey = "overdue" | "today" | "upcoming" | "done";
const SECTIONS: SectionKey[] = ["overdue", "today", "upcoming", "done"];

export function TasksView() {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const viewParams = useAppStore((s) => s.viewParams);
  const wsId = useWorkspaceId();
  const tz = useLocaleTz();
  const { apiError } = useApiToast();
  const qc = useQueryClient();

  const [view, setView] = useState<"list" | "board">("list");
  const [section, setSection] = useState<SectionKey>("today");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [completingIds, setCompletingIds] = useState<string[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // Deep-link auto-open runs once per taskId (query refetches must not re-open dialogs).
  const autoOpenedRef = useRef<string | null>(null);

  // One server round-trip per status; sections are grouped client-side.
  const openQuery = useQuery({
    queryKey: ["tasks", wsId, "open"],
    queryFn: () =>
      api.get<Paginated<Task>>("/tasks", { status: "OPEN", pageSize: 200, sort: "dueAt", dir: "asc" }, wsId),
    enabled: Boolean(wsId),
  });
  const doneQuery = useQuery({
    queryKey: ["tasks", wsId, "done"],
    queryFn: () => {
      const from = new Date(Date.now() - 30 * 86400000).toISOString();
      const to = new Date(Date.now() + 60 * 86400000).toISOString();
      return api.get<Paginated<Task>>(
        "/tasks",
        { status: "DONE", dueFrom: from, dueTo: to, pageSize: 200, sort: "dueAt", dir: "desc" },
        wsId
      );
    },
    enabled: Boolean(wsId),
  });

  const openTasks = openQuery.data?.items ?? [];
  const doneTasks = doneQuery.data?.items ?? [];

  const tStart = todayStartIso(tz);
  const tEnd = tomorrowStartIso(tz);

  const sections = useMemo(() => {
    const overdue: Task[] = [];
    const today: Task[] = [];
    const upcoming: Task[] = [];
    for (const task of openTasks) {
      if (!task.dueAt) {
        upcoming.push(task);
        continue;
      }
      if (task.dueAt < tStart) overdue.push(task);
      else if (task.dueAt < tEnd) today.push(task);
      else upcoming.push(task);
    }
    upcoming.sort((a, b) => {
      if (!a.dueAt && !b.dueAt) return a.title.localeCompare(b.title);
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return a.dueAt.localeCompare(b.dueAt);
    });
    const done = [...doneTasks].sort((a, b) =>
      (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt)
    );
    return { overdue, today, upcoming, done } as Record<SectionKey, Task[]>;
  }, [openTasks, doneTasks, tStart, tEnd]);

  // Deep-link: viewParams.taskId → open edit dialog + highlight row.
  useEffect(() => {
    const id = viewParams.taskId;
    if (!id || autoOpenedRef.current === id) return;
    const known =
      openQuery.data?.items.find((task) => task.id === id) ??
      doneQuery.data?.items.find((task) => task.id === id);
    if (known) {
      autoOpenedRef.current = id;
      setHighlightId(id);
      setEditing(known);
      setFormOpen(true);
    } else if (openQuery.data && doneQuery.data) {
      autoOpenedRef.current = id;
      setHighlightId(id);
      api
        .get<Task>(`/tasks/${id}`, undefined, wsId)
        .then((task) => {
          setEditing(task);
          setFormOpen(true);
        })
        .catch(() => undefined);
    }
  }, [viewParams.taskId, openQuery.data, doneQuery.data]);

  const invalidateTasks = () => {
    qc.invalidateQueries({ queryKey: ["tasks", wsId] });
    qc.invalidateQueries({ queryKey: ["calendar-tasks"] });
  };

  const toggleComplete = async (task: Task) => {
    const next = task.status === "DONE" ? "OPEN" : "DONE";
    setCompletingIds((ids) => [...ids, task.id]);
    try {
      await api.patch(`/tasks/${task.id}`, { workspaceId: wsId, status: next }, wsId);
      toast.success(t(next === "DONE" ? "tasks.completedToast" : "tasks.reopenedToast"));
      invalidateTasks();
    } catch (err) {
      apiError(err);
    } finally {
      setCompletingIds((ids) => ids.filter((x) => x !== task.id));
    }
  };

  const removeTask = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/tasks/${deleting.id}`, undefined, wsId);
      toast.success(t("tasks.deletedToast"));
      setDeleting(null);
      invalidateTasks();
    } catch (err) {
      apiError(err);
    } finally {
      setDeleteBusy(false);
    }
  };

  const openEdit = (task: Task) => {
    setEditing(task);
    setFormOpen(true);
  };

  const relatedName = (task: Task): string | null =>
    task.deal?.title ?? task.contact?.name ?? task.company?.name ?? task.lead?.name ?? null;

  const dueChip = (task: Task) => {
    if (!task.dueAt) {
      return (
        <span className="text-xs text-muted-foreground">{t("time.noDueDate")}</span>
      );
    }
    const key = zonedDayKey(task.dueAt, tz);
    const overdue = task.status === "OPEN" && key < todayKey(tz);
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${
          overdue
            ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
            : "border-border bg-muted/50 text-muted-foreground"
        }`}
      >
        <CalendarClock className="h-3 w-3" aria-hidden="true" />
        {formatDateTime(task.dueAt, locale, tz)}
        {overdue ? t("time.overdue") : null}
      </span>
    );
  };

  const loading = openQuery.isLoading || doneQuery.isLoading;
  const error = openQuery.isError || doneQuery.isError;
  const allEmpty = openTasks.length === 0 && doneTasks.length === 0;

  const relatedIcon = (task: Task) =>
    task.deal ? (
      <Handshake className="h-3 w-3 shrink-0" aria-hidden="true" />
    ) : task.company ? (
      <Building2 className="h-3 w-3 shrink-0" aria-hidden="true" />
    ) : (
      <User className="h-3 w-3 shrink-0" aria-hidden="true" />
    );

  const TaskRow = ({ task }: { task: Task }) => {
    const done = task.status === "DONE";
    const completing = completingIds.includes(task.id);
    return (
      <div
        className={`flex items-start gap-3 px-3 py-3 transition-colors hover:bg-muted/40 sm:items-center ${
          highlightId === task.id ? "ring-1 ring-inset ring-primary/50 bg-primary/5" : ""
        }`}
      >
        <Checkbox
          checked={done}
          onCheckedChange={() => toggleComplete(task)}
          disabled={completing}
          className="mt-0.5 h-5 w-5 sm:mt-0"
          aria-label={t(done ? "tasks.actions.reopen" : "tasks.actions.complete")}
        />
        <button
          type="button"
          onClick={() => openEdit(task)}
          className="min-w-0 flex-1 text-start"
          aria-label={`${t("common.edit")} — ${task.title}`}
        >
          <span
            className={`block truncate text-sm font-medium ${done ? "text-muted-foreground line-through" : ""}`}
          >
            {task.title}
            {task.recurrence ? (
              <Repeat className="ms-1.5 inline h-3 w-3 text-muted-foreground" aria-hidden="true" />
            ) : null}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {dueChip(task)}
            {task.assignee ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <User className="h-3 w-3" aria-hidden="true" />
                {task.assignee.name}
              </span>
            ) : null}
            {relatedName(task) ? (
              <span className="inline-flex max-w-40 items-center gap-1 truncate text-xs text-muted-foreground">
                {relatedIcon(task)}
                <span className="truncate">{relatedName(task)}</span>
              </span>
            ) : null}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="hidden sm:block">
            <PriorityBadge priority={task.priority} />
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => openEdit(task)}
            aria-label={`${t("common.edit")} — ${task.title}`}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-destructive hover:bg-destructive/10"
            onClick={() => setDeleting(task)}
            aria-label={`${t("common.delete")} — ${task.title}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  };

  const SectionColumn = ({ id }: { id: SectionKey }) => {
    const tasks = sections[id];
    return (
      <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-muted/30">
        <header className="flex items-center justify-between gap-2 px-3 pb-1 pt-3">
          <p className="truncate text-sm font-bold">
            {t(`tasks.sections.${id}`)}
          </p>
          <Badge variant="secondary" className="shrink-0">
            {formatNumber(tasks.length, locale)}
          </Badge>
        </header>
        <div className="flex max-h-[60vh] min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto p-2 nx-kanban-scroll">
          {tasks.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t("common.noData")}</p>
          ) : (
            tasks.map((task) => {
              const done = task.status === "DONE";
              const completing = completingIds.includes(task.id);
              const overdue = !done && task.dueAt && zonedDayKey(task.dueAt, tz) < todayKey(tz);
              return (
                <div
                  key={task.id}
                  className={`rounded-xl border border-border bg-card p-2.5 nx-card-hover ${
                    overdue ? "border-s-2 border-s-red-500" : ""
                  } ${highlightId === task.id ? "ring-1 ring-primary/50" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={done}
                      onCheckedChange={() => toggleComplete(task)}
                      disabled={completing}
                      className="mt-0.5 h-5 w-5"
                      aria-label={t(done ? "tasks.actions.reopen" : "tasks.actions.complete")}
                    />
                    <button
                      type="button"
                      onClick={() => openEdit(task)}
                      className="min-w-0 flex-1 text-start"
                      aria-label={`${t("common.viewDetails")} — ${task.title}`}
                    >
                      <span
                        className={`block truncate text-sm font-medium ${done ? "text-muted-foreground line-through" : ""}`}
                      >
                        {task.title}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        {dueChip(task)}
                        <PriorityBadge priority={task.priority} />
                      </span>
                      {relatedName(task) ? (
                        <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                          {relatedIcon(task)}
                          <span className="truncate">{relatedName(task)}</span>
                        </span>
                      ) : null}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("nav.tasks")}
        subtitle={t("tasks.subtitle")}
        actions={
          <>
            <Tabs value={view} onValueChange={(v) => setView(v as "list" | "board")}>
              <TabsList>
                <TabsTrigger value="list">{t("tasks.views.list")}</TabsTrigger>
                <TabsTrigger value="board">{t("tasks.views.board")}</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("tasks.createTitle")}
            </Button>
          </>
        }
      />

      {view === "list" ? (
        <Tabs value={section} onValueChange={(v) => setSection(v as SectionKey)}>
          <TabsList className="flex w-full max-w-xl justify-start overflow-x-auto">
            {SECTIONS.map((id) => (
              <TabsTrigger key={id} value={id} className="gap-1.5">
                {t(`tasks.sections.${id}`)}
                <Badge variant="secondary" className="px-1.5 text-[10px]">
                  {formatNumber(sections[id].length, locale)}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 w-full animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      ) : error ? (
        <ErrorState
          title={t("errors.generic")}
          retryLabel={t("common.retry")}
          onRetry={() => {
            openQuery.refetch();
            doneQuery.refetch();
          }}
        />
      ) : allEmpty ? (
        <EmptyState
          title={t("common.noData")}
          description={t("tasks.empty")}
          action={
            <Button
              size="sm"
              className="h-9"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("tasks.createTitle")}
            </Button>
          }
        />
      ) : view === "list" ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {sections[section].length === 0 ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {t("common.noData")}
            </p>
          ) : (
            <div className="divide-y divide-border">
              {sections[section].map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {SECTIONS.map((id) => (
            <SectionColumn key={id} id={id} />
          ))}
        </div>
      )}

      <TaskFormDialog
        open={formOpen}
        onOpenChange={(next) => {
          setFormOpen(next);
          if (!next) {
            setEditing(null);
            setHighlightId(null);
          }
        }}
        task={editing}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        title={t("common.deleteConfirmTitle")}
        description={t("common.deleteConfirmDescription", { name: deleting?.title ?? "" })}
        confirmLabel={t("common.delete")}
        loading={deleteBusy}
        destructive
        onConfirm={removeTask}
      />
    </div>
  );
}
