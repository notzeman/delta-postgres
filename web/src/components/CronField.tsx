import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { Health } from "../types";
import { Field, Input } from "./ui";
import Picker from "./Picker";

export const CRON_PRESETS = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Every 12 hours", value: "0 */12 * * *" },
  { label: "Daily at 02:00", value: "0 2 * * *" },
  { label: "Daily at 03:00", value: "0 3 * * *" },
  { label: "Weekly · Sunday 03:00", value: "0 3 * * 0" },
  { label: "Monthly · 1st at 03:00", value: "0 3 1 * *" },
];

const CUSTOM = "__custom__";

export default function CronField({
  value,
  onChange,
  label = "Schedule",
  allowInherit = false,
  inheritLabel = "Inherit global schedule",
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  allowInherit?: boolean;
  inheritLabel?: string;
  hint?: string;
}) {
  const match = CRON_PRESETS.find((preset) => preset.value === value);
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api<Health>("/health"),
    staleTime: 30_000,
  });
  const timezone = health.data?.timezone;
  const [mode, setMode] = useState<string>(() => {
    if (!value && allowInherit) return "";
    return match ? match.value : value ? CUSTOM : allowInherit ? "" : CRON_PRESETS[3].value;
  });

  useEffect(() => {
    if (!value && allowInherit) setMode("");
    else if (match) setMode(match.value);
    else if (value) setMode(CUSTOM);
  }, [value, allowInherit, match]);

  return (
    <Field label={label} hint={hint}>
      <div className="space-y-2">
        <Picker
          value={mode}
          onChange={(next) => {
            setMode(next);
            if (next === "") onChange("");
            else if (next !== CUSTOM) onChange(next);
            else if (!value || match) onChange("0 2 * * *");
          }}
          options={[
            ...(allowInherit ? [{ value: "", label: inheritLabel }] : []),
            ...CRON_PRESETS.map((preset) => ({
              value: preset.value,
              label: preset.label,
            })),
            { value: CUSTOM, label: "Custom cron expression" },
          ]}
          placeholder={inheritLabel}
          ariaLabel={label}
        />
        {mode === CUSTOM ? (
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="0 2 * * *"
            spellCheck={false}
            className="font-mono"
          />
        ) : null}
        {mode ? (
          <p className="text-xs text-slate-500">
            <span className="num">{value || "inherits global schedule"}</span>
            {timezone ? <> in {timezone}</> : null}
          </p>
        ) : null}
      </div>
    </Field>
  );
}
