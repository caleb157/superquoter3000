import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Sanitize a value bound to a numeric input.
 *  - Renders empty string for `0`, `"0"`, `null`, `undefined`, `NaN`, `Infinity`,
 *    or any non-finite number, so the field looks blank instead of showing "0"
 *    or "NaN".
 *  - Leaves valid numeric strings (e.g. "0.7", "10", "-3.5") untouched.
 */
function sanitizeNumericValue(v: unknown): unknown {
  if (v === null || v === undefined) return "";
  if (v === 0 || v === "0") return "";
  if (typeof v === "number" && !Number.isFinite(v)) return "";
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "" || trimmed.toLowerCase() === "nan") return "";
    // Preserve in-progress input like "-", ".", "0.", etc. — only blank when
    // the parsed value is a non-finite number (e.g. "NaN").
    const n = Number(trimmed);
    if (!Number.isFinite(n) && trimmed !== "-" && trimmed !== "." && trimmed !== "-.") {
      return "";
    }
  }
  return v;
}

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, value, defaultValue, inputMode, ...props }, ref) => {
    // For numeric fields, render as text + decimal inputMode so users can
    // type things like ".7" freely (native type=number rejects this in some
    // browsers and shows spinner UI we don't want). Also blank out zeros.
    const isNumber = type === "number";
    const renderedType = isNumber ? "text" : type;
    const renderedInputMode = isNumber ? (inputMode ?? "decimal") : inputMode;

    const renderedValue = isNumber && value !== undefined ? blankIfZero(value) : value;
    const renderedDefault =
      isNumber && defaultValue !== undefined ? blankIfZero(defaultValue) : defaultValue;

    return (
      <input
        type={renderedType}
        inputMode={renderedInputMode}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...(renderedValue !== undefined ? { value: renderedValue as any } : {})}
        {...(renderedDefault !== undefined ? { defaultValue: renderedDefault as any } : {})}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
