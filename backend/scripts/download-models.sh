#!/usr/bin/env bash
# Download the PaddleOCR recognition model (ONNX, converted by RapidOCR) + dictionary into backend/models.
# plate.onnx is produced by training (docs 5.4): yolo export model=runs/plate/weights/best.pt format=onnx imgsz=640 nms=True
set -euo pipefail
cd "$(dirname "$0")/../models"
curl -fL --retry 5 -o rec_ch_v4_server.onnx "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_rec_server_infer.onnx"
curl -fL --retry 5 -o ppocr_keys_v1.txt "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/release/2.7/ppocr/utils/ppocr_keys_v1.txt"
[ -f plate.onnx ] || cp ../../runs/plate/weights/best.onnx plate.onnx 2>/dev/null || echo "plate.onnx missing: export it from runs/plate/weights/best.pt"
ls -la
