"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlarmClock,
  BadgeDollarSign,
  CalendarClock,
  Cog,
  GitBranch,
  KanbanSquare,
  ListTodo,
  Mail,
  Percent,
  Phone,
  Radar as RadarIcon,
  Repeat,
  Sparkles,
  StickyNote,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { PriorityBadge, SeverityBadge } from "@/components/shared/badges";
import { CardGridSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { api } from "@/lib/client-api";
import {
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
} from "@/lib/format";
import {
  useApiToast,
  useLocaleTz,
  useWorkspaceCurrency,
  useWorkspaceId,
} from "@/hooks/use-workspace";
import { useAppStore } from "@/store/app-store";
import type {
  Activity,
  DashboardResponse,
  Deal,
  Locale,
  NamedValue,
  RadarItem,
  Task,
} from "@/types/api";
import { radarExplanation } from "@/features/radar/radar-utils";
import {
  CHART_COLORS,
  ChartCard,
  ChartLegend,
  ChartTooltip,
  chartAxisProps,
  chartGridProps,
  compactTick,
  namedValueLabel,
  shortDateTick,
  sumSeries,
} from "@/features/dashboard/chart-helpers";

// ---- Local palette maps ----
const TASK_COMPLETION_COLORS: Record<string, string> = {
  "dashboard.charts.completed": CHART_COLORS.green,
  "dashboard.charts.openTasks": CHART_COLORS.slate,
  "dashboard.charts.overdue": CHART_COLORS.red,
};

const WON_VS_LOST_COLORS: Record<string, string> = {
  "dashboard.charts.won": CHART_COLORS.green,
  "dashboard.charts.lost": CHART_COLORS.red,
};

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  CALL: Phone,
  MEETING: Users,
  EMAIL: Mail,
  NOTE: StickyNote,
  TASK_EVENT: ListTodo,
  STAGE_CHANGE: GitBranch,
  CONVERSION: Repeat,
  SYSTEM: Cog,
};

// ---- Small building blocks ----

function SectionCard({
  title,
  count,
  emptyLabel,
  children,
}: {
  title: string;
  count: number;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{title}</h3>
          <span
            className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground"
            aria-label={`${count}`}
          >
            {count}
          </span>
        </div>
        {count === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto pe-1">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

function ListRow({
  title,
  meta,
  end,
  onClick,
  icon,
}: {
  title: string;
  meta?: React.ReactNode;
  end?: React.ReactNode;
  onClick?: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        onClick ? "cursor-pointer hover:border-border hover:bg-accent" : "cursor-default"
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {meta ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{meta}</span> : null}
      </span>
      {end}
    </button>
  );
}

function DonutChart({
  data,
  total,
  totalLabel,
  locale,
  ariaLabel,
}: {
  data: { label: string; value: number; fill: string }[];
  total: number;
  totalLabel: string;
  locale: Locale;
  ariaLabel: string;
}) {
  return (
    <div className="relative h-52" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="62%"
            outerRadius="88%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((d) => (
              <Cell key={d.label} fill={d.fill} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip locale={locale} />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums" dir="ltr">
          {formatNumber(total, locale)}
        </span>
        <span className="text-xs text-muted-foreground">{totalLabel}</span>
      </div>
    </div>
  );
}

// ---- Main view ----

export function OverviewView() {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const user = useAppStore((s) => s.user);
  const navigate = useAppStore((s) => s.navigate);
  const workspaceId = useWorkspaceId();
  const currency = useWorkspaceCurrency();
  useLocaleTz();
  const { apiError } = useApiToast();
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ["dashboard", workspaceId],
    queryFn: () => api.get<DashboardResponse>("/dashboard", { workspaceId }, workspaceId),
    enabled: Boolean(workspaceId),
  });

  const seedDemo = useMutation({
    mutationFn: () => api.post<{ created: boolean }>("/dev/seed", {}),
    onSuccess: () => {
      toast.success(t("settings.data.demoCreated"), {
        description: "demo@nexora.app / nexora-demo",
      });
      void q.refetch();
    },
    onError: (err) => apiError(err),
  });

  const data = q.data;

  const isEmpty =
    !!data &&
    Object.values(data.kpis).every((v) => v === 0) &&
    data.priorities.recentActivity.length === 0;

  const priorityTasks = useMemo<{ task: Task; overdue: boolean }[]>(() => {
    if (!data) return [];
    return [
      ...data.priorities.overdueTasks.map((task) => ({ task, overdue: true })),
      ...data.priorities.dueToday.map((task) => ({ task, overdue: false })),
    ];
  }, [data]);

  const stageData = useMemo(() => {
    if (!data) return [];
    return data.dealsByStage
      .filter((d) => d.value > 0)
      .map((d) => ({
        label: namedValueLabel(d, t),
        count: d.value,
        valueSum: d.extra ?? 0,
      }));
  }, [data, t]);

  const wonVsLostData = useMemo(() => {
    if (!data) return [];
    return data.wonVsLost
      .filter((d) => d.value > 0)
      .map((d) => ({
        label: namedValueLabel(d, t),
        value: d.value,
        fill: d.key === "dashboard.charts.won" ? CHART_COLORS.green : CHART_COLORS.red,
      }));
  }, [data, t]);

  const taskCompletionData = useMemo(() => {
    if (!data) return [];
    return data.taskCompletion
      .filter((d) => d.value > 0)
      .map((d) => ({
        label: namedValueLabel(d, t),
        value: d.value,
        fill: TASK_COMPLETION_COLORS[d.key ?? ""] ?? CHART_COLORS.slate,
      }));
  }, [data, t]);

  const sourceData = useMemo(() => {
    if (!data) return [];
    return data.leadSources
      .filter((d) => d.value > 0)
      .map((d) => ({ label: namedValueLabel(d, t), value: d.value }));
  }, [data, t]);

  // ---------- State rendering ----------

  const header = (
    <PageHeader
      title={t("dashboard.title")}
      subtitle={t("dashboard.subtitle", { name: user?.name ?? "" })}
    />
  );

  if (q.isLoading || (!data && !q.isError)) {
    return (
      <div className="space-y-6">
        {header}
        <CardGridSkeleton count={8} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-full rounded-xl" />
          ))}
        </div>
        <LoadingState rows={3} />
      </div>
    );
  }

  if (q.isError || !data) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title={t("common.errorStateTitle")}
          description={t("common.errorStateDescription")}
          retryLabel={t("common.retry")}
          onRetry={() => void q.refetch()}
        />
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={Sparkles}
          title={t("dashboard.emptyKpis")}
          description={t("radar.thresholdsNote")}
          action={
            <Button size="sm" onClick={() => seedDemo.mutate()} disabled={seedDemo.isPending}>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {t("dashboard.loadDemo")}
            </Button>
          }
        />
      </div>
    );
  }

  const k = data.kpis;
  const { priorities } = data;

  const legendItems = (items: NamedValue[], colors: Record<string, string>) =>
    items.map((d) => ({
      label: namedValueLabel(d, t),
      color: colors[d.key ?? ""] ?? CHART_COLORS.violet,
      value: d.value,
      locale,
    }));

  return (
    <div className="space-y-6">
      {header}

      {/* ---- KPI cards ---- */}
      <section aria-label={t("dashboard.title")} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label={t("dashboard.kpi.totalContacts")}
          value={k.totalContacts}
          icon={Users}
          tone="neutral"
          locale={locale}
          onClick={() => navigate("contacts")}
        />
        <StatCard
          label={t("dashboard.kpi.newLeads")}
          value={k.newLeads}
          icon={UserPlus}
          tone="neutral"
          locale={locale}
          onClick={() => navigate("leads")}
        />
        <StatCard
          label={t("dashboard.kpi.activeDeals")}
          value={k.activeDeals}
          icon={KanbanSquare}
          tone="neutral"
          locale={locale}
          onClick={() => navigate("deals")}
        />
        <StatCard
          label={t("dashboard.kpi.openPipeline")}
          value={formatMoney(k.openPipelineValue, locale, currency)}
          valueIsRaw
          icon={TrendingUp}
          tone="neutral"
          locale={locale}
          onClick={() => navigate("deals")}
        />
        <StatCard
          label={t("dashboard.kpi.wonRevenue")}
          value={formatMoney(k.wonRevenue, locale, currency)}
          valueIsRaw
          icon={BadgeDollarSign}
          tone="green"
          locale={locale}
          onClick={() => navigate("deals")}
        />
        <StatCard
          label={t("dashboard.kpi.conversionRate")}
          value={formatPercent(k.conversionRate, locale)}
          valueIsRaw
          icon={Percent}
          tone="neutral"
          locale={locale}
        />
        <StatCard
          label={t("dashboard.kpi.overdueTasks")}
          value={k.overdueTasks}
          icon={AlarmClock}
          tone="red"
          locale={locale}
          onClick={() => navigate("tasks")}
        />
        <StatCard
          label={t("dashboard.kpi.followUpsToday")}
          value={k.followUpsToday}
          icon={CalendarClock}
          tone="neutral"
          locale={locale}
          onClick={() => navigate("tasks")}
        />
      </section>

      {/* ---- Charts ---- */}
      <section aria-label={t("reports.title")} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title={t("dashboard.charts.leadsOverTime")} empty={sumSeries(data.leadsOverTime) === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.leadsOverTime} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="nxLeadFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.violet} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={CHART_COLORS.violet} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid {...chartGridProps} />
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => shortDateTick(v, locale)}
                minTickGap={28}
                {...chartAxisProps}
              />
              <YAxis allowDecimals={false} tickFormatter={(v: number) => compactTick(v, locale)} width={40} {...chartAxisProps} />
              <Tooltip
                content={
                  <ChartTooltip
                    locale={locale}
                    labelFormatter={(v) => shortDateTick(v, locale)}
                  />
                }
                cursor={{ stroke: CHART_COLORS.violet, strokeOpacity: 0.3 }}
              />
              <Area
                type="monotone"
                dataKey="value"
                name={t("dashboard.charts.leadsOverTime")}
                stroke={CHART_COLORS.violet}
                strokeWidth={2}
                fill="url(#nxLeadFill)"
                activeDot={{ r: 3, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={t("dashboard.charts.revenueOverTime")} empty={sumSeries(data.revenueOverTime) === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.revenueOverTime} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="nxRevenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_COLORS.emerald} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={CHART_COLORS.emerald} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid {...chartGridProps} />
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => shortDateTick(v, locale)}
                minTickGap={28}
                {...chartAxisProps}
              />
              <YAxis tickFormatter={(v: number) => compactTick(v, locale)} width={44} {...chartAxisProps} />
              <Tooltip
                content={
                  <ChartTooltip
                    locale={locale}
                    labelFormatter={(v) => shortDateTick(v, locale)}
                    valueFormatter={(v) => formatMoney(v, locale, currency)}
                  />
                }
                cursor={{ stroke: CHART_COLORS.emerald, strokeOpacity: 0.3 }}
              />
              <Area
                type="monotone"
                dataKey="value"
                name={t("dashboard.charts.value")}
                stroke={CHART_COLORS.emerald}
                strokeWidth={2}
                fill="url(#nxRevenueFill)"
                activeDot={{ r: 3, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={t("dashboard.charts.dealsByStage")} empty={stageData.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stageData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis
                type="number"
                allowDecimals={false}
                tickFormatter={(v: number) => compactTick(v, locale)}
                {...chartAxisProps}
              />
              <YAxis type="category" dataKey="label" width={88} {...chartAxisProps} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                content={
                  <ChartTooltip
                    locale={locale}
                    footerRows={(payload) => [
                      {
                        label: t("dashboard.charts.value"),
                        value: formatMoney(Number(payload.valueSum ?? 0), locale, currency),
                      },
                    ]}
                  />
                }
              />
              <Bar
                dataKey="count"
                name={t("dashboard.charts.count")}
                fill={CHART_COLORS.violet}
                radius={[0, 4, 4, 0]}
                barSize={16}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={t("dashboard.charts.leadSources")} empty={sourceData.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sourceData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis
                type="number"
                allowDecimals={false}
                tickFormatter={(v: number) => compactTick(v, locale)}
                {...chartAxisProps}
              />
              <YAxis type="category" dataKey="label" width={92} {...chartAxisProps} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                content={<ChartTooltip locale={locale} />}
              />
              <Bar
                dataKey="value"
                name={t("dashboard.charts.count")}
                fill={CHART_COLORS.slate}
                radius={[0, 4, 4, 0]}
                barSize={16}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={t("dashboard.charts.wonVsLost")} empty={wonVsLostData.length === 0}>
          <div className="flex h-full flex-col justify-center gap-2">
            <DonutChart
              data={wonVsLostData}
              total={wonVsLostData.reduce((a, d) => a + d.value, 0)}
              totalLabel={t("dashboard.charts.count")}
              locale={locale}
              ariaLabel={t("dashboard.charts.wonVsLost")}
            />
            <ChartLegend items={legendItems(data.wonVsLost, WON_VS_LOST_COLORS)} />
          </div>
        </ChartCard>

        <ChartCard title={t("dashboard.charts.taskCompletion")} empty={taskCompletionData.length === 0}>
          <div className="flex h-full flex-col justify-center gap-2">
            <DonutChart
              data={taskCompletionData}
              total={taskCompletionData.reduce((a, d) => a + d.value, 0)}
              totalLabel={t("dashboard.charts.count")}
              locale={locale}
              ariaLabel={t("dashboard.charts.taskCompletion")}
            />
            <ChartLegend items={legendItems(data.taskCompletion, TASK_COMPLETION_COLORS)} />
          </div>
        </ChartCard>
      </section>

      {/* ---- Action sections ---- */}
      <section aria-label={t("dashboard.sections.todayPriorities")} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard
          title={t("dashboard.sections.todayPriorities")}
          count={priorityTasks.length}
          emptyLabel={t("common.noData")}
        >
          {priorityTasks.map(({ task, overdue }) => (
            <ListRow
              key={`${overdue ? "o" : "t"}-${task.id}`}
              title={task.title}
              onClick={() => navigate("tasks")}
              icon={
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${overdue ? "bg-red-500" : "bg-amber-500"}`}
                  aria-hidden="true"
                />
              }
              meta={
                <span className={overdue ? "font-medium text-red-500" : undefined}>
                  {overdue ? t("time.overdue") : t("time.dueToday")}
                  {" · "}
                  {formatRelative(task.dueAt, locale, t)}
                  {task.assignee ? ` · ${task.assignee.name}` : ""}
                </span>
              }
              end={<PriorityBadge priority={task.priority} />}
            />
          ))}
        </SectionCard>

        <SectionCard
          title={t("dashboard.sections.stagnantDeals")}
          count={priorities.stagnantDeals.length}
          emptyLabel={t("common.noData")}
        >
          {priorities.stagnantDeals.map((deal: Deal) => (
            <ListRow
              key={deal.id}
              title={deal.title}
              onClick={() => navigate("deals", { params: { dealId: deal.id } })}
              meta={
                <>
                  {deal.stage?.name ?? "—"}
                  {" · "}
                  {formatMoney(deal.value, locale, currency)}
                </>
              }
              end={
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatRelative(deal.stageEnteredAt, locale, t)}
                </span>
              }
            />
          ))}
        </SectionCard>

        <SectionCard
          title={t("dashboard.sections.recentActivity")}
          count={priorities.recentActivity.length}
          emptyLabel={t("activities.empty")}
        >
          {priorities.recentActivity.map((activity: Activity) => {
            const Icon = ACTIVITY_ICONS[activity.type] ?? Cog;
            return (
              <ListRow
                key={activity.id}
                title={activity.title}
                onClick={() => navigate("activities")}
                icon={
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </span>
                }
                meta={
                  <>
                    {t(`enums.activityType.${activity.type}`)}
                    {" · "}
                    {t("activities.byUser", { name: activity.user?.name ?? "—" })}
                    {" · "}
                    {formatRelative(activity.createdAt, locale, t)}
                  </>
                }
              />
            );
          })}
        </SectionCard>
      </section>

      {/* ---- Critical radar mini-list ---- */}
      <Card className="border-border bg-card">
        <CardContent className="p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <RadarIcon className="h-4 w-4 text-primary" aria-hidden="true" />
              {t("dashboard.sections.radarCritical")}
            </h3>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => navigate("radar")}>
              {t("dashboard.viewAll")}
            </Button>
          </div>
          {priorities.radarCritical.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("radar.empty.description")}</p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto pe-1">
              {priorities.radarCritical.map((item: RadarItem) => (
                <ListRow
                  key={item.id}
                  title={item.entity.title}
                  onClick={() => navigate("radar")}
                  meta={radarExplanation(item, locale, currency, t)}
                  end={<SeverityBadge severity={item.severity} />}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
