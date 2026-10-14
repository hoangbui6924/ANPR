// Video recognition (congvieccanlam.md, giai đoạn 2): upload a video, the backend tracks every plate and reads it once
// per vehicle; the page plays the local file and draws each vehicle's box over it for as long as it is on screen.
import { useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Film, RotateCcw, ScanSearch, Timer } from "lucide-react";
import { api } from "@/api";
import type { VideoJob, VideoTrack } from "@/api/types";
import { PageHeader } from "@/components/AppLayout";
import { BoxLegend } from "@/components/ImageWithBoxes";
import { PlateCard } from "@/components/PlateCard";
import { VideoWithBoxes } from "@/components/VideoWithBoxes";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox } from "@/components/ui";
import { clock } from "@/lib/video";
import { cn } from "@/lib/utils";

const MAX_MB = 200;
const MAX_S = 5 * 60;
const POLL_MS = 1500;

/** Duration from the file's metadata (NaN when the browser cannot read this format) */
function videoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    v.preload = "metadata";
    v.onloadedmetadata = () => (URL.revokeObjectURL(url), resolve(v.duration));
    v.onerror = () => (URL.revokeObjectURL(url), resolve(NaN));
    v.src = url;
  });
}

export function VideoPage() {
  const qc = useQueryClient();
  const video = useRef<HTMLVideoElement>(null);
  const [file, setFile] = useState<{ file: File; url: string; playable: boolean } | null>(null);
  const [job, setJob] = useState<VideoJob | null>(null);
  const [tracks, setTracks] = useState<VideoTrack[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [active, setActive] = useState<number | null>(null);

  const reset = () => {
    setFile((f) => (f && URL.revokeObjectURL(f.url), null));
    setJob(null);
    setTracks([]);
    setError(null);
    setActive(null);
  };
  useEffect(() => () => reset(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = async (f: File) => {
    reset();
    if (f.size > MAX_MB * 1024 * 1024) return setError(new Error(`Video lớn hơn ${MAX_MB} MB`));
    const d = await videoDuration(f);
    if (d > MAX_S + 0.5) return setError(new Error(`Video dài ${clock(d)}, tối đa ${clock(MAX_S)}`));
    setFile({ file: f, url: URL.createObjectURL(f), playable: !Number.isNaN(d) });
    setUploading(true);
    try {
      setJob(await api.uploadVideo(f));
    } catch (e) {
      setError(e);
    } finally {
      setUploading(false);
    }
  };

  // poll the job: new vehicles appear as the backend reaches them; the final call fetches every vehicle again
  // (a vehicle lost and found again is merged into the earlier one on the backend)
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") return;
    let stop = false;
    const timer = setTimeout(async () => {
      try {
        const j = await api.videoJob(job.id, tracks.length);
        if (stop) return;
        if (j.status === "done") {
          const full = await api.videoJob(job.id, 0);
          if (stop) return;
          setTracks(full.tracks);
          setJob(full);
          qc.invalidateQueries({ queryKey: ["detections"] });
          qc.invalidateQueries({ queryKey: ["stats"] });
        } else {
          setTracks((xs) => [...xs, ...j.tracks]);
          setJob(j);
        }
      } catch (e) {
        if (!stop) setError(e);
      }
    }, POLL_MS);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [job, tracks.length, qc]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: false,
    accept: { "video/*": [".mp4", ".webm", ".mov", ".mkv", ".avi"] },
    onDrop: (accepted) => accepted[0] && onFile(accepted[0]),
  });

  const seek = (tr: VideoTrack) => {
    setActive(tr.id);
    if (video.current) video.current.currentTime = Math.max(0, tr.start - 0.2);
  };

  const sorted = [...tracks].sort((a, b) => a.start - b.start);
  const blacklisted = tracks.filter((t) => t.plate.list?.kind === "black").length;
  const working = uploading || job?.status === "queued" || job?.status === "processing";

  return (
    <>
      <PageHeader title="Nhận dạng từ video" description={`Tải video (MP4, WebM, MOV… tối đa ${MAX_MB} MB, ${MAX_S / 60} phút) để theo dõi và đọc biển số từng xe.`} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0">
          <CardHeader
            title="Video"
            description={file ? <span className="block truncate">{file.file.name}</span> : "Khung biển số chạy theo từng xe trong lúc phát"}
            action={
              file && (
                <Button variant="ghost" size="sm" onClick={reset}>
                  <RotateCcw className="size-4" /> Video khác
                </Button>
              )
            }
          />
          <div className="space-y-3 p-5">
            {!file ? (
              <div
                {...getRootProps()}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border px-6 py-12 text-center transition hover:border-primary/60",
                  isDragActive && "border-primary bg-primary/5",
                )}
              >
                <input {...getInputProps()} />
                <Film className="size-10 text-fg-muted" />
                <p className="font-medium text-fg">{isDragActive ? "Thả video vào đây" : "Kéo thả video, hoặc bấm để chọn"}</p>
                <p className="text-sm text-fg-muted">MP4, WebM, MOV, MKV, AVI · tối đa {MAX_MB} MB, {MAX_S / 60} phút</p>
              </div>
            ) : (
              <>
                <VideoWithBoxes src={file.url} tracks={tracks} active={active} videoRef={video} />
                {tracks.length > 0 && <BoxLegend />}
                {!file.playable && (
                  <p className="text-sm text-warning">Trình duyệt không phát được định dạng này, nhưng biển số vẫn được nhận dạng và lưu vào lịch sử.</p>
                )}
                <Progress uploading={uploading} job={job} found={tracks.length} />
              </>
            )}
            {error != null && <ErrorBox error={error} />}
          </div>
        </Card>

        <Card className="min-w-0 self-start">
          <CardHeader
            title="Xe tìm thấy"
            description={job ? `${tracks.length} xe${blacklisted ? ` · ${blacklisted} trong danh sách đen` : ""} · bấm để tua tới lúc xe xuất hiện` : "Mỗi xe lưu một ảnh rõ nhất vào lịch sử"}
          />
          <div className="space-y-3 p-4">
            {!file && (
              <EmptyState icon={<Clapperboard className="size-8" />} title="Chưa có video">
                Chọn video để bắt đầu. Mỗi xe được lưu một lần, kèm khung hình rõ nhất.
              </EmptyState>
            )}
            {file && !tracks.length && working && <div className="h-40 animate-pulse rounded-xl bg-muted" />}
            {job?.status === "done" && !tracks.length && <EmptyState title="Không tìm thấy biển số">Thử video rõ hơn hoặc quay gần biển số hơn.</EmptyState>}
            {sorted.map((tr, i) => (
              <div key={tr.id} className="space-y-1.5">
                <button type="button" onClick={() => seek(tr)} className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
                  <Timer className="size-3.5" /> {clock(tr.start)} – {clock(tr.end)}
                </button>
                <PlateCard plate={tr.plate} index={i} active={active === tr.id} onClick={() => seek(tr)} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function Progress({ uploading, job, found }: { uploading: boolean; job: VideoJob | null; found: number }) {
  if (!uploading && !job) return null;
  const pct = uploading ? 0 : Math.round((job?.progress ?? 0) * 100);
  const text = uploading
    ? "Đang tải video lên…"
    : job?.status === "queued"
      ? "Đang chờ video khác xử lý xong…"
      : job?.status === "processing"
        ? `Đang xử lý ${pct}% (${clock((job.progress ?? 0) * job.duration)} / ${clock(job.duration)}) · khung biển số hiện dần khi xử lý tới đoạn đó`
        : job?.status === "done"
          ? `Xong: ${found} xe`
          : "Xử lý thất bại";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted">
        <span className="flex items-center gap-2">
          {job?.status !== "done" && job?.status !== "error" && <ScanSearch className="size-4 animate-pulse text-primary" />}
          {text}
        </span>
        {job?.status === "done" && job.processMs != null && (
          <Badge>
            <Timer className="size-3.5" /> {(job.processMs / 1000).toFixed(1)} s cho video {clock(job.duration)}
          </Badge>
        )}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full bg-primary transition-all", uploading && "w-1/3 animate-pulse")} style={uploading ? undefined : { width: `${pct}%` }} />
      </div>
    </div>
  );
}
