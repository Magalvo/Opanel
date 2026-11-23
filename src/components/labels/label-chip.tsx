import type { LabelColour, LabelRef } from "@/lib/schemas/labels";
import { cn } from "@/lib/utils";

/**
 * Each palette colour in light and dark mode (WS-108 section 1). Written out in full so
 * Tailwind finds every class; the accessibility check holds them to WCAG AA.
 */
export const LABEL_COLOUR_CLASSES: Record<LabelColour, string> = {
  gray: "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-950 dark:text-gray-200 dark:border-gray-800",
  red: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-800",
  orange:
    "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-200 dark:border-orange-800",
  amber:
    "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  green:
    "bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-200 dark:border-green-800",
  teal: "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-200 dark:border-teal-800",
  blue: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800",
  indigo:
    "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:border-indigo-800",
  purple:
    "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950 dark:text-purple-200 dark:border-purple-800",
  pink: "bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-950 dark:text-pink-200 dark:border-pink-800",
};

/** A label: its name always written, so colour is never the only signal (WCAG 1.4.1). */
export function LabelChip({
  label,
  className,
}: Readonly<{ label: Pick<LabelRef, "name" | "colour"> & { id?: string }; className?: string }>) {
  return (
    <span
      title={label.name}
      className={cn(
        "inline-block max-w-40 truncate rounded-full border px-2 py-0.5 text-xs font-medium",
        LABEL_COLOUR_CLASSES[label.colour],
        className,
      )}
    >
      {label.name}
    </span>
  );
}

/** A task's labels as a list of chips; nothing when it has none. */
export function LabelChips({ labels }: Readonly<{ labels: readonly LabelRef[] }>) {
  if (labels.length === 0) return null;
  return (
    <ul aria-label="Labels" className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <li key={label.id} className="min-w-0">
          <LabelChip label={label} />
        </li>
      ))}
    </ul>
  );
}
