"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
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
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  Coins,
  Download,
  Gauge,
  Percent,
  Target,
  Timer,
  Users,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { ErrorState } from "@/components/shared/states";
import { FilterBar, MultiSelectFilter } from "@/components/shared/filters";
import { api, downloadFile } from "@/lib/client-api";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import {
  useApiToast,
  useMemberOptions,
  useWorkspaceCurrency,
  useWorkspaceId,
} from "@/hooks/use-workspace";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import type {
  LeadsReport,
  Locale,
  NamedValue,
  Pipeline,
  ProductivityReport,
  SalesReport,
} from "@/types/api";
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
} from "@/features/dashboard/chart-helpers";

type ReportTab = "leads" | "sales" | "productivity";
type RangePreset = "7" | "30" | "90" | "12m";

const LEAD_STATUS_COLORS: Record<string, string> = {
  "enums.leadStatus.NEW": CHART_COLORS.violet,
  "enums.leadStatus.CONTACTED": CHART_COLORS.sky,
  "enums.leadStatus.QUALIFIED": CHART_COLORS.amber,
  "enums.leadStatus.DISQUALIFIED": CHART_COLORS.slate,
  "enums.leadStatus.CONVERTED": CHART_COLORS.green,
};

const PRODUCTIVITY_COLORS: Record<string, string> = {
  "reports.productivity.completed": CHART_COLORS.green,
  "reports.productivity.overdue": CHART_COLORS.red,
};

function computeRange(preset: RangePreset): { from: string; to: string } {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (preset === "7") from.setDate(from.getDate() - 6);
  else if (preset === "30") from.setDate(from.getDate() - 29);
  else if (preset === "90") from.setDate(from.getDate() - 89);
  else from.setMonth(from.getMonth() - 12);
  return { from: from.toISOString(), to: new Date().toISOString() };
}

function TabSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-72 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function DonutBlock({
  title,
  data,
  colors,
  locale,
}: {
  title: string;
  data: NamedValue[];
  colors: Record<string, string>;
  locale: Locale;
}) {
  const { t } = useTranslation();
  const slices = data
    .filter((d) => d.value > 0)
    .map((d) => ({
      label: namedValueLabel(d, t),
      value: d.value,
      fill: colors[d.key ?? ""] ?? CHART_COLORS.violet,
    }));
  const total = slices.reduce((a, d) => a + d.value, 0);
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4">
        <h3 className="mb-3 text-sm font-semibold">{title}</h3>
        {total === 0 ? (
          <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
            {t("reports.empty")}
          </div>
        ) : (
          <div className="flex flex-col justify-center gap-2" role="img" aria-label={title}>
            <div className="relative h-52" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="62%"
                    outerRadius="88%"
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {slices.map((d) => (
                      <Cell key={d.label} fill={d.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip locale={locale} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold tabular-nums" dir="ltr">
                  {formatNumber(total, locale)}
                </span>
              </div>
            </div>
            <ChartLegend
              items={data.map((d) => ({
                label: namedValueLabel(d, t),
                color: colors[d.key ?? ""] ?? CHART_COLORS.violet,
                value: d.value,
                locale,
              }))}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ReportsView() {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const workspaceId = useWorkspaceId();
  const currency = useWorkspaceCurrency();
  const { apiError } = useApiToast();
  const memberOptions = useMemberOptions();

  const [tab, setTab] = useState<ReportTab>("leads");
  const [preset, setPreset] = useState<RangePreset>("30");
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [pipelineId, setPipelineId] = useState<string>("all");

  const range = useMemo(() => computeRange(preset), [preset]);
  const ownerParam = ownerIds.join(",");

  const baseQuery = {
    workspaceId,
    from: range.from,
    to: range.to,
    ...(ownerIds.length ? { ownerId: ownerParam } : {}),
  };

  const leadsQ = useQuery({
    queryKey: ["reports", "leads", workspaceId, preset, ownerParam],
    queryFn: () => api.get<LeadsReport>("/reports/leads", baseQuery, workspaceId),
    enabled: tab === "leads" && Boolean(workspaceId),
  });

  const salesQ = useQuery({
    queryKey: ["reports", "sales", workspaceId, preset, ownerParam, pipelineId],
    queryFn: () =>
      api.get<SalesReport>(
        "/reports/sales",
        { ...baseQuery, ...(pipelineId !== "all" ? { pipelineId } : {}) },
        workspaceId
      ),
    enabled: tab === "sales" && Boolean(workspaceId),
  });

  const productivityQ = useQuery({
    queryKey: ["reports", "productivity", workspaceId, preset, ownerParam],
    queryFn: () =>
      api.get<ProductivityReport>("/reports/productivity", baseQuery, workspaceId),
    enabled: tab === "productivity" && Boolean(workspaceId),
  });

  const pipelinesQ = useQuery({
    queryKey: ["pipelines", workspaceId],
    queryFn: () => api.get<Pipeline[]>("/pipelines", { workspaceId }, workspaceId),
    enabled: tab === "sales" && Boolean(workspaceId),
    staleTime: 60_000,
  });

  // ---- CSV export ----
  // Leads: dedicated endpoint (supported). Sales: deals export is attempted via a
  // guarded download so failures surface as a toast instead of navigating away.
  const exportSalesCsv = async () => {
    try {
      const res = await fetch(
        `/api/v1/csv/export/deals?workspaceId=${encodeURIComponent(workspaceId)}`,
        { credentials: "same-origin" }
      );
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "nexora-deals.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      apiError(err, "errors.generic");
    }
  };

  const presets: { value: RangePreset; label: string }[] = [
    { value: "7", label: t("time.last7") },
    { value: "30", label: t("time.last30") },
    { value: "90", label: t("time.last90") },
    { value: "12m", label: t("time.last12m") },
  ];

  const stageTooltipFooter = (payload: Record<string, unknown>) => [
    { label: t("dashboard.charts.value"), value: formatMoney(Number(payload.valueSum ?? 0), locale, currency) },
  ];

  // ================= LEADS TAB =================
  const leadsReport = leadsQ.data;
  const leadsInRange = leadsReport ? leadsReport.byStatus.reduce((a, d) => a + d.value, 0) : 0;
  const leadsSourceData =
    leadsReport?.bySource
      .filter((d) => d.value > 0)
      .map((d) => ({ label: namedValueLabel(d, t), value: d.value })) ?? [];

  // ================= SALES TAB =================
  const salesReport = salesQ.data;
  const salesStageData =
    salesReport?.dealsByStage
      .filter((d) => d.value > 0)
      .map((d) => ({ label: namedValueLabel(d, t), count: d.value, valueSum: d.extra ?? 0 })) ?? [];
  const money = (v: number) => formatMoney(v, locale, currency);
  const days = (v: number | null) => (v === null ? "—" : t("reports.leads.days", { count: v }));

  // ================= PRODUCTIVITY TAB =================
  const prodReport = productivityQ.data;
  const maxWorkload = prodReport
    ? Math.max(1, ...prodReport.workloadByOwner.map((w) => w.value))
    : 1;

  return (
    <div className="space-y-6">
      <PageHeader title={t("reports.title")} subtitle={t("reports.subtitle")} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as ReportTab)} className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList aria-label={t("reports.title")}>
            <TabsTrigger value="leads">{t("reports.tabs.leads")}</TabsTrigger>
            <TabsTrigger value="sales">{t("reports.tabs.sales")}</TabsTrigger>
            <TabsTrigger value="productivity">{t("reports.tabs.productivity")}</TabsTrigger>
          </TabsList>

          <FilterBar>
            <div
              role="group"
              aria-label={t("reports.filters.dateRange")}
              className="inline-flex rounded-lg border border-border p-0.5"
            >
              {presets.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPreset(p.value)}
                  aria-pressed={preset === p.value}
                  className={cn(
                    "h-8 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    preset === p.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <MultiSelectFilter
              label={t("reports.filters.owner")}
              options={memberOptions}
              selected={ownerIds}
              onChange={setOwnerIds}
            />

            {tab === "sales" ? (
              <Select value={pipelineId} onValueChange={setPipelineId}>
                <SelectTrigger
                  className="h-9 w-40 font-normal"
                  size="sm"
                  aria-label={t("reports.filters.pipeline")}
                >
                  <SelectValue placeholder={t("common.all")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.all")}</SelectItem>
                  {(pipelinesQ.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            {tab === "leads" ? (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => downloadFile("/csv/export/leads", { workspaceId })}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {t("reports.exportCsv")}
              </Button>
            ) : null}
            {tab === "sales" ? (
              <Button variant="outline" size="sm" className="h-9" onClick={() => void exportSalesCsv()}>
                <Download className="h-4 w-4" aria-hidden="true" />
                {t("reports.exportCsv")}
              </Button>
            ) : null}
          </FilterBar>
        </div>

        {/* ---------------- LEADS ---------------- */}
        <TabsContent value="leads" className="space-y-4">
          {leadsQ.isLoading ? (
            <TabSkeleton />
          ) : leadsQ.isError || !leadsReport ? (
            <ErrorState
              title={t("common.errorStateTitle")}
              description={t("common.errorStateDescription")}
              retryLabel={t("common.retry")}
              onRetry={() => void leadsQ.refetch()}
            />
          ) : (
            <>
              <section
                aria-label={t("reports.tabs.leads")}
                className="grid grid-cols-2 gap-3 sm:grid-cols-3"
              >
                <StatCard
                  label={t("reports.leads.totalLeads")}
                  value={leadsInRange}
                  icon={Users}
                  tone="neutral"
                  locale={locale}
                />
                <StatCard
                  label={t("reports.leads.conversionRate")}
                  value={formatPercent(leadsReport.conversionRate, locale)}
                  valueIsRaw
                  icon={Percent}
                  tone="neutral"
                  locale={locale}
                />
                <StatCard
                  label={t("reports.leads.avgTimeToConvert")}
                  value={days(leadsReport.avgTimeToConvertDays)}
                  valueIsRaw
                  icon={Clock}
                  tone="neutral"
                  locale={locale}
                />
              </section>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <ChartCard
                  title={t("reports.leads.overTime")}
                  className="lg:col-span-2"
                  empty={leadsReport.leadsOverTime.every((p) => p.value === 0)}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={leadsReport.leadsOverTime} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="nxRepLeads" x1="0" y1="0" x2="0" y2="1">
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
                      <YAxis
                        allowDecimals={false}
                        tickFormatter={(v: number) => compactTick(v, locale)}
                        width={40}
                        {...chartAxisProps}
                      />
                      <Tooltip
                        content={<ChartTooltip locale={locale} labelFormatter={(v) => shortDateTick(v, locale)} />}
                        cursor={{ stroke: CHART_COLORS.violet, strokeOpacity: 0.3 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        name={t("reports.leads.overTime")}
                        stroke={CHART_COLORS.violet}
                        strokeWidth={2}
                        fill="url(#nxRepLeads)"
                        activeDot={{ r: 3, strokeWidth: 0 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <DonutBlock
                  title={t("reports.leads.byStatus")}
                  data={leadsReport.byStatus}
                  colors={LEAD_STATUS_COLORS}
                  locale={locale}
                />

                <ChartCard
                  title={t("reports.leads.bySource")}
                  className="lg:col-span-3"
                  empty={leadsSourceData.length === 0}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={leadsSourceData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis
                        type="number"
                        allowDecimals={false}
                        tickFormatter={(v: number) => compactTick(v, locale)}
                        {...chartAxisProps}
                      />
                      <YAxis type="category" dataKey="label" width={100} {...chartAxisProps} />
                      <Tooltip
                        cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                        content={<ChartTooltip locale={locale} />}
                      />
                      <Bar
                        dataKey="value"
                        name={t("dashboard.charts.count")}
                        fill={CHART_COLORS.violet}
                        radius={[0, 4, 4, 0]}
                        barSize={16}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
            </>
          )}
        </TabsContent>

        {/* ---------------- SALES ---------------- */}
        <TabsContent value="sales" className="space-y-4">
          {salesQ.isLoading ? (
            <TabSkeleton />
          ) : salesQ.isError || !salesReport ? (
            <ErrorState
              title={t("common.errorStateTitle")}
              description={t("common.errorStateDescription")}
              retryLabel={t("common.retry")}
              onRetry={() => void salesQ.refetch()}
            />
          ) : (
            <>
              <section
                aria-label={t("reports.tabs.sales")}
                className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
              >
                <StatCard
                  label={t("reports.sales.winRate")}
                  value={salesReport.winRate === null ? "—" : formatPercent(salesReport.winRate, locale)}
                  valueIsRaw
                  icon={Target}
                  tone="neutral"
                  locale={locale}
                />
                <StatCard
                  label={t("reports.sales.wonValue")}
                  value={money(salesReport.wonValue)}
                  valueIsRaw
                  icon={CircleDollarSign}
                  tone="green"
                  locale={locale}
                />
                <StatCard
                  label={t("reports.sales.lostValue")}
                  value={money(salesReport.lostValue)}
                  valueIsRaw
                  icon={XCircle}
                  tone="red"
                  locale={locale}
                />
                <StatCard
                  label={t("reports.sales.weightedPipeline")}
                  value={money(salesReport.weightedPipelineValue)}
                  valueIsRaw
                  icon={Gauge}
                  tone="neutral"
                  locale={locale}
                />
                <StatCard
                  label={t("reports.sales.avgDealSize")}
                  value={salesReport.avgDealSize === null ? "—" : money(salesReport.avgDealSize)}
                  valueIsRaw
                  icon={Coins}
                  tone="neutral"
                  locale={locale}
                />
                <StatCard
                  label={t("reports.sales.avgCycle")}
                  value={days(salesReport.avgCycleDays)}
                  valueIsRaw
                  icon={Timer}
                  tone="neutral"
                  locale={locale}
                />
              </section>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <ChartCard
                  title={t("reports.sales.byStage")}
                  empty={salesStageData.length === 0}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={salesStageData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
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
                        content={<ChartTooltip locale={locale} footerRows={stageTooltipFooter} />}
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

                <ChartCard
                  title={t("reports.sales.valueOverTime")}
                  className="lg:col-span-2"
                  empty={salesReport.valueOverTime.every((p) => p.value === 0)}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={salesReport.valueOverTime} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="nxRepSales" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CHART_COLORS.green} stopOpacity={0.28} />
                          <stop offset="100%" stopColor={CHART_COLORS.green} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...chartGridProps} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v: string) => shortDateTick(v, locale)}
                        minTickGap={28}
                        {...chartAxisProps}
                      />
                      <YAxis
                        tickFormatter={(v: number) => compactTick(v, locale)}
                        width={44}
                        {...chartAxisProps}
                      />
                      <Tooltip
                        content={
                          <ChartTooltip
                            locale={locale}
                            labelFormatter={(v) => shortDateTick(v, locale)}
                            valueFormatter={(v) => money(v)}
                          />
                        }
                        cursor={{ stroke: CHART_COLORS.green, strokeOpacity: 0.3 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        name={t("dashboard.charts.value")}
                        stroke={CHART_COLORS.green}
                        strokeWidth={2}
                        fill="url(#nxRepSales)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <Card className="border-border bg-card lg:col-span-3">
                  <CardContent className="p-4">
                    <h3 className="mb-3 text-sm font-semibold">{t("reports.sales.lossReasons")}</h3>
                    {salesReport.lossReasons.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">{t("common.noData")}</p>
                    ) : (
                      <ul className="max-h-64 space-y-1.5 overflow-y-auto pe-1">
                        {salesReport.lossReasons.map((r: NamedValue) => (
                          <li
                            key={r.name}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
                          >
                            <span className="min-w-0 truncate text-sm">{r.name}</span>
                            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums" dir="ltr">
                              {formatNumber(r.value, locale)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* ---------------- PRODUCTIVITY ---------------- */}
        <TabsContent value="productivity" className="space-y-4">
          {productivityQ.isLoading ? (
            <TabSkeleton />
          ) : productivityQ.isError || !prodReport ? (
            <ErrorState
              title={t("common.errorStateTitle")}
              description={t("common.errorStateDescription")}
              retryLabel={t("common.retry")}
              onRetry={() => void productivityQ.refetch()}
            />
          ) : (
            <>
              <section
                aria-label={t("reports.tabs.productivity")}
                className="grid grid-cols-2 gap-3 sm:grid-cols-3"
              >
                <StatCard
                  label={t("reports.productivity.followUpsCompleted")}
                  value={prodReport.followUpsCompleted}
                  icon={CheckCircle2}
                  tone="green"
                  locale={locale}
                />
                <StatCard
                  label={t("reports.productivity.attentionDeals")}
                  value={prodReport.attentionDeals}
                  icon={AlertTriangle}
                  tone="red"
                  locale={locale}
                />
              </section>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <DonutBlock
                  title={t("reports.productivity.completedVsOverdue")}
                  data={prodReport.completedVsOverdue}
                  colors={PRODUCTIVITY_COLORS}
                  locale={locale}
                />

                <ChartCard
                  title={t("reports.productivity.activitiesOverTime")}
                  className="lg:col-span-2"
                  empty={prodReport.activitiesOverTime.every((p) => p.value === 0)}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={prodReport.activitiesOverTime} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="nxRepProd" x1="0" y1="0" x2="0" y2="1">
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
                      <YAxis
                        allowDecimals={false}
                        tickFormatter={(v: number) => compactTick(v, locale)}
                        width={40}
                        {...chartAxisProps}
                      />
                      <Tooltip
                        content={<ChartTooltip locale={locale} labelFormatter={(v) => shortDateTick(v, locale)} />}
                        cursor={{ stroke: CHART_COLORS.violet, strokeOpacity: 0.3 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        name={t("reports.productivity.activities")}
                        stroke={CHART_COLORS.violet}
                        strokeWidth={2}
                        fill="url(#nxRepProd)"
                        activeDot={{ r: 3, strokeWidth: 0 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <Card className="border-border bg-card lg:col-span-3">
                  <CardContent className="p-4">
                    <h3 className="mb-3 text-sm font-semibold">{t("reports.productivity.workloadByOwner")}</h3>
                    {prodReport.workloadByOwner.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">{t("common.noData")}</p>
                    ) : (
                      <ul className="max-h-64 space-y-2.5 overflow-y-auto pe-1">
                        {prodReport.workloadByOwner.map((w: NamedValue) => (
                          <li key={w.name} className="flex items-center gap-3">
                            <span className="w-28 shrink-0 truncate text-sm" title={w.name}>
                              {w.name}
                            </span>
                            <Progress
                              value={(w.value / maxWorkload) * 100}
                              className="h-2 flex-1"
                              aria-label={`${w.name}: ${w.value}`}
                            />
                            <span className="w-10 shrink-0 text-end text-xs font-semibold tabular-nums text-muted-foreground" dir="ltr">
                              {formatNumber(w.value, locale)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
