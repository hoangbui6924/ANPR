# Quá trình xây dựng và huấn luyện hệ thống nhận dạng biển số xe (ANPR)

Tài liệu này ghi lại các bước đã thực hiện thực tế khi xây dựng website nhận dạng biển số xe máy và ô tô Việt Nam bằng YOLOv12, theo kế hoạch trong tài liệu "Quy trình xây dựng website ANPR YOLOv12". Mỗi phần mô tả việc đã làm, kết quả đo được, các vấn đề gặp phải và cách giải quyết, kèm lý do của từng quyết định. Những chỗ khác với kế hoạch ban đầu được nêu rõ để thuận tiện khi viết báo cáo.

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

Mô hình phát hiện biển số là YOLO12s-pose (bản "small", cân bằng giữa tốc độ và độ chính xác): ngoài khung bao và loại biển (một dòng / hai dòng), mô hình còn dự đoán bốn góc của biển để nắn phối cảnh (mục 5.8). Ultralytics chỉ phát hành trọng số huấn luyện sẵn của YOLO12 cho bài toán phát hiện, không có bản pose, nên mô hình được dựng từ tệp cấu hình `yolo12s-pose.yaml` rồi nạp trọng số của `yolo12s.pt` cho các lớp trùng khớp (691/733 tham số; phần đầu dự đoán bốn góc học từ đầu). Mô hình có 9,5 triệu tham số.

Huấn luyện với ảnh 640×640, tối đa 100 epoch, cơ chế dừng sớm sau 20 epoch không cải thiện (patience 20), seed 42. Máy chỉ có GPU 6 GB: bước đánh giá cuối mỗi epoch của Ultralytics mặc định dùng batch gấp đôi, và khối attention của YOLO12 tốn bộ nhớ GPU hơn các thế hệ YOLO dùng tích chập thuần, nên chọn batch 4 cho cả huấn luyện lẫn đánh giá. Không dùng tiến trình nạp dữ liệu phụ (workers 0), vì trên Windows mỗi tiến trình như vậy nạp lại toàn bộ PyTorch và CUDA, dễ làm cạn bộ nhớ hệ thống.

### 3.2 Quá trình huấn luyện

Mô hình hội tụ nhanh: sau 10 epoch, mAP50 trên tập valid đã đạt 0,988; phần còn lại chủ yếu cải thiện độ khít của khung (mAP50-95).

| Epoch | Precision | Recall | mAP50 | mAP50-95 khung | mAP50-95 bốn góc |
|---|---|---|---|---|---|
| 1 | 0,676 | 0,751 | 0,637 | 0,447 | 0,559 |
| 5 | 0,944 | 0,906 | 0,966 | 0,783 | 0,944 |
| 10 | 0,977 | 0,959 | 0,988 | 0,833 | 0,972 |
| 50 | 0,971 | 0,979 | 0,993 | 0,880 | 0,988 |
| 97 (tốt nhất) | 0,986 | 0,985 | 0,994 | 0,897 | 0,991 |

Mô hình chạy đủ 100 epoch (chưa lần nào 20 epoch liên tiếp không cải thiện), mô hình tốt nhất được lưu ở epoch 97. Tổng thời gian huấn luyện là 4,45 giờ, khoảng 2,5–6 phút mỗi epoch. Nút thắt là phần đọc và tăng cường ảnh trên CPU (do không dùng tiến trình nạp dữ liệu phụ): GPU chỉ được sử dụng khoảng 30% và dùng khoảng 3 GB bộ nhớ.

### 3.3 Kết quả trên tập test

Mô hình tốt nhất được đánh giá trên tập test (455 ảnh, đủ năm nguồn, không tham gia huấn luyện):

| Lớp | Số biển | Precision | Recall | mAP50 | mAP50-95 khung | mAP50-95 bốn góc |
|---|---|---|---|---|---|---|
| Tất cả | 513 | 0,990 | 0,983 | 0,989 | 0,906 | 0,989 |
| Biển một dòng | 153 | 0,991 | 1,000 | 0,995 | 0,900 | 0,994 |
| Biển hai dòng | 360 | 0,989 | 0,966 | 0,984 | 0,913 | 0,983 |

Kết quả trên tập test sát với tập valid (mAP50-95 0,906 so với 0,897), cho thấy mô hình không bị quá khớp. Tốc độ suy luận khoảng 9 ms mỗi ảnh trên GPU; trong Node.js trên CPU, riêng bước phát hiện mất khoảng 120 ms cho một ảnh 1566×853.

### 3.4 Xuất sang ONNX

Mô hình được xuất sang định dạng ONNX kèm bước lọc khung trùng (NMS) bên trong, để phần mã Node.js không phải tự cài đặt NMS:

```
yolo export model=runs/plate_pose/weights/best.pt format=onnx imgsz=640 nms=True
```

Đầu ra của mô hình có dạng `[1, 300, 18]`, mỗi dòng gồm tọa độ góc trên trái và góc dưới phải của khung, độ tin cậy, lớp, rồi tọa độ và độ hiện diện của bốn góc biển.

---

## 4. Lựa chọn và tích hợp OCR

### 4.1 Chọn PaddleOCR

Kế hoạch ban đầu chọn huấn luyện một mô hình YOLO nhận dạng từng ký tự (36 lớp), nhưng hướng này cần một bộ dữ liệu gán nhãn từng ký tự, mà bộ dữ liệu hiện có chỉ chứa vị trí biển. Vì vậy nhóm chuyển sang phương án dự phòng trong kế hoạch: dùng mô hình nhận dạng chữ của PaddleOCR ở định dạng ONNX. Cách này giữ nguyên kiến trúc "hướng A" (chỉ một backend Node.js, không cần dịch vụ Python), vì mô hình ONNX chạy trực tiếp bằng `onnxruntime-node`.

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

### 5.6 Huấn luyện mô hình OCR riêng cho biển số

**Tạo dữ liệu bằng gán nhãn tự động.** Bộ dữ liệu không có chuỗi ký tự, nên nhóm dùng chính các mô hình mạnh nhất hiện có để gán nhãn tự động, với điều kiện chặt chẽ để hạn chế nhãn sai. Với mỗi khung biển trong nhãn gốc của tập train và valid, biển được cắt ở độ phân giải đầy đủ (nơi các mô hình đọc tốt nhất), rồi được đọc độc lập bởi hai mô hình khác nhau là PP-OCRv4 server và PP-OCRv6 medium, mỗi mô hình bỏ phiếu trên bốn biến thể. Nhãn chỉ được giữ khi kết quả của cả hai mô hình hợp lệ và trùng khớp hoàn toàn. Biển hai dòng được tách thành từng dòng theo đúng cách tách lúc nhận dạng, và nhãn của từng dòng được suy ra từ cấu trúc biển (dòng trên là mã tỉnh và seri, dòng dưới là dãy số). Tập test không được dùng ở bước này, nên mẫu đánh giá 42 biển vẫn độc lập.

**Mô hình và cách huấn luyện.** Mô hình là một mạng CRNN nhỏ: phần tích chập trích đặc trưng từ ảnh xám cao 32 điểm ảnh, rộng tối đa 160, tạo ra chuỗi 40 bước theo chiều ngang; tiếp theo là hai lớp LSTM hai chiều và một lớp phân loại 37 lớp (36 ký tự 0–9, A–Z và ký tự trống của CTC). Hàm mất mát là CTC. Điểm mấu chốt là ảnh huấn luyện được làm hỏng ngẫu nhiên ở mỗi lần đọc: thu nhỏ để chữ chỉ còn cao 6 đến 40 điểm ảnh, làm mờ, nén JPEG với chất lượng 25–95, xoay và xô lệch nhẹ, thay đổi độ sáng, tương phản và thêm nhiễu, cắt hoặc nới mép ngẫu nhiên. Nhờ vậy mô hình học cách đọc biển ở điều kiện xấu thay vì chỉ ảnh rõ nét. Trong quá trình huấn luyện, độ chính xác theo dòng được đo trên tập valid ở ba mức: ảnh gốc, chữ cao 16 điểm ảnh và chữ cao 10 điểm ảnh.

**Kết quả gán nhãn.** Với tập train, 3.187 trên 4.112 biển (77,5%) được giữ lại, tạo thành 5.283 ảnh dòng chữ; 444 biển bị loại vì chuỗi đọc được không hợp lệ và 481 biển vì hai mô hình không thống nhất. Với tập valid, 396 trên 521 biển (76,0%) được giữ, tạo thành 651 ảnh dòng chữ. Kiểm tra bằng mắt 40 ảnh dòng chữ chọn ngẫu nhiên cho thấy toàn bộ nhãn đều đúng, kể cả biển nền vàng, biển nền tối và biển mờ. Cần lưu ý rằng cách lọc này ưu tiên những biển dễ đọc, nên tập dữ liệu thiên về biển rõ; nhược điểm này được bù lại bằng việc làm hỏng ảnh khi huấn luyện.

**Các vấn đề kỹ thuật khi huấn luyện.** Lần chạy đầu gặp lỗi "hết bộ nhớ GPU" giả trong lớp LSTM khi dùng độ chính xác hỗn hợp (fp16), dù GPU vẫn còn trống hơn 3 GB; cách khắc phục là cho riêng lớp LSTM chạy ở fp32. Lần thứ hai bị treo do các tiến trình phụ nạp dữ liệu trên Windows; vì bước làm hỏng ảnh rất nhẹ (dưới 1 ms mỗi ảnh), nhóm bỏ hẳn tiến trình phụ và nạp dữ liệu ngay trong tiến trình chính. Sau đó mỗi epoch chỉ mất khoảng 6 giây.

**Hai lần huấn luyện.** Lần thứ nhất huấn luyện 60 epoch, mọi ảnh đều bị thu nhỏ ngẫu nhiên. Mô hình hội tụ chậm trong khoảng 10 epoch đầu (giai đoạn mô hình CTC chủ yếu dự đoán ký tự trống), sau đó tăng nhanh. Kết quả tốt nhưng chưa bão hòa, và khi dùng riêng thì kém PaddleOCR ở biển cỡ vừa. Lần thứ hai huấn luyện 150 epoch và giữ 25% mẫu ở độ phân giải gốc, để mô hình vừa đọc tốt biển rõ vừa đọc được biển nhỏ. Mô hình tốt nhất (epoch 132) có kích thước 8 MB, nhỏ hơn hơn mười lần so với mô hình PaddleOCR server (90 MB).

Độ chính xác theo dòng chữ trên tập valid:

| Lần huấn luyện | Ảnh gốc | Chữ cao 16 px | Chữ cao 10 px |
|---|---|---|---|
| Lần 1 (60 epoch) | 87,9% | 84,6% | 56,8% |
| Lần 2 (150 epoch, 25% ảnh gốc) | 96,0% | 93,1% | 65,1% |

**Kết hợp với PaddleOCR.** Khi đo trên bộ thử biển nhỏ với khung nhãn gốc, mô hình riêng lần 2 ngang PaddleOCR ở mức ×0,5 và vượt xa ở các mức nhỏ hơn. Hai mô hình có điểm mạnh bổ sung cho nhau: PaddleOCR tốt với biển cỡ vừa và lớn, mô hình riêng tốt với biển rất nhỏ. Vì vậy nhóm cho hai mô hình cùng bỏ phiếu: mỗi mô hình đọc bốn biến thể, tám kết quả được gộp vào một lần bỏ phiếu chung.

| OCR (trên khung nhãn gốc) | ×0,5 | ×0,35 | ×0,25 |
|---|---|---|---|
| PaddleOCR v4 server | 34/43 | 27/43 | 19/43 |
| Mô hình riêng lần 1 | 29/43 | 25/43 | 22/43 |
| Mô hình riêng lần 2 | 34/43 | 32/43 | 28/43 |
| PaddleOCR + mô hình riêng lần 2 | 38/43 | 34/43 | 28/43 |

Kết quả trên toàn bộ chuỗi xử lý (bao gồm cả khâu phát hiện), số biển đọc đúng trên 42:

| Cấu hình | ×1 | ×0,5 | ×0,35 | ×0,25 | Thời gian mỗi ảnh (CPU) |
|---|---|---|---|---|---|
| Chỉ PaddleOCR | 35 | 37 | 30 | 21 | 282 ms |
| Chỉ mô hình riêng | 36 | 35 | 33 | 26 | 156 ms |
| PaddleOCR + mô hình riêng | 37 | 36 | 34 | 27 | 349 ms |

Cấu hình kết hợp được chọn làm mặc định vì chính xác nhất ở hầu hết các mức; ở mức chữ cao khoảng 17 điểm ảnh, số biển đọc đúng tăng từ 21 lên 27 (khoảng 29%). Nếu cần tốc độ, có thể chỉ dùng mô hình riêng: nhanh gần gấp đôi mà vẫn tốt hơn PaddleOCR với biển nhỏ. Ảnh thực tế ở mục 5.1 vẫn được đọc đúng với cấu hình mới.

### 5.7 Ảnh lớn có nhiều xe: phát hiện theo ô và gộp nhiều lần nhìn thấy

Bộ thử biển nhỏ ở mục 5.3 được tạo từ ảnh gốc 640×640 nên chưa phản ánh một tình huống thường gặp: ảnh chụp đường phố có độ phân giải lớn với nhiều xe ở xa. Với một ảnh đường phố 1566×853 điểm ảnh, hệ thống ban đầu chỉ trả về 2 biển trong khi mắt người đọc được ít nhất 5 biển. Nguyên nhân lần này nằm ở khâu phát hiện: ảnh bị thu nhỏ khoảng 2,4 lần khi đưa về 640 điểm ảnh, nên nhiều biển chỉ còn rộng 15–25 điểm ảnh trong đầu vào của mô hình.

Giải pháp gồm ba phần. Thứ nhất, với ảnh có cạnh dài lớn hơn 960 điểm ảnh, ngoài lần phát hiện trên toàn ảnh, hệ thống còn chia ảnh thành bốn ô chồng lấn nhau (mỗi ô khoảng 62% kích thước ảnh) và phát hiện trên từng ô; mỗi ô được phóng về 640 điểm ảnh nên biển nhỏ trông to gấp khoảng hai lần với mô hình. Thứ hai, các khung trùng nhau giữa toàn ảnh và các ô được gom thành một nhóm đại diện cho cùng một biển; thay vì chỉ giữ một khung, hệ thống đọc biển trên hai khung có độ tin cậy cao nhất của nhóm và gộp tất cả kết quả vào một lần bỏ phiếu. Cách này quan trọng vì khung từ ô phóng to đôi khi có độ tin cậy cao hơn nhưng cắt biển kém hơn; khi chỉ giữ một khung, ảnh thực tế ở mục 5.1 từng bị đọc sai. Để tiết kiệm thời gian, nếu khung thứ nhất đã cho ít nhất 75% kết quả trùng khớp thì bỏ qua khung thứ hai. Thứ ba, ngưỡng độ tin cậy được hạ xuống 0,25 cho những khung đọc ra chuỗi hợp lệ, và khi chuỗi đọc được không hợp lệ, hệ thống thử đọc lại với loại biển ngược lại (một dòng hay hai dòng), vì mô hình phát hiện đôi khi nhầm loại với biển nhỏ.

Kết quả: ảnh đường phố trên được nhận đủ 5 biển và đọc đúng cả 5 (trong đó có một biển hai dòng của xe bán tải và một biển chỉ đạt độ tin cậy phát hiện 0,26), ảnh thực tế ở mục 5.1 vẫn đọc đúng, và bộ thử biển nhỏ không bị giảm (37/36/34/27). Đổi lại, thời gian xử lý ảnh lớn tăng lên khoảng 1–2,3 giây trên CPU, tùy số biển trong ảnh.

### 5.8 Mô hình bốn góc (YOLO12-pose) và nắn phối cảnh

Biển chụp xéo là nhóm lỗi lớn còn lại, vì khung chữ nhật của biển bị méo thành hình thang chứa nhiều nền và chữ bị nghiêng. Theo phương án nâng cấp trong kế hoạch, mô hình phát hiện là YOLO12s-pose (mục 3): ngoài khung bao còn dự đoán bốn góc của biển, tận dụng nhãn đa giác bốn góc sẵn có của bộ dữ liệu.

**Chuẩn bị dữ liệu.** Nhãn đa giác được chuyển sang định dạng pose của YOLO: khung bao kèm bốn điểm góc theo thứ tự trên trái, trên phải, dưới phải, dưới trái. Với 51 đa giác có 6–7 điểm, bốn góc được chọn bằng quy tắc điểm cực trị (góc trên trái có tổng x + y nhỏ nhất, góc dưới phải có tổng lớn nhất, góc trên phải có hiệu x − y lớn nhất, góc dưới trái có hiệu nhỏ nhất). Khi lật ảnh ngang để tăng cường dữ liệu, các góc trái và phải được hoán đổi tương ứng.

**Huấn luyện.** Cấu hình, quá trình huấn luyện và kết quả trên tập test được trình bày ở mục 3. Trên tập test, mô hình xác định bốn góc biển gần như chính xác tuyệt đối (mAP50-95 bốn góc 0,989).

**Nắn phối cảnh.** Từ bốn góc, hệ thống tính ma trận biến đổi phối cảnh (homography, giải hệ tám phương trình tuyến tính) ánh xạ hình chữ nhật đích về tứ giác của biển trên ảnh gốc, rồi lấy mẫu lại từng điểm ảnh bằng nội suy song tuyến. Kích thước ảnh đích lấy theo cặp cạnh đối dài hơn của tứ giác, kèm một lề nhỏ quanh biển. Kết quả là một ảnh biển thẳng, đúng tỷ lệ, được đưa vào bước tách dòng và OCR như trước.

**Kết quả trên bộ thử biển nhỏ** (toàn bộ chuỗi xử lý, số biển đọc đúng trên 42):

| Cấu hình (YOLO12s-pose) | ×1 | ×0,5 | ×0,35 | ×0,25 | Thời gian (×0,25) |
|---|---|---|---|---|---|
| Không nắn | 38 | 38 | 33 | 31 | 368 ms |
| Chỉ đọc ảnh đã nắn | 39 | 38 | 35 | 29 | 377 ms |
| Đọc cả ảnh nắn và khung thường | 39 | 38 | 35 | 33 | 574 ms |

Cấu hình đọc cả ảnh đã nắn lẫn khung thường (các kết quả cùng bỏ phiếu) được chọn làm mặc định vì cho kết quả tốt nhất ở mọi mức thu nhỏ: ở mức chữ cao khoảng 17 điểm ảnh, số biển đọc đúng là 33/42, so với 21/42 ở cấu hình ban đầu chỉ dùng PaddleOCR. Đổi lại, thời gian xử lý tăng khoảng 200 ms mỗi ảnh vì mỗi biển được đọc hai lần. Ảnh thực tế ở mục 5.1 vẫn được đọc đúng (37A-715.32) với độ tin cậy phát hiện 0,88. Hạn chế: trên ảnh đường phố ở mục 5.7, hệ thống đọc đúng 4/5 biển (30E-220.70, 30F-748.46, 14C-147.59, 29V-7427) nhưng không phát hiện được biển yếu nhất (51H-709.67); thời gian xử lý ảnh này khoảng 2,7 giây trên CPU.

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

Người dùng tự đổi mật khẩu được ở trang Tài khoản (phải nhập đúng mật khẩu hiện tại). Ảnh tải lên không được phục vụ công khai: mỗi đường dẫn ảnh mà API trả về kèm thời hạn và chữ ký HMAC tạo từ khóa bí mật của máy chủ, vì thẻ ảnh của trình duyệt không gửi kèm được token đăng nhập; đường dẫn bị sửa hoặc hết hạn bị từ chối với mã 403.

Máy chủ API chạy ở cổng 3001 thay vì 3000 như kế hoạch, vì cổng 3000 trên máy phát triển đã bị một ứng dụng khác sử dụng; cổng có thể đổi trong tệp cấu hình.

### 6.3 Kiểm thử API

Một kịch bản kiểm thử tự động gọi toàn bộ API với ảnh thật và kiểm tra 33 tình huống: đăng nhập đúng và sai, làm mới token, nhận dạng biển một dòng và hai dòng, từ chối tệp không phải ảnh, lịch sử có phân trang và lọc theo ngày, tìm kiếm gần đúng, thêm biển vào danh sách đen và nhận cảnh báo khi nhận dạng lại, thống kê, tạo người dùng, kiểm tra phân quyền (staff không xem được danh sách người dùng, không xóa được dữ liệu), không cho admin tự khóa tài khoản của mình, tài khoản bị khóa không đăng nhập được, và xóa một lần nhận dạng kèm tệp ảnh. Lần chạy đầu phát hiện một lỗi (ảnh đã xóa trả về mã 500 thay vì 404); sau khi sửa, cả 33 tình huống đều đạt.

Sau đó các phép kiểm thử được đưa vào dự án dưới dạng kiểm thử tự động. Phía backend dùng Vitest và Supertest: kiểm thử đơn vị cho hậu xử lý biển số (sửa ký tự dễ nhầm, kiểm tra định dạng, biển hai dòng), cho bước tách dòng và gom khung; kiểm thử nhận dạng thật trên hai ảnh mẫu (biển một dòng và hai dòng); và kiểm thử API với tài khoản thử nghiệm tự tạo rồi tự dọn (xác thực, phân quyền, kiểm tra dữ liệu đầu vào, danh sách đen, nhận dạng, đường dẫn ảnh có chữ ký, tìm kiếm gần đúng, thống kê, đổi mật khẩu). Phía frontend dùng Vitest cho các hàm chuẩn hóa và định dạng biển số. Khi thêm nhận dạng từ video (mục 8), bộ kiểm thử có thêm phần theo dõi biển qua các khung hình (backend) và phần nội suy vị trí khung khi phát video (frontend). Phần camera trực tiếp (mục 9) có thêm kiểm thử phiên camera với bộ phát hiện và OCR giả (lưu một lần mỗi xe, xác nhận bằng hai lần đọc trùng nhau, không lưu lại biển vừa lưu, không lưu vật không đọc ra biển hợp lệ) và phần dự đoán vị trí khung. Bỏ phiếu theo từng ký tự cũng có kiểm thử riêng. Toàn bộ 58 phép kiểm thử (44 backend, 14 frontend) đều đạt. Bộ kiểm thử đã phát hiện một lỗi thật: chữ "Đ" không được chuẩn hóa thành "D" vì Unicode không tách được dấu của chữ này.

### 6.4 Đóng gói bằng Docker Compose

Toàn hệ thống được đóng gói thành ba dịch vụ: cơ sở dữ liệu PostgreSQL 16, API (image `node:22-slim` vì `onnxruntime-node` và `sharp` cần thư viện glibc) và web (ứng dụng React được build rồi phục vụ bằng nginx; nginx đồng thời chuyển tiếp các yêu cầu `/api` và `/uploads` sang API). Khi khởi động, container API tự áp dụng migration và tạo tài khoản quản trị đầu tiên từ biến môi trường. Mật khẩu và khóa bí mật đặt trong tệp `.env` không đưa lên Git. Image web nặng khoảng 94 MB, image API khoảng 2,6 GB (chủ yếu là thư viện ONNX Runtime và các mô hình). Toàn bộ luồng chính đã được kiểm thử tự động bằng trình duyệt trên hệ thống chạy trong Docker.

### 6.5 Tập kiểm thử toàn hệ thống

Để có số liệu chính thức thay cho mẫu 42 biển, nhóm xây dựng tập kiểm thử theo mục 4.6 của kế hoạch: 200 ảnh của tập test, chọn đều theo năm nguồn (greenpack 77, carlong 43, Tgmt 39, Dieu 22, Hung 19), tổng cộng 226 biển. Đáp án ban đầu được điền sẵn bằng OCR, sau đó người kiểm tra duyệt và sửa từng biển trên một trang HTML riêng; biển không đọc được bằng mắt được loại khỏi phép đo. Kịch bản đánh giá chạy toàn bộ hệ thống trên 200 ảnh và tính tỷ lệ phát hiện, tỷ lệ đọc đúng toàn bộ chuỗi và tỷ lệ đúng theo ký tự, theo từng nguồn và từng loại biển.

---

## 7. Giao diện web

Giao diện được xây dựng bằng React 19, Vite, TypeScript và TailwindCSS, gồm sáu trang theo kế hoạch: đăng nhập, nhận dạng, lịch sử, danh sách xe, thống kê và người dùng (chỉ admin), cùng hai trang được thêm sau: nhận dạng từ video (mục 8) và camera trực tiếp (mục 9). Thư viện TanStack Query quản lý việc gọi API và bộ nhớ đệm; Recharts vẽ biểu đồ thống kê. Giao diện hỗ trợ chế độ sáng, tối và màn hình điện thoại.

Trang nhận dạng cho phép tải một ảnh hoặc kéo thả cả một thư mục ảnh. Khi tải thư mục, các tệp JPG/PNG hợp lệ được sắp theo tên và nhận dạng lần lượt, có thanh tiến độ; người dùng chuyển ảnh bằng nút trái/phải, phím mũi tên hoặc dải ảnh thu nhỏ có đánh dấu trạng thái từng ảnh. Kết quả hiển thị khung biển trên ảnh (màu khác nhau cho biển một dòng, hai dòng và biển thuộc danh sách đen), ảnh cắt biển, chuỗi biển số trình bày giống biển thật, loại xe, độ tin cậy phát hiện và đọc ký tự, cùng nhãn "Hợp lệ" hoặc "Cần kiểm tra". Biển thuộc danh sách đen có cảnh báo nổi bật kèm biểu tượng, không chỉ dựa vào màu sắc.

Trong giai đoạn chưa có backend, giao diện chạy với một bộ dữ liệu mô phỏng có cùng định dạng với API; khi backend sẵn sàng chỉ cần tắt chế độ mô phỏng. Toàn bộ luồng chính (đăng nhập, nhận dạng cả thư mục ảnh thật, lịch sử, thống kê) đã được kiểm thử tự động bằng trình duyệt Edge với backend thật.

---

## 8. Nhận dạng từ video

Ngoài ảnh, hệ thống nhận dạng biển số trong video tải lên (MP4, WebM, MOV, MKV, AVI; tối đa 200 MB và 5 phút). Yêu cầu đặt ra là: video phát đúng tốc độ, khung biển số chạy liên tục theo từng xe trong suốt thời gian xe xuất hiện, và mỗi xe chỉ được lưu một lần với khung hình rõ nhất, không bị tách thành nhiều ảnh.

**Tách ba việc chạy ở ba tốc độ.** Đọc ký tự là bước chậm (khoảng 0,5–1 giây mỗi biển trên CPU) nên không thể chạy cho mọi khung hình; ngược lại, riêng bước phát hiện chỉ mất khoảng 120 ms mỗi khung. Vì vậy:

- Trình duyệt tự phát tệp video gốc ở tốc độ bình thường, nên việc nhận dạng không bao giờ làm video chậm lại.
- Backend dùng ffmpeg (gói `ffmpeg-static`, chạy được cả trên Windows lẫn trong Docker) lấy khoảng 8 khung hình mỗi giây (khung đầu tiên trong mỗi khoảng 1/8 giây), thu nhỏ về cạnh dài tối đa 1280 điểm ảnh, rồi chạy mô hình phát hiện trên từng khung. Thời điểm của mỗi khung được lấy từ chính dấu thời gian trong video (bộ lọc `showinfo`), không suy ra từ số thứ tự khung, để khung biển vẽ ra khớp với hình đang phát. Video quay bằng điện thoại có cờ xoay được ffmpeg và trình duyệt xoay giống nhau.
- Các khung biển ở những khung hình liên tiếp được nối thành **một đường đi cho mỗi xe** (tracking): khung mới thuộc về xe có vị trí dự đoán (khung trước dịch theo vận tốc của hai lần thấy gần nhất) chồng lên nó nhiều nhất, hoặc nằm đủ gần nếu xe chạy nhanh; xe không được thấy quá 1 giây thì coi là đã ra khỏi khung hình.
- Khi một xe ra khỏi khung hình, bước đọc ký tự chỉ chạy trên 5 khung hình tốt nhất của xe đó (biển to và độ tin cậy cao nhất), rồi bỏ phiếu chọn chuỗi biển số xuất hiện nhiều nhất. Nếu không chuỗi nào được đọc ra từ hai lần trở lên nhưng có từ ba lần đọc cùng độ dài, các lần đọc bỏ phiếu theo từng ký tự (ví dụ `29C200980`, `29C200560`, `29D200560` cho `29C200560`), với điều kiện ở mọi vị trí có một ký tự thắng rõ ràng và được ít nhất hai lần đọc ủng hộ. Xe có từ ba lần đọc hợp lệ mà vẫn không thống nhất được thì không lưu, vì biển quá nhỏ hoặc mờ để tin được.

**Lưu kết quả.** Mỗi xe được lưu thành một lần nhận dạng (nguồn "video") kèm khung hình rõ nhất và ảnh cắt biển, nên trang Lịch sử và Thống kê dùng lại được mà không phải đổi lược đồ cơ sở dữ liệu. Nếu cùng một biển bị mất dấu rồi xuất hiện lại trong vòng 3 giây, hai đoạn được gộp thành một xe. Tệp video gốc chỉ được giữ trong lúc xử lý rồi xóa. Ba luật lọc nhiễu: đường đi ngắn hơn 3 khung hình bị bỏ; xe chưa từng có khung đạt độ tin cậy 0,4 (cùng ngưỡng với ảnh) bị bỏ trừ khi được thấy liên tục ít nhất 2 giây; và khác với ảnh tĩnh, xe mà không lần đọc nào ra biển số đúng định dạng Việt Nam cũng bị bỏ, vì với nhiều khung hình để đọc, trường hợp này gần như luôn là vật khác giống biển số (vạch kẻ đường, chữ dán trên kính).

**Hiển thị.** Video được xử lý dưới nền; trang web hỏi tiến độ mỗi 1,5 giây và nhận dần các xe đã xử lý xong, nên người dùng xem được video ngay trong lúc chờ. Một lớp canvas nằm trên video vẽ lại khung biển ở mỗi lần màn hình làm tươi, theo thời điểm đang phát: giữa hai mẫu của backend (cách nhau 1/8 giây), vị trí khung được nội suy tuyến tính nên khung trượt mượt theo xe thay vì nhảy từng nấc. Nhờ có sẵn toàn bộ đường đi, tua, tạm dừng hay phát lại đều khớp. Bấm vào một xe trong danh sách sẽ tua video tới lúc xe đó xuất hiện.

**Thử nghiệm.** Video thử được tạo từ ảnh đường phố ở mục 5.7 bằng cách cho khung hình 1280×696 lia dần qua ảnh trong 10 giây, nên các biển di chuyển trong khung hình và một biển chỉ đi vào khung từ giây thứ 5. Ở lần chạy đầu (3 khung hình đọc ký tự mỗi xe, chưa có luật độ tin cậy), hệ thống tìm được 6 xe: 3 biển đúng, 1 biển sai một ký tự (14G-147.59 thay vì 14C-147.59) và 2 "xe" có độ tin cậy phát hiện chỉ 0,30–0,34 đọc ra chuỗi sai. Sau khi tăng lên 5 khung hình mỗi xe và thêm luật độ tin cậy, kết quả là 4 xe, đọc đúng cả 4 biển (30E-220.70, 14C-147.59, 29V-7427, 30F-748.46), xử lý hết khoảng 18–25 giây trên CPU cho 10 giây video. Kiểm thử bằng trình duyệt xác nhận video phát đúng tốc độ gốc, khung biển bám theo xe và bấm vào xe thì tua đúng thời điểm, cả khi chạy phát triển lẫn khi chạy trong Docker.

**Thử trên video quay thực tế.** Video thứ hai là một đoạn quay bằng điện thoại từ trên cao, dài 19 giây, 888×576 điểm ảnh sau khi xoay (tệp gốc lưu dọc, có cờ xoay 90°), 29,95 khung hình/giây: một ô tô biển hai dòng 56P-5644 đi vào rồi dừng, sau đó bốn xe máy lần lượt đi qua. Lần chạy đầu phát hiện hai lỗi mà video dựng từ ảnh tĩnh không bộc lộ:

- Một vạch kẻ đường màu trắng bị nhận là biển số (độ tin cậy phát hiện 0,66, thấy liên tục 6 giây, đọc ra chuỗi không hợp lệ "1 71156"). Luật bỏ xe không đọc ra biển hợp lệ ở trên được thêm vào để loại trường hợp này.
- Khung biển của xe máy chạy nhanh đi trước biển thật khoảng 15–23 điểm ảnh (khoảng 0,05 giây). Đo bằng cách chạy lại mô hình phát hiện trên đúng khung hình tại từng thời điểm cho thấy nguyên nhân: bộ lọc `fps` của ffmpeg gán lại dấu thời gian cho khung được chọn, nên "khung thứ i ở giây i/8" không còn đúng. Sau khi chuyển sang chọn khung bằng bộ lọc `select` và đọc dấu thời gian thật, độ lệch tại các thời điểm lấy mẫu còn 0–3 điểm ảnh, giữa hai mẫu tối đa khoảng 9 điểm ảnh (xe tăng tốc nên nội suy tuyến tính không khớp hoàn toàn).

Kết quả sau khi sửa: 5 xe, xử lý trong khoảng 30 giây cho 19 giây video. Ô tô 56P-5644 được theo dõi liên tục từ giây 0,8 đến hết video và đọc đúng; hai xe máy 59-G3 073.26 và 29-C2 005.60 đọc đúng (so với biển nhìn bằng mắt khi phóng to). Biển của xe máy chở thùng hàng chỉ cao khoảng 30 điểm ảnh và bị mờ: năm lần đọc cho các chuỗi khác nhau (ví dụ 59Z-007.74, trong khi bằng mắt đọc được khoảng 59-S7 007.74), nên sau khi thêm luật không lưu biển đọc không thống nhất, xe này không còn được lưu; kết quả cuối là 4 xe. Biển của xe máy cuối cùng (59-P2 551.67) quá mờ để kiểm chứng bằng mắt.

---

## 9. Camera trực tiếp

Trang Camera nhận dạng biển số từ webcam theo thời gian thực (chương 10 của kế hoạch), dùng lại bộ theo dõi xe của mục 8. Yêu cầu giống video: hình camera không bị chậm, khung biển chạy liên tục theo xe, mỗi xe chỉ lưu một lần với khung hình rõ nhất.

**Luồng xử lý.** Trình duyệt mở webcam bằng `getUserMedia` và tự hiển thị hình, nên hình không phụ thuộc tốc độ nhận dạng. Song song, trang chụp khung hình hiện tại (cạnh dài tối đa 1280 điểm ảnh, JPEG), gửi lên `POST /api/camera/:id/frames` kèm thời điểm chụp, và chỉ gửi khung tiếp theo khi đã nhận trả lời; nhờ vậy độ trễ không bao giờ dồn lại, máy chậm thì chỉ gửi thưa hơn. Các yêu cầu gửi khung (đã đăng nhập) không bị tính vào giới hạn 1000 yêu cầu mỗi 15 phút của API, vì camera gửi khoảng 400 khung mỗi phút. Với mỗi khung, backend chỉ chạy phát hiện và theo dõi (khoảng 100–200 ms) rồi trả về các khung biển hiện có, kèm biển số đã đọc được của từng xe. Việc đọc ký tự chạy nền, mỗi lần một xe, ưu tiên xe được đọc ít nhất, ở chế độ đọc nhanh (một biến thể cắt ảnh thay vì bốn, khoảng 100 ms thay vì 400 ms, đo trên các biển của video thử cho cùng kết quả), vì mỗi xe sẽ còn được đọc lại trên các khung sau.

**Lưu và cảnh báo.** Một xe được lưu (nguồn "webcam") ngay khi hai lần đọc cho cùng một biển hợp lệ, không cần chờ xe đi khỏi; xe rời khung hình với một hoặc hai lần đọc hợp lệ thì lưu lần đọc tốt nhất; xe có từ ba lần đọc hợp lệ trở lên mà không thống nhất được, kể cả khi bỏ phiếu theo từng ký tự như ở mục 8, thì không lưu, vì biển quá nhỏ hoặc mờ để tin được. Cùng một biển xuất hiện lại trong vòng 10 giây (xe dừng ở cổng, bị che rồi hiện lại) không được lưu thêm. Vật đã đọc hai lần mà không ra biển hợp lệ (vạch kẻ đường) bị loại và không vẽ nữa. Khi một biển trong danh sách đen được lưu, trang hiện cảnh báo nổi bật ngay.

**Hiển thị.** Trả lời đến 5–7 lần mỗi giây và trễ khoảng 0,1–0,3 giây so với hình, nên ở mỗi lần màn hình làm tươi, khung biển được dời tiếp theo vận tốc của hai lần trả lời gần nhất (tối đa 0,4 giây) để bám theo xe thay vì nhảy từng nấc và chạy sau xe. Biển chưa đọc được hiện nhãn "Đang đọc…", biển đã lưu có dấu ✓. Trang có ô chọn camera khi máy có nhiều camera (ví dụ webcam của laptop và điện thoại dùng làm webcam).

**Thử nghiệm.** Không có webcam thật trên máy phát triển, nên thử nghiệm dùng camera giả của trình duyệt Edge, phát lại video thực tế 19 giây ở mục 8 như một webcam, và một kịch bản gửi từng khung của video lên API đúng nhịp thời gian thực. Các lần thử đầu cho thấy ba vấn đề, đã sửa:

- Xe máy chạy nhanh bị tách thành nhiều "xe": ở 5 khung/giây, biển xe máy dịch khoảng 70 điểm ảnh giữa hai khung, xa hơn ngưỡng ghép 1,5 lần cỡ biển, trong khi xe mới thấy một lần chưa có vận tốc để dự đoán. Ngưỡng cho xe mới thấy một lần được nới lên 3 lần cỡ biển.
- Đọc ký tự đến chậm (ô tô hiện biển sau 3,4 giây, xác nhận sau 7 giây) vì mỗi lần đọc chạy đủ bốn biến thể và hàng đợi bị chiếm bởi các vạch kẻ đường. Sau khi dùng chế độ đọc nhanh, ưu tiên xe chưa đọc và bỏ các vật không phải biển, ô tô hiện biển sau 0,4 giây và được lưu sau 1 giây; hai xe máy hiện biển khoảng 0,4–0,8 giây sau khi vào khung.
- Khung cũ còn sót lại cạnh khung mới khi một xe được gán mã theo dõi mới: phía trình duyệt nay bỏ ngay biển vắng mặt trong hai lần trả lời liên tiếp.

Hai vấn đề nữa lộ ra khi chạy trong Docker (máy chủ chậm hơn, khoảng 4,5 khung/giây): một xe máy bị lưu hai lần với hai cách đọc sai khác nhau (59-D0 073.26 và 59-G3 079.76), và có xe đọc ba lần ra ba chuỗi gần giống nhau (29C200980, 29C200560, 29D200560) nên bị coi là không đọc được. Bỏ phiếu theo từng ký tự (mục 8) giải quyết cả hai: chuỗi được xác nhận sớm và đúng, nên không còn lần lưu thứ hai.

Kết quả cuối, chạy lại video 19 giây đúng nhịp thời gian thực ở cả 4 và 5 khung/giây: ô tô 56P-5644 được lưu sau khoảng 1–1,2 giây kể từ khi xuất hiện; hai xe máy 59-G3 073.26 và 29-C2 005.60 được lưu đúng, mỗi xe một lần; xe máy cuối được lưu là 59-P2 551.67; biển xe máy chở thùng hàng không được lưu vì các lần đọc không thống nhất; vạch kẻ đường không được lưu và không còn hiện khung. Với camera giả trong trình duyệt: 4,5–6,5 khung/giây, máy chủ xử lý 120–210 ms mỗi khung. Hạn chế: chưa thử với webcam thật; tốc độ phụ thuộc CPU của máy chủ; trình duyệt chỉ cho dùng camera trên trang mở bằng `localhost` hoặc HTTPS.

---

## 10. Những điểm khác với kế hoạch ban đầu

| Kế hoạch | Thực tế | Lý do |
|---|---|---|
| PyTorch CUDA 12.8 | PyTorch CUDA 11.8 | Driver GPU 517.48 không hỗ trợ CUDA 12.8 |
| Batch 16 khi huấn luyện | Batch 4 | GPU 6 GB; bước đánh giá dùng batch gấp đôi và khối attention của YOLO12 tốn bộ nhớ |
| YOLO nhận dạng ký tự | PaddleOCR (ONNX) kết hợp mô hình CRNN tự huấn luyện | Không có dữ liệu gán nhãn ký tự (dùng gán nhãn tự động); PaddleOCR yếu với biển nhỏ |
| Letterbox khi nhận dạng | Ban đầu kéo giãn, sau chuyển sang letterbox | Ảnh huấn luyện bị kéo giãn; ảnh thực tế chữ nhật cho thấy letterbox tốt hơn |
| Một lần đọc mỗi biển | Bỏ phiếu trên bốn biến thể | Kết quả OCR với biển nhỏ không ổn định |
| shadcn/ui | Bộ thành phần giao diện tự viết cùng phong cách | Công cụ cài đặt của shadcn/ui cần thao tác tương tác |
| bcrypt | bcryptjs | Tránh biên dịch mô-đun gốc trên Windows |
| Cổng API 3000, web cổng 80 | API cổng 3001, web cổng 8080 | Hai cổng này đã bị ứng dụng khác trên máy dùng |
| YOLO12-pose là nâng cấp tùy chọn | Đã huấn luyện và dùng làm mô hình phát hiện mặc định | Cải thiện đọc biển nhỏ và biển chụp xéo nhờ nắn phối cảnh |
| Prisma (bản cũ) | Prisma 7 | Bản mới nhất khi thực hiện; cấu hình kết nối thay đổi |

---

## 11. Hạn chế và hướng phát triển

- Mẫu đánh giá OCR (42 biển) có đáp án do người thực hiện tự đọc, có 4 biển chưa chắc chắn; cần xây dựng tập kiểm thử khoảng 200 ảnh có đáp án được kiểm tra lại để có con số chính thức.
- Mô hình bốn góc đôi khi bỏ sót biển rất yếu ở xa (ví dụ biển 51H-709.67 trên ảnh đường phố ở mục 5.7); có thể huấn luyện thêm một mô hình phát hiện YOLO12 thường rồi kết hợp kết quả của hai mô hình.
- Nhận dạng từ video đọc sai biển xe máy nhỏ và mờ (cao khoảng 30 điểm ảnh); mới thử trên hai video. Trên CPU, thời gian xử lý khoảng 1,5–2 lần độ dài video.
- Mô hình phát hiện đôi khi nhận nhầm vật thể khác là biển số ở bối cảnh cổng barrier; các khung này hiện bị loại nhờ bước kiểm tra định dạng của OCR.
- Camera trực tiếp mới được thử bằng camera giả của trình duyệt (phát lại video); cần thử với webcam hoặc điện thoại thật.
- Số liệu chính thức của toàn hệ thống phụ thuộc vào việc duyệt xong đáp án của tập kiểm thử 200 ảnh.
