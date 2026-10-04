// One recognized plate: crop, big plate text, vehicle, confidences, valid / blacklist status (docs 9.2)
import { Bike, Car, CheckCircle2, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import type { PlateResult } from "@/api/types";
import { Badge } from "@/components/ui";
import { PlateText } from "@/components/PlateText";
import { cn, fmt, PLATE_TYPE_LABEL, VEHICLE_LABEL } from "@/lib/utils";

function Confidence({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-fg-muted">
        <span>{label}</span>
        <span className="font-medium text-fg">{fmt.percent(value)}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", value >= 0.85 ? "bg-success" : value >= 0.6 ? "bg-warning" : "bg-danger")}
          style={{ width: `${value * 100}%` }}
        />
      </div>
    </div>
  );
}

export function PlateCard({
  plate,
  index,
  active,
  onClick,
}: {
  plate: PlateResult;
  index: number;
  active?: boolean;
  onClick?: () => void;
}) {
  const black = plate.list?.kind === "black";
  const white = plate.list?.kind === "white";
  const VehicleIcon = plate.vehicle === "motorbike" ? Bike : Car;

  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-xl border bg-surface p-4 transition",
        black ? "border-danger/60" : active ? "border-primary" : "border-border hover:border-primary/40",
      )}
    >
      {black && (
        <div role="alert" className="-mx-4 -mt-4 mb-4 flex items-start gap-2 rounded-t-xl bg-danger px-4 py-2.5 text-sm text-white">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">Cảnh báo: xe trong danh sách đen</p>
            {plate.list?.note && <p className="text-white/85">{plate.list.note}</p>}
          </div>
        </div>
      )}

      <div className="flex items-start gap-4">
        <span className="text-sm font-semibold text-fg-muted">#{index + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            {plate.cropUrl && <img src={plate.cropUrl} alt="Ảnh biển cắt" className="h-12 rounded border border-border" />}
            <PlateText text={plate.text} type={plate.type} size="lg" list={plate.list?.kind} />
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {plate.valid ? (
              <Badge tone="success">
                <CheckCircle2 className="size-3.5" /> Hợp lệ
              </Badge>
            ) : (
              <Badge tone="warning">
                <TriangleAlert className="size-3.5" /> Cần kiểm tra
              </Badge>
            )}
            <Badge>{PLATE_TYPE_LABEL[plate.type]}</Badge>
            {plate.vehicle && (
              <Badge>
                <VehicleIcon className="size-3.5" /> {VEHICLE_LABEL[plate.vehicle]}
              </Badge>
            )}
            {white && (
              <Badge tone="primary">
                <ShieldCheck className="size-3.5" /> Danh sách trắng
              </Badge>
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Confidence label="Phát hiện biển" value={plate.detConf} />
            <Confidence label="Đọc ký tự" value={plate.ocrConf} />
          </div>
          <p className="mt-3 text-xs text-fg-muted">
            Chuẩn hóa: <span className="font-mono text-fg">{plate.norm}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
