// Video recognition (congvieccanlam.md, giai đoạn 2). An uploaded video becomes a background job:
// ffmpeg decodes it at `config.video.fps` frames per second, every frame goes through the plate detector,
// boxes are linked into one track per vehicle, and each closed track is read by OCR on its best few frames.
// One vehicle = one detection row (its clearest frame), so history and stats need no change.
// The browser plays the original file itself and draws the returned track boxes over it.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";
import { config } from "../config.ts";
import type { Decoded } from "../recognition/image.ts";
import type { RecognizedPlate } from "../recognition/index.ts";
import { Tracker, type Track } from "../recognition/track.ts";
import { HttpError } from "../middlewares/error.ts";
import type { plateDto } from "./dto.ts";
import { getRecognizer } from "./recognize.ts";
import { Candidates, votePlate, type Candidate } from "../recognition/candidates.ts";
import { saveVehicle } from "./vehicles.ts";

const FFMPEG = config.video.ffmpeg ?? (ffmpegStatic as unknown as string | null);
const FPS = config.video.fps;
const SIDE = config.video.maxSide;
// Keep the first frame of every 1/FPS s slot (original timestamps, unlike the fps filter which re-times frames and
// put boxes ~0.05 s ahead of the picture on phone videos), then shrink (never enlarge) to SIDE on the long side.
// Quotes protect the commas from the filter parser.
const FILTER =
  `select='isnan(prev_selected_t)+gt(floor(t*${FPS}),floor(prev_selected_t*${FPS}))',` +
  `scale=w='if(gte(iw,ih),min(${SIDE},iw),-2)':h='if(gte(iw,ih),-2,min(${SIDE},ih))'`;

const CANDIDATES = 5; // frames per vehicle that go to OCR (largest, most confident sightings)
const MIN_SIGHTINGS = 3; // shorter tracks are noise
const MIN_CONF = 0.4;
const MERGE_GAP_S = 3; // a vehicle lost for a moment and found again with the same plate stays one vehicle

// ---------- ffmpeg ----------

function run(args: string[], capture = false): Promise<{ stdout: Buffer; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    if (!FFMPEG) return reject(new Error("ffmpeg not found (install ffmpeg-static or set FFMPEG_PATH)"));
    const p = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (c: Buffer) => capture && out.push(c));
    p.stderr.on("data", (c: Buffer) => (err += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => resolve({ stdout: Buffer.concat(out), stderr: err, code }));
  });
}

export interface VideoInfo {
  duration: number; // seconds
  start: number; // container start time: frame timestamps minus this = the browser's currentTime
  width: number; // size of the analysed frames (after scaling and rotation)
  height: number;
}

/** Duration from ffmpeg's header dump; frame size from the first frame through the same filter (handles phone rotation) */
export async function probeVideo(file: string): Promise<VideoInfo> {
  const head = await run(["-hide_banner", "-i", file]);
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(head.stderr);
  if (!m || !/Stream #.*Video:/.test(head.stderr)) throw new HttpError(400, "Không đọc được tệp video");
  const duration = +m[1] * 3600 + +m[2] * 60 + +m[3];
  const start = Number(/, start: (-?\d+(?:\.\d+)?)/.exec(head.stderr)?.[1] ?? 0);
  const first = await run(["-hide_banner", "-loglevel", "error", "-i", file, "-vf", FILTER, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"], true);
  if (!first.stdout.length) throw new HttpError(400, "Không đọc được khung hình nào từ video");
  const meta = await sharp(first.stdout).metadata();
  return { duration, start, width: meta.width!, height: meta.height! };
}

/**
 * Raw RGB frames (about FPS per second) with their real timestamps, one at a time: the async iterator pauses
 * ffmpeg while a frame is being processed. showinfo logs each frame's pts_time on stderr; the pixels arrive on stdout.
 */
async function* frames(file: string, info: VideoInfo): AsyncGenerator<{ frame: Decoded; t: number }> {
  const p = spawn(FFMPEG!, ["-hide_banner", "-nostats", "-i", file, "-vf", `${FILTER},showinfo`, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  // timestamps can arrive before or after their frame's pixels: queue them and let a frame wait for its own
  const times: number[] = [];
  let wake: (() => void) | null = null, ended = false, line = "";
  p.stderr.on("data", (c: Buffer) => {
    const lines = (line + c.toString()).split(/\r?\n/);
    line = lines.pop()!;
    for (const l of lines) {
      const m = /showinfo.* pts_time:\s*(-?[\d.]+)/.exec(l);
      if (m) times.push(+m[1] - info.start);
    }
    wake?.();
  });
  p.on("close", () => ((ended = true), wake?.()));
  const nextTime = async () => {
    while (!times.length && !ended) await new Promise<void>((r) => (wake = r));
    return times.shift();
  };

  const size = info.width * info.height * 3;
  let pending: Buffer = Buffer.alloc(0);
  try {
    for await (const chunk of p.stdout as AsyncIterable<Buffer>) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= size) {
        const frame = { data: Buffer.from(pending.subarray(0, size)), width: info.width, height: info.height };
        pending = pending.subarray(size);
        const t = await nextTime();
        if (t === undefined) return;
        yield { frame, t };
      }
    }
  } finally {
    p.kill();
  }
}

// ---------- jobs ----------

/** One vehicle on the video timeline; `boxes` are [t, x1, y1, x2, y2] with coordinates in 0..1 of the frame */
export interface VideoTrack {
  id: number;
  start: number;
  end: number;
  boxes: [number, number, number, number, number][];
  detectionId: number;
  imageUrl: string;
  plate: ReturnType<typeof plateDto>;
}

interface Job {
  id: string;
  userId: number;
  status: "queued" | "processing" | "done" | "error";
  info: VideoInfo;
  progress: number; // 0..1
  tracks: VideoTrack[];
  error?: string;
  createdAt: number;
  ms?: number;
}

const jobs = new Map<string, Job>();
let queue: Promise<void> = Promise.resolve(); // one video at a time: detection already uses every CPU core
const KEEP_MS = 60 * 60 * 1000; // finished jobs stay readable for an hour

export function jobDto(job: Job, since = 0) {
  return {
    id: job.id,
    status: job.status,
    progress: +job.progress.toFixed(3),
    duration: job.info.duration,
    width: job.info.width,
    height: job.info.height,
    error: job.error ?? null,
    processMs: job.ms ?? null,
    totalTracks: job.tracks.length,
    tracks: job.tracks.slice(since), // polling sends only the vehicles found since the last call
  };
}

export function getJob(id: string, user: { id: number; role: string }) {
  const job = jobs.get(id);
  if (!job || (job.userId !== user.id && user.role !== "admin")) throw new HttpError(404, "Không tìm thấy video đang xử lý");
  return job;
}

/** Queue an uploaded video file (it is deleted once processed: only the vehicles' frames are kept) */
export async function startVideoJob(file: string, userId: number) {
  let info: VideoInfo;
  try {
    info = await probeVideo(file);
    if (info.duration > config.video.maxSeconds + 0.5) throw new HttpError(400, `Video dài hơn ${config.video.maxSeconds / 60} phút`);
  } catch (e) {
    await fs.rm(file, { force: true });
    throw e;
  }
  const job: Job = { id: randomUUID(), userId, status: "queued", info, progress: 0, tracks: [], createdAt: Date.now() };
  jobs.set(job.id, job);
  queue = queue.then(() => processJob(job, file));
  return job;
}

async function processJob(job: Job, file: string) {
  const t0 = performance.now();
  job.status = "processing";
  try {
    const rec = getRecognizer();
    const tracker = new Tracker(1);
    const best = new Candidates(CANDIDATES); // OCR candidates per track

    const close = async (tracks: Track[]) => {
      for (const tr of tracks) {
        const cands = best.get(tr.id);
        best.delete(tr.id);
        if (tr.sightings.length >= MIN_SIGHTINGS) await finishTrack(job, tr, cands);
      }
    };

    for await (const { frame, t } of frames(file, job.info)) {
      const boxes = await rec.detect(frame);
      await close(tracker.update(t, boxes));
      for (const b of boxes) {
        const tr = tracker.trackOf(b);
        if (tr) best.add(tr.id, frame, b);
      }
      job.progress = Math.min(0.99, t / Math.max(job.info.duration, 0.001));
    }
    await close(tracker.flush());
    job.status = "done";
    job.progress = 1;
  } catch (e) {
    console.error("video job failed", e);
    job.status = "error";
    job.error = e instanceof HttpError ? e.message : "Lỗi khi xử lý video";
  } finally {
    job.ms = Math.round(performance.now() - t0);
    await fs.rm(file, { force: true });
    setTimeout(() => jobs.delete(job.id), KEEP_MS).unref();
  }
}

/** OCR a closed track on its candidate frames, vote, then save it (or fold it into the same plate seen just before) */
async function finishTrack(job: Job, tr: Track, cands: Candidate[]) {
  // never a confident box and only seen briefly: a far-away or false plate, whatever it reads as (same 0.4 as images)
  if (Math.max(...tr.sightings.map((s) => s.box.conf)) < MIN_CONF && tr.sightings.length < 2 * FPS) return;
  const t0 = performance.now();
  const rec = getRecognizer();
  const reads: { plate: RecognizedPlate; frame: Decoded }[] = [];
  for (const c of cands) {
    const p = await rec.readPlate(c.frame, [c.box]);
    if (p) reads.push({ plate: p, frame: c.frame });
  }
  const pick = votePlate(reads);
  // no valid read, or three or more valid reads that never agree (not even character by character): unreadable
  if (!pick || (pick.votes < 2 && reads.filter((r) => r.plate.valid).length >= 3)) return;

  const { width: w, height: h } = job.info;
  const boxes = tr.sightings.map(({ t, box }) => [+t.toFixed(3), ...[box.x1 / w, box.y1 / h, box.x2 / w, box.y2 / h].map((v) => +v.toFixed(4))]) as VideoTrack["boxes"];
  const start = tr.sightings[0].t, end = tr.sightings.at(-1)!.t;

  // same plate lost and found again a moment later: extend that vehicle instead of saving it twice
  const prev = job.tracks.find((x) => x.plate.norm === pick.plate.norm && start - x.end <= MERGE_GAP_S);
  if (prev) {
    prev.boxes = [...prev.boxes, ...boxes].sort((a, b) => a[0] - b[0]);
    prev.start = Math.min(prev.start, start);
    prev.end = Math.max(prev.end, end);
    return;
  }

  const saved = await saveVehicle(pick.frame, pick.plate, job.userId, "video", performance.now() - t0);
  job.tracks.push({ id: tr.id, start, end, boxes, ...saved });
}
