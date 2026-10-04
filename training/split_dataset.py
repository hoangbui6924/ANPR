# Re-split the Vietnam License Plate dataset (Roboflow v2) per source: 80% train / 10% valid / 10% test
# The original test set only had "Tgmt" images, so it did not represent the other sources (see docs, 4.3).
#   python split_dataset.py
import random
import shutil
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "Vietnam License Plate.v2i.yolov11"
DST = ROOT / "datasets" / "vn-plate"
SPLITS = ("train", "valid", "test")
SEED = 42

random.seed(SEED)

# group every image of the 3 original splits by source (file-name prefix)
groups = defaultdict(list)
for img in sorted(SRC.glob("*/images/*.jpg")):
    lbl = img.parent.parent / "labels" / (img.stem + ".txt")
    if not lbl.exists():
        raise SystemExit(f"missing label for {img}")
    groups[img.name.split("_")[0]].append((img, lbl))

if DST.exists():
    shutil.rmtree(DST)  # always rebuild from scratch so re-running gives the same split

counts = {}
for source in sorted(groups):
    items = groups[source]
    random.shuffle(items)
    n = len(items)
    a, b = int(n * 0.8), int(n * 0.9)
    parts = dict(zip(SPLITS, (items[:a], items[a:b], items[b:])))
    counts[source] = {s: len(p) for s, p in parts.items()}
    for split, part in parts.items():
        for img, lbl in part:
            for kind, f in (("images", img), ("labels", lbl)):
                out = DST / split / kind
                out.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, out / f.name)

# class order is unchanged (0 = 1-line plate, 1 = 2-line plate), so label files need no edits
(DST / "data.yaml").write_text(
    f"path: {DST.as_posix()}\n"
    "train: train/images\n"
    "val: valid/images\n"
    "test: test/images\n"
    "names:\n"
    "  0: plate_1line\n"
    "  1: plate_2line\n",
    encoding="utf-8",
)

print(f"{'source':<10} {'train':>6} {'valid':>6} {'test':>6}")
for source, c in counts.items():
    print(f"{source:<10} {c['train']:>6} {c['valid']:>6} {c['test']:>6}")
total = {s: sum(c[s] for c in counts.values()) for s in SPLITS}
print(f"{'TOTAL':<10} {total['train']:>6} {total['valid']:>6} {total['test']:>6}")
print(f"-> {DST}")
