# Convert the 4-corner polygon labels of datasets/vn-plate into YOLO pose labels (docs 5.5):
#   class cx cy w h  x_tl y_tl 2  x_tr y_tr 2  x_br y_br 2  x_bl y_bl 2
# Polygons with 6-7 points are reduced to 4 corners with the extreme-point rule
# (top-left = min x+y, bottom-right = max x+y, top-right = max x-y, bottom-left = min x-y).
#   python make_pose_dataset.py   -> datasets/vn-plate-pose
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "datasets" / "vn-plate"
DST = ROOT / "datasets" / "vn-plate-pose"


def corners(pts):
    tl = min(pts, key=lambda p: p[0] + p[1])
    br = max(pts, key=lambda p: p[0] + p[1])
    tr = max(pts, key=lambda p: p[0] - p[1])
    bl = min(pts, key=lambda p: p[0] - p[1])
    return [tl, tr, br, bl]


def main():
    if DST.exists():
        shutil.rmtree(DST)
    reduced = total = 0
    for split in ("train", "valid", "test"):
        (DST / split / "labels").mkdir(parents=True)
        # images are shared, not copied: Ultralytics finds labels next to "images" -> link the folder
        shutil.copytree(SRC / split / "images", DST / split / "images")
        for f in (SRC / split / "labels").glob("*.txt"):
            out = []
            for line in f.read_text().split("\n"):
                v = line.split()
                if not v:
                    continue
                cls, xy = v[0], list(map(float, v[1:]))
                pts = list({(round(xy[i], 6), round(xy[i + 1], 6)) for i in range(0, len(xy) - 1, 2)})
                total += 1
                if len(pts) > 4:
                    reduced += 1
                c = corners(pts)
                xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                x1, x2, y1, y2 = min(xs), max(xs), min(ys), max(ys)
                kp = " ".join(f"{x:.6f} {y:.6f} 2" for x, y in c)
                out.append(f"{cls} {(x1 + x2) / 2:.6f} {(y1 + y2) / 2:.6f} {x2 - x1:.6f} {y2 - y1:.6f} {kp}")
            (DST / split / "labels" / f.name).write_text("\n".join(out) + "\n")
    (DST / "data.yaml").write_text(
        f"path: {DST.as_posix()}\n"
        "train: train/images\nval: valid/images\ntest: test/images\n"
        "kpt_shape: [4, 3]\n"
        "flip_idx: [1, 0, 3, 2]\n"  # horizontal flip swaps left/right corners
        "names:\n  0: plate_1line\n  1: plate_2line\n",
        encoding="utf-8",
    )
    print(f"{total} plates, {reduced} polygons reduced from 6-7 points to 4 corners -> {DST}")


if __name__ == "__main__":
    main()
