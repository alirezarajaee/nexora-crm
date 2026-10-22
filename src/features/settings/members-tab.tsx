"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Info, Trash2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/shared/states";
import { api, ApiRequestError } from "@/lib/client-api";
import { useApiToast, useMembers, useWorkspaceId, useWorkspaceRole } from "@/hooks/use-workspace";
import type { MemberInfo, Role } from "@/types/api";

interface AddMemberForm {
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "MEMBER";
}

const DEFAULT_ADD_FORM: AddMemberForm = { name: "", email: "", password: "", role: "MEMBER" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function MembersTab() {
  const { t } = useTranslation();
  const workspaceId = useWorkspaceId();
  const myRole = useWorkspaceRole();
  const canManage = myRole === "OWNER" || myRole === "ADMIN";
  const queryClient = useQueryClient();
  const { apiError } = useApiToast();

  const membersQuery = useMembers();
  const members = membersQuery.data ?? [];

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<AddMemberForm>(DEFAULT_ADD_FORM);
  const [removing, setRemoving] = useState<MemberInfo | null>(null);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["members", workspaceId] });

  const addMutation = useMutation({
    mutationFn: (form: AddMemberForm) =>
      api.post<MemberInfo>("/workspaces/members", { workspaceId, ...form }, workspaceId),
    onSuccess: () => {
      toast.success(t("settings.members.added"));
      setAddOpen(false);
      setAddForm(DEFAULT_ADD_FORM);
      invalidate();
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.code === "ALREADY_MEMBER") {
        toast.error(t("settings.members.alreadyMember"));
        return;
      }
      apiError(err);
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      api.patch("/workspaces/members", { workspaceId, userId, role }, workspaceId),
    onSuccess: () => {
      toast.success(t("settings.members.roleUpdated"));
      invalidate();
    },
    onError: (err) => apiError(err),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      api.delete("/workspaces/members", { workspaceId, userId }, workspaceId),
    onSuccess: () => {
      toast.success(t("settings.members.removed"));
      setRemoving(null);
      invalidate();
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.code === "CANNOT_REMOVE_OWNER") {
        toast.error(t("settings.members.cannotRemoveOwner"));
        return;
      }
      apiError(err);
    },
  });

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (addForm.name.trim().length < 2) {
      toast.error(t("validation.nameRequired"));
      return;
    }
    if (!EMAIL_RE.test(addForm.email.trim())) {
      toast.error(t("validation.email"));
      return;
    }
    if (addForm.password.length < 8) {
      toast.error(t("validation.passwordLength"));
      return;
    }
    addMutation.mutate({ ...addForm, name: addForm.name.trim(), email: addForm.email.trim() });
  };

  if (membersQuery.isLoading) {
    return <LoadingState rows={3} />;
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div
        className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm text-muted-foreground"
        role="note"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span>{t("settings.members.addMemberHint")}</span>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base">{t("settings.members.title")}</CardTitle>
            <CardDescription>{t("settings.members.roleHint")}</CardDescription>
          </div>
          {canManage ? (
            <Button className="h-9 shrink-0" onClick={() => setAddOpen(true)}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {t("settings.members.addMember")}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <ul className="divide-y" aria-label={t("settings.members.title")}>
            {members.map((member) => {
              const isOwner = member.role === "OWNER";
              return (
                <li key={member.membershipId} className="flex items-center gap-3 py-3">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary"
                    aria-hidden="true"
                  >
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {member.name}
                      {isOwner ? (
                        <span className="ms-2 align-middle">
                          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-[11px] text-primary">
                            {t(`enums.role.OWNER`)}
                          </Badge>
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground" dir="ltr">
                      {member.email}
                    </p>
                  </div>
                  {canManage && !isOwner ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 gap-1 font-normal">
                            {t(`enums.role.${member.role}`)}
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {(["ADMIN", "MEMBER"] as const).map((r) => (
                            <DropdownMenuItem
                              key={r}
                              disabled={member.role === r || roleMutation.isPending}
                              onClick={() => roleMutation.mutate({ userId: member.userId, role: r })}
                            >
                              {t(`enums.role.${r}`)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setRemoving(member)}
                        aria-label={`${t("common.delete")} — ${member.name}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <EntityFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title={t("settings.members.addMemberTitle")}
        loading={addMutation.isPending}
        onSubmit={submitAdd}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="member-name">{t("common.name")} *</Label>
            <Input
              id="member-name"
              className="h-9"
              value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="member-email">{t("common.email")} *</Label>
            <Input
              id="member-email"
              type="email"
              dir="ltr"
              className="h-9"
              value={addForm.email}
              onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
              maxLength={160}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="member-password">{t("settings.members.tempPassword")} *</Label>
            <Input
              id="member-password"
              type="text"
              dir="ltr"
              className="h-9"
              value={addForm.password}
              onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
              maxLength={128}
            />
            <p className="text-xs text-muted-foreground">{t("validation.passwordLength")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="member-role">{t("settings.members.role")}</Label>
            <Select
              value={addForm.role}
              onValueChange={(v) => setAddForm((f) => ({ ...f, role: v as AddMemberForm["role"] }))}
            >
              <SelectTrigger id="member-role" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MEMBER">{t("enums.role.MEMBER")}</SelectItem>
                <SelectItem value="ADMIN">{t("enums.role.ADMIN")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </EntityFormDialog>

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("common.deleteConfirmTitle")}
        description={t("settings.members.removeConfirm", { name: removing?.name ?? "" })}
        confirmLabel={t("common.delete")}
        destructive
        loading={removeMutation.isPending}
        onConfirm={() => {
          if (removing) removeMutation.mutate(removing.userId);
        }}
      />
    </div>
  );
}
