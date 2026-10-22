"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MultiOption {
  value: string;
  label: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t("common.search")}
        className="ps-9"
        type="search"
        aria-label={placeholder ?? t("common.search")}
      />
    </div>
  );
}

export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  icon: Icon,
}: {
  label: string;
  options: MultiOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const { t } = useTranslation();
  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter((s) => s !== v));
    else onChange([...selected, v]);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-2 font-normal" aria-label={label}>
          {Icon ? <Icon className="h-4 w-4 text-muted-foreground" /> : <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />}
          <span className="max-w-36 truncate">{label}</span>
          {selected.length > 0 ? (
            <span className="ms-auto rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
              {selected.length}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
        {options.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{t("common.noData")}</p>
        ) : (
          options.map((opt) => (
            <DropdownMenuCheckboxItem
              key={opt.value}
              checked={selected.includes(opt.value)}
              onCheckedChange={() => toggle(opt.value)}
              onSelect={(e) => e.preventDefault()}
            >
              {opt.label}
            </DropdownMenuCheckboxItem>
          ))
        )}
        {selected.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full"
            onClick={() => onChange([])}
          >
            {t("common.clearFilters")}
          </Button>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} role="group" aria-label={t("common.filter")}>
      {children}
    </div>
  );
}

export function ArchivedToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      variant={value ? "secondary" : "outline"}
      size="sm"
      className="h-9"
      onClick={() => onChange(!value)}
      aria-pressed={value}
    >
      {t("common.showArchived")}
    </Button>
  );
}
