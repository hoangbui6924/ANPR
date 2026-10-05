// Image with plate boxes drawn from the bbox returned by the API (docs 9.2).
// Boxes are positioned in % of the image's natural size, so they stay aligned at any display size.
import { useState } from "react";
import type { PlateResult } from "@/api/types";
import { cn } from "@/lib/utils";

export function ImageWithBoxes({
  src,
  plates,
  active,
  onSelect,
  className,
}: {
  src: string;
  plates: PlateResult[];
  active?: number | null;
  onSelect?: (index: number) => void;
  className?: string;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  return (
    <div className={cn("relative inline-block max-w-full overflow-hidden rounded-lg bg-muted", className)}>
      <img
        src={src}
        alt="Ảnh nhận dạng"
        className="block max-h-[78vh] w-auto max-w-full"
        onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      />
      {size &&
        plates.map((p, i) => {
          const [x1, y1, x2, y2] = p.bbox;
          const black = p.list?.kind === "black";
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect?.(i)}
              title={p.text}
              className={cn(
                "absolute rounded-sm border-[3px] transition",
                black ? "border-danger" : p.type === "1line" ? "border-box-1line" : "border-box-2line",
                active === i && "ring-4 ring-white/70",
              )}
              style={{
                left: `${(x1 / size.w) * 100}%`,
                top: `${(y1 / size.h) * 100}%`,
                width: `${((x2 - x1) / size.w) * 100}%`,
                height: `${((y2 - y1) / size.h) * 100}%`,
              }}
            >
              <span
                className={cn(
                  "absolute -top-6 left-[-3px] whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold text-white",
                  black ? "bg-danger" : p.type === "1line" ? "bg-box-1line" : "bg-box-2line",
                )}
              >
                {i + 1}. {p.text}
              </span>
            </button>
          );
        })}
    </div>
  );
}

export function BoxLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-fg-muted">
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border-2 border-box-1line" /> Biển 1 dòng
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border-2 border-box-2line" /> Biển 2 dòng
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border-2 border-danger" /> Danh sách đen
      </span>
    </div>
  );
}
