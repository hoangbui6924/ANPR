# Train the 4-corner plate model (docs 5.5): YOLO11s-pose, same settings as the detector (batch 8 on the 6 GB GPU)
#   python train_plate_pose.py            -> runs/plate_pose/weights/best.pt (+ test-split metrics)
import argparse
from pathlib import Path

from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
DATA = ROOT / "datasets" / "vn-plate-pose" / "data.yaml"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="yolo11s-pose.pt")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--batch", type=int, default=6)
    ap.add_argument("--workers", type=int, default=0, help="dataloader processes; each one loads torch+CUDA (~2-3 GB commit on Windows)")
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    if args.resume:
        YOLO(str(ROOT / "runs" / "plate_pose" / "weights" / "last.pt")).train(resume=True)
    else:
        YOLO(str(HERE / args.model)).train(
            data=str(DATA), imgsz=640, epochs=args.epochs, batch=args.batch, patience=20, device=0, workers=args.workers,
            project=str(ROOT / "runs"), name="plate_pose", exist_ok=True, seed=42,
        )
    best = YOLO(str(ROOT / "runs" / "plate_pose" / "weights" / "best.pt"))
    # same small batch / no extra workers as training: the default val batch (16) does not fit the 6 GB GPU
    m = best.val(data=str(DATA), split="test", imgsz=640, batch=args.batch, workers=args.workers, device=0,
                 project=str(ROOT / "runs"), name="plate_pose_test", exist_ok=True)
    print(f"TEST box mAP50={m.box.map50:.3f} mAP50-95={m.box.map:.3f}  pose mAP50={m.pose.map50:.3f} mAP50-95={m.pose.map:.3f}")


if __name__ == "__main__":
    main()
