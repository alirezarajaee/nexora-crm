"use client";

import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { ApiRequestError } from "@/lib/client-api";

/**
 * Standard create/edit dialog: hosts a react-hook-form <form>,
 * handles save in-flight state and localized API error display.
 */
export function EntityFormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  loading,
  onSubmit,
  submitLabel,
  wide,
  footerExtra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  loading?: boolean;
  onSubmit: (e: React.FormEvent) => void;
  submitLabel?: string;
  wide?: boolean;
  footerExtra?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!loading) onOpenChange(next); }}>
      <DialogContent className={wide ? "sm:max-w-2xl" : "sm:max-w-lg"} dir={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <fieldset disabled={loading} className="min-w-0 space-y-4 py-1">
            {children}
          </fieldset>
          <DialogFooter className="mt-4 gap-2">
            {footerExtra}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {submitLabel ?? t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function apiErrorMessage(err: unknown, t: (key: string, params?: Record<string, unknown>) => string): string {
  if (err instanceof ApiRequestError) {
    const known = t(`errors.${err.code}`, { defaultValue: "" });
    return known || t("errors.generic");
  }
  return t("errors.generic");
}
