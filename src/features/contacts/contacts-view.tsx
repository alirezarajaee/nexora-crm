"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  Eye,
  Handshake,
  Info,
  ListChecks,
  Loader2,
  Mail,
  NotebookPen,
  PenLine,
  PhoneCall,
  Plus,
  Repeat,
  Trash2,
  Users,
} from "lucide-react";

import { useAppStore } from "@/store/app-store";
import {
  useApiToast,
  useLocaleTz,
  useMemberOptions,
  useWorkspaceCurrency,
  useWorkspaceId,
} from "@/hooks/use-workspace";
import { api } from "@/lib/client-api";
import {
  formatDate,
  formatDateInputValue,
  formatMoney,
  formatNumber,
  formatRelative,
  isOverdue,
} from "@/lib/format";
import type {
  Activity,
  Company,
  Contact,
  CustomFieldValueInfo,
  Deal,
  Paginated,
  Task,
} from "@/types/api";

import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { DataTable, TablePagination, type Column } from "@/components/shared/data-table";
import { ArchivedToggle, FilterBar, MultiSelectFilter, SearchInput } from "@/components/shared/filters";
import { PriorityBadge, TagBadges } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const NO_COMPANY = "__no_company__";
const UNASSIGNED = "__unassigned__";

interface ContactDetail extends Contact {
  company?: { id: string; name: string } | null;
  deals: Deal[];
  tasks: Task[];
  activities: Activity[];
}

interface ContactFormState {
  name: string;
  email: string;
  phone: string;
  jobTitle: string;
  companyId: string;
  ownerId: string;
  nextFollowUpAt: string;
  notes: string;
}

const EMPTY_FORM: ContactFormState = {
  name: "",
  email: "",
  phone: "",
  jobTitle: "",
  companyId: "",
  ownerId: "",
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

const ACTIVITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  CALL: PhoneCall,
  MEETING: Users,
  EMAIL: Mail,
  NOTE: NotebookPen,
  TASK_EVENT: ListChecks,
  STAGE_CHANGE: Handshake,
  CONVERSION: Repeat,
  SYSTEM: Info,
};

function ActivityTimeline({ activities }: { activities: Activity[] }) {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  if (!activities.length) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground" role="status">
        {t("activities.empty")}
      </p>
    );
  }
  return (
    <ol className="space-y-4" aria-label={t("contacts.tabs.timeline")}>
      {activities.map((a) => {
        const Icon = ACTIVITY_ICONS[a.type] ?? Info;
        const internal = /^[A-Z0-9_]+$/.test(a.title);
        const primary = internal ? t(`enums.activityType.${a.type}`, { defaultValue: a.title }) : a.title;
        return (
          <li key={a.id} className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-muted/40">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{primary}</p>
              {a.content ? (
                <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {a.content}
                </p>
              ) : null}
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t("activities.byUser", { name: a.user?.name ?? "—" })} · {formatRelative(a.createdAt, locale, t)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ContactsView() {
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

  const changeOwners = (values: string[]) => {
    setOwnerIds(values);
    setPage(1);
  };
  const changeArchived = (value: boolean) => {
    setArchived(value);
    setPage(1);
  };

  const hasFilters = q.length > 0 || ownerIds.length > 0;

  // ---- Company options for the form select ----
  const companiesOptionsQuery = useQuery({
    queryKey: ["companies", workspaceId, "options"],
    queryFn: () => api.get<Paginated<Company>>("/companies", { pageSize: 100 }, workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
  const companyOptions = companiesOptionsQuery.data?.items ?? [];

  // ---- List ----
  const contactsQuery = useQuery({
    queryKey: ["contacts", workspaceId, { q, ownerIds, archived, page }],
    queryFn: () =>
      api.get<Paginated<Contact>>(
        "/contacts",
        {
          q: q || undefined,
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
  const contacts = contactsQuery.data?.items ?? [];
  const total = contactsQuery.data?.total ?? 0;

  // ---- Detail ----
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const detailQuery = useQuery({
    queryKey: ["contact", workspaceId, selectedContactId],
    queryFn: () => api.get<ContactDetail>(`/contacts/${selectedContactId}`, undefined, workspaceId),
    enabled: Boolean(workspaceId && selectedContactId),
  });
  const selectedRowContact = contacts.find((c) => c.id === selectedContactId) ?? null;
  // Full detail (deals/tasks/activities) only exists in the detail query result;
  // the list row is used just to render the dialog header immediately.
  const headerContact: Contact | null = detailQuery.data ?? selectedRowContact;
  const contactDetail = detailQuery.data;

  const openDetail = (id: string) => setSelectedContactId(id);
  const closeDetail = () => setSelectedContactId(null);

  const invalidateContacts = () => {
    queryClient.invalidateQueries({ queryKey: ["contacts"] });
    queryClient.invalidateQueries({ queryKey: ["contact"] });
  };

  // ---- Deep link (viewParams.contactId) ----
  useEffect(() => {
    const id = viewParams.contactId;
    if (!id) return;
    const timer = window.setTimeout(() => {
      setSelectedContactId(id);
      navigate("contacts");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [viewParams.contactId, navigate]);

  // ---- Form (create / edit) ----
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState<ContactFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState("");

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setFormOpen(true);
  };

  const openEdit = (contact: Contact) => {
    setEditing(contact);
    setForm({
      name: contact.name,
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      jobTitle: contact.jobTitle ?? "",
      companyId: contact.companyId ?? "",
      ownerId: contact.ownerId ?? "",
      nextFollowUpAt: formatDateInputValue(contact.nextFollowUpAt),
      notes: contact.notes ?? "",
    });
    setFormError("");
    setFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api.patch<Contact>(`/contacts/${editing.id}`, payload, workspaceId)
        : api.post<Contact>("/contacts", payload, workspaceId),
    onSuccess: () => {
      apiToast.success(t(editing ? "contacts.updatedToast" : "contacts.createdToast"));
      setFormOpen(false);
      invalidateContacts();
    },
    onError: (err: unknown) => {
      apiToast.apiError(err);
      if ((err as { code?: string })?.code === "DUPLICATE") {
        setFormError(t("contacts.duplicateWarning"));
      }
    },
  });

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError(t("validation.nameRequired"));
      return;
    }
    setFormError("");
    saveMutation.mutate({
      workspaceId,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      jobTitle: form.jobTitle.trim(),
      companyId: form.companyId,
      ownerId: form.ownerId,
      nextFollowUpAt: toIsoOrNull(form.nextFollowUpAt),
      notes: form.notes,
    });
  };

  // ---- Archive / Restore ----
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string; archived: boolean } | null>(null);

  const archiveMutation = useMutation({
    mutationFn: (vars: { id: string; archived: boolean }) =>
      api.patch<Contact>(`/contacts/${vars.id}`, { workspaceId, archived: vars.archived }, workspaceId),
    onSuccess: (_data, vars) => {
      apiToast.success(t(vars.archived ? "contacts.archivedToast" : "contacts.restoredToast"));
      setArchiveTarget(null);
      invalidateContacts();
    },
    onError: (err: unknown) => apiToast.apiError(err),
  });

  // ---- Delete ----
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/contacts/${id}`, undefined, workspaceId),
    onSuccess: () => {
      apiToast.success(t("contacts.deletedToast"));
      setDeleteTarget(null);
      closeDetail();
      invalidateContacts();
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
    onError: (err: unknown) => apiToast.apiError(err),
  });

  // ---- Columns ----
  const columns: Column<Contact>[] = [
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
      header: t("contacts.field.company"),
      cell: (row) => <span className="block max-w-40 truncate text-sm">{row.company?.name ?? "—"}</span>,
      className: "hidden md:table-cell",
      headerClassName: "hidden md:table-cell",
    },
    {
      key: "jobTitle",
      header: t("contacts.field.jobTitle"),
      cell: (row) => <span className="block max-w-36 truncate text-sm">{row.jobTitle ?? "—"}</span>,
      className: "hidden md:table-cell",
      headerClassName: "hidden md:table-cell",
    },
    {
      key: "phone",
      header: t("common.phone"),
      cell: (row) => <span className="text-sm tabular-nums" dir="ltr">{row.phone ?? "—"}</span>,
      className: "hidden sm:table-cell",
      headerClassName: "hidden sm:table-cell",
    },
    {
      key: "followUp",
      header: t("contacts.field.nextFollowUpAt"),
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
      cell: (row) => (
        <span className="text-sm tabular-nums text-muted-foreground">{formatDate(row.createdAt, locale, tz)}</span>
      ),
      className: "hidden xl:table-cell",
      headerClassName: "hidden xl:table-cell",
    },
  ];

  const customFieldLabel = (f: CustomFieldValueInfo): string => {
    if (f.value == null || f.value === "") return "—";
    switch (f.type) {
      case "BOOLEAN":
        return f.value === "true" ? t("common.yes") : t("common.no");
      case "DATE":
        return formatDate(f.value, locale, tz);
      case "NUMBER": {
        const n = Number(f.value);
        return Number.isFinite(n) ? formatNumber(n, locale) : f.value;
      }
      default:
        return f.value;
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("contacts.title")}
        subtitle={t("contacts.subtitle")}
        actions={
          <Button onClick={openCreate} className="h-9">
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="truncate">{t("contacts.createTitle")}</span>
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
            label={t("common.owner")}
            options={memberOptions}
            selected={ownerIds}
            onChange={changeOwners}
          />
          <ArchivedToggle value={archived} onChange={changeArchived} />
        </FilterBar>
      </div>

      {/* Table */}
      {contactsQuery.isError ? (
        <ErrorState
          title={t("common.errorStateTitle")}
          description={t("common.errorStateDescription")}
          retryLabel={t("common.retry")}
          onRetry={() => contactsQuery.refetch()}
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={contacts}
            loading={contactsQuery.isPending}
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
                      {t("contacts.createTitle")}
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

      {/* ---- Detail dialog with tabs ---- */}
      <Dialog open={Boolean(selectedContactId)} onOpenChange={(open) => !open && closeDetail()}>
        <DialogContent className="sm:max-w-2xl" dir={undefined}>
          <DialogHeader>
            <DialogTitle className="min-w-0 truncate pe-8">
              {headerContact?.name ?? t("common.loading")}
            </DialogTitle>
            <DialogDescription className="truncate">
              {headerContact?.email ?? headerContact?.company?.name ?? "\u00A0"}
            </DialogDescription>
          </DialogHeader>

          {contactDetail ? (
            <div className="-mx-1 max-h-[60vh] overflow-y-auto px-1">
              <Tabs defaultValue="overview">
                <TabsList className="max-w-full justify-start overflow-x-auto">
                  <TabsTrigger value="overview">{t("contacts.tabs.overview")}</TabsTrigger>
                  <TabsTrigger value="deals">{t("contacts.tabs.deals")}</TabsTrigger>
                  <TabsTrigger value="tasks">{t("contacts.tabs.tasks")}</TabsTrigger>
                  <TabsTrigger value="timeline">{t("contacts.tabs.timeline")}</TabsTrigger>
                </TabsList>

                {/* Overview */}
                <TabsContent value="overview" className="mt-4 space-y-5">
                  <div className="flex flex-wrap items-center gap-2">
                    {contactDetail.company?.name ? (
                      <Badge variant="secondary" className="max-w-48 font-normal">
                        <span className="truncate">{contactDetail.company.name}</span>
                      </Badge>
                    ) : null}
                    {contactDetail.archived ? (
                      <Badge variant="outline" className="font-normal text-muted-foreground">
                        {t("common.archived")}
                      </Badge>
                    ) : null}
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                    <InfoItem label={t("common.email")} value={contactDetail.email ?? "—"} />
                    <InfoItem label={t("common.phone")} value={contactDetail.phone ?? "—"} />
                    <InfoItem label={t("contacts.field.jobTitle")} value={contactDetail.jobTitle ?? "—"} />
                    <InfoItem label={t("contacts.field.company")} value={contactDetail.company?.name ?? "—"} />
                    <InfoItem label={t("common.owner")} value={contactDetail.owner?.name ?? "—"} />
                    <InfoItem
                      label={t("contacts.field.nextFollowUpAt")}
                      value={
                        contactDetail.nextFollowUpAt
                          ? formatDate(contactDetail.nextFollowUpAt, locale, tz)
                          : "—"
                      }
                    />
                    <InfoItem
                      label={t("contacts.field.lastContactedAt")}
                      value={
                        contactDetail.lastContactedAt
                          ? formatDate(contactDetail.lastContactedAt, locale, tz)
                          : "—"
                      }
                    />
                    <InfoItem label={t("common.created")} value={formatDate(contactDetail.createdAt, locale, tz)} />
                  </dl>

                  {contactDetail.customFields?.length ? (
                    <div className="min-w-0">
                      <p className="mb-1.5 text-xs text-muted-foreground">{t("contacts.tabs.customFields")}</p>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                        {contactDetail.customFields.map((f) => (
                          <InfoItem key={f.fieldId} label={f.label} value={customFieldLabel(f)} />
                        ))}
                      </dl>
                    </div>
                  ) : null}

                  {contactDetail.tags?.length ? (
                    <div className="min-w-0">
                      <p className="mb-1.5 text-xs text-muted-foreground">{t("common.tags")}</p>
                      <TagBadges tags={contactDetail.tags} max={10} />
                    </div>
                  ) : null}

                  {contactDetail.notes ? (
                    <div className="min-w-0">
                      <p className="mb-1.5 text-xs text-muted-foreground">{t("common.notes")}</p>
                      <p className="whitespace-pre-wrap text-sm">{contactDetail.notes}</p>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2 border-t pt-4">
                    <Button variant="outline" size="sm" className="h-9" onClick={() => openEdit(contactDetail)}>
                      <PenLine className="h-4 w-4" aria-hidden="true" />
                      <span className="truncate">{t("common.edit")}</span>
                    </Button>
                    {contactDetail.archived ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        disabled={archiveMutation.isPending}
                        onClick={() => archiveMutation.mutate({ id: contactDetail.id, archived: false })}
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
                          setArchiveTarget({ id: contactDetail.id, name: contactDetail.name, archived: true })
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
                      onClick={() => setDeleteTarget({ id: contactDetail.id, name: contactDetail.name })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      <span className="truncate">{t("common.delete")}</span>
                    </Button>
                  </div>
                </TabsContent>

                {/* Deals */}
                <TabsContent value="deals" className="mt-4">
                  {contactDetail.deals.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground" role="status">
                      {t("common.noData")}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {contactDetail.deals.map((d) => (
                        <li
                          key={d.id}
                          className="flex items-center justify-between gap-3 rounded-lg border p-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{d.title}</p>
                            <p className="truncate text-xs text-muted-foreground">{d.stage?.name ?? "—"}</p>
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">
                            {formatMoney(d.value, locale, d.currency || currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                {/* Tasks */}
                <TabsContent value="tasks" className="mt-4">
                  {contactDetail.tasks.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground" role="status">
                      {t("common.noData")}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {contactDetail.tasks.map((task) => (
                        <li key={task.id} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="min-w-0 truncate text-sm font-medium">{task.title}</p>
                            <Badge
                              variant="outline"
                              className={cn(
                                "shrink-0 font-normal",
                                task.status === "DONE"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-amber-600 dark:text-amber-400"
                              )}
                            >
                              {t(`enums.taskStatus.${task.status}`)}
                            </Badge>
                          </div>
                          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span
                              className={cn(
                                "truncate tabular-nums",
                                task.status === "OPEN" && isOverdue(task.dueAt) && "font-medium text-destructive"
                              )}
                            >
                              {task.dueAt ? formatDate(task.dueAt, locale, tz) : t("time.noDueDate")}
                            </span>
                            {task.status === "OPEN" && isOverdue(task.dueAt) ? (
                              <span className="shrink-0 text-destructive">· {t("time.overdue")}</span>
                            ) : null}
                          </p>
                          <div className="mt-1.5">
                            <PriorityBadge priority={task.priority} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>

                {/* Timeline */}
                <TabsContent value="timeline" className="mt-4">
                  <ActivityTimeline activities={contactDetail.activities} />
                </TabsContent>
              </Tabs>
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
        title={editing ? t("contacts.editTitle") : t("contacts.createTitle")}
        loading={saveMutation.isPending}
        onSubmit={submitForm}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("common.name")} htmlFor="contact-name" required>
            <Input
              id="contact-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoComplete="off"
            />
          </FormField>
          <FormField label={t("common.email")} htmlFor="contact-email">
            <Input
              id="contact-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              autoComplete="off"
            />
          </FormField>
          <FormField label={t("common.phone")} htmlFor="contact-phone">
            <Input
              id="contact-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              autoComplete="off"
            />
          </FormField>
          <FormField label={t("contacts.field.jobTitle")} htmlFor="contact-job-title">
            <Input
              id="contact-job-title"
              value={form.jobTitle}
              onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))}
              autoComplete="off"
            />
          </FormField>
          <FormField label={t("contacts.field.company")} htmlFor="contact-company">
            <Select
              value={form.companyId || NO_COMPANY}
              onValueChange={(v) => setForm((f) => ({ ...f, companyId: v === NO_COMPANY ? "" : v }))}
            >
              <SelectTrigger id="contact-company" className="w-full">
                <SelectValue placeholder={t("common.selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COMPANY}>{t("common.none")}</SelectItem>
                {companyOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={t("common.owner")} htmlFor="contact-owner">
            <Select
              value={form.ownerId || UNASSIGNED}
              onValueChange={(v) => setForm((f) => ({ ...f, ownerId: v === UNASSIGNED ? "" : v }))}
            >
              <SelectTrigger id="contact-owner" className="w-full">
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
          <FormField label={t("contacts.field.nextFollowUpAt")} htmlFor="contact-followup">
            <Input
              id="contact-followup"
              type="date"
              value={form.nextFollowUpAt}
              onChange={(e) => setForm((f) => ({ ...f, nextFollowUpAt: e.target.value }))}
            />
          </FormField>
          <div className="sm:col-span-2">
            <FormField label={t("common.notes")} htmlFor="contact-notes">
              <Textarea
                id="contact-notes"
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
