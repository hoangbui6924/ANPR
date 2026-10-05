# Việc tiếp theo

Danh sách việc còn lại sau buổi làm việc ngày 05/10/2026. Trạng thái hiện tại: nhận dạng ảnh tĩnh và cả thư mục ảnh chạy ổn (YOLO11s-pose + nắn phối cảnh, PaddleOCR + CRNN tự huấn luyện bỏ phiếu), web + API + PostgreSQL chạy được bằng Docker Compose.

## Tính năng mới

1. **Nhận dạng từ video.** Tải lên một tệp video (mp4…), trích khung hình theo khoảng thời gian (ví dụ 2–5 khung/giây), nhận dạng từng khung, gộp kết quả theo biển số: cùng một biển xuất hiện ở nhiều khung chỉ ghi một lần, giữ chuỗi được bỏ phiếu nhiều nhất và khung hình rõ nhất. Hiển thị dòng thời gian (biển nào xuất hiện ở giây thứ mấy) và cho phép tua tới khung hình tương ứng.
2. **Nhận dạng qua camera trực tiếp (chương 10 của kế hoạch).** Trình duyệt mở webcam bằng `getUserMedia`, gửi khung hình định kỳ (300–500 ms) qua Socket.IO; backend nhận dạng và trả kết quả ngay để vẽ khung lên video; bỏ qua khung mới khi backend đang bận để tránh trễ dồn; cùng một biển trong N giây (ví dụ 10 giây) chỉ lưu một lần; cảnh báo ngay khi gặp biển trong danh sách đen. Cân nhắc thêm nguồn camera IP (RTSP) ở phía backend.

Hai tính năng có thể dùng chung phần "gộp kết quả theo biển qua nhiều khung hình" và phần theo dõi biển giữa các khung (tracking đơn giản theo vị trí khung và chuỗi biển số).

## Cải thiện độ chính xác

1. **Nhầm D và U ở seri biển khi ánh sáng chói / lóa.** Ví dụ ảnh đường phố có hai xe biển `52D-0694` và `52D-1843` (2 dòng) đọc sai ký tự seri giữa D và U. Hướng xử lý:
   - Bổ sung mẫu biển bị lóa, ngược sáng vào dữ liệu huấn luyện mô hình OCR riêng (tăng cường độ sáng, giả lập lóa, giảm tương phản cục bộ).
   - Dùng danh sách seri hợp lệ của biển Việt Nam để ưu tiên chữ cái có thật khi hai mô hình phân vân.
   - Xem xét giữ thêm ứng viên thứ hai từ CTC (không chỉ chuỗi tham lam) để bỏ phiếu theo từng ký tự.
2. **Biển yếu bị bỏ sót bởi mô hình bốn góc.** Trên ảnh đường phố mục 5.7, mô hình pose không thấy biển `51H-709.67` mà mô hình phát hiện cũ còn thấy (độ tin cậy 0,26). Có thể chạy thêm mô hình cũ cho ảnh lớn rồi gộp kết quả.
3. **Số liệu chính thức:** duyệt xong `datasets/eval-200/review.html`, tải `answers.csv`, chạy `node scripts/eval-200.ts` và đưa bảng kết quả vào báo cáo.
