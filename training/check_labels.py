# Draw the polygon labels on random images of the re-split dataset for a visual check
#   python check_labels.py [split] [count]   -> datasets/vn-plate/_check_<split>.jpg
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "datasets" / "vn-plate"
split = sys.argv[1] if len(sys.argv) > 1 else "test"
count = int(sys.argv[2]) if len(sys.argv) > 2 else 24
COLORS = {0: (0, 220, 0), 1: (255, 60, 200)}  # 0 = plate_1line green, 1 = plate_2line magenta
TILE, COLS = 320, 6

random.seed(0)
imgs = sorted((DATA / split / "images").glob("*.jpg"))
picked = random.sample(imgs, min(count, len(imgs)))
rows = (len(picked) + COLS - 1) // COLS
sheet = Image.new("RGB", (COLS * TILE, rows * TILE), "black")

for k, img_path in enumerate(picked):
    im = Image.open(img_path).convert("RGB")
    w, h = im.size
    draw = ImageDraw.Draw(im)
    lbl = DATA / split / "labels" / (img_path.stem + ".txt")
    for line in lbl.read_text().split("\n"):
        v = line.split()
        if not v:
            continue
        cls, xy = int(v[0]), list(map(float, v[1:]))
        pts = [(xy[i] * w, xy[i + 1] * h) for i in range(0, len(xy) - 1, 2)]
        draw.polygon(pts, outline=COLORS.get(cls, (255, 255, 0)), width=3)
    draw.text((6, 6), img_path.name.split("_")[0], fill=(255, 255, 0))
    sheet.paste(im.resize((TILE, TILE)), ((k % COLS) * TILE, (k // COLS) * TILE))

out = DATA / f"_check_{split}.jpg"
sheet.save(out, quality=90)
print(f"{len(picked)} images -> {out}")
