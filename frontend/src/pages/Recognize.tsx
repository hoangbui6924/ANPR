import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, RotateCcw, ScanSearch, Timer } from "lucide-react";
import { api } from "@/api";
import { PageHeader } from "@/components/AppLayout";
import { BoxLegend, ImageWithBoxes } from "@/components/ImageWithBoxes";
import { PlateCard } from "@/components/PlateCard";
import { UploadZone } from "@/components/UploadZone";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox } from "@/components/ui";
import { fmt } from "@/lib/utils";

export function RecognizePage() {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(0);

  const recognize = useMutation({
    mutationFn: (file: File) => api.recognize(file),
    onSuccess: () => {
      setActive(0);
      qc.invalidateQueries({ queryKey: ["detections"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const onFile = (file: File) => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    recognize.mutate(file);
  };

  const reset = () => {
    recognize.reset();
    setPreview(null);
  };

  const result = recognize.data;
  const blacklisted = result?.plates.filter((p) => p.list?.kind === "black").length ?? 0;

  return (
    <>
      <PageHeader
        title="Nhận dạng biển số"
        description="Tải ảnh xe máy hoặc ô tô lên để phát hiện và đọc biển số."
        action={
          <Button variant="secondary" disabled title="Tính năng nâng cao (chương 10)">
            <Camera className="size-4" /> Webcam realtime
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card>
          <CardHeader
            title="Ảnh"
            description={result ? <BoxLegend /> : "Ảnh gốc kèm khung biển số tìm được"}
            action={
              preview && (
                <Button variant="ghost" size="sm" onClick={reset} disabled={recognize.isPending}>
                  <RotateCcw className="size-4" /> Ảnh khác
                </Button>
              )
            }
          />
          <div className="p-5">
            {!preview ? (
              <UploadZone onFile={onFile} />
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  <ImageWithBoxes
                    src={result?.imageUrl ?? preview}
                    plates={result?.plates ?? []}
                    active={active}
                    onSelect={setActive}
                  />
                  {recognize.isPending && (
                    <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/40 text-white">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <ScanSearch className="size-5 animate-pulse" /> Đang nhận dạng…
                      </div>
                    </div>
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
              </div>
            )}
            {recognize.isError && (
              <div className="mt-4">
                <ErrorBox error={recognize.error} />
              </div>
            )}
          </div>
        </Card>

        <Card className="self-start">
          <CardHeader
            title="Kết quả"
            description={
              result
                ? `Tìm thấy ${result.plates.length} biển số${blacklisted ? ` · ${blacklisted} trong danh sách đen` : ""}`
                : "Chuỗi biển số, loại xe, độ tin cậy"
            }
          />
          <div className="space-y-3 p-4">
            {!result && !recognize.isPending && (
              <EmptyState icon={<ScanSearch className="size-8" />} title="Chưa có kết quả">
                Chọn một ảnh để bắt đầu. Kết quả sẽ được lưu vào lịch sử.
              </EmptyState>
            )}
            {recognize.isPending && <div className="h-40 animate-pulse rounded-xl bg-muted" />}
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
