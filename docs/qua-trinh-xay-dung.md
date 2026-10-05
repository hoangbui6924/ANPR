# Quá trình xây dựng và huấn luyện hệ thống nhận dạng biển số xe (ANPR)

Tài liệu này ghi lại các bước đã thực hiện thực tế khi xây dựng website nhận dạng biển số xe máy và ô tô Việt Nam bằng YOLOv11, theo kế hoạch trong tài liệu "Quy trình xây dựng website ANPR YOLOv11". Mỗi phần mô tả việc đã làm, kết quả đo được, các vấn đề gặp phải và cách giải quyết, kèm lý do của từng quyết định. Những chỗ khác với kế hoạch ban đầu được nêu rõ để thuận tiện khi viết báo cáo.

---

## 1. Chuẩn bị môi trường

### 1.1 Hiện trạng máy và những điểm khác với kế hoạch

Máy phát triển dùng Windows 11, GPU NVIDIA GeForce RTX 3060 Laptop 6 GB. Khi kiểm tra lại trước khi bắt đầu, có ba điểm khác với bảng hiện trạng trong kế hoạch:

- Máy chưa có Python (kế hoạch ghi đã có 3.13.8). Python 3.12.10 được cài mới và đặt ở ổ D (`D:\Python\Python312`) để không chiếm dung lượng ổ hệ thống.
- Node.js là bản 24 thay vì 22. Bản 24 vẫn tương thích với toàn bộ thư viện, và còn chạy trực tiếp được tệp TypeScript nên thuận tiện cho việc viết script thử nghiệm.
- Driver GPU là bản 517.48, quá cũ để chạy PyTorch bản CUDA 12.8 như lệnh mẫu trong kế hoạch. Thay vì nâng cấp driver, nhóm chọn PyTorch 2.7.1 bản CUDA 11.8, vốn chạy được trên driver hiện có. Sau khi cài, PyTorch nhận GPU bình thường.

Ngoài ra, máy chưa cài Microsoft Visual C++ Redistributable, khiến thư viện `onnxruntime-node` không nạp được trên Windows. Gói này được cài bổ sung qua `winget`.

### 1.2 Môi trường huấn luyện

Môi trường huấn luyện là một môi trường ảo Python riêng (`training/.venv`), tách khỏi Python hệ thống. Các gói chính: PyTorch 2.7.1 (CUDA 11.8), Ultralytics 8.4, OpenCV, ONNX và onnxslim. Vì tốc độ mạng tới kho gói PyPI rất chậm trong thời gian thực hiện (khoảng 20–30 KB/s), tệp cài đặt PyTorch (2,8 GB) được tải riêng từ máy chủ của PyTorch rồi cài từ tệp cục bộ.

### 1.3 Môi trường web

Phần web gồm backend Node.js (Express 5, TypeScript, Prisma 7), frontend React 19 + Vite + TailwindCSS 4, và cơ sở dữ liệu PostgreSQL 16 chạy trong Docker. Mã nguồn được quản lý bằng Git ngay từ đầu.

---

## 2. Chuẩn bị dữ liệu

### 2.1 Bộ dữ liệu

Bộ dữ liệu sử dụng là "Vietnam License Plate" (Roboflow Universe, phiên bản 2, giấy phép CC BY 4.0), gồm 4.534 ảnh kích thước 640×640, nhãn dạng đa giác 4 góc với hai lớp: lớp 0 là biển một dòng, lớp 1 là biển hai dòng. Ảnh đến từ năm nguồn, nhận biết qua tiền tố tên tệp: bãi giữ xe máy (greenpack), cổng barrier ô tô (carlong), ô tô cận cảnh (Tgmt) và hai nguồn ảnh đường phố (Dieu, Hung).

Khi đọc tệp mô tả của bộ dữ liệu, nhóm phát hiện một chi tiết mà kế hoạch chưa đề cập: toàn bộ ảnh đã được Roboflow **kéo giãn** (stretch) về 640×640 chứ không giữ tỷ lệ khung hình. Chi tiết này ảnh hưởng đến cách đưa ảnh vào mô hình khi nhận dạng ảnh thực tế (xem mục 5.5).

### 2.2 Chia lại tập dữ liệu

Phân chia gốc có hai vấn đề: tập test chỉ chứa ảnh của nguồn Tgmt (ô tô cận cảnh) nên không phản ánh đúng khả năng của mô hình với xe máy và ảnh đường phố, và tập valid chiếm tới 27%. Vì vậy dữ liệu được gộp lại, nhóm theo nguồn, xáo trộn với hạt giống cố định (seed 42) rồi chia mỗi nguồn theo tỷ lệ 80% train, 10% valid, 10% test. Tên lớp được đổi thành `plate_1line` và `plate_2line`; thứ tự lớp giữ nguyên nên không phải sửa các tệp nhãn.

Kết quả phân chia (khớp với bảng đề xuất trong kế hoạch):

| Nguồn | Bối cảnh | Train | Valid | Test |
|---|---|---|---|---|
| Dieu | Đường phố | 396 | 49 | 50 |
| Hung | Đường phố | 344 | 43 | 43 |
| Tgmt | Ô tô cận cảnh | 698 | 87 | 88 |
| carlong | Cổng barrier ô tô | 791 | 99 | 99 |
| greenpack | Bãi giữ xe máy | 1.397 | 175 | 175 |
| **Tổng** | | **3.626** | **453** | **455** |

Sau khi chia, nhãn được vẽ lại lên 24 ảnh ngẫu nhiên của tập test để kiểm tra bằng mắt. Các khung đều ôm sát biển số, kể cả biển nhỏ ở xa và biển nghiêng; lớp được gán đúng theo hình dạng biển (có cả biển hai dòng của ô tô). Tập test mới chứa đủ năm bối cảnh, và có cả biển nền vàng của xe kinh doanh.

---

## 3. Huấn luyện mô hình phát hiện biển số

### 3.1 Cấu hình

Mô hình phát hiện biển số dùng YOLO11s (bản "small", cân bằng giữa tốc độ và độ chính xác), huấn luyện với ảnh 640×640, tối đa 100 epoch, cơ chế dừng sớm sau 20 epoch không cải thiện (patience 20), seed 42.

Lần chạy đầu với batch 16 bị lỗi hết bộ nhớ GPU ngay ở bước đánh giá cuối epoch đầu tiên: khi huấn luyện, GPU dùng khoảng 3,95 GB, nhưng bước đánh giá của Ultralytics dùng batch gấp đôi, cộng với phần bộ nhớ hệ điều hành đang chiếm, nên vượt quá 6 GB. Theo đúng phương án dự phòng trong kế hoạch, batch được giảm xuống 8 và số luồng nạp dữ liệu giảm xuống 2. Lần chạy thứ hai diễn ra ổn định.

### 3.2 Quá trình huấn luyện

Mỗi epoch mất khoảng 52 giây (bao gồm cả bước đánh giá trên tập valid). Mô hình hội tụ nhanh: sau 10 epoch, mAP50 trên tập valid đã đạt 0,989.

| Epoch | Precision | Recall | mAP50 | mAP50-95 |
|---|---|---|---|---|
| 1 | 0,858 | 0,906 | 0,901 | 0,705 |
| 5 | 0,943 | 0,943 | 0,978 | 0,815 |
| 10 | 0,985 | 0,983 | 0,989 | 0,845 |
| 46 | — | — | 0,992 | 0,887 |
| 65 (tốt nhất) | 0,988 | 0,985 | 0,993 | 0,901 |

Quá trình huấn luyện tự dừng ở epoch 85 vì 20 epoch liên tiếp không cải thiện; mô hình tốt nhất được lưu ở epoch 65. Tổng thời gian huấn luyện là 1,24 giờ.

### 3.3 Kết quả trên tập test

Mô hình tốt nhất được đánh giá trên tập test mới (455 ảnh, đủ năm nguồn, không tham gia huấn luyện):

| Lớp | Số biển | Precision | Recall | mAP50 | mAP50-95 |
|---|---|---|---|---|---|
| Tất cả | 513 | 0,987 | 0,989 | 0,992 | 0,904 |
| Biển một dòng | 153 | 0,989 | 1,000 | 0,995 | 0,896 |
| Biển hai dòng | 360 | 0,985 | 0,978 | 0,990 | 0,912 |

Kết quả trên tập test sát với tập valid (mAP50-95 0,904 so với 0,901), cho thấy mô hình không bị quá khớp. Tốc độ suy luận khoảng 6 ms mỗi ảnh trên GPU.

### 3.4 Xuất sang ONNX

Mô hình được xuất sang định dạng ONNX kèm bước lọc khung trùng (NMS) bên trong, để phần mã Node.js không phải tự cài đặt NMS:

```
yolo export model=runs/plate/weights/best.pt format=onnx imgsz=640 nms=True
```

Đầu ra của mô hình có dạng `[1, 300, 6]`, mỗi dòng gồm tọa độ góc trên trái và góc dưới phải, độ tin cậy và lớp.

---

## 4. Lựa chọn và tích hợp OCR

### 4.1 Chọn PaddleOCR

Kế hoạch ban đầu chọn huấn luyện một mô hình YOLO11 nhận dạng từng ký tự (36 lớp), nhưng hướng này cần một bộ dữ liệu gán nhãn từng ký tự, mà bộ dữ liệu hiện có chỉ chứa vị trí biển. Vì vậy nhóm chuyển sang phương án dự phòng trong kế hoạch: dùng mô hình nhận dạng chữ của PaddleOCR ở định dạng ONNX. Cách này giữ nguyên kiến trúc "hướng A" (chỉ một backend Node.js, không cần dịch vụ Python), vì mô hình ONNX chạy trực tiếp bằng `onnxruntime-node`.

Mô hình nhận dạng của PaddleOCR chỉ đọc một dòng chữ mỗi lần và trả về xác suất ký tự theo từng bước thời gian; nhóm tự cài đặt phần tiền xử lý (đưa ảnh về chiều cao 48 điểm ảnh, chuẩn hóa về khoảng [-1, 1], thứ tự kênh BGR) và phần giải mã CTC tham lam (chọn ký tự có xác suất cao nhất ở mỗi bước, gộp ký tự lặp và bỏ ký tự trống).

### 4.2 Chuỗi xử lý nhận dạng

Một ảnh đi qua các bước sau:

1. Đọc ảnh và xoay đúng chiều theo thông tin EXIF.
2. Đưa ảnh về 640×640 và chạy mô hình phát hiện để lấy các khung biển số cùng loại biển (một dòng hay hai dòng).
3. Cắt từng biển từ ảnh gốc độ phân giải đầy đủ, nới rộng khung một chút để không mất ký tự ở mép.
4. Với biển hai dòng, tìm hàng điểm ảnh sáng nhất ở khoảng giữa biển (khe giữa hai dòng chữ) để tách thành dòng trên và dòng dưới, mỗi dòng đọc riêng.
5. Đọc ký tự bằng mô hình OCR.
6. Hậu xử lý theo định dạng biển số Việt Nam.

### 4.3 Hậu xử lý theo định dạng biển số Việt Nam

Biển số Việt Nam có cấu trúc cố định: hai chữ số mã tỉnh, phần seri (một chữ cái; hai chữ cái; hoặc một chữ cái và một chữ số với xe máy), sau đó là 4 hoặc 5 chữ số. Dựa vào vị trí, các ký tự dễ nhầm được sửa lại: ở vị trí phải là số thì O, D, Q thành 0; I, L, T thành 1; Z thành 2; S thành 5; G thành 6; B thành 8; ở vị trí phải là chữ thì làm ngược lại. Chuỗi kết quả được kiểm tra bằng biểu thức chính quy:

```
^(\d{2})([A-Z]{1,2}|[A-Z]\d)(\d{4,5})$
```

Chuỗi khớp định dạng được trình bày lại theo cách hiển thị quen thuộc (ví dụ `51F-155.85` cho ô tô, `59-V2 453.87` cho xe máy); chuỗi không khớp vẫn được lưu nhưng đánh dấu "cần kiểm tra".

Trong quá trình thử nghiệm, nhóm phát hiện một lỗi quan trọng ở bước này: khi gộp hai dòng của biển hai dòng thành một chuỗi rồi mới đoán định dạng, chuỗi như `52T76433` có thể hiểu là xe máy `52-T7 6433` hoặc ô tô `52T-764.33`. Cách sửa là giữ riêng hai dòng: dòng trên của biển hai dòng luôn là mã tỉnh và seri, dòng dưới luôn là dãy số. Riêng thay đổi này đã nâng số biển đọc đúng trên mẫu thử từ 27 lên 31 trên 42.

### 4.4 So sánh mô hình OCR và các bước tiền xử lý ảnh

Vì chưa có tập kiểm thử toàn hệ thống có đáp án (mục 4.6 của kế hoạch), nhóm lập một mẫu đánh giá gồm 42 biển số lấy từ 39 ảnh của tập test (trải đều năm nguồn), với đáp án được đọc bằng mắt; 4 biển có đáp án chưa chắc chắn vì ảnh mờ hoặc bị che. Một biển chỉ được tính là đúng khi toàn bộ chuỗi trùng khớp. Mẫu này chỉ dùng để so sánh các phương án; con số chính thức cần đo trên tập khoảng 200 ảnh có đáp án được kiểm tra lại.

So sánh các mô hình nhận dạng của PaddleOCR (chạy trên CPU):

| Mô hình | Đúng (trên 42) | Thời gian mỗi biển |
|---|---|---|
| en_PP-OCRv3 (bảng ký tự Latin) | khoảng 29* | 15 ms |
| ch_PP-OCRv4 mobile | 31 | 15 ms |
| ch_PP-OCRv4 server | 34 | 38 ms |

\* Ước lượng từ lần chấm bằng mắt; mô hình này thường xuyên mất ký tự nên bị loại sớm.

Nhóm cũng thử các bước tiền xử lý ảnh biển trước khi đọc: chuyển ảnh xám, tăng tương phản toàn cục, tăng tương phản cục bộ (CLAHE), làm nét và nắn nghiêng (ước lượng góc nghiêng bằng cách tìm góc làm cho hình chiếu theo hàng của các điểm ảnh tối có phương sai lớn nhất). Kết quả với mô hình ch_PP-OCRv4 server: không có bước nào cải thiện rõ rệt (chênh lệch tối đa một biển, nằm trong mức dao động của mẫu nhỏ); tăng tương phản và CLAHE còn làm giảm nhẹ. Nguyên nhân là mô hình phát hiện đã cắt biển rất sát và mô hình PaddleOCR vốn đã được huấn luyện trên ảnh đa dạng; các lỗi còn lại chủ yếu do biển chụp xéo (méo phối cảnh) chứ không phải do xoay, nên nắn nghiêng không giúp được.

### 4.5 Đánh giá mô hình phát hiện trong Node.js

Mô hình ONNX được chạy lại trên toàn bộ tập test bằng Node.js (CPU) để kiểm tra phần cài đặt tiền xử lý, đồng thời đo riêng theo từng nguồn như kế hoạch yêu cầu:

| Nguồn | Số ảnh | Precision | Recall | Đúng loại biển | Thời gian |
|---|---|---|---|---|---|
| greenpack (bãi xe máy) | 175 | 100% | 100% | 100% | 81 ms |
| Tgmt (ô tô cận cảnh) | 88 | 98,9% | 100% | 100% | 81 ms |
| carlong (cổng barrier) | 99 | 93,4% | 100% | 100% | 82 ms |
| Dieu (đường phố) | 50 | 96,3% | 96,3% | 100% | 85 ms |
| Hung (đường phố) | 43 | 92,9% | 94,2% | 98,5% | 83 ms |
| **Tất cả** | **455** | **96,9%** | **98,6%** | **99,8%** | **82 ms** |

Ảnh đường phố là bối cảnh khó nhất vì biển nhỏ và ở xa; nguồn cổng barrier có precision thấp hơn do đôi khi nhận nhầm vật thể khác là biển số. Hai cách đưa ảnh vào mô hình (kéo giãn và giữ tỷ lệ có đệm viền) cho kết quả giống hệt nhau trên tập test, vì mọi ảnh test đều vuông.

---

## 5. Tối ưu cho ảnh thực tế và biển số nhỏ

### 5.1 Trường hợp ảnh thực tế đầu tiên

Ảnh thực tế đầu tiên được thử (ảnh chữ nhật 1163×740, biển nhỏ, chụp xéo, có lửa gần) cho kết quả `37A-7132` trong khi biển thật là `37A-715.32`. Khi phân tích, nhóm nhận thấy ba nguyên nhân: biển chỉ chiếm khung 89×50 điểm ảnh và chụp xéo nên khung chứa nhiều nền; kéo giãn ảnh chữ nhật về 640×640 làm méo biển và khung kém chính xác; và kết quả OCR rất nhạy với chi tiết nhỏ (chỉ cần thay đổi độ nới khung hoặc bật chế độ ảnh xám là ký tự "5" lúc có lúc mất).

### 5.2 Giữ tỷ lệ ảnh và bỏ phiếu nhiều lần đọc

Hai thay đổi được áp dụng. Thứ nhất, ảnh được đưa vào mô hình phát hiện theo kiểu giữ tỷ lệ và đệm viền xám (letterbox) như kế hoạch, thay vì kéo giãn; với ảnh trên, khung biển ôm sát hơn và độ tin cậy cao hơn. Thứ hai, mỗi biển được đọc bốn lần với các biến thể khác nhau (nới khung 2% hoặc 6%, ảnh màu hoặc ảnh xám); chuỗi nào khớp định dạng biển Việt Nam và xuất hiện nhiều nhất được chọn, nếu hòa thì lấy chuỗi có độ tin cậy trung bình cao hơn. Cách này khiến một lần đọc hụt không còn quyết định kết quả. Trên mẫu 42 biển, cấu hình mới giữ nguyên 35/42, và đọc đúng ảnh thực tế nói trên; thời gian xử lý tăng từ khoảng 160 ms lên khoảng 300 ms mỗi ảnh trên CPU.

### 5.3 Bộ thử biển số nhỏ

Các phép thử trước chủ yếu gồm biển to, rõ nên chưa đánh giá được khả năng đọc biển nhỏ. Nhóm tạo bộ thử biển nhỏ bằng cách thu nhỏ chính các ảnh của mẫu đánh giá xuống 50%, 35% và 25% kích thước, sau đó nén JPEG chất lượng 75 để mô phỏng ảnh mạng hoặc ảnh camera. Chiều cao chữ (tính cho mỗi dòng chữ) ở các mức như sau:

| Mức thu nhỏ | Chiều cao chữ nhỏ nhất / trung vị |
|---|---|
| ×1 | 12 / 70 điểm ảnh |
| ×0,5 | 6 / 35 điểm ảnh |
| ×0,35 | 4 / 24 điểm ảnh |
| ×0,25 | 3 / 17 điểm ảnh |

Với cấu hình hiện tại, số biển đọc đúng lần lượt là 35, 37, 30 và 21 trên 42: khi chữ chỉ còn khoảng 17 điểm ảnh, hệ thống đọc đúng khoảng một nửa.

### 5.4 Thử các cách tối ưu và chẩn đoán nguyên nhân

Ba cách tối ưu được thử: hạ ngưỡng độ tin cậy của khâu phát hiện (khung có độ tin cậy thấp chỉ được giữ nếu đọc ra chuỗi hợp lệ), phát hiện thêm trên bốn ô ảnh chồng lấn được phóng to (tiling, giúp biển nhỏ trông to gấp đôi với mô hình), và thêm các biến thể đọc cho biển nhỏ (phóng to bằng nội suy Lanczos kết hợp làm nét, tăng tương phản cục bộ). Không cách nào cải thiện kết quả; tiling chạy trên mọi ảnh còn làm giảm độ chính xác và tăng thời gian gần ba lần.

Để tìm nguyên nhân, nhóm tách riêng hai khâu: đo tỷ lệ mô hình phát hiện tìm được biển, và đo độ chính xác OCR khi được cung cấp đúng khung nhãn gốc (tức giả định khâu phát hiện hoàn hảo):

| Mức thu nhỏ | Phát hiện được biển | OCR đúng trên khung nhãn gốc |
|---|---|---|
| ×0,5 | 43/43 | 34/43 |
| ×0,35 | 42/43 | 27/43 |
| ×0,25 | 41/43 | 19/43 |

Kết quả cho thấy khâu phát hiện gần như không có vấn đề kể cả khi biển rất nhỏ; nút thắt nằm hoàn toàn ở khâu OCR. Điều này giải thích vì sao các cách tối ưu khâu phát hiện không có tác dụng, và phóng to bằng nội suy cũng không giúp vì nội suy không tạo thêm chi tiết.

### 5.5 So sánh các thế hệ PaddleOCR mới hơn

Nhóm thử thêm các mô hình nhận dạng mới hơn do PaddlePaddle phát hành ở định dạng ONNX, đo trên khung nhãn gốc:

| Mô hình | ×0,5 | ×0,35 | ×0,25 |
|---|---|---|---|
| PP-OCRv4 server (đang dùng) | 34 | 27 | 19 |
| PP-OCRv5 server | 32 | 24 | 18 |
| en_PP-OCRv5 mobile | 29 | 26 | 21 |
| PP-OCRv6 small | 31 | 30 | 19 |
| PP-OCRv6 medium | 37 | 27 | 21 |

Các mô hình mới chỉ cải thiện một đến ba biển. Ở mức chữ cao khoảng 17 điểm ảnh, mọi mô hình nhận dạng chữ tổng quát đều dừng ở khoảng 45–50%. Kết luận: để đọc được biển nhỏ cần một mô hình OCR được huấn luyện riêng cho biển số Việt Nam ở độ phân giải thấp.

### 5.6 Huấn luyện mô hình OCR riêng cho biển số (đang thực hiện)

**Tạo dữ liệu bằng gán nhãn tự động.** Bộ dữ liệu không có chuỗi ký tự, nên nhóm dùng chính các mô hình mạnh nhất hiện có để gán nhãn tự động, với điều kiện chặt chẽ để hạn chế nhãn sai. Với mỗi khung biển trong nhãn gốc của tập train và valid, biển được cắt ở độ phân giải đầy đủ (nơi các mô hình đọc tốt nhất), rồi được đọc độc lập bởi hai mô hình khác nhau là PP-OCRv4 server và PP-OCRv6 medium, mỗi mô hình bỏ phiếu trên bốn biến thể. Nhãn chỉ được giữ khi kết quả của cả hai mô hình hợp lệ và trùng khớp hoàn toàn. Biển hai dòng được tách thành từng dòng theo đúng cách tách lúc nhận dạng, và nhãn của từng dòng được suy ra từ cấu trúc biển (dòng trên là mã tỉnh và seri, dòng dưới là dãy số). Tập test không được dùng ở bước này, nên mẫu đánh giá 42 biển vẫn độc lập.

**Mô hình và cách huấn luyện.** Mô hình là một mạng CRNN nhỏ: phần tích chập trích đặc trưng từ ảnh xám cao 32 điểm ảnh, rộng tối đa 160, tạo ra chuỗi 40 bước theo chiều ngang; tiếp theo là hai lớp LSTM hai chiều và một lớp phân loại 37 lớp (36 ký tự 0–9, A–Z và ký tự trống của CTC). Hàm mất mát là CTC. Điểm mấu chốt là ảnh huấn luyện được làm hỏng ngẫu nhiên ở mỗi lần đọc: thu nhỏ để chữ chỉ còn cao 6 đến 40 điểm ảnh, làm mờ, nén JPEG với chất lượng 25–95, xoay và xô lệch nhẹ, thay đổi độ sáng, tương phản và thêm nhiễu, cắt hoặc nới mép ngẫu nhiên. Nhờ vậy mô hình học cách đọc biển ở điều kiện xấu thay vì chỉ ảnh rõ nét. Trong quá trình huấn luyện, độ chính xác theo dòng được đo trên tập valid ở ba mức: ảnh gốc, chữ cao 16 điểm ảnh và chữ cao 10 điểm ảnh.

Kết quả của bước này sẽ được bổ sung sau khi huấn luyện xong.

---

## 6. Cơ sở dữ liệu và backend API

### 6.1 Cơ sở dữ liệu

PostgreSQL 16 chạy trong Docker. Lược đồ gồm bốn bảng theo kế hoạch: `users` (tài khoản, vai trò admin hoặc staff), `detections` (mỗi lần nhận dạng một ảnh), `plates` (mỗi biển tìm được, gồm chuỗi hiển thị, chuỗi chuẩn hóa, loại biển, loại xe, độ tin cậy, tọa độ khung, ảnh cắt và cờ hợp lệ) và `vehicle_lists` (danh sách trắng/đen theo biển số chuẩn hóa). Danh sách đen được đối chiếu tại thời điểm truy vấn theo biển số chuẩn hóa, nên thêm một biển vào danh sách đen sẽ có hiệu lực ngay cả với các lần nhận dạng cũ.

Để tìm biển số khi OCR có thể đọc sai một ký tự, nhóm bật extension `pg_trgm` của PostgreSQL và tạo chỉ mục GIN trên cột biển số chuẩn hóa:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX plates_norm_trgm ON plates USING gin (plate_norm gin_trgm_ops);
```

Khi kiểm thử, tìm `56N7181` (sai một ký tự) vẫn trả về biển `56N7186` với độ tương đồng 0,6.

Lược đồ được khai báo bằng Prisma 7. So với hướng dẫn trong kế hoạch (viết cho Prisma bản cũ hơn), Prisma 7 đặt chuỗi kết nối trong tệp `prisma.config.ts` và yêu cầu một driver adapter (`@prisma/adapter-pg`).

### 6.2 Backend API

Backend dùng Express 5 và TypeScript, gồm các nhóm API theo kế hoạch: xác thực, nhận dạng, lịch sử nhận dạng, tìm kiếm biển số, danh sách trắng/đen, thống kê và quản lý người dùng. Mô hình phát hiện và mô hình OCR được nạp một lần khi khởi động máy chủ (khoảng 0,7 giây) và dùng lại cho mọi yêu cầu.

Về bảo mật: mật khẩu băm bằng bcrypt (thư viện `bcryptjs`, bản viết bằng JavaScript thuần để tránh phải biên dịch mô-đun gốc trên Windows); access token JWT có hạn 15 phút, refresh token 7 ngày; phân quyền admin và staff; kiểm tra dữ liệu đầu vào bằng Zod; chỉ nhận ảnh JPG/PNG tối đa 5 MB; giới hạn số lần đăng nhập; dùng helmet và CORS chỉ cho phép địa chỉ frontend. Ảnh gốc và ảnh cắt biển được lưu trên đĩa với tên ngẫu nhiên (UUID); cơ sở dữ liệu chỉ lưu đường dẫn.

Máy chủ API chạy ở cổng 3001 thay vì 3000 như kế hoạch, vì cổng 3000 trên máy phát triển đã bị một ứng dụng khác sử dụng; cổng có thể đổi trong tệp cấu hình.

### 6.3 Kiểm thử API

Một kịch bản kiểm thử tự động gọi toàn bộ API với ảnh thật và kiểm tra 33 tình huống: đăng nhập đúng và sai, làm mới token, nhận dạng biển một dòng và hai dòng, từ chối tệp không phải ảnh, lịch sử có phân trang và lọc theo ngày, tìm kiếm gần đúng, thêm biển vào danh sách đen và nhận cảnh báo khi nhận dạng lại, thống kê, tạo người dùng, kiểm tra phân quyền (staff không xem được danh sách người dùng, không xóa được dữ liệu), không cho admin tự khóa tài khoản của mình, tài khoản bị khóa không đăng nhập được, và xóa một lần nhận dạng kèm tệp ảnh. Lần chạy đầu phát hiện một lỗi (ảnh đã xóa trả về mã 500 thay vì 404); sau khi sửa, cả 33 tình huống đều đạt.

---

## 7. Giao diện web

Giao diện được xây dựng bằng React 19, Vite, TypeScript và TailwindCSS, gồm sáu trang theo kế hoạch: đăng nhập, nhận dạng, lịch sử, danh sách xe, thống kê và người dùng (chỉ admin). Thư viện TanStack Query quản lý việc gọi API và bộ nhớ đệm; Recharts vẽ biểu đồ thống kê. Giao diện hỗ trợ chế độ sáng, tối và màn hình điện thoại.

Trang nhận dạng cho phép tải một ảnh hoặc kéo thả cả một thư mục ảnh. Khi tải thư mục, các tệp JPG/PNG hợp lệ được sắp theo tên và nhận dạng lần lượt, có thanh tiến độ; người dùng chuyển ảnh bằng nút trái/phải, phím mũi tên hoặc dải ảnh thu nhỏ có đánh dấu trạng thái từng ảnh. Kết quả hiển thị khung biển trên ảnh (màu khác nhau cho biển một dòng, hai dòng và biển thuộc danh sách đen), ảnh cắt biển, chuỗi biển số trình bày giống biển thật, loại xe, độ tin cậy phát hiện và đọc ký tự, cùng nhãn "Hợp lệ" hoặc "Cần kiểm tra". Biển thuộc danh sách đen có cảnh báo nổi bật kèm biểu tượng, không chỉ dựa vào màu sắc.

Trong giai đoạn chưa có backend, giao diện chạy với một bộ dữ liệu mô phỏng có cùng định dạng với API; khi backend sẵn sàng chỉ cần tắt chế độ mô phỏng. Toàn bộ luồng chính (đăng nhập, nhận dạng cả thư mục ảnh thật, lịch sử, thống kê) đã được kiểm thử tự động bằng trình duyệt Edge với backend thật.

---

## 8. Những điểm khác với kế hoạch ban đầu

| Kế hoạch | Thực tế | Lý do |
|---|---|---|
| PyTorch CUDA 12.8 | PyTorch CUDA 11.8 | Driver GPU 517.48 không hỗ trợ CUDA 12.8 |
| Batch 16 khi huấn luyện | Batch 8 | Hết bộ nhớ GPU 6 GB ở bước đánh giá |
| YOLO11 nhận dạng ký tự | PaddleOCR (ONNX), sau đó huấn luyện CRNN riêng | Không có dữ liệu gán nhãn ký tự; PaddleOCR yếu với biển nhỏ |
| Letterbox khi nhận dạng | Ban đầu kéo giãn, sau chuyển sang letterbox | Ảnh huấn luyện bị kéo giãn; ảnh thực tế chữ nhật cho thấy letterbox tốt hơn |
| Một lần đọc mỗi biển | Bỏ phiếu trên bốn biến thể | Kết quả OCR với biển nhỏ không ổn định |
| shadcn/ui | Bộ thành phần giao diện tự viết cùng phong cách | Công cụ cài đặt của shadcn/ui cần thao tác tương tác |
| bcrypt | bcryptjs | Tránh biên dịch mô-đun gốc trên Windows |
| Cổng API 3000 | Cổng 3001 | Cổng 3000 đã bị ứng dụng khác dùng |
| Prisma (bản cũ) | Prisma 7 | Bản mới nhất khi thực hiện; cấu hình kết nối thay đổi |

---

## 9. Hạn chế và hướng phát triển

- Mẫu đánh giá OCR (42 biển) có đáp án do người thực hiện tự đọc, có 4 biển chưa chắc chắn; cần xây dựng tập kiểm thử khoảng 200 ảnh có đáp án được kiểm tra lại để có con số chính thức.
- Biển chụp xéo (méo phối cảnh) vẫn là nhóm lỗi lớn; hướng giải quyết là huấn luyện mô hình YOLO11-pose trả về bốn góc biển để nắn thẳng trước khi đọc, tận dụng nhãn đa giác bốn góc sẵn có.
- Mô hình phát hiện đôi khi nhận nhầm vật thể khác là biển số ở bối cảnh cổng barrier; các khung này hiện bị loại nhờ bước kiểm tra định dạng của OCR.
- Ảnh tải lên hiện được phục vụ công khai (tên tệp ngẫu nhiên, khó đoán); có thể bổ sung kiểm soát truy cập.
- Các bước còn lại theo kế hoạch: tính năng webcam thời gian thực, kiểm thử đơn vị (Vitest, Supertest) và đóng gói toàn hệ thống bằng Docker Compose.
