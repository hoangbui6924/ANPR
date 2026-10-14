// Video with tracked plate boxes. The browser plays the file at its own rate; a canvas on top redraws the
// boxes on every screen refresh from the current playback time (interpolated between the backend's samples),
// so the overlay never slows the video and seeking / pausing stays in sync.
import { useEffect, useRef, type RefObject } from "react";
import type { VideoTrack } from "@/api/types";
import { boxAt, contentRect } from "@/lib/video";
import { cn } from "@/lib/utils";

/** Box colours from the theme (same as the image boxes): 1-line, 2-line, blacklisted */
export function boxColors() {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { "1line": color("--box-1line", "#16a34a"), "2line": color("--box-2line", "#db2777"), black: color("--danger", "#dc2626") };
}

/** One plate box with its label above it (below it at the top edge of the picture `top`) */
export function drawPlateBox(
  ctx: CanvasRenderingContext2D,
  { x, y, w, h }: { x: number; y: number; w: number; h: number },
  top: number,
  label: string,
  color: string,
  highlight = false,
) {
  if (highlight) {
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 7;
    ctx.strokeRect(x, y, w, h);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  const lw = ctx.measureText(label).width + 10, lh = 20;
  const ly = y - lh - 2 >= top ? y - lh - 2 : y + h + 2;
  ctx.fillStyle = color;
  ctx.fillRect(x - 1.5, ly, lw, lh);
  ctx.fillStyle = "#fff";
  ctx.fillText(label, x + 3.5, ly + lh / 2);
}

/** Canvas sized to its element at device-pixel resolution, cleared, with the label font set */
export function prepareCanvas(c: HTMLCanvasElement, W: number, H: number) {
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  return ctx;
}

export function VideoWithBoxes({
  src,
  tracks,
  active,
  videoRef,
  className,
}: {
  src: string;
  tracks: VideoTrack[];
  active?: number | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // the draw loop reads the latest props through refs instead of restarting on every poll
  const state = useRef({ tracks, active });
  state.current = { tracks, active };

  useEffect(() => {
    const colors = boxColors();
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const v = videoRef.current, c = canvas.current;
      if (!v || !c) return;
      const W = v.clientWidth, H = v.clientHeight;
      const ctx = prepareCanvas(c, W, H);
      if (!ctx) return;
      const r = contentRect(W, H, v.videoWidth, v.videoHeight);
      const t = v.currentTime;

      for (const tr of state.current.tracks) {
        const b = boxAt(tr, t);
        if (!b) continue;
        const x = r.x + b[0] * r.w, y = r.y + b[1] * r.h, w = (b[2] - b[0]) * r.w, h = (b[3] - b[1]) * r.h;
        const black = tr.plate.list?.kind === "black";
        drawPlateBox(ctx, { x, y, w, h }, r.y, `${black ? "⚠ " : ""}${tr.plate.text}`, black ? colors.black : colors[tr.plate.type], state.current.active === tr.id);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  return (
    <div className={cn("relative w-full overflow-hidden rounded-lg bg-black", className)}>
      <video ref={videoRef} src={src} controls playsInline className="block max-h-[70vh] w-full" />
      <canvas ref={canvas} className="pointer-events-none absolute top-0 left-0 size-full" />
    </div>
  );
}
