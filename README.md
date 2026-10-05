# ANPR – Website nhận dạng biển số xe máy và ô tô Việt Nam

Website cho phép tải ảnh (một ảnh hoặc cả thư mục) để phát hiện và đọc biển số xe Việt Nam, lưu lịch sử, tìm kiếm biển số gần đúng, thống kê và cảnh báo xe trong danh sách đen.

- **Phát hiện biển số:** YOLO11s-pose (khung + 4 góc biển để nắn phối cảnh) huấn luyện trên bộ dữ liệu Vietnam License Plate (Roboflow, 4.534 ảnh), chạy bằng ONNX Runtime ngay trong Node.js.
- **Đọc ký tự:** PaddleOCR (PP-OCRv4 server, ONNX) kết hợp bỏ phiếu với một mô hình CRNN tự huấn luyện cho biển số độ phân giải thấp.
- **Web:** Node.js + Express 5 + Prisma 7 + PostgreSQL 16; React 19 + Vite + TailwindCSS 4.

Quá trình xây dựng, các thử nghiệm và số liệu chi tiết: [docs/qua-trinh-xay-dung.md](docs/qua-trinh-xay-dung.md).

## Kết quả chính

| Hạng mục | Kết quả |
|---|---|
| Phát hiện biển số (tập test 455 ảnh) | Precision 0,988 · Recall 0,988 · mAP50 0,994 · mAP50-95 0,908 (4 góc: 0,992) |
| Tốc độ (CPU) | khoảng 0,15–0,4 s/ảnh; ảnh lớn nhiều xe 1–2,5 s |
| Biển nhỏ (chữ cao ~17 px) | đọc đúng 31/42 so với 21/42 ở cấu hình ban đầu |

Độ chính xác toàn hệ thống chính thức được đo trên tập kiểm thử 200 ảnh có đáp án đã kiểm tra (xem phần [Kiểm thử](#kiểm-thử)).

## Cấu trúc thư mục

```
ANPR/
├── backend/            API Express + module nhận dạng (src/recognition) + Prisma
│   ├── models/         plate_pose.onnx, plate.onnx, plate_ocr_v2.onnx, rec_ch_v4_server.onnx, ppocr_keys_v1.txt
│   ├── scripts/        đánh giá, gán nhãn tự động, tạo tập kiểm thử, CLI nhận dạng
│   └── tests/          Vitest + Supertest
├── frontend/           React + Vite (trang nhận dạng, lịch sử, danh sách xe, thống kê, người dùng)
├── training/           script Python: chia dữ liệu, huấn luyện YOLO11 / YOLO11-pose / CRNN
├── datasets/           (không đưa lên git) dữ liệu đã chia lại, dữ liệu OCR, tập kiểm thử
├── docs/               tài liệu quá trình xây dựng
└── docker-compose.yml  db + api + web
```

## Chạy bằng Docker (toàn hệ thống)

Yêu cầu: Docker Desktop, và các tệp mô hình trong `backend/models/` (xem [Mô hình](#mô-hình)).

```bash
cp .env.example .env          # đặt mật khẩu, khóa JWT, mật khẩu admin đầu tiên
docker compose up -d --build  # http://localhost:8080
```

Container `api` tự tạo bảng và tạo tài khoản admin đầu tiên (`ADMIN_USERNAME` / `ADMIN_PASSWORD` trong `.env`). Đăng nhập xong nên đổi mật khẩu ở mục **Đổi mật khẩu**.

## Chạy để phát triển

Yêu cầu: Node.js 22 trở lên, Docker (cho PostgreSQL). Trên Windows cần Microsoft Visual C++ Redistributable cho `onnxruntime-node`.

```bash
docker compose up -d db                 # PostgreSQL 16

cd backend
cp .env.example .env                    # sửa JWT_SECRET, JWT_REFRESH_SECRET, ADMIN_PASSWORD
npm install
npm run db:migrate && npm run db:seed   # tạo bảng + tài khoản admin
npm start                               # API: http://localhost:3001

cd ../frontend
npm install
npm run dev                             # giao diện: http://localhost:5173
```

Giao diện có chế độ dữ liệu mô phỏng (`VITE_USE_MOCK=true` trong `frontend/.env`) để chạy khi chưa có backend.

Nhận dạng nhanh từ dòng lệnh: `node scripts/recognize.ts <ảnh hoặc thư mục>` (trong `backend/`).

## Mô hình

| Tệp | Nguồn |
|---|---|
| `plate_pose.onnx` | Huấn luyện bằng `training/train_plate_pose.py` (dữ liệu: `training/make_pose_dataset.py`), xuất ONNX với `nms=True` |
| `plate.onnx` | Huấn luyện bằng `training/train_plate.py`, xuất ONNX: `yolo export model=runs/plate/weights/best.pt format=onnx imgsz=640 nms=True` |
| `plate_ocr_v2.onnx` + `.json` | Huấn luyện bằng `training/train_plate_ocr.py --epochs 150 --name plate_ocr_v2` trên dữ liệu tạo bởi `backend/scripts/pseudo-label.ts` |
| `rec_ch_v4_server.onnx`, `ppocr_keys_v1.txt` | Tải bằng `backend/scripts/download-models.sh` (PaddleOCR PP-OCRv4, bản ONNX của RapidOCR) |

## Huấn luyện lại (tóm tắt)

```bash
cd training
python -m venv .venv && .venv\Scripts\activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
pip install ultralytics opencv-python onnx onnxslim

python split_dataset.py        # chia lại dữ liệu theo nguồn 80/10/10 -> datasets/vn-plate
python train_plate.py --batch 8
cd ../backend && node scripts/pseudo-label.ts && cd ../training
python train_plate_ocr.py --epochs 150 --name plate_ocr_v2
```

## Kiểm thử

```bash
cd backend && npm test      # unit test hậu xử lý + module nhận dạng + API (Supertest, cần database)
cd frontend && npm test
```

Độ chính xác toàn hệ thống (mục 4.6 của kế hoạch):

1. `node scripts/make-eval-set.ts` tạo `datasets/eval-200/review.html` (200 ảnh test, đáp án điền sẵn bằng OCR).
2. Mở `review.html`, kiểm tra và sửa từng đáp án, tải `answers.csv` về `datasets/eval-200/`.
3. `node scripts/eval-200.ts` in bảng kết quả theo nguồn và loại biển, ghi `datasets/eval-200/report.md`.

## Giấy phép dữ liệu

Bộ dữ liệu "Vietnam License Plate" (Roboflow Universe, vietnam-license-plate-hjswj v2) theo giấy phép CC BY 4.0.
