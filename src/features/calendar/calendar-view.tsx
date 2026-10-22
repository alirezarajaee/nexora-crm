"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Info,
  Pencil,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";
import { useApiToast, useLocaleTz, useWorkspaceId } from "@/hooks/use-workspace";
import { useAppStore } from "@/store/app-store";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/states";
import { PriorityBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { Paginated, Task } from "@/types/api";
import {
  PRIORITY_DOT,
  calDayOf,
  dayKeyToEndIso,
  dayKeyToStartIso,
  dayNumber,
  fullDayTitle,
  monthGrid,
  monthTitle,
  todayKey,
  weekdayHeaders,
  weekdayShortOf,
  weekDays,
  zonedDayKey,
  type CalDay,
} from "@/features/tasks/time-utils";
import { TaskFormDialog } from "@/features/tasks/task-form-dialog";

type Mode = "month" | "week" | "day";

export function CalendarView() {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const wsId = useWorkspaceId();
  const tz = useLocaleTz();
  const { apiError } = useApiToast();
  const qc = useQueryClient();

  const [mode, setMode] = useState<Mode>("month");
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [completingIds, setCompletingIds] = useState<string[]>([]);

  const days = useMemo<CalDay[]>(() => {
    if (mode === "month") return monthGrid(anchor, locale);
    if (mode === "week") return weekDays(anchor, locale);
    return [calDayOf(anchor)];
  }, [mode, anchor, locale]);

  const rangeStartKey = days[0]?.key ?? todayKey(tz);
  const rangeEndKey = days[days.length - 1]?.key ?? rangeStartKey;

  const tasksQuery = useQuery({
    queryKey: ["calendar-tasks", wsId, mode, rangeStartKey, rangeEndKey],
    queryFn: () =>
      api.get<Paginated<Task>>(
        "/tasks",
        {
          dueFrom: dayKeyToStartIso(rangeStartKey, tz),
          dueTo: dayKeyToEndIso(rangeEndKey, tz),
          pageSize: 200,
          sort: "dueAt",
          dir: "asc",
        },
        wsId
      ),
    enabled: Boolean(wsId),
  });

  // Overdue OPEN tasks (due before today) — shown in the strip above the grid.
  const overdueQuery = useQuery({
    queryKey: ["tasks", wsId, "overdue-strip"],
    queryFn: () =>
      api.get<Paginated<Task>>("/tasks", { overdue: true, pageSize: 50, sort: "dueAt", dir: "asc" }, wsId),
    enabled: Boolean(wsId),
  });

  const tasks = tasksQuery.data?.items ?? [];
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const day of days) map.set(day.key, []);
    for (const task of tasks) {
      if (!task.dueAt) continue;
      const key = zonedDayKey(task.dueAt, tz); // workspace-tz calendar day
      map.get(key)?.push(task);
    }
    return map;
  }, [tasks, days, tz]);

  const today = todayKey(tz);
  const isRtl = locale === "fa";
  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;
  const headers = weekdayHeaders(locale);

  const navigate = (dir: -1 | 1) => {
    setAnchor((a) => {
      if (mode === "month") return new Date(a.getFullYear(), a.getMonth() + dir, 1);
      if (mode === "week") return new Date(a.getFullYear(), a.getMonth(), a.getDate() + dir * 7);
      return new Date(a.getFullYear(), a.getMonth(), a.getDate() + dir);
    });
  };

  const title = useMemo(() => {
    if (mode === "month") return monthTitle(anchor, locale);
    if (mode === "week") {
      const start = days[0];
      const end = days[days.length - 1];
      if (!start || !end) return "";
      return `${formatDayLabel(start, locale)} — ${formatDayLabel(end, locale)}`;
    }
    return fullDayTitle(days[0] ?? calDayOf(anchor), locale);
  }, [mode, anchor, locale, days]);

  const selectedTasks = selectedKey ? byDay.get(selectedKey) ?? [] : [];
  const overdueTasks = overdueQuery.data?.items ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["calendar-tasks", wsId] });
    qc.invalidateQueries({ queryKey: ["tasks", wsId] });
  };

  const toggleComplete = async (task: Task) => {
    const next = task.status === "DONE" ? "OPEN" : "DONE";
    setCompletingIds((ids) => [...ids, task.id]);
    try {
      await api.patch(`/tasks/${task.id}`, { workspaceId: wsId, status: next }, wsId);
      toast.success(t(next === "DONE" ? "tasks.completedToast" : "tasks.reopenedToast"));
      invalidate();
    } catch (err) {
      apiError(err);
    } finally {
      setCompletingIds((ids) => ids.filter((x) => x !== task.id));
    }
  };

  const MiniTask = ({ task, compact }: { task: Task; compact?: boolean }) => {
    const done = task.status === "DONE";
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(task);
          setFormOpen(true);
        }}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-start hover:bg-primary/10",
          done && "opacity-55"
        )}
        aria-label={`${task.title} — ${t("common.edit")}`}
      >
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])} aria-hidden="true" />
        <span className={cn("truncate text-[11px]", done ? "line-through" : "font-medium")}>
          {task.title}
        </span>
        {compact ? null : (
          <span className="ms-auto shrink-0 text-[10px] text-muted-foreground">
            {formatDateTime(task.dueAt, locale, tz).split(", ").pop()}
          </span>
        )}
      </button>
    );
  };

  const DayCell = ({ day, tall }: { day: CalDay; tall?: boolean }) => {
    const dayTasks = byDay.get(day.key) ?? [];
    const shown = dayTasks.slice(0, 3);
    const rest = dayTasks.length - shown.length;
    const isToday = day.key === today;
    const isSelected = day.key === selectedKey;
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => setSelectedKey(day.key)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setSelectedKey(day.key);
          }
        }}
        className={cn(
          "flex flex-col items-stretch gap-1 rounded-lg border p-1.5 text-start align-top transition-colors",
          day.inMonth ? "border-border bg-card" : "border-transparent bg-muted/20",
          isSelected && "ring-1 ring-primary",
          isToday && "border-primary/60",
          tall ? "min-h-[150px]" : "min-h-[88px] sm:min-h-[104px]"
        )}
        aria-label={`${day.key} — ${formatNumber(dayTasks.length, locale)} ${t("calendar.legendTasks")}`}
        aria-pressed={isSelected}
      >
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
            isToday ? "bg-primary text-primary-foreground" : day.inMonth ? "text-foreground" : "text-muted-foreground/60"
          )}
        >
          {dayNumber(day, locale)}
        </span>
        {shown.map((task) => (
          <MiniTask key={task.id} task={task} compact />
        ))}
        {rest > 0 ? (
          <span className="px-1.5 text-[10px] font-semibold text-primary">
            +{formatNumber(rest, locale)}
          </span>
        ) : null}
      </div>
    );
  };

  if (tasksQuery.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("nav.calendar")} subtitle={t("calendar.subtitle")} />
        <ErrorState
          title={t("errors.generic")}
          retryLabel={t("common.retry")}
          onRetry={() => tasksQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("nav.calendar")}
        subtitle={t("calendar.subtitle")}
        actions={
          <>
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <TabsList>
                <TabsTrigger value="day">{t("calendar.day")}</TabsTrigger>
                <TabsTrigger value="week">{t("calendar.week")}</TabsTrigger>
                <TabsTrigger value="month">{t("calendar.month")}</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => navigate(-1)} aria-label={t("calendar.prev")}>
                <PrevIcon className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button variant="outline" size="sm" className="h-9" onClick={() => setAnchor(new Date())}>
                {t("calendar.today")}
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => navigate(1)} aria-label={t("calendar.next")}>
                <NextIcon className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
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

      {/* Overdue strip */}
      {overdueTasks.length > 0 ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2"
        >
          <span className="flex items-center gap-1.5 text-sm font-semibold text-red-600 dark:text-red-400">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {t("time.overdue")}
            <Badge variant="outline" className="border-red-500/40 text-red-600 dark:text-red-400">
              {formatNumber(overdueTasks.length, locale)}
            </Badge>
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {overdueTasks.slice(0, 4).map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => {
                  setEditing(task);
                  setFormOpen(true);
                }}
                className="inline-flex max-w-56 items-center gap-1 rounded-md border border-red-500/25 bg-background px-2 py-0.5 text-xs hover:bg-red-500/10"
              >
                <span className="truncate font-medium">{task.title}</span>
                <span className="shrink-0 text-muted-foreground">{formatDateTime(task.dueAt, locale, tz)}</span>
              </button>
            ))}
            {overdueTasks.length > 4 ? (
              <span className="text-xs text-muted-foreground">+{formatNumber(overdueTasks.length - 4, locale)}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
        {t("calendar.timezoneNote")}
      </p>

      {/* Title */}
      <div className="flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-bold">{title}</h2>
        {tasksQuery.isLoading ? (
          <span className="text-xs text-muted-foreground" aria-busy="true">
            {t("common.loading")}
          </span>
        ) : null}
      </div>

      {/* Grid */}
      {mode === "month" ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="grid grid-cols-7 border-b border-border bg-muted/40">
            {headers.map((h) => (
              <div key={h} className="px-2 py-2 text-center text-xs font-semibold text-muted-foreground">
                {h}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 p-1">
            {days.map((day) => <DayCell key={day.key} day={day} />)}
          </div>
        </div>
      ) : mode === "week" ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="grid grid-cols-7 border-b border-border bg-muted/40">
            {days.map((day) => (
              <div key={day.key} className="px-2 py-2 text-center">
                <p className="text-xs text-muted-foreground">{weekdayShortOf(day, locale)}</p>
                <p className={cn("text-sm font-bold", day.key === today && "text-primary")}>
                  {dayNumber(day, locale)}
                </p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-1 p-1 sm:grid-cols-7">
            {days.map((day) => (
              <div
                key={day.key}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedKey(day.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedKey(day.key);
                  }
                }}
                className={cn(
                  "flex min-h-[180px] flex-col gap-1 rounded-lg border p-1.5 text-start",
                  day.key === today ? "border-primary/60" : "border-border"
                )}
                aria-label={`${day.key} — ${formatNumber((byDay.get(day.key) ?? []).length, locale)}`}
              >
                {(byDay.get(day.key) ?? []).slice(0, 5).map((task) => (
                  <MiniTask key={task.id} task={task} />
                ))}
                {(byDay.get(day.key) ?? []).length > 5 ? (
                  <span className="px-1.5 text-[10px] font-semibold text-primary">
                    +{formatNumber((byDay.get(day.key) ?? []).length - 5, locale)}
                  </span>
                ) : null}
                {(byDay.get(day.key) ?? []).length === 0 ? (
                  <span className="mt-auto text-center text-[10px] text-muted-foreground">—</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-3">
          {(byDay.get(days[0]?.key ?? "") ?? []).length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t("calendar.noEvents")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {(byDay.get(days[0]?.key ?? "") ?? []).map((task) => {
                const done = task.status === "DONE";
                const completing = completingIds.includes(task.id);
                return (
                  <li key={task.id} className="flex items-center gap-3 py-2.5">
                    <Checkbox
                      checked={done}
                      onCheckedChange={() => toggleComplete(task)}
                      disabled={completing}
                      className="h-5 w-5"
                      aria-label={t(done ? "tasks.actions.reopen" : "tasks.actions.complete")}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(task);
                        setFormOpen(true);
                      }}
                      className="min-w-0 flex-1 text-start"
                      aria-label={`${t("common.edit")} — ${task.title}`}
                    >
                      <span className={cn("block truncate text-sm font-medium", done && "text-muted-foreground line-through")}>
                        {task.title}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {formatDateTime(task.dueAt, locale, tz)}
                        {task.assignee ? <span>· {task.assignee.name}</span> : null}
                      </span>
                    </button>
                    <PriorityBadge priority={task.priority} />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditing(task);
                        setFormOpen(true);
                      }}
                      aria-label={`${t("common.edit")} — ${task.title}`}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Selected day side panel */}
      <Sheet
        open={Boolean(selectedKey)}
        onOpenChange={(next) => {
          if (!next) setSelectedKey(null);
        }}
      >
        <SheetContent
          side={locale === "fa" ? "left" : "right"}
          className="flex w-full flex-col gap-0 p-0 sm:max-w-sm"
        >
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle className="text-base">
              {selectedKey
                ? fullDayTitle(
                    (() => {
                      const [y, m, d] = selectedKey.split("-").map(Number);
                      return calDayOf(new Date(y, m - 1, d));
                    })(),
                    locale
                  )
                : t("calendar.selectedDay")}
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("calendar.selectedDay")}
            </p>
            {selectedTasks.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("calendar.noEvents")}</p>
            ) : (
              <ul className="space-y-2">
                {selectedTasks.map((task) => {
                  const done = task.status === "DONE";
                  const completing = completingIds.includes(task.id);
                  return (
                    <li
                      key={task.id}
                      className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-3"
                    >
                      <Checkbox
                        checked={done}
                        onCheckedChange={() => toggleComplete(task)}
                        disabled={completing}
                        className="mt-0.5 h-5 w-5"
                        aria-label={t(done ? "tasks.actions.reopen" : "tasks.actions.complete")}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(task);
                          setFormOpen(true);
                        }}
                        className="min-w-0 flex-1 text-start"
                        aria-label={`${t("common.edit")} — ${task.title}`}
                      >
                        <span className={cn("block truncate text-sm font-medium", done && "text-muted-foreground line-through")}>
                          {task.title}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {formatDateTime(task.dueAt, locale, tz)}
                          {task.assignee ? <span>· {task.assignee.name}</span> : null}
                        </span>
                      </button>
                      <PriorityBadge priority={task.priority} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <TaskFormDialog
        open={formOpen}
        onOpenChange={(next) => {
          setFormOpen(next);
          if (!next) setEditing(null);
        }}
        task={editing}
      />
    </div>
  );
}

function formatDayLabel(day: CalDay, locale: "fa" | "en"): string {
  const tag = locale === "fa" ? "fa-IR" : "en-US";
  return new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "UTC" }).format(
    Date.UTC(day.year, day.month, day.date)
  );
}
