// Live camera (congvieccanlam.md, giai đoạn 3): the webcam is shown by the browser itself (never slowed down);
// frames go to the backend one at a time (the next one only after the answer, so delay never piles up);
// plate boxes are drawn on a canvas and carried along their motion between answers.
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, CameraOff, Gauge, ScanSearch, ShieldAlert, Timer } from "lucide-react";
import { api } from "@/api";
import type { LiveBox, SavedVehicle } from "@/api/types";
import { PageHeader } from "@/components/AppLayout";
import { BoxLegend } from "@/components/ImageWithBoxes";
import { PlateCard } from "@/components/PlateCard";
import { boxColors, drawPlateBox, prepareCanvas } from "@/components/VideoWithBoxes";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Select } from "@/components/ui";
import { contentRect, predictBox, type Box } from "@/lib/video";
import { cn, fmt } from "@/lib/utils";

const MAX_SIDE = 1280; // frames sent to the backend are at most this wide / tall
const JPEG_QUALITY = 0.8;
const DEVICE_KEY = "anpr.cameraDevice"; // the chosen camera, remembered on this browser

/** getUserMedia errors in words the user can act on */
function cameraError(e: unknown) {
  const name = e instanceof DOMException ? e.name : "";
  const msg: Record<string, string> = {
    NotFoundError: "Không tìm thấy camera nào trên máy. Hãy cắm webcam, hoặc dùng điện thoại làm webcam (DroidCam, Iriun…), rồi thử lại.",
    NotAllowedError: "Chưa được cấp quyền dùng camera. Bấm biểu tượng ổ khóa cạnh thanh địa chỉ để cho phép camera, rồi thử lại.",
    NotReadableError: "Camera đang được ứng dụng khác dùng (Zoom, Teams, Camera…). Hãy tắt ứng dụng đó rồi thử lại.",
    OverconstrainedError: "Camera đã chọn không còn kết nối. Hãy chọn camera khác trong danh sách.",
  };
  return msg[name] ? new Error(msg[name]) : e;
}

function readDevice() {
  try {
    return localStorage.getItem(DEVICE_KEY) ?? "";
  } catch {
    return "";
  }
}

type Live = Omit<LiveBox, "box"> & { samples: { t: number; box: Box }[]; missed: number };

export function CameraPage() {
  const qc = useQueryClient();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(new Map<number, Live>()); // drawn every screen refresh, updated by every answer
  const run = useRef<{ stop: boolean; done: Promise<void> } | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "running" | "stopping">("idle");
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<(SavedVehicle & { at: string })[]>([]);
  const [stats, setStats] = useState<{ fps: number; ms: number; size: string } | null>(null);
  const [alert, setAlert] = useState<SavedVehicle | null>(null);
  // cameras: a laptop webcam plus e.g. a phone used as a webcam (names are only known once access was granted)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState(readDevice);

  const listDevices = () =>
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === "videoinput")))
      .catch(() => {});

  useEffect(() => {
    listDevices();
    navigator.mediaDevices?.addEventListener("devicechange", listDevices); // a phone plugged in / out
    return () => navigator.mediaDevices?.removeEventListener("devicechange", listDevices);
  }, []);

  const chooseDevice = (id: string) => {
    setDeviceId(id);
    try {
      localStorage.setItem(DEVICE_KEY, id);
    } catch {
      /* private mode: just not remembered */
    }
  };

  const addSaved = (xs: SavedVehicle[]) => {
    if (!xs.length) return;
    const at = new Date().toISOString();
    setSaved((cur) => [...xs.map((x) => ({ ...x, at })).reverse(), ...cur]);
    const black = xs.find((x) => x.plate.list?.kind === "black");
    if (black) setAlert(black);
    qc.invalidateQueries({ queryKey: ["detections"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  };

  async function start() {
    setError(null);
    setAlert(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(new Error("Trình duyệt không cho dùng camera. Hãy mở trang qua localhost hoặc HTTPS."));
      return;
    }
    setStatus("starting");
    let stream: MediaStream | null = null;
    try {
      const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
      const chosen = devices.some((d) => d.deviceId === deviceId) ? deviceId : "";
      stream = await navigator.mediaDevices.getUserMedia({
        video: chosen ? { ...size, deviceId: { exact: chosen } } : { ...size, facingMode: "environment" },
        audio: false,
      });
      listDevices(); // names become visible after the first permission
      const v = video.current!;
      v.srcObject = stream;
      await v.play();
      const { id } = await api.cameraStart();
      const ctl = { stop: false, done: Promise.resolve() };
      ctl.done = loop(id, v, ctl, stream);
      run.current = ctl;
      setStatus("running");
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      setError(cameraError(e));
      setStatus("idle");
    }
  }

  async function loop(id: string, v: HTMLVideoElement, ctl: { stop: boolean }, stream: MediaStream) {
    const grab = document.createElement("canvas");
    const times: number[] = [];
    try {
      while (!ctl.stop) {
        const s = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
        grab.width = Math.round(v.videoWidth * s);
        grab.height = Math.round(v.videoHeight * s);
        if (!grab.width) {
          await new Promise((r) => setTimeout(r, 100)); // no picture yet
          continue;
        }
        const t = performance.now() / 1000;
        grab.getContext("2d")!.drawImage(v, 0, 0, grab.width, grab.height);
        const jpeg = await new Promise<Blob | null>((r) => grab.toBlob(r, "image/jpeg", JPEG_QUALITY));
        if (!jpeg || ctl.stop) continue;
        const res = await api.cameraFrame(id, jpeg, t);

        const seen = new Set<number>();
        for (const b of res.boxes) {
          seen.add(b.id);
          const cur = live.current.get(b.id);
          const samples = [...(cur?.samples ?? []), { t: res.t, box: b.box }].slice(-3);
          live.current.set(b.id, { ...b, samples, missed: 0 });
        }
        // a plate missing from two answers in a row is gone (its track ended or got a new id): drop it now,
        // so an old box never lingers next to the new one
        for (const [k, x] of live.current) if (!seen.has(k) && ++x.missed >= 2) live.current.delete(k);
        addSaved(res.saved);

        times.push(t);
        while (times.length && t - times[0] > 2) times.shift();
        setStats({ fps: times.length / 2, ms: res.ms, size: `${grab.width}×${grab.height}` });
      }
    } catch (e) {
      if (!ctl.stop) setError(e);
    } finally {
      stream.getTracks().forEach((tr) => tr.stop());
      if (video.current) video.current.srcObject = null;
      live.current.clear();
      try {
        addSaved((await api.cameraStop(id)).saved); // vehicles still in view are saved on stop
      } catch {
        /* session already gone (timed out) */
      }
      setStats(null);
      setStatus("idle");
    }
  }

  async function stop() {
    if (!run.current) return;
    setStatus("stopping");
    run.current.stop = true;
    await run.current.done;
    run.current = null;
  }

  useEffect(() => () => {
    if (run.current) run.current.stop = true; // leaving the page stops the camera and closes the session
  }, []);

  // overlay: every screen refresh, each plate is drawn where it should be now
  useEffect(() => {
    const colors = boxColors();
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const v = video.current, c = canvas.current;
      if (!v || !c) return;
      const W = v.clientWidth, H = v.clientHeight;
      const ctx = prepareCanvas(c, W, H);
      if (!ctx) return;
      const r = contentRect(W, H, v.videoWidth, v.videoHeight);
      const now = performance.now() / 1000;
      for (const x of live.current.values()) {
        const b = predictBox(x.samples, now);
        if (!b) continue;
        const label = x.text ? `${x.black ? "⚠ " : ""}${x.text}${x.confirmed ? " ✓" : ""}` : "Đang đọc…";
        const box = { x: r.x + b[0] * r.w, y: r.y + b[1] * r.h, w: (b[2] - b[0]) * r.w, h: (b[3] - b[1]) * r.h };
        ctx.globalAlpha = x.confirmed ? 1 : 0.75;
        drawPlateBox(ctx, box, r.y, label, x.black ? colors.black : colors[x.type]);
        ctx.globalAlpha = 1;
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  const running = status === "running";

  return (
    <>
      <PageHeader
        title="Camera trực tiếp"
        description="Nhận dạng biển số từ webcam theo thời gian thực. Mỗi xe được lưu vào lịch sử một lần, kèm khung hình rõ nhất."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {devices.length > 1 && (
              <Select
                aria-label="Chọn camera"
                className="w-56"
                value={devices.some((d) => d.deviceId === deviceId) ? deviceId : ""}
                disabled={status !== "idle"}
                onChange={(e) => chooseDevice(e.target.value)}
              >
                <option value="">Camera mặc định</option>
                {devices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </Select>
            )}
            {running || status === "stopping" ? (
              <Button variant="secondary" onClick={stop} loading={status === "stopping"}>
                <CameraOff className="size-4" /> Dừng camera
              </Button>
            ) : (
              <Button onClick={start} loading={status === "starting"}>
                <Camera className="size-4" /> Bật camera
              </Button>
            )}
          </div>
        }
      />

      {alert && (
        <div role="alert" className="mb-5 flex items-start gap-3 rounded-xl bg-danger px-4 py-3 text-white">
          <ShieldAlert className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Cảnh báo: xe trong danh sách đen · {alert.plate.text}</p>
            {alert.plate.list?.note && <p className="text-white/85">{alert.plate.list.note}</p>}
          </div>
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/15" onClick={() => setAlert(null)}>
            Đã xem
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0">
          <CardHeader
            title="Camera"
            description={running ? "Khung biển số chạy theo xe; ✓ là biển đã xác nhận và lưu" : "Bấm “Bật camera” và cho phép trình duyệt dùng webcam"}
          />
          <div className="space-y-3 p-5">
            <div className={cn("relative w-full overflow-hidden rounded-lg bg-black", !running && status !== "stopping" && "aspect-video")}>
              <video ref={video} muted playsInline className={cn("block max-h-[70vh] w-full", !running && status !== "stopping" && "hidden")} />
              <canvas ref={canvas} className="pointer-events-none absolute top-0 left-0 size-full" />
              {!running && status !== "stopping" && (
                <div className="absolute inset-0 grid place-items-center text-sm text-white/70">
                  <span className="flex items-center gap-2">
                    {status === "starting" ? <ScanSearch className="size-5 animate-pulse" /> : <CameraOff className="size-5" />}
                    {status === "starting" ? "Đang bật camera…" : "Camera đang tắt"}
                  </span>
                </div>
              )}
            </div>
            {running && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <BoxLegend />
                {stats && (
                  <div className="flex flex-wrap gap-2">
                    <Badge title="Số khung hình được nhận dạng mỗi giây">
                      <Gauge className="size-3.5" /> {stats.fps.toFixed(1)} khung/giây
                    </Badge>
                    <Badge title="Thời gian máy chủ xử lý một khung">
                      <Timer className="size-3.5" /> {stats.ms} ms/khung
                    </Badge>
                    <Badge>{stats.size}</Badge>
                  </div>
                )}
              </div>
            )}
            {error != null && <ErrorBox error={error} />}
          </div>
        </Card>

        <Card className="min-w-0 self-start">
          <CardHeader title="Xe đã lưu" description={saved.length ? `${saved.length} xe trong phiên này` : "Biển số được xác nhận sẽ hiện ở đây"} />
          <div className="space-y-3 p-4">
            {!saved.length && (
              <EmptyState icon={<Camera className="size-8" />} title="Chưa có xe nào">
                Đưa biển số vào khung hình. Biển được lưu khi hai lần đọc trùng nhau, hoặc khi xe rời khỏi khung hình.
              </EmptyState>
            )}
            {saved.map((s, i) => (
              <div key={`${s.detectionId}-${s.at}`} className="space-y-1.5">
                <p className="text-xs text-fg-muted">{fmt.dateTime(s.at)} · lần nhận dạng #{s.detectionId}</p>
                <PlateCard plate={s.plate} index={saved.length - 1 - i} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
