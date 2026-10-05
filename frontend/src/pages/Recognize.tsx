import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Loader2, RotateCcw, ScanSearch, ShieldAlert, Timer } from "lucide-react";
import { api } from "@/api";
import type { RecognizeResult } from "@/api/types";
import { PageHeader } from "@/components/AppLayout";
import { BoxLegend, ImageWithBoxes } from "@/components/ImageWithBoxes";
import { PlateCard } from "@/components/PlateCard";
import { UploadZone } from "@/components/UploadZone";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox } from "@/components/ui";
import { cn, fmt } from "@/lib/utils";

type Status = "pending" | "running" | "done" | "error";
interface Item {
  file: File;
  url: string; // local preview
  status: Status;
  result?: RecognizeResult;
  error?: unknown;
}

export function RecognizePage() {
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [index, setIndex] = useState(0);
  const [active, setActive] = useState<number | null>(0);
  const [skipped, setSkipped] = useState(0);
  const batch = useRef(0); // bumps on every new upload so an old queue stops
  const strip = useRef<HTMLDivElement>(null);

  const update = (i: number, patch: Partial<Item>) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  // recognize the images one after another (the backend handles one request at a time well)
  const runQueue = useCallback(
    async (list: Item[], id: number) => {
      for (let i = 0; i < list.length; i++) {
        if (batch.current !== id) return;
        update(i, { status: "running" });
        try {
          const result = await api.recognize(list[i].file);
          if (batch.current !== id) return;
          update(i, { status: "done", result });
        } catch (error) {
          if (batch.current !== id) return;
          update(i, { status: "error", error });
        }
      }
      qc.invalidateQueries({ queryKey: ["detections"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
    [qc],
  );

  const onFiles = (files: File[], skip: number) => {
    reset();
    setSkipped(skip);
    if (!files.length) return;
    const list: Item[] = files.map((file) => ({ file, url: URL.createObjectURL(file), status: "pending" }));
    const id = ++batch.current;
    setItems(list);
    setIndex(0);
    setActive(0);
    runQueue(list, id);
  };

  const reset = () => {
    batch.current++;
    setItems((xs) => {
      xs.forEach((x) => URL.revokeObjectURL(x.url));
      return [];
    });
    setSkipped(0);
  };

  const go = useCallback(
    (d: number) => {
      setIndex((i) => Math.min(Math.max(i + d, 0), Math.max(items.length - 1, 0)));
      setActive(0);
    },
    [items.length],
  );

  // ← / → switch images (ignored while typing in a field)
  useEffect(() => {
    if (items.length < 2) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, go]);

  // keep the current thumbnail centered in the strip (scroll the strip only, never the page)
  useEffect(() => {
    const s = strip.current;
    const el = s?.querySelector<HTMLElement>(`[data-i="${index}"]`);
    if (s && el) s.scrollTo({ left: el.offsetLeft - s.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
  }, [index]);

  useEffect(() => () => reset(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const item = items[index];
  const result = item?.result;
  const busy = item?.status === "pending" || item?.status === "running";
  const doneCount = items.filter((x) => x.status === "done" || x.status === "error").length;
  const multi = items.length > 1;
  const blacklisted = result?.plates.filter((p) => p.list?.kind === "black").length ?? 0;

  return (
    <>
      <PageHeader
        title="Nhận dạng biển số"
        description="Tải ảnh hoặc cả thư mục ảnh xe máy, ô tô để phát hiện và đọc biển số."
        action={
          <Button variant="secondary" disabled title="Tính năng nâng cao (chương 10)">
            <Camera className="size-4" /> Webcam realtime
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0">
          <CardHeader
            title={multi ? `Ảnh ${index + 1} / ${items.length}` : "Ảnh"}
            description={
              item ? (
                <span className="flex flex-col gap-1">
                  <span className="truncate" title={item.file.webkitRelativePath || item.file.name}>
                    {item.file.webkitRelativePath || item.file.name}
                  </span>
                  {result && <BoxLegend />}
                </span>
              ) : (
                "Ảnh gốc kèm khung biển số tìm được"
              )
            }
            action={
              item && (
                <Button variant="ghost" size="sm" onClick={reset}>
                  <RotateCcw className="size-4" /> Ảnh khác
                </Button>
              )
            }
          />
          <div className="p-5">
            {!item ? (
              <>
                <UploadZone onFiles={onFiles} />
                {skipped > 0 && (
                  <p className="mt-3 text-center text-sm text-warning">Không có ảnh JPG/PNG hợp lệ (≤ 5 MB) trong {skipped} tệp đã chọn.</p>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="flex w-full items-center justify-center gap-2 sm:gap-3">
                  {multi && (
                    <Button variant="secondary" className="size-10 shrink-0 rounded-full p-0" disabled={index === 0} onClick={() => go(-1)} aria-label="Ảnh trước (←)">
                      <ChevronLeft className="size-5" />
                    </Button>
                  )}
                  {/* flex-1 + min-w-0 lets the image shrink between the arrow buttons on small screens */}
                  <div className="flex min-w-0 flex-1 justify-center">
                    <div className="relative max-w-full">
                      <ImageWithBoxes key={item.url} src={item.url} plates={result?.plates ?? []} active={active} onSelect={setActive} />
                      {busy && (
                        <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/40 text-white">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <ScanSearch className="size-5 animate-pulse" /> {item.status === "running" ? "Đang nhận dạng…" : "Đang chờ…"}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {multi && (
                    <Button
                      variant="secondary"
                      className="size-10 shrink-0 rounded-full p-0"
                      disabled={index === items.length - 1}
                      onClick={() => go(1)}
                      aria-label="Ảnh sau (→)"
                    >
                      <ChevronRight className="size-5" />
                    </Button>
                  )}
                </div>

                {result && (
                  <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-fg-muted">
                    <Badge>
                      <Timer className="size-3.5" /> {fmt.ms(result.processMs)}
                    </Badge>
                    <Badge>Mã lần nhận dạng #{result.detectionId}</Badge>
                  </div>
                )}
                {item.status === "error" && <ErrorBox error={item.error} />}

                {multi && (
                  <div className="w-full space-y-2">
                    <div className="flex items-center justify-between text-xs text-fg-muted">
                      <span>
                        Đã xử lý {doneCount}/{items.length} ảnh{skipped ? ` · bỏ qua ${skipped} tệp không phải ảnh` : ""}
                      </span>
                      <span>← → để chuyển ảnh</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary transition-all" style={{ width: `${(doneCount / items.length) * 100}%` }} />
                    </div>
                    <div ref={strip} className="relative flex gap-2 overflow-x-auto pb-2">
                      {items.map((x, i) => {
                        const black = x.result?.plates.some((p) => p.list?.kind === "black");
                        return (
                          <button
                            key={x.url}
                            data-i={i}
                            type="button"
                            onClick={() => {
                              setIndex(i);
                              setActive(0);
                            }}
                            title={x.file.name}
                            className={cn(
                              "relative size-16 shrink-0 overflow-hidden rounded-lg border-2 transition",
                              i === index ? "border-primary" : "border-transparent opacity-70 hover:opacity-100",
                            )}
                          >
                            <img src={x.url} alt="" loading="lazy" className="size-full object-cover" />
                            <span className="absolute right-0.5 bottom-0.5 grid size-5 place-items-center rounded-full bg-surface shadow">
                              {x.status === "running" && <Loader2 className="size-3.5 animate-spin text-primary" />}
                              {x.status === "pending" && <span className="size-2 rounded-full bg-fg-muted/50" />}
                              {x.status === "error" && <CircleAlert className="size-3.5 text-danger" />}
                              {x.status === "done" &&
                                (black ? <ShieldAlert className="size-3.5 text-danger" /> : <CheckCircle2 className="size-3.5 text-success" />)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        <Card className="min-w-0 self-start">
          <CardHeader
            title="Kết quả"
            description={
              result
                ? `Tìm thấy ${result.plates.length} biển số${blacklisted ? ` · ${blacklisted} trong danh sách đen` : ""}`
                : "Chuỗi biển số, loại xe, độ tin cậy"
            }
          />
          <div className="space-y-3 p-4">
            {!item && (
              <EmptyState icon={<ScanSearch className="size-8" />} title="Chưa có kết quả">
                Chọn ảnh hoặc thư mục để bắt đầu. Kết quả sẽ được lưu vào lịch sử.
              </EmptyState>
            )}
            {busy && <div className="h-40 animate-pulse rounded-xl bg-muted" />}
            {result?.plates.length === 0 && (
              <EmptyState title="Không tìm thấy biển số">Thử ảnh rõ hơn hoặc chụp gần biển số hơn.</EmptyState>
            )}
            {result?.plates.map((p, i) => (
              <PlateCard key={i} plate={p} index={i} active={active === i} onClick={() => setActive(i)} />
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
