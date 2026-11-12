import React, { useState } from "react";
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "./ui";

export interface PickerOption {
  value: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

function OptionContent({
  option,
  selected,
}: {
  option: PickerOption;
  selected: boolean;
}) {
  return (
    <>
      {option.icon ? (
        <span className="shrink-0 text-slate-500">{option.icon}</span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{option.label}</span>
        {option.description ? (
          <span className="block truncate text-[11px] text-slate-500">
            {option.description}
          </span>
        ) : null}
      </span>
      {selected ? <Check className="h-4 w-4 shrink-0 text-accent-500" /> : null}
    </>
  );
}

const optionClass =
  "group flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-300 outline-none data-[focus]:bg-white/[0.08] data-[selected]:text-slate-100 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40";

const panelClass =
  "popover z-50 max-h-72 overflow-auto p-1.5 [--anchor-gap:8px]";

export default function Picker({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchable = false,
  disabled = false,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: PickerOption[];
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const selected = options.find((option) => option.value === value) || null;

  if (searchable) {
    return <SearchablePicker
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      ariaLabel={ariaLabel}
      className={className}
      selected={selected}
    />;
  }

  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      <div className={cn("relative", className)}>
        <ListboxButton
          className="input flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={ariaLabel}
        >
          <span className={cn("truncate", !selected && "text-slate-500")}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
        </ListboxButton>
        <ListboxOptions
          anchor="bottom start"
          className={cn(panelClass, "w-[var(--button-width)]")}
        >
          {options.map((option) => (
            <ListboxOption
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className={optionClass}
            >
              <OptionContent option={option} selected={option.value === value} />
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}

function SearchablePicker({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  ariaLabel,
  className,
  selected,
}: {
  value: string;
  onChange: (value: string) => void;
  options: PickerOption[];
  placeholder: string;
  disabled: boolean;
  ariaLabel?: string;
  className?: string;
  selected: PickerOption | null;
}) {
  const [query, setQuery] = useState("");
  const filtered =
    query === ""
      ? options
      : options.filter((option) => {
          const haystack = `${option.label} ${option.description || ""}`.toLowerCase();
          return haystack.includes(query.toLowerCase());
        });

  return (
    <Combobox
      value={value}
      onChange={(next) => {
        onChange((next as string) ?? "");
        setQuery("");
      }}
      onClose={() => setQuery("")}
      disabled={disabled}
      immediate
    >
      <div className={cn("relative", className)}>
        <ComboboxInput
          className="input pr-10"
          displayValue={() => selected?.label ?? ""}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoComplete="off"
          spellCheck={false}
        />
        <ComboboxButton className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 transition hover:text-slate-300">
          <ChevronDown className="h-4 w-4" />
        </ComboboxButton>
        <ComboboxOptions
          anchor="bottom start"
          className={cn(panelClass, "w-[var(--input-width)]")}
        >
          {filtered.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500">
              <Search className="h-3.5 w-3.5" /> No matches
            </div>
          ) : (
            filtered.map((option) => (
              <ComboboxOption
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={optionClass}
              >
                <OptionContent option={option} selected={option.value === value} />
              </ComboboxOption>
            ))
          )}
        </ComboboxOptions>
      </div>
    </Combobox>
  );
}
