// Perspective correction of a plate from its 4 corners (YOLO11-pose, docs 5.5): the quad
// (top-left, top-right, bottom-right, bottom-left) is mapped to an upright rectangle before OCR.
import type { Decoded } from "./image.ts";

export type Pt = [number, number];
type Rgb = { data: Buffer; width: number; height: number };

/** Solve A·x = b (8×8) by Gaussian elimination with partial pivoting */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) throw new Error("degenerate quad");
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** Homography H (row-major 3×3, h33 = 1) with H·src[i] ~ dst[i] */
export function homography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return [...solve(A, b), 1];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Warp the plate quad to an upright crop. Output size follows the longest opposite edges; `pad` adds a margin
 * (fraction of the size) taken from around the quad, like the widened box crop.
 */
export function warpQuad(img: Decoded, quad: Pt[], pad = 0.06): Rgb {
  const [tl, tr, br, bl] = quad;
  const w = Math.max(dist(tl, tr), dist(bl, br)), h = Math.max(dist(tl, bl), dist(tr, br));
  const mx = Math.round(w * pad), my = Math.round(h * pad);
  const W = Math.max(2, Math.round(w) + 2 * mx), H = Math.max(2, Math.round(h) + 2 * my);
  // map output pixel -> source pixel (inverse mapping, so every output pixel is filled)
  const Hm = homography([[mx, my], [mx + w, my], [mx + w, my + h], [mx, my + h]], quad);
  const out = Buffer.alloc(W * H * 3);
  const src = img.data, sw = img.width, sh = img.height;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Hm[6] * x + Hm[7] * y + Hm[8];
      let sx = (Hm[0] * x + Hm[1] * y + Hm[2]) / d, sy = (Hm[3] * x + Hm[4] * y + Hm[5]) / d;
      sx = Math.min(Math.max(sx, 0), sw - 1.001);
      sy = Math.min(Math.max(sy, 0), sh - 1.001);
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 3, i01 = i00 + 3, i10 = i00 + sw * 3, i11 = i10 + 3, o = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) {
        // bilinear sampling
        out[o + c] = (src[i00 + c] * (1 - fx) + src[i01 + c] * fx) * (1 - fy) + (src[i10 + c] * (1 - fx) + src[i11 + c] * fx) * fy;
      }
    }
  }
  return { data: out, width: W, height: H };
}
