# Model card — Nối 0.1

Ngày: 2026-11-05. Trạng thái: thử nghiệm cá nhân, chưa đánh giá ngôn ngữ ký hiệu trên người thật.

## Hai mô hình khác nhau

**Hand Landmarker:** Google MediaPipe Tasks Vision 1.2.2; bundle full FP16 v1. Hai tay, 21 điểm mỗi tay, tọa độ ảnh và tọa độ 3D riêng từng tay. Model/WASM chạy trong Web Worker, GPU rồi fallback CPU khi khởi tạo GPU lỗi. Tài sản local và SHA256 trong `public/models/manifest.json`.

**Bộ phân loại Nối:** Temporal CNN tự huấn luyện tại máy, 32 bước ×172 đặc trưng. Ba Conv1D, pooling, dense, dropout, softmax. 52.330 tham số với hai nhãn; thêm 33 tham số cho mỗi nhãn tiếp theo. Không có trọng số ký hiệu Nối được phân phối sẵn.

## Đầu vào và biểu diễn

Hình ngón chuẩn hóa theo trục tay được giữ riêng với orientation 6D trong hệ camera. Có vị trí cổ tay trong ảnh, vận tốc, độ gập ngón, mask tay vắng và quan hệ hai tay trong ảnh. Quaternion dùng để kiểm tra góc, không gọi đó là phép đo góc khớp cổ tay y khoa. Không suy khoảng cách hai tay từ hai hệ world có gốc riêng. Không có thân, mặt, cảm biến độ sâu hoặc góc tuyệt đối so với trọng lực.

Các clip được lấy mẫu theo thời gian thành 32 bước. Cửa sổ live chọn theo trung vị thời lượng từng lớp, làm tròn 500 ms, từ 1 đến 4 giây. Lưu tối đa 4,2 giây; thử các độ dài đang có và chỉ nhận lớp khớp độ dài của nó. Mỗi lượt dự đoán cách nhau ít nhất 250 ms. Kết quả được chấp nhận hiện trong 1,8 giây kể từ lần chấp nhận gần nhất. Đây là phân loại clip trên cửa sổ trượt, chưa có phân đoạn chuỗi hội thoại.

## Huấn luyện và kiểm định

Tối thiểu hai lớp ×ba clip hợp lệ; tối đa mặc định 48 epoch, Adam, dừng sớm khi có validation. Ưu tiên giữ nguyên buổi quay ngoài train; một buổi đủ mẫu thì giữ nguyên clip ngoài train. Validation được dùng chọn trọng số, không phải final test. Schema hiện chưa có signerId, nên không thể báo cáo khả năng dùng cho người mới.

Chấp nhận cần softmax ≥0,68, chênh ứng viên đầu/hai ≥0,18, nằm gần vùng đặc trưng của lớp và không phải NO_SIGN. Ngưỡng là heuristic chưa hiệu chỉnh trên Nối. Softmax không phải độ chính xác thực nghiệm. Không có tay luôn bị từ chối. Mẫu nền cần có tay nhìn thấy; người dùng phải tự thu các cử động ngoài nhãn.

## Giới hạn

- Che ngón, hai tay chồng nhau, góc cạnh bàn tay, blur, camera nghiêng hoặc đổi người có thể gây lỗi. 3D là dự đoán từ RGB.
- Lớp chưa thu không thể được nhận diện đúng theo nghĩa chỉ nhờ nằm trong từ vựng.
- Một phần ngôn ngữ ký hiệu tự nhiên phụ thuộc thân/mặt/vị trí; bản này không quan sát đủ.
- Thời gian một frame tracking không phải thời gian để nhận ra từ. Cửa sổ cần đủ chuyển động trước khi phân loại.
- Không có kết quả tốc độ gõ tương đương, độ chính xác trên người dùng, hoặc lợi ích giảm mỏi đã được đo.
- Người dùng tự xác nhận từ bằng dấu cộng; app không tự gửi prompt hoặc chạy lệnh AI.

## Kiểm thử

Xem `QA.md`: kiểm tra hình học tổng hợp; TFJS train/infer thật; model save/load trong IndexedDB; worker trên ảnh bàn tay chính thức, xoay ảnh 90°; camera canvas từ ảnh để kiểm thử MediaRecorder và UI. Dữ liệu kiểm thử và nhãn A không được nạp vào hồ sơ người dùng hoặc bản build. Các số đo này không thay thế test trên ký hiệu và người thật.
