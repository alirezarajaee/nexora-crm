"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  Eye,
  Loader2,
  PenLine,
  PhoneCall,
  Plus,
  ShieldOff,
  Trash2,
} from "lucide-react";

import { useAppStore } from "@/store/app-store";
import {
  useApiToast,
  useLocaleTz,
  useMemberOptions,
  useWorkspaceCurrency,
  useWorkspaceId,
} from "@/hooks/use-workspace";
import { ApiRequestError, api } from "@/lib/client-api";
import { formatDate, formatDateInputValue, formatMoney, isOverdue, parseLocalizedNumber } from "@/lib/format";
import type { Lead, LeadSource, LeadStatus, Paginated, Priority } from "@/types/api";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { DataTable, TablePagination, type Column } from "@/components/shared/data-table";
import { ArchivedToggle, FilterBar, MultiSelectFilter, SearchInput } from "@/components/shared/filters";
import { LeadStatusBadge, PriorityBadge, TagBadges } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const LEAD_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "DISQUALIFIED", "CONVERTED"];
const LEAD_SOURCES: LeadSource[] = ["WEBSITE", "REFERRAL", "SOCIAL", "CAMPAIGN", "DIRECT", "OTHER"];
const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH"];
const PAGE_SIZE = 20;
const NONE = "__none__";
const UNASSIGNED = "__unassigned__";

interface LeadFormState {
  name: string;
  email: string;
  phone: string;
  companyName: string;
  jobTitle: string;
  source: string;
  status: string;
  priority: string;
  ownerId: string;
  estimatedValue: string;
  nextFollowUpAt: string;
  notes: string;
}

const EMPTY_FORM: LeadFormState = {
  name: "",
  email: "",
  phone: "",
  companyName: "",
  jobTitle: "",
  source: "",
  status: "NEW",
  priority: "MEDIUM",
  ownerId: "",
  estimatedValue: "",
  nextFollowUpAt: "",
  notes: "",
};

function toIsoOrNull(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function FormField({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={htmlFor} className="flex items-center gap-1">
        <span className="truncate">{label}</span>
        {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{value == null || value === "" ? "—" : value}</dd>
    </div>
  );
}

export function LeadsView() {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const viewParams = useAppStore((s) => s.viewParams);
  const navigate = useAppStore((s) => s.navigate);
  const workspaceId = useWorkspaceId();
  const currency = useWorkspaceCurrency();
  const tz = useLocaleTz();
  const memberOptions = useMemberOptions();
  const apiToast = useApiToast();
  const queryClient = useQueryClient();

  // ---- Filters ----
  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);

  // Debounced search: updates q and resets pagination from a timer callback.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(searchText.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const changeStatuses = (values: string[]) => {
    setStatuses(values);
    setPage(1);
  };
  const changeSources = (values: string[]) => {
    setSources(values);
    setPage(1);
  };
  const changePriorities = (values: string[]) => {
    setPriorities(values);
    setPage(1);
  };
  const changeOwners = (values: string[]) => {
    setOwnerIds(values);
    setPage(1);
  };
  const changeArchived = (value: boolean) => {
    setArchived(value);
    setPage(1);
  };

  const hasFilters =
    q.length > 0 ||
    statuses.length > 0 ||
    sources.length > 0 ||
    priorities.length > 0 ||
    ownerIds.length > 0;

  // ---- List ----
  const leadsQuery = useQuery({
    queryKey: ["leads", workspaceId, { q, statuses, sources, priorities, ownerIds, archived, page }],
    queryFn: () =>
      api.get<Paginated<Lead>>(
        "/leads",
        {
          q: q || undefined,
          status: statuses,
          source: sources,
          priority: priorities,
          ownerId: ownerIds,
          archived,
          page,
          pageSize: PAGE_SIZE,
        },
        workspaceId
      ),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
  const leads = leadsQuery.data?.items ?? [];
  const total = leadsQuery.data?.total ?? 0;

  // ---- Detail ----
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const detailQuery = useQuery({
    queryKey: ["lead", workspaceId, selectedLeadId],
    queryFn: () => api.get<Lead>(`/leads/${selectedLeadId}`, undefined, workspaceId),
    enabled: Boolean(workspaceId && selectedLeadId),
  });
  const selectedRowLead = leads.find((l) => l.id === selectedLeadId) ?? null;
  const leadDetail = detailQuery.data ?? selectedRowLead;

  const openDetail = (id: string) => setSelectedLeadId(id);
  const closeDetail = () => setSelectedLeadId(null);

  const invalidateLeads = () => {
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    queryClient.invalidateQueries({ queryKey: ["lead"] });
  };

  // ---- Deep link (viewParams.leadId from global search / radar) ----
  useEffect(() => {
    const id = viewParams.leadId;
    if (!id) return;
    const timer = window.setTimeout(() => {
      setSelectedLeadId(id);
      navigate("leads");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [viewParams.leadId, navigate]);

  // ---- Form (create / edit) ----
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [form, setForm] = useState<LeadFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState("");

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, ownerId: "" });
    setFormError("");
    setFormOpen(true);
  };

  const openEdit = (lead: Lead) => {
    setEditing(lead);
    setForm({
      name: lead.name,
      email: lead.email ?? "",
      phone: lead.phone ?? "",
      companyName: lead.companyName ?? "",
      jobTitle: lead.jobTitle ?? "",
      source: lead.source ?? "",
      status: lead.status,
      priority: lead.priority,
      ownerId: lead.ownerId ?? "",
      estimatedValue: lead.estimatedValue != null ? String(lead.estimatedValue) : "",
      nextFollowUpAt: formatDateInputValue(lead.nextFollowUpAt),
      notes: lead.notes ?? "",
    });
    setFormError("");
    setFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api.patch<Lead>(`/leads/${editing.id}`, payload, workspaceId)
        : api.post<Lead>("/leads", payload, workspaceId),
    onSuccess: () => {
      apiToast.success(t(editing ? "leads.updatedToast" : "leads.createdToast"));
      setFormOpen(false);
      invalidateLeads();
    },
    onError: (err: unknown) => {
      apiToast.apiError(err);
      if (err instanceof ApiRequestError && err.code === "DUPLICATE") {
        setFormError(t("leads.duplicateWarning"));
      }
    },
  });

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError(t("validation.nameRequired"));
      return;
    }
    const valueRaw = form.estimatedValue.trim();
    const estimated = valueRaw ? parseLocalizedNumber(valueRaw) : null;
    if (valueRaw && estimated == null) {
      setFormError(t("validation.number"));
      return;
    }
    setFormError("");
    saveMutation.mutate({
      workspaceId,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      companyName: form.companyName.trim(),
      jobTitle: form.jobTitle.trim(),
      source: form.source || undefined,
      status: form.status,
      priority: form.priority,
      ownerId: form.ownerId,
      estimatedValue: estimated,
      nextFollowUpAt: toIsoOrNull(form.nextFollowUpAt),
      notes: form.notes,
    });
  };

  // ---- Convert ----
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertAlsoDeal, setConvertAlsoDeal] = useState(false);
  const [convertDealTitle, setConvertDealTitle] = useState("");
  const [convertDealValue, setConvertDealValue] = useState("");

  const openConvert = () => {
    setConvertAlsoDeal(false);
    setConvertDealTitle("");
    setConvertDealValue("");
    setConvertOpen(true);
  };

  const convertMutation = useMutation({
    mutationFn: (id: string) => {
      const valueRaw = convertDealValue.trim();
      const parsedValue = valueRaw ? parseLocalizedNumber(valueRaw) : null;
      return api.post<{ contactId: string; dealId: string | null }>(
        `/leads/${id}/convert`,
        {
          workspaceId,
          createDeal: convertAlsoDeal,
          ...(convertAlsoDeal
            ? {
                dealTitle: convertDealTitle.trim() || undefined,
                dealValue: parsedValue != null ? parsedValue : undefined,
              }
            : {}),
        },
        workspaceId
      );
    },
    onSuccess: () => {
      apiToast.success(t("leads.actions.convertSuccess"));
      setConvertOpen(false);
      invalidateLeads();
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
    onError: (err: unknown) => apiToast.apiError(err),
  });

  // ---- Disqualify ----
  const [disqualifyOpen, setDisqualifyOpen] = useState(false);
  const [disqualifyReason, setDisqualifyReason] = useState("");

  const disqualifyMutation = useMutation({
    mutationFn: (id: string) =>
      api.patch<Lead>(
        `/leads/${id}`,
        { workspaceId, status: "DISQUALIFIED", disqualificationReason: disqualifyReason.trim() },
        workspaceId
      ),
    onSuccess: () => {
      apiToast.success(t("leads.actions.disqualifySuccess"));
      setDisqualifyOpen(false);
      setDisqualifyReason("");
      invalidateLeads();
    },
    onError: (err: unknown) => apiToast.apiError(err),
  });

  // ---- Archive / Restore ----
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string; archived: boolean } | null>(null);

  const archiveMutation = useMutation({
    mutationFn: (vars: { id: string; archived: boolean }) =>
      api.patch<Lead>(`/leads/${vars.id}`, { workspaceId, archived: vars.archived }, workspaceId),
    onSuccess: (_data, vars) => {
      apiToast.success(t(vars.archived ? "leads.archivedToast" : "leads.restoredToast"));
      setArchiveTarget(null);
      invalidateLeads();
    },
    onError: (err: unknown) => apiToast.apiError(err),
  });

  // ---- Delete ----
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/leads/${id}`, undefined, workspaceId),
    onSuccess: () => {
      apiToast.success(t("leads.deletedToast"));
      setDeleteTarget(null);
      closeDetail();
      invalidateLeads();
    },
    onError: (err: unknown) => apiToast.apiError(err),
  });

  // ---- Log call ----
  const logCallMutation = useMutation({
    mutationFn: (id: string) =>
      api.post("/activities", { workspaceId, type: "CALL", title: t("leads.actions.logCall"), leadId: id }, workspaceId),
    onSuccess: () => {
      apiToast.success(t("activities.createdToast"));
      invalidateLeads();
    },
    onError: (err: unknown) => apiToast.apiError(err),
  });

  // ---- Columns ----
  const columns: Column<Lead>[] = [
    {
      key: "name",
      header: t("common.name"),
      cell: (row) => (
        <button
          type="button"
          onClick={() => openDetail(row.id)}
          className="flex min-w-0 max-w-56 flex-col items-start gap-0.5 rounded text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate font-semibold hover:underline">{row.name}</span>
          {row.email ? (
            <span className="max-w-56 truncate text-xs font-normal text-muted-foreground">{row.email}</span>
          ) : null}
        </button>
      ),
    },
    {
      key: "company",
      header: t("leads.field.companyName"),
      cell: (row) => <span className="block max-w-40 truncate text-sm">{row.companyName ?? "—"}</span>,
      className: "hidden md:table-cell",
      headerClassName: "hidden md:table-cell",
    },
    {
      key: "status",
      header: t("common.status"),
      cell: (row) => <LeadStatusBadge status={row.status} />,
    },
    {
      key: "priority",
      header: t("common.priority"),
      cell: (row) => <PriorityBadge priority={row.priority} />,
      className: "hidden sm:table-cell",
      headerClassName: "hidden sm:table-cell",
    },
    {
      key: "value",
      header: t("leads.field.estimatedValue"),
      cell: (row) => (
        <span className="text-sm tabular-nums">
          {row.estimatedValue != null ? formatMoney(row.estimatedValue, locale, currency) : "—"}
        </span>
      ),
      className: "hidden md:table-cell",
      headerClassName: "hidden md:table-cell",
    },
    {
      key: "followUp",
      header: t("leads.field.nextFollowUpAt"),
      cell: (row) => {
        if (!row.nextFollowUpAt) return <span className="text-sm text-muted-foreground">—</span>;
        const overdue = isOverdue(row.nextFollowUpAt);
        return (
          <span
            className={cn("text-sm tabular-nums", overdue && "font-medium text-destructive")}
            title={overdue ? t("time.overdue") : undefined}
          >
            {formatDate(row.nextFollowUpAt, locale, tz)}
            {overdue ? <span className="sr-only"> — {t("time.overdue")}</span> : null}
          </span>
        );
      },
      className: "hidden lg:table-cell",
      headerClassName: "hidden lg:table-cell",
    },
    {
      key: "owner",
      header: t("common.owner"),
      cell: (row) => <span className="block max-w-32 truncate text-sm">{row.owner?.name ?? "—"}</span>,
      className: "hidden lg:table-cell",
      headerClassName: "hidden lg:table-cell",
    },
    {
      key: "tags",
      header: t("common.tags"),
      cell: (row) => <TagBadges tags={row.tags} />,
      className: "hidden xl:table-cell",
      headerClassName: "hidden xl:table-cell",
    },
    {
      key: "createdAt",
      header: t("common.created"),
      cell: (row) => <span className="text-sm tabular-nums text-muted-foreground">{formatDate(row.createdAt, locale, tz)}</span>,
      className: "hidden xl:table-cell",
      headerClassName: "hidden xl:table-cell",
    },
  ];

  const isConverted = leadDetail?.status === "CONVERTED";
  const isDisqualified = leadDetail?.status === "DISQUALIFIED";

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("leads.title")}
        subtitle={t("leads.subtitle")}
        actions={
          <Button onClick={openCreate} className="h-9">
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="truncate">{t("leads.createTitle")}</span>
          </Button>
        }
      />

      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SearchInput
          value={searchText}
          onChange={setSearchText}
          placeholder={t("common.search")}
          className="w-full lg:max-w-xs"
        />
        <FilterBar>
          <MultiSelectFilter
            label={t("common.status")}
            options={LEAD_STATUSES.map((s) => ({ value: s, label: t(`enums.leadStatus.${s}`) }))}
            selected={statuses}
            onChange={changeStatuses}
          />
          <MultiSelectFilter
            label={t("common.source")}
            options={LEAD_SOURCES.map((s) => ({ value: s, label: t(`enums.source.${s}`) }))}
            selected={sources}
            onChange={changeSources}
          />
          <MultiSelectFilter
            label={t("common.priority")}
            options={PRIORITIES.map((p) => ({ value: p, label: t(`enums.priority.${p}`) }))}
            selected={priorities}
            onChange={changePriorities}
          />
          <MultiSelectFilter
            label={t("common.owner")}
            options={memberOptions}
            selected={ownerIds}
            onChange={changeOwners}
          />
          <ArchivedToggle value={archived} onChange={changeArchived} />
        </FilterBar>
      </div>

      {/* Table */}
      {leadsQuery.isError ? (
        <ErrorState
          title={t("common.errorStateTitle")}
          description={t("common.errorStateDescription")}
          retryLabel={t("common.retry")}
          onRetry={() => leadsQuery.refetch()}
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={leads}
            loading={leadsQuery.isPending}
            rowActions={(row) => (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={t("common.viewDetails")}
                onClick={() => openDetail(row.id)}
              >
                <Eye className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
            emptyState={
              <EmptyState
                title={t(hasFilters ? "common.emptyFilteredTitle" : "common.emptyStateTitle")}
                description={t(hasFilters ? "common.emptyFilteredDescription" : "common.emptyStateDescription")}
                action={
                  !hasFilters ? (
                    <Button variant="outline" onClick={openCreate} className="h-9">
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      {t("leads.createTitle")}
                    </Button>
                  ) : undefined
                }
              />
            }
          />
          {total > 0 ? (
            <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} locale={locale} />
          ) : null}
        </>
      )}

      {/* ---- Detail dialog ---- */}
      <Dialog open={Boolean(selectedLeadId)} onOpenChange={(open) => !open && closeDetail()}>
        <DialogContent className="sm:max-w-2xl" dir={undefined}>
          <DialogHeader>
            <DialogTitle className="min-w-0 truncate pe-8">{leadDetail?.name ?? t("common.loading")}</DialogTitle>
            <DialogDescription className="truncate">
              {leadDetail?.email ?? leadDetail?.companyName ?? "\u00A0"}
            </DialogDescription>
          </DialogHeader>

          {leadDetail ? (
            <div className="-mx-1 max-h-[60vh] overflow-y-auto px-1">
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <LeadStatusBadge status={leadDetail.status} />
                  <PriorityBadge priority={leadDetail.priority} />
                  {leadDetail.source ? (
                    <Badge variant="secondary" className="font-normal">
                      {t(`enums.source.${leadDetail.source}`)}
                    </Badge>
                  ) : null}
                  {leadDetail.archived ? (
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      {t("common.archived")}
                    </Badge>
                  ) : null}
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                  <InfoItem label={t("common.email")} value={leadDetail.email ?? "—"} />
                  <InfoItem label={t("common.phone")} value={leadDetail.phone ?? "—"} />
                  <InfoItem label={t("leads.field.companyName")} value={leadDetail.companyName ?? "—"} />
                  <InfoItem label={t("leads.field.jobTitle")} value={leadDetail.jobTitle ?? "—"} />
                  <InfoItem
                    label={t("leads.field.estimatedValue")}
                    value={
                      leadDetail.estimatedValue != null
                        ? formatMoney(leadDetail.estimatedValue, locale, currency)
                        : "—"
                    }
                  />
                  <InfoItem
                    label={t("leads.field.nextFollowUpAt")}
                    value={
                      leadDetail.nextFollowUpAt
                        ? formatDate(leadDetail.nextFollowUpAt, locale, tz)
                        : "—"
                    }
                  />
                  <InfoItem
                    label={t("leads.field.lastContactedAt")}
                    value={
                      leadDetail.lastContactedAt ? formatDate(leadDetail.lastContactedAt, locale, tz) : "—"
                    }
                  />
                  <InfoItem label={t("common.owner")} value={leadDetail.owner?.name ?? "—"} />
                  <InfoItem label={t("common.created")} value={formatDate(leadDetail.createdAt, locale, tz)} />
                </dl>

                {leadDetail.tags?.length ? (
                  <div className="min-w-0">
                    <p className="mb-1.5 text-xs text-muted-foreground">{t("common.tags")}</p>
                    <TagBadges tags={leadDetail.tags} max={10} />
                  </div>
                ) : null}

                {leadDetail.status === "DISQUALIFIED" && leadDetail.disqualificationReason ? (
                  <div className="min-w-0">
                    <p className="mb-1.5 text-xs text-muted-foreground">{t("leads.field.disqualificationReason")}</p>
                    <p className="text-sm text-destructive">{leadDetail.disqualificationReason}</p>
                  </div>
                ) : null}

                {leadDetail.notes ? (
                  <div className="min-w-0">
                    <p className="mb-1.5 text-xs text-muted-foreground">{t("common.notes")}</p>
                    <p className="whitespace-pre-wrap text-sm">{leadDetail.notes}</p>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    disabled={logCallMutation.isPending}
                    onClick={() => logCallMutation.mutate(leadDetail.id)}
                  >
                    {logCallMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <PhoneCall className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span className="truncate">{t("leads.actions.logCall")}</span>
                  </Button>
                  <Button variant="outline" size="sm" className="h-9" onClick={() => openEdit(leadDetail)}>
                    <PenLine className="h-4 w-4" aria-hidden="true" />
                    <span className="truncate">{t("common.edit")}</span>
                  </Button>
                  {!isConverted ? (
                    <Button variant="outline" size="sm" className="h-9" onClick={openConvert}>
                      <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
                      <span className="truncate">{t("leads.actions.convert")}</span>
                    </Button>
                  ) : null}
                  {!isConverted && !isDisqualified ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() => {
                        setDisqualifyReason("");
                        setDisqualifyOpen(true);
                      }}
                    >
                      <ShieldOff className="h-4 w-4" aria-hidden="true" />
                      <span className="truncate">{t("leads.actions.disqualify")}</span>
                    </Button>
                  ) : null}
                  {leadDetail.archived ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={archiveMutation.isPending}
                      onClick={() =>
                        archiveMutation.mutate({ id: leadDetail.id, archived: false })
                      }
                    >
                      <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                      <span className="truncate">{t("common.restore")}</span>
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() =>
                        setArchiveTarget({ id: leadDetail.id, name: leadDetail.name, archived: true })
                      }
                    >
                      <Archive className="h-4 w-4" aria-hidden="true" />
                      <span className="truncate">{t("common.archive")}</span>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget({ id: leadDetail.id, name: leadDetail.name })}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span className="truncate">{t("common.delete")}</span>
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex justify-center py-8" aria-busy="true">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ---- Create / Edit form ---- */}
      <EntityFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) setFormOpen(false);
        }}
        title={editing ? t("leads.editTitle") : t("leads.createTitle")}
        loading={saveMutation.isPending}
        onSubmit={submitForm}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("common.name")} htmlFor="lead-name" required>
            <Input
              id="lead-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoComplete="off"
            />
          </FormField>
          <FormField label={t("common.email")} htmlFor="lead-email">
            <Input
              id="lead-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              autoComplete="off"
            />
          </FormField>
          <FormField label={t("common.phone")} htmlFor="lead-phone">
            <Input
              id="lead-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              autoComplete="off"
            />
          </FormField>
          <FormField label={t("leads.field.companyName")} htmlFor="lead-company">
            <Input
              id="lead-company"
              value={form.companyName}
              onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
              autoComplete="off"
            />
          </FormField>
          <FormField label={t("leads.field.jobTitle")} htmlFor="lead-job-title">
            <Input
              id="lead-job-title"
              value={form.jobTitle}
              onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))}
              autoComplete="off"
            />
          </FormField>
          <FormField label={t("common.source")} htmlFor="lead-source">
            <Select
              value={form.source || NONE}
              onValueChange={(v) => setForm((f) => ({ ...f, source: v === NONE ? "" : v }))}
            >
              <SelectTrigger id="lead-source" className="w-full">
                <SelectValue placeholder={t("common.selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("common.none")}</SelectItem>
                {LEAD_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`enums.source.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={t("common.status")} htmlFor="lead-status">
            <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
              <SelectTrigger id="lead-status" className="w-full">
                <SelectValue placeholder={t("common.selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`enums.leadStatus.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={t("common.priority")} htmlFor="lead-priority">
            <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
              <SelectTrigger id="lead-priority" className="w-full">
                <SelectValue placeholder={t("common.selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(`enums.priority.${p}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={t("common.owner")} htmlFor="lead-owner">
            <Select
              value={form.ownerId || UNASSIGNED}
              onValueChange={(v) => setForm((f) => ({ ...f, ownerId: v === UNASSIGNED ? "" : v }))}
            >
              <SelectTrigger id="lead-owner" className="w-full">
                <SelectValue placeholder={t("common.selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>{t("common.none")}</SelectItem>
                {memberOptions.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={t("leads.field.estimatedValue")} htmlFor="lead-value">
            <Input
              id="lead-value"
              inputMode="decimal"
              value={form.estimatedValue}
              onChange={(e) => setForm((f) => ({ ...f, estimatedValue: e.target.value }))}
              placeholder="0"
            />
          </FormField>
          <FormField label={t("leads.field.nextFollowUpAt")} htmlFor="lead-followup">
            <Input
              id="lead-followup"
              type="date"
              value={form.nextFollowUpAt}
              onChange={(e) => setForm((f) => ({ ...f, nextFollowUpAt: e.target.value }))}
            />
          </FormField>
          <div className="sm:col-span-2">
            <FormField label={t("common.notes")} htmlFor="lead-notes">
              <Textarea
                id="lead-notes"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </FormField>
          </div>
        </div>
        {formError ? (
          <p className="text-sm font-medium text-destructive" role="alert">
            {formError}
          </p>
        ) : null}
      </EntityFormDialog>

      {/* ---- Convert dialog ---- */}
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="sm:max-w-md" dir={undefined}>
          <DialogHeader>
            <DialogTitle>{t("leads.actions.convertTitle")}</DialogTitle>
            <DialogDescription>
              {t("leads.actions.convertDescription", { name: leadDetail?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="flex min-h-6 cursor-pointer items-center gap-2 text-sm font-medium">
              <Checkbox checked={convertAlsoDeal} onCheckedChange={(v) => setConvertAlsoDeal(v === true)} />
              <span className="truncate">{t("leads.actions.convertAlsoDeal")}</span>
            </label>
            {convertAlsoDeal ? (
              <div className="space-y-4">
                <FormField label={t("leads.actions.convertDealTitle")} htmlFor="convert-deal-title">
                  <Input
                    id="convert-deal-title"
                    value={convertDealTitle}
                    onChange={(e) => setConvertDealTitle(e.target.value)}
                    placeholder={leadDetail?.name}
                  />
                </FormField>
                <FormField label={t("leads.actions.convertDealValue")} htmlFor="convert-deal-value">
                  <Input
                    id="convert-deal-value"
                    inputMode="decimal"
                    value={convertDealValue}
                    onChange={(e) => setConvertDealValue(e.target.value)}
                    placeholder="0"
                  />
                </FormField>
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConvertOpen(false)} disabled={convertMutation.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => leadDetail && convertMutation.mutate(leadDetail.id)}
              disabled={convertMutation.isPending}
            >
              {convertMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              <span className="truncate">{t("leads.actions.convert")}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Disqualify dialog ---- */}
      <Dialog open={disqualifyOpen} onOpenChange={setDisqualifyOpen}>
        <DialogContent className="sm:max-w-md" dir={undefined}>
          <DialogHeader>
            <DialogTitle>{t("leads.actions.disqualifyTitle")}</DialogTitle>
            <DialogDescription className="truncate">{leadDetail?.name ?? "\u00A0"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="disqualify-reason">{t("leads.actions.disqualifyReason")}</Label>
            <Textarea
              id="disqualify-reason"
              rows={3}
              value={disqualifyReason}
              onChange={(e) => setDisqualifyReason(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDisqualifyOpen(false)} disabled={disqualifyMutation.isPending}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => leadDetail && disqualifyMutation.mutate(leadDetail.id)}
              disabled={disqualifyMutation.isPending}
            >
              {disqualifyMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              <span className="truncate">{t("leads.actions.disqualify")}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Archive confirm ---- */}
      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={t("common.archiveConfirmTitle")}
        description={t("common.archiveConfirmDescription", { name: archiveTarget?.name ?? "" })}
        confirmLabel={t("common.archive")}
        destructive
        loading={archiveMutation.isPending}
        onConfirm={() => archiveTarget && archiveMutation.mutate({ id: archiveTarget.id, archived: true })}
      />

      {/* ---- Delete confirm ---- */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("common.deleteConfirmTitle")}
        description={t("common.deleteConfirmDescription", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("common.delete")}
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </div>
  );
}
