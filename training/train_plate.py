# Train the plate detector (docs 5.1): YOLO11s, 640, 100 epochs, early stop after 20 without improvement
#   python train_plate.py            -> runs/plate/weights/best.pt
#   python train_plate.py --batch 8  (if CUDA runs out of memory on the 6 GB GPU)
import argparse
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(HERE / "yolo11s.pt"))
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--resume", action="store_true", help="continue runs/plate after an interruption")
    args = ap.parse_args()

    if args.resume:
        YOLO(str(ROOT / "runs" / "plate" / "weights" / "last.pt")).train(resume=True)
        return

    model = YOLO(args.model)
    model.train(
        data=str(ROOT / "datasets" / "vn-plate" / "data.yaml"),
        imgsz=640,
        epochs=args.epochs,
        batch=args.batch,
        patience=20,
        device=0,
        workers=args.workers,
        project=str(ROOT / "runs"),
        name="plate",
        exist_ok=True,
        seed=42,
    )

    # final numbers on the re-split test set (all 5 sources)
    best = YOLO(str(ROOT / "runs" / "plate" / "weights" / "best.pt"))
    m = best.val(data=str(ROOT / "datasets" / "vn-plate" / "data.yaml"), split="test", imgsz=640, batch=args.batch, workers=args.workers, device=0,
                 project=str(ROOT / "runs"), name="plate_test", exist_ok=True)
    print(f"TEST  P={m.box.mp:.3f}  R={m.box.mr:.3f}  mAP50={m.box.map50:.3f}  mAP50-95={m.box.map:.3f}")


if __name__ == "__main__":  # required on Windows (dataloader workers use spawn)
    main()
