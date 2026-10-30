import { useState } from "react";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const DIVIDER_PRESETS = [
  ["#52525B", "Subtle gray"],
  ["#A1A1AA", "Bright gray"],
  ["#3B82F6", "Blue"],
  ["#A855F7", "Purple"],
  ["#14B8A6", "Teal"],
] as const;

export function DividerColorControl({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const valid = /^#[0-9a-fA-F]{6}$/.test(draft);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        disabled={disabled}
        value={
          DIVIDER_PRESETS.some(([color]) => color === value.toUpperCase())
            ? value.toUpperCase()
            : "custom"
        }
        onValueChange={(color) => {
          if (color && color !== "custom") onChange(color);
        }}
      >
        <SelectTrigger aria-label="Editor divider preset">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {DIVIDER_PRESETS.map(([color, label]) => (
            <SelectItem key={color} value={color}>
              {label}
            </SelectItem>
          ))}
          <SelectItem value="custom">Custom HEX</SelectItem>
        </SelectPopup>
      </Select>
      <div className="w-28">
        <Input
          disabled={disabled}
          aria-label="Editor divider HEX color"
          aria-invalid={!valid}
          maxLength={7}
          value={draft}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setDraft(next);
            if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next.toUpperCase());
          }}
          onBlur={() => {
            if (!valid) setDraft(value);
          }}
        />
      </div>
      <span
        aria-hidden
        className="size-5 rounded border border-border"
        style={{ backgroundColor: value }}
      />
    </div>
  );
}
