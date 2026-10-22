"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronsLeftRight,
  GripVertical,
  Loader2,
  Plus,
  Settings2,
  TrendingUp,
  User,
  XCircle,
} from "lucide-react";
import { api, ApiRequestError } from "@/lib/client-api";
import { toast } from "sonner";
import {
  useApiToast,
  useLocaleTz,
  useMemberMap,
  useWorkspaceCurrency,
  useWorkspaceId,
  useWorkspaceRole,
} from "@/hooks/use-workspace";
import { useAppStore } from "@/store/app-store";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { SearchInput, MultiSelectFilter, FilterBar, ArchivedToggle } from "@/components/shared/filters";
import { PriorityBadge, TagBadges } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatCompact,
  formatMoney,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { zonedDayKey, todayKey } from "@/features/tasks/time-utils";
import { DealFormDialog } from "@/features/deals/deal-form-dialog";
import { DealDetailSheet } from "@/features/deals/deal-detail-sheet";
import { StagesManagerDialog } from "@/features/deals/stages-manager-dialog";
import type { Deal, Paginated, Pipeline, Priority, SalesReport, Stage } from "@/types/api";

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH"];

function moneyCompact(value: number, locale: "fa" | "en", currency: string): string {
  if (Math.abs(value) >= 100_000) return `${formatCompact(value, locale)} ${currency}`;
  return formatMoney(value, locale, currency);
}

function stageTone(type: Stage["type"]): string {
  if (type === "WON") return "text-emerald-600 dark:text-emerald-400";
  if (type === "LOST") return "text-red-600 dark:text-red-400";
  return "text-foreground";
}

// ---------- Deal card ----------

function DealCard({
  deal,
  onOpen,
  dragging,
  overlay,
}: {
  deal: Deal;
  onOpen: (id: string) => void;
  dragging?: boolean;
  overlay?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const tz = useLocaleTz();
  const currency = useWorkspaceCurrency();

  const dueKey = deal.expectedCloseDate ? zonedDayKey(deal.expectedCloseDate, tz) : "";
  const overdue = Boolean(dueKey && dueKey < todayKey(tz) && deal.stage?.type === "OPEN");

  return (
    <div
      className={`group rounded-xl border border-border bg-card p-3 transition-shadow nx-card-hover ${
        overlay ? "rotate-1 shadow-xl ring-1 ring-primary/40" : ""
      }`}
      role={overlay ? undefined : "button"}
      tabIndex={overlay ? undefined : 0}
      aria-label={deal.title}
      onClick={overlay ? undefined : () => onOpen(deal.id)}
      onKeyDown={
        overlay
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(deal.id);
              }
            }
      }
    >
      <div className="flex items-start gap-1.5">
        <GripVertical
          className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 ${dragging ? "" : "group-hover:text-muted-foreground"}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{deal.title}</p>
          <p className="mt-1 text-sm font-bold text-primary">
            {formatMoney(deal.value, locale, deal.currency || currency)}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={deal.priority} />
        {dueKey ? (
          <span
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${
              overdue
                ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
                : "border-border bg-muted/50 text-muted-foreground"
            }`}
          >
            <CalendarClock className="h-3 w-3" aria-hidden="true" />
            {dueKey}
            {overdue ? <span className="sr-only">{t("time.overdue")}</span> : null}
          </span>
        ) : null}
      </div>

      {(deal.contact || deal.company) && (
        <p className="mt-1.5 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
          {deal.contact ? (
            <>
              <User className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{deal.contact.name}</span>
            </>
          ) : null}
          {deal.contact && deal.company ? <span aria-hidden="true">·</span> : null}
          {deal.company ? (
            <>
              <Building2 className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{deal.company.name}</span>
            </>
          ) : null}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <TagBadges tags={deal.tags} max={2} />
        {deal.owner ? (
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary"
            title={deal.owner.name}
            aria-label={deal.owner.name}
          >
            {deal.owner.name.charAt(0).toUpperCase()}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DraggableDealCard({
  deal,
  onOpen,
}: {
  deal: Deal;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    data: { deal },
  });
  // Suppress the click that browsers fire right after a drag ends.
  const suppressClick = useRef(false);
  useEffect(() => {
    if (isDragging) {
      suppressClick.current = true;
      return;
    }
    const id = window.setTimeout(() => {
      suppressClick.current = false;
    }, 150);
    return () => window.clearTimeout(id);
  }, [isDragging]);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`touch-none ${isDragging ? "opacity-40" : ""}`}
    >
      <DealCard
        deal={deal}
        dragging={isDragging}
        onOpen={(id) => {
          if (!suppressClick.current) onOpen(id);
        }}
      />
    </div>
  );
}

// ---------- Stage column ----------

function StageColumn({
  stage,
  deals,
  onOpenDeal,
  onAddDeal,
  locale,
  currency,
}: {
  stage: Stage;
  deals: Deal[];
  onOpenDeal: (id: string) => void;
  onAddDeal: (stageId: string) => void;
  locale: "fa" | "en";
  currency: string;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, data: { stage } });
  const sum = deals.reduce((acc, d) => acc + d.value, 0);

  return (
    <section
      className="flex w-[280px] min-w-[260px] shrink-0 flex-col rounded-2xl border border-border bg-muted/30"
      aria-label={stage.name}
    >
      <header className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <div className="min-w-0">
          <p className={`truncate text-sm font-bold ${stageTone(stage.type)}`}>{stage.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {t("deals.kanban.stageCount", { count: formatNumber(deals.length, locale) })}
            {" · "}
            {moneyCompact(sum, locale, currency)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {stage.type === "WON" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" /> : null}
          {stage.type === "LOST" ? <XCircle className="h-4 w-4 text-red-500" aria-hidden="true" /> : null}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => onAddDeal(stage.id)}
            aria-label={`${t("deals.createTitle")} — ${stage.name}`}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </header>
      <div
        ref={setNodeRef}
        className={`flex min-h-[120px] max-h-[calc(100dvh-300px)] flex-1 flex-col gap-2 overflow-y-auto rounded-b-2xl px-2 pb-2 nx-kanban-scroll ${
          isOver ? "bg-primary/5 ring-1 ring-inset ring-primary/30" : ""
        }`}
      >
        {deals.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">{t("deals.kanban.emptyStage")}</p>
        ) : (
          deals.map((deal) => (
            <DraggableDealCard key={deal.id} deal={deal} onOpen={onOpenDeal} />
          ))
        )}
      </div>
    </section>
  );
}

// ---------- Main view ----------

export function DealsView() {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const viewParams = useAppStore((s) => s.viewParams);
  const wsId = useWorkspaceId();
  const role = useWorkspaceRole();
  const tz = useLocaleTz();
  const currency = useWorkspaceCurrency();
  const { apiError } = useApiToast();
  const qc = useQueryClient();
  const canManage = role === "OWNER" || role === "ADMIN";

  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState("");
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [formDefaultStage, setFormDefaultStage] = useState<string | undefined>(undefined);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [pipelineDialogOpen, setPipelineDialogOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creatingPipeline, setCreatingPipeline] = useState(false);
  const [forecastOpen, setForecastOpen] = useState(false);
  const [pendingLost, setPendingLost] = useState<{ dealId: string; stage: Stage } | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [moving, setMoving] = useState(false);

  // Deep-link support: viewParams.dealId opens the detail sheet on mount.
  useEffect(() => {
    if (viewParams.dealId) setDetailId(viewParams.dealId);
  }, [viewParams.dealId]);

  const pipelinesQuery = useQuery({
    queryKey: ["pipelines", wsId],
    queryFn: () => api.get<Pipeline[]>("/pipelines", { workspaceId: wsId }, wsId),
    enabled: Boolean(wsId),
  });
  const pipelines = useMemo(() => pipelinesQuery.data ?? [], [pipelinesQuery.data]);

  useEffect(() => {
    if (pipelines.length === 0) return;
    if (!pipelines.some((p) => p.id === selectedPipelineId)) {
      setSelectedPipelineId(pipelines.find((p) => p.isDefault)?.id ?? pipelines[0].id);
    }
  }, [pipelines, selectedPipelineId]);

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId) ?? null;
  const boardKey = ["deals", wsId, selectedPipelineId, archived] as const;

  const dealsQuery = useQuery({
    queryKey: boardKey,
    queryFn: () =>
      api.get<Paginated<Deal>>(
        "/deals",
        { pipelineId: selectedPipelineId, archived, pageSize: 200, sort: "lastActivityAt", dir: "desc" },
        wsId
      ),
    enabled: Boolean(wsId && selectedPipelineId),
  });

  const memberMap = useMemberMap();

  // Forecast (fetched lazily when the popover opens)
  const salesQuery = useQuery({
    queryKey: ["sales-forecast", wsId, selectedPipelineId],
    queryFn: () =>
      api.get<SalesReport>(
        "/reports/sales",
        {
          pipelineId: selectedPipelineId || undefined,
          from: new Date(Date.now() - 3650 * 86400000).toISOString(),
          to: new Date(Date.now() + 365 * 86400000).toISOString(),
        },
        wsId
      ),
    enabled: forecastOpen && Boolean(wsId),
    staleTime: 60_000,
  });

  const allDeals = dealsQuery.data?.items ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allDeals.filter((d) => {
      if (ownerIds.length && (!d.ownerId || !ownerIds.includes(d.ownerId))) return false;
      if (priorities.length && !priorities.includes(d.priority)) return false;
      if (needle) {
        const hay = `${d.title} ${d.contact?.name ?? ""} ${d.company?.name ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [allDeals, ownerIds, priorities, q]);

  const byStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const s of selectedPipeline?.stages ?? []) map.set(s.id, []);
    for (const d of filtered) {
      const arr = map.get(d.stageId);
      if (arr) arr.push(d);
      else map.set(d.stageId, [d]);
    }
    return map;
  }, [filtered, selectedPipeline]);

  // Forecast client-side numbers from the loaded board
  const openPipelineValue = filtered
    .filter((d) => d.stage?.type === "OPEN")
    .reduce((acc, d) => acc + d.value, 0);
  const thisMonthKey = todayKey(tz).slice(0, 7);
  const nextMonthDate = new Date();
  nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
  const nextMonthKey = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const closingThisMonth = filtered
    .filter((d) => d.stage?.type === "OPEN" && d.expectedCloseDate && zonedDayKey(d.expectedCloseDate, tz).slice(0, 7) === thisMonthKey)
    .reduce((acc, d) => acc + d.value, 0);
  const closingNextMonth = filtered
    .filter((d) => d.stage?.type === "OPEN" && d.expectedCloseDate && zonedDayKey(d.expectedCloseDate, tz).slice(0, 7) === nextMonthKey)
    .reduce((acc, d) => acc + d.value, 0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const moveDeal = async (dealId: string, stage: Stage, reason?: string) => {
    const snapshot = qc.getQueryData(boardKey);
    // Optimistic update
    qc.setQueryData<Paginated<Deal>>(boardKey, (old) =>
      old
        ? {
            ...old,
            items: old.items.map((d) =>
              d.id === dealId
                ? {
                    ...d,
                    stageId: stage.id,
                    stage,
                    probability: stage.probability,
                    actualCloseDate: stage.type === "OPEN" ? null : d.actualCloseDate,
                    lostReason: stage.type === "LOST" ? (reason ?? d.lostReason) : d.lostReason,
                  }
                : d
            ),
          }
        : old
    );
    setMoving(true);
    try {
      await api.patch(
        `/deals/${dealId}`,
        {
          workspaceId: wsId,
          stageId: stage.id,
          ...(stage.type === "LOST" ? { lostReason: reason ?? "" } : {}),
        },
        wsId
      );
      if (stage.type === "WON") toast.success(t("deals.actions.wonToast"));
      else if (stage.type === "LOST") toast.success(t("deals.actions.lostToast"));
      else toast.success(t("deals.actions.stageChangedToast"));
    } catch (err) {
      if (snapshot) qc.setQueryData(boardKey, snapshot);
      if (err instanceof ApiRequestError) apiError(err);
      else apiError(err);
    } finally {
      setMoving(false);
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["deal", wsId, dealId] });
      qc.invalidateQueries({ queryKey: ["sales-forecast", wsId] });
    }
  };

  const onDragStart = (e: DragStartEvent) => {
    const deal = (e.active.data.current as { deal?: Deal } | undefined)?.deal;
    if (deal) setActiveDeal(deal);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const deal = (e.active.data.current as { deal?: Deal } | undefined)?.deal ?? activeDeal;
    setActiveDeal(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId || !deal || moving) return;
    const target = selectedPipeline?.stages.find((s) => s.id === overId);
    if (!target || target.id === deal.stageId) return;
    if (target.type === "LOST") {
      setLostReason("");
      setPendingLost({ dealId: deal.id, stage: target });
      return;
    }
    void moveDeal(deal.id, target);
  };

  const openForm = (deal: Deal | null, stageId?: string) => {
    setEditingDeal(deal);
    setFormDefaultStage(stageId);
    setFormOpen(true);
  };

  const createPipeline = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newPipelineName.trim();
    if (!name) return;
    setCreatingPipeline(true);
    try {
      const created = await api.post<Pipeline>("/pipelines", { workspaceId: wsId, name }, wsId);
      toast.success(t("pipelines.pipelineCreated"));
      setPipelineDialogOpen(false);
      setNewPipelineName("");
      qc.invalidateQueries({ queryKey: ["pipelines", wsId] });
      setSelectedPipelineId(created.id);
    } catch (err) {
      apiError(err);
    } finally {
      setCreatingPipeline(false);
    }
  };

  const confirmLost = () => {
    if (!pendingLost) return;
    void moveDeal(pendingLost.dealId, pendingLost.stage, lostReason.trim());
    setPendingLost(null);
  };

  const ownerOptions = useMemo(
    () => Array.from(memberMap.values()).map((m) => ({ value: m.userId, label: m.name })),
    [memberMap]
  );

  const forecastRow = (label: string, value: string, strong?: boolean) => (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-bold text-primary" : "font-semibold"}>{value}</span>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <PageHeader
        title={t("nav.deals")}
        subtitle={t("deals.subtitle")}
        actions={
          <>
            <Popover open={forecastOpen} onOpenChange={setForecastOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5">
                  <TrendingUp className="h-4 w-4" aria-hidden="true" />
                  {t("deals.forecast.title")}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <p className="mb-3 text-sm font-bold">{t("deals.forecast.title")}</p>
                {salesQuery.isLoading ? (
                  <div className="flex justify-center py-6" aria-busy="true">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {forecastRow(t("deals.forecast.openPipeline"), moneyCompact(openPipelineValue, locale, currency))}
                    {forecastRow(
                      t("deals.forecast.weightedPipeline"),
                      moneyCompact(salesQuery.data?.weightedPipelineValue ?? 0, locale, currency),
                      true
                    )}
                    {forecastRow(
                      t("deals.forecast.wonRevenue"),
                      moneyCompact(salesQuery.data?.wonValue ?? 0, locale, currency)
                    )}
                    {forecastRow(
                      t("deals.forecast.winRate"),
                      salesQuery.data?.winRate == null ? "—" : formatPercent(salesQuery.data.winRate, locale)
                    )}
                    {forecastRow(
                      t("deals.forecast.avgDealSize"),
                      salesQuery.data?.avgDealSize == null ? "—" : moneyCompact(salesQuery.data.avgDealSize, locale, currency)
                    )}
                    {forecastRow(t("deals.forecast.expectedThisMonth"), moneyCompact(closingThisMonth, locale, currency))}
                    {forecastRow(t("deals.forecast.expectedNextMonth"), moneyCompact(closingNextMonth, locale, currency))}
                    <p className="border-t border-border pt-2 text-[11px] leading-relaxed text-muted-foreground">
                      {t("deals.forecast.forecastNote")}
                    </p>
                  </div>
                )}
              </PopoverContent>
            </Popover>
            <Button size="sm" className="h-9 gap-1.5" onClick={() => openForm(null)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("deals.createTitle")}
            </Button>
          </>
        }
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={selectedPipelineId}
          onValueChange={setSelectedPipelineId}
          disabled={pipelines.length === 0}
        >
          <SelectTrigger className="h-9 w-44 shrink-0" aria-label={t("deals.filters.pipeline")}>
            <SelectValue placeholder={t("deals.filters.pipeline")} />
          </SelectTrigger>
          <SelectContent>
            {pipelines.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? ` · ${t("pipelines.defaultPipeline")}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage ? (
          <>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => setStagesOpen(true)}
              disabled={!selectedPipeline}
              aria-label={t("pipelines.title")}
            >
              <Settings2 className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => setPipelineDialogOpen(true)}
              aria-label={t("pipelines.addPipeline")}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </>
        ) : null}

        <FilterBar className="ms-auto">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder={t("common.search")}
            className="w-full sm:w-52"
          />
          <MultiSelectFilter
            label={t("deals.filters.owner")}
            options={ownerOptions}
            selected={ownerIds}
            onChange={setOwnerIds}
            icon={User}
          />
          <MultiSelectFilter
            label={t("deals.filters.priority")}
            options={PRIORITIES.map((p) => ({ value: p, label: t(`enums.priority.${p}`) }))}
            selected={priorities}
            onChange={setPriorities}
            icon={ChevronsLeftRight}
          />
          <ArchivedToggle value={archived} onChange={setArchived} />
        </FilterBar>
      </div>

      {/* Board */}
      {pipelinesQuery.isLoading ? (
        <LoadingState rows={4} />
      ) : pipelinesQuery.isError ? (
        <ErrorState
          title={t("errors.generic")}
          retryLabel={t("common.retry")}
          onRetry={() => pipelinesQuery.refetch()}
        />
      ) : pipelines.length === 0 ? (
        <EmptyState
          title={t("common.noData")}
          description={canManage ? t("pipelines.addPipeline") : undefined}
          action={
            canManage ? (
              <Button size="sm" className="h-9" onClick={() => setPipelineDialogOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("pipelines.addPipeline")}
              </Button>
            ) : undefined
          }
        />
      ) : dealsQuery.isLoading ? (
        <LoadingState rows={4} />
      ) : dealsQuery.isError ? (
        <ErrorState
          title={t("errors.generic")}
          retryLabel={t("common.retry")}
          onRetry={() => dealsQuery.refetch()}
        />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveDeal(null)}
        >
          <div className="nx-kanban-scroll -mx-1 flex min-h-0 flex-1 gap-3 overflow-x-auto px-1 pb-2">
            {(selectedPipeline?.stages ?? []).map((stage) => (
              <StageColumn
                key={stage.id}
                stage={stage}
                locale={locale}
                currency={currency}
                deals={byStage.get(stage.id) ?? []}
                onOpenDeal={setDetailId}
                onAddDeal={(stageId) => openForm(null, stageId)}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
            {activeDeal ? (
              <div className="w-[260px]">
                <DealCard deal={activeDeal} onOpen={() => undefined} overlay />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Detail sheet */}
      <DealDetailSheet
        dealId={detailId}
        open={Boolean(detailId)}
        onOpenChange={(next) => {
          if (!next) setDetailId(null);
        }}
        pipelines={pipelines}
        onEdit={(deal) => openForm(deal)}
      />

      {/* Create / edit */}
      <DealFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        deal={editingDeal}
        pipelines={pipelines}
        defaultStageId={formDefaultStage}
      />

      {/* Manage stages */}
      <StagesManagerDialog
        open={stagesOpen}
        onOpenChange={setStagesOpen}
        pipeline={selectedPipeline}
      />

      {/* New pipeline */}
      <EntityFormDialog
        open={pipelineDialogOpen}
        onOpenChange={setPipelineDialogOpen}
        title={t("pipelines.addPipeline")}
        loading={creatingPipeline}
        onSubmit={createPipeline}
      >
        <div className="space-y-1.5">
          <Label htmlFor="pipeline-name">{t("pipelines.pipelineName")} *</Label>
          <Input
            id="pipeline-name"
            value={newPipelineName}
            onChange={(e) => setNewPipelineName(e.target.value)}
            maxLength={80}
          />
        </div>
      </EntityFormDialog>

      {/* Lost reason on drag */}
      <Dialog
        open={Boolean(pendingLost)}
        onOpenChange={(next) => {
          if (!next) setPendingLost(null);
        }}
      >
        <DialogContent className="sm:max-w-md" dir={undefined}>
          <DialogHeader>
            <DialogTitle>{t("deals.actions.markLostTitle")}</DialogTitle>
            {pendingLost ? <DialogDescription>{pendingLost.stage.name}</DialogDescription> : null}
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="kanban-lost-reason">{t("deals.actions.markLostReason")}</Label>
            <Input
              id="kanban-lost-reason"
              autoFocus
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              maxLength={500}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPendingLost(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmLost}>
              {t("deals.actions.markLost")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
