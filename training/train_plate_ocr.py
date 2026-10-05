# Train a dedicated plate-row OCR model (CRNN + CTC) that keeps reading when plates are small.
# Data: datasets/vn-plate-ocr/{train,valid}/rows/*.png + labels.csv (built by backend/scripts/pseudo-label.ts).
# Training images are degraded on the fly (downscaled to 6-32 px text height, blur, JPEG, small tilt) so the
# model learns low-resolution plates. Exports backend/models/plate_ocr.onnx + plate_ocr.json.
#   python train_plate_ocr.py [--epochs 60]
import argparse
import csv
import json
import math
import random
from pathlib import Path

import cv2

cv2.setNumThreads(1)
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "datasets" / "vn-plate-ocr"
OUT_MODEL = ROOT / "backend" / "models"
CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
H, W = 32, 160  # model input (gray); rows are resized to H keeping aspect ratio, right-padded to W


def preprocess(gray: np.ndarray) -> np.ndarray:
    """Resize to height H (keep ratio, max width W), normalize to [-1, 1], pad right with 0. Mirrored in ocr.ts."""
    h, w = gray.shape
    nw = max(1, min(W, round(w * H / h)))
    img = cv2.resize(gray, (nw, H), interpolation=cv2.INTER_AREA if h > H else cv2.INTER_CUBIC)
    x = np.zeros((H, W), np.float32)
    x[:, :nw] = (img.astype(np.float32) / 255.0 - 0.5) / 0.5
    return x


CLEAN_PROB = 0.0  # share of samples that skip the downscale step (set by --clean-prob)


def degrade(gray: np.ndarray, rng: random.Random) -> np.ndarray:
    """Simulate small / blurry / compressed plates."""
    img = gray
    h, w = img.shape
    # margin jitter: crop up to 5% or pad up to 6% on each side
    if rng.random() < 0.6:
        t, b = [int(h * rng.uniform(-0.06, 0.05)) for _ in range(2)]
        l, r = [int(w * rng.uniform(-0.06, 0.05)) for _ in range(2)]
        img = cv2.copyMakeBorder(img, max(0, -t), max(0, -b), max(0, -l), max(0, -r), cv2.BORDER_REPLICATE)
        hh, ww = img.shape
        img = img[max(0, t): hh - max(0, b), max(0, l): ww - max(0, r)]
        h, w = img.shape
    # small rotation / shear
    if rng.random() < 0.5:
        a = math.radians(rng.uniform(-4, 4))
        sh = rng.uniform(-0.15, 0.15)
        M = np.array([[math.cos(a), -math.sin(a) + sh, 0], [math.sin(a), math.cos(a), 0]], np.float32)
        c = np.array([w / 2, h / 2], np.float32)
        M[:, 2] = c - M[:, :2] @ c
        img = cv2.warpAffine(img, M, (w, h), borderMode=cv2.BORDER_REPLICATE)
    # downscale: text height log-uniform in [6, 40] px
    target = math.exp(rng.uniform(math.log(6), math.log(40)))
    if target < h and rng.random() >= CLEAN_PROB:
        s = target / h
        img = cv2.resize(img, (max(2, round(w * s)), max(2, round(h * s))), interpolation=rng.choice([cv2.INTER_AREA, cv2.INTER_LINEAR]))
    if rng.random() < 0.3:
        img = cv2.GaussianBlur(img, (0, 0), rng.uniform(0.3, 1.0))
    if rng.random() < 0.7:
        ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, rng.randint(25, 95)])
        img = cv2.imdecode(enc, cv2.IMREAD_GRAYSCALE)
    # brightness / contrast / noise
    if rng.random() < 0.5:
        img = np.clip(img.astype(np.float32) * rng.uniform(0.6, 1.4) + rng.uniform(-40, 40), 0, 255).astype(np.uint8)
    if rng.random() < 0.2:
        img = np.clip(img.astype(np.float32) + np.random.normal(0, rng.uniform(3, 12), img.shape), 0, 255).astype(np.uint8)
    return img


class Rows(Dataset):
    def __init__(self, split: str, train: bool, fixed_height: float | None = None):
        self.dir = DATA / split / "rows"
        with open(DATA / split / "labels.csv", encoding="utf-8") as f:
            self.items = [(r["file"], r["label"]) for r in csv.DictReader(f) if r["label"]]
        self.train, self.fixed_height = train, fixed_height
        self.rng = random.Random()

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        name, label = self.items[i]
        gray = cv2.imread(str(self.dir / name), cv2.IMREAD_GRAYSCALE)
        if self.train:
            gray = degrade(gray, self.rng)
        elif self.fixed_height and gray.shape[0] > self.fixed_height:
            s = self.fixed_height / gray.shape[0]
            gray = cv2.resize(gray, (max(2, round(gray.shape[1] * s)), max(2, round(gray.shape[0] * s))), interpolation=cv2.INTER_AREA)
            ok, enc = cv2.imencode(".jpg", gray, [cv2.IMWRITE_JPEG_QUALITY, 75])
            gray = cv2.imdecode(enc, cv2.IMREAD_GRAYSCALE)
        target = torch.tensor([CHARSET.index(c) + 1 for c in label], dtype=torch.long)
        return torch.from_numpy(preprocess(gray))[None], target, label


def collate(batch):
    xs, ts, labels = zip(*batch)
    return torch.stack(xs), torch.cat(ts), torch.tensor([len(t) for t in ts]), list(labels)


def conv(i, o):
    return nn.Sequential(nn.Conv2d(i, o, 3, 1, 1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True))


class CRNN(nn.Module):
    def __init__(self, n_classes: int):
        super().__init__()
        self.cnn = nn.Sequential(
            conv(1, 32), nn.MaxPool2d(2, 2),  # 16 x 80
            conv(32, 64), nn.MaxPool2d(2, 2),  # 8 x 40
            conv(64, 128), conv(128, 128), nn.MaxPool2d((2, 1), (2, 1)),  # 4 x 40
            conv(128, 256), conv(256, 256), nn.MaxPool2d((2, 1), (2, 1)),  # 2 x 40
            nn.Conv2d(256, 256, (2, 1), bias=False), nn.BatchNorm2d(256), nn.ReLU(inplace=True),  # 1 x 40
            nn.Dropout2d(0.1),
        )
        self.rnn = nn.LSTM(256, 128, num_layers=2, bidirectional=True, batch_first=True, dropout=0.2)
        self.fc = nn.Linear(256, n_classes)

    def forward(self, x):  # x: [N, 1, H, W] -> logits [N, T, C]
        f = self.cnn(x).squeeze(2).permute(0, 2, 1).contiguous()
        # cuDNN LSTM under fp16 autocast can fail with spurious "out of memory" on Windows: keep the RNN in fp32
        with torch.autocast(device_type=x.device.type, enabled=False):
            return self.fc(self.rnn(f.float())[0])


class Exportable(nn.Module):
    """ONNX graph returns per-step probabilities [N, T, C] (blank = 0), like PaddleOCR rec models."""

    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):
        return self.m(x).softmax(-1)


def greedy(logits: torch.Tensor) -> list[str]:
    out = []
    for seq in logits.argmax(-1).cpu().numpy():
        s, last = "", 0
        for k in seq:
            if k != 0 and k != last:
                s += CHARSET[k - 1]
            last = k
        out.append(s)
    return out


def evaluate(model, loader, device):
    model.eval()
    ok = n = 0
    with torch.no_grad():
        for x, _, _, labels in loader:
            pred = greedy(model(x.to(device)))
            ok += sum(p == l for p, l in zip(pred, labels))
            n += len(labels)
    return ok / max(n, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--clean-prob", type=float, default=0.25, help="share of training samples kept at full resolution")
    ap.add_argument("--name", default="plate_ocr", help="output model name in backend/models")
    ap.add_argument("--workers", type=int, default=0)  # augmentation is cheap; worker processes hung on Windows
    args = ap.parse_args()
    global CLEAN_PROB
    CLEAN_PROB = args.clean_prob

    torch.manual_seed(42)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    train = Rows("train", train=True)
    # validation at several text heights: clean, 16 px, 10 px
    vals = {h: Rows("valid", train=False, fixed_height=h) for h in (None, 16, 10)}
    print(f"train rows {len(train)}, valid rows {len(vals[None])}, device {device}")
    tl = DataLoader(train, args.batch, shuffle=True, num_workers=args.workers, collate_fn=collate, drop_last=True, persistent_workers=args.workers > 0)
    vls = {h: DataLoader(v, 256, num_workers=0, collate_fn=collate) for h, v in vals.items()}

    model = CRNN(len(CHARSET) + 1).to(device)
    print(f"params {sum(p.numel() for p in model.parameters()) / 1e6:.2f} M")
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.epochs * len(tl), pct_start=0.15)
    ctc = nn.CTCLoss(blank=0, zero_infinity=True)
    scaler = torch.amp.GradScaler(enabled=device == "cuda")
    best, best_path = -1.0, ROOT / "runs" / f"{args.name}_best.pt"
    best_path.parent.mkdir(exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        model.train()
        total = 0.0
        for x, targets, lengths, _ in tl:
            x = x.to(device)
            with torch.autocast(device_type="cuda", enabled=device == "cuda"):
                logits = model(x)
            logp = logits.float().log_softmax(-1).permute(1, 0, 2)  # [T, N, C]
            loss = ctc(logp, targets, torch.full((x.size(0),), logp.size(0), dtype=torch.long), lengths)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            scaler.step(opt)
            scaler.update()
            sched.step()
            total += loss.item()
        accs = {h: evaluate(model, l, device) for h, l in vls.items()}
        score = sum(accs.values()) / len(accs)
        tag = ""
        if score > best:
            best, tag = score, "  *best"
            torch.save(model.state_dict(), best_path)
        print(f"epoch {epoch:3d}  loss {total / len(tl):.4f}  row-acc clean {accs[None]:.3f}  16px {accs[16]:.3f}  10px {accs[10]:.3f}{tag}", flush=True)

    model.load_state_dict(torch.load(best_path, map_location=device))
    model.eval().cpu()
    OUT_MODEL.mkdir(parents=True, exist_ok=True)
    onnx_path = OUT_MODEL / f"{args.name}.onnx"
    torch.onnx.export(Exportable(model), torch.zeros(1, 1, H, W), str(onnx_path), input_names=["x"], output_names=["probs"],
                      dynamic_axes={"x": {0: "n"}, "probs": {0: "n"}}, opset_version=17, dynamo=False)
    (OUT_MODEL / f"{args.name}.json").write_text(json.dumps({
        "charset": CHARSET, "height": H, "width": W, "channels": 1, "normalize": "(x/255-0.5)/0.5", "pad": 0,
        "best_score": round(best, 4),
    }, indent=2))
    print(f"exported {onnx_path} (best mean row-acc {best:.3f})")


if __name__ == "__main__":
    main()
