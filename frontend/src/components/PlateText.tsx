// Renders a plate string styled like a real Vietnamese plate (1 or 2 rows)
import type { ListKind, PlateType } from "@/api/types";
import { plateRows } from "@/lib/plate";
import { cn } from "@/lib/utils";

export function PlateText({
  text,
  type = "1line",
  size = "md",
  list,
}: {
  text: string;
  type?: PlateType;
  size?: "sm" | "md" | "lg";
  list?: ListKind | null;
}) {
  const rows = plateRows(text, type);
  return (
    <span
      className={cn(
        "inline-flex flex-col items-center justify-center rounded-md border-2 bg-white font-plate font-bold leading-tight tracking-wide text-slate-900 shadow-sm",
        list === "black" ? "border-danger" : "border-slate-900",
        size === "sm" && "px-2 py-0.5 text-sm",
        size === "md" && "px-3 py-1 text-lg",
        size === "lg" && "px-4 py-1.5 text-3xl",
      )}
    >
      {rows.map((r) => (
        <span key={r}>{r}</span>
      ))}
    </span>
  );
}
