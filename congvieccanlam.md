# Công việc cần làm

Ghi chú ngày 05/10/2026, cập nhật 14/10/2026.

**Hiện trạng:** nhận dạng ảnh tĩnh, cả thư mục ảnh, video tải lên và camera trực tiếp chạy ổn (YOLO12s-pose + nắn phối cảnh; PaddleOCR + CRNN tự huấn luyện cùng bỏ phiếu); web + API + PostgreSQL chạy được bằng Docker Compose (http://localhost:8080).

---

## 1. Lỗi đã ghi nhận

- **Nhầm D và U ở seri biển khi ánh sáng chói / lóa.** Ví dụ ảnh đường phố có hai xe biển 2 dòng `52D-0694` và `52D-1843` bị đọc sai ký tự seri giữa D và U. Do góc sáng nên tạm chấp nhận, để sửa sau.
- **Biển yếu bị mô hình bốn góc bỏ sót.** Trên ảnh đường phố (mục 5.7 của tài liệu), mô hình pose không thấy biển `51H-709.67`.

## 2. Tính năng

- ~~**Đọc biển số từ video** (tải lên tệp video).~~ Đã xong ngày 14/10/2026 (tài liệu mục 8).
- ~~**Đọc biển số từ camera trực tiếp** (webcam qua trình duyệt, chương 10 của kế hoạch).~~ Đã xong ngày 14/10/2026 (tài liệu mục 9); mới thử bằng camera giả của trình duyệt, cần thử với webcam / điện thoại thật.

---

## 3. Kế hoạch chỉnh sửa

### Giai đoạn 1 và 2: Tracking + nhận dạng từ video (đã xong)

- Theo dõi biển qua các khung hình: `backend/src/recognition/track.ts` (dự đoán vị trí theo vận tốc, ghép theo IoU hoặc khoảng cách).
- Video: `POST /api/videos` (tối đa 200 MB, 5 phút) tạo job chạy nền; ffmpeg (`ffmpeg-static`) giải mã 8 khung/giây; đọc ký tự trên 5 khung tốt nhất mỗi xe rồi bỏ phiếu; mỗi xe lưu một lần nhận dạng (nguồn `video`) với khung hình rõ nhất; tệp video xóa sau khi xử lý; trang web hỏi tiến độ qua `GET /api/videos/:id`.
- Trang **Video**: trình duyệt tự phát video (không bị chậm), canvas vẽ khung biển nội suy giữa các mẫu nên khung chạy liên tục theo xe; bấm vào xe để tua tới lúc xe xuất hiện.
- Đã thử thêm một video quay thực tế (19 s): sửa lỗi vạch kẻ đường bị nhận là biển và lỗi khung biển đi trước xe ~0,05 s (dùng dấu thời gian thật của khung hình). Còn lại: biển xe máy nhỏ, mờ vẫn đọc sai seri.

### Giai đoạn 3: Camera trực tiếp (đã xong, tài liệu mục 9)

- **Trình duyệt:** mở webcam bằng `getUserMedia`; video hiển thị trực tiếp nên không bị chậm; gửi khung hình lên backend khoảng 5–8 lần/giây.
- **Backend:** chỉ chạy bước phát hiện (khoảng 120 ms/khung) cho mọi khung nhận được và dùng lại tracker của video; đọc ký tự vài khung tốt nhất của mỗi xe; bỏ qua khung mới khi đang bận để tránh trễ dồn; mỗi xe lưu một lần; cảnh báo ngay khi gặp biển trong danh sách đen.
- **Hiển thị:** giữa hai lần cập nhật, khung biển được dự đoán theo hướng di chuyển để trông liền mạch; trễ khoảng 0,1–0,3 s so với xe thật.
- **Đã chốt:** chỉ webcam / camera điện thoại qua trình duyệt (chưa cần RTSP); chỉ lưu một khung hình rõ nhất mỗi xe, không lưu video.

### Giai đoạn 4: Cải thiện độ chính xác

1. **Lỗi D / U khi biển bị lóa:**
   - Dựa vào danh sách seri hợp lệ của biển Việt Nam: seri không tồn tại thì đổi sang chữ gần giống nhất có thật.
   - Bỏ phiếu theo từng ký tự: đã làm cho video và camera (nhiều lần đọc một xe); với ảnh tĩnh còn có thể dùng thêm ứng viên thứ hai của CTC.
   - Huấn luyện lại mô hình OCR riêng với ảnh biển bị lóa giả lập (tăng sáng cục bộ, giảm tương phản), khoảng 20 phút.
2. **Biển yếu bị mô hình pose bỏ sót:** huấn luyện thêm mô hình phát hiện YOLO12s thường (khoảng 2 giờ, `training/train_plate.py`), với ảnh lớn chạy cả hai mô hình rồi gộp kết quả.
3. **Số liệu chính thức cho báo cáo:** duyệt xong `datasets/eval-200/review.html`, tải `answers.csv`, chạy `node scripts/eval-200.ts` (trong `backend/`), đưa bảng kết quả vào báo cáo.

### Thứ tự đề xuất và ước lượng

| Bước | Nội dung | Ước lượng |
|---|---|---|
| 1 | Thử camera với webcam / điện thoại thật | — |
| 2 | Sửa lỗi D/U bằng luật seri + bỏ phiếu theo ký tự | 1 buổi |
| 3 | Mô hình phát hiện YOLO12s thường cho biển yếu | 2 giờ huấn luyện + nửa buổi |
| 4 | Huấn luyện lại OCR với ảnh lóa, đo trên tập 200 ảnh, cập nhật báo cáo | 1 buổi |
