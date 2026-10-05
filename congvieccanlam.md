# Công việc cần làm

Ghi chú ngày 05/10/2026. Đây chỉ là kế hoạch, chưa triển khai.

**Hiện trạng:** nhận dạng ảnh tĩnh và cả thư mục ảnh chạy ổn (YOLO11s-pose + nắn phối cảnh; PaddleOCR + CRNN tự huấn luyện cùng bỏ phiếu); web + API + PostgreSQL chạy được bằng Docker Compose (http://localhost:8080).

---

## 1. Lỗi đã ghi nhận

- **Nhầm D và U ở seri biển khi ánh sáng chói / lóa.** Ví dụ ảnh đường phố có hai xe biển 2 dòng `52D-0694` và `52D-1843` bị đọc sai ký tự seri giữa D và U. Do góc sáng nên tạm chấp nhận, để sửa sau.
- **Biển yếu bị mô hình bốn góc bỏ sót.** Trên ảnh đường phố (mục 5.7 của tài liệu), mô hình pose không thấy biển `51H-709.67` mà mô hình phát hiện cũ còn thấy (độ tin cậy 0,26).

## 2. Tính năng cần làm thêm

- **Đọc biển số từ video** (tải lên tệp video).
- **Đọc biển số từ camera trực tiếp** (webcam / camera, chương 10 của kế hoạch).

---

## 3. Kế hoạch chỉnh sửa

### Giai đoạn 1: Phần dùng chung cho video và camera

Cả hai tính năng đều cần gộp kết quả theo biển qua nhiều khung hình:

- **Theo dõi biển giữa các khung (tracking đơn giản):** khung ở khung hình sau trùng khung trước (IoU đủ lớn) hoặc đọc ra cùng chuỗi biển số thì coi là cùng một xe.
- **Bỏ phiếu theo thời gian:** mỗi xe giữ chuỗi biển số được đọc nhiều nhất qua các khung và khung hình rõ nhất (độ tin cậy cao nhất) làm ảnh cắt.
- **Cơ sở dữ liệu:** thêm bảng cho mỗi lần xử lý video / phiên camera, kèm danh sách xe và thời điểm xuất hiện; bảng `plates` hiện có dùng lại được.

### Giai đoạn 2: Nhận dạng từ video

- **Backend:** API nhận tệp video (giới hạn dung lượng, ví dụ 100–200 MB); dùng ffmpeg trích khung hình (2–5 khung/giây); xử lý ở nền, báo tiến độ qua Socket.IO.
- **Frontend:** trang mới có trình phát video, thanh tiến độ, danh sách biển kèm thời điểm; bấm vào một biển thì tua video tới đúng giây đó và hiện khung biển.
- **Docker:** thêm ffmpeg vào image API.

### Giai đoạn 3: Camera trực tiếp

- **Trình duyệt:** mở webcam bằng `getUserMedia`, gửi khung hình mỗi 300–500 ms qua Socket.IO, vẽ khung biển và biển số đè lên video.
- **Backend:** bỏ qua khung mới khi đang bận để tránh trễ dồn; cùng một biển trong khoảng 10 giây chỉ lưu một lần; cảnh báo ngay khi gặp biển trong danh sách đen.
- **Tùy chọn:** hỗ trợ camera IP qua RTSP, do backend đọc trực tiếp.
- **Hiệu năng:** khoảng 0,3–0,5 s mỗi khung trên CPU (2–3 khung/giây), đủ cho camera cổng ra vào; với camera có thể chỉ dùng mô hình OCR riêng (nhanh gấp đôi).

### Giai đoạn 4: Cải thiện độ chính xác

1. **Lỗi D / U khi biển bị lóa:**
   - Dựa vào danh sách seri hợp lệ của biển Việt Nam: seri không tồn tại thì đổi sang chữ gần giống nhất có thật.
   - Bỏ phiếu theo từng ký tự thay vì cả chuỗi, dùng thêm ứng viên thứ hai của CTC.
   - Huấn luyện lại mô hình OCR riêng với ảnh biển bị lóa giả lập (tăng sáng cục bộ, giảm tương phản), khoảng 20 phút.
2. **Biển yếu bị mô hình pose bỏ sót:** với ảnh lớn, chạy thêm mô hình phát hiện cũ rồi gộp kết quả (ảnh đường phố sẽ lại đủ 5/5 biển).
3. **Số liệu chính thức cho báo cáo:** duyệt xong `datasets/eval-200/review.html`, tải `answers.csv`, chạy `node scripts/eval-200.ts` (trong `backend/`), đưa bảng kết quả vào báo cáo.

### Thứ tự đề xuất và ước lượng

| Bước | Nội dung | Ước lượng |
|---|---|---|
| 1 | Sửa lỗi D/U bằng luật seri + bỏ phiếu theo ký tự; gộp hai mô hình phát hiện | 1 buổi |
| 2 | Phần dùng chung: tracking, bỏ phiếu theo thời gian, bảng dữ liệu | 1 buổi |
| 3 | Nhận dạng video | 1–2 buổi |
| 4 | Camera trực tiếp | 1–2 buổi |
| 5 | Huấn luyện lại OCR với ảnh lóa, đo trên tập 200 ảnh, cập nhật báo cáo | 1 buổi |

---

## 4. Cần quyết định trước khi bắt đầu

- Video tải lên tối đa bao lớn / dài bao lâu?
- Camera chỉ là webcam / điện thoại qua trình duyệt, hay cần cả camera IP (RTSP)?
- Có lưu lại video gốc không, hay chỉ lưu ảnh các khung hình có biển số?
