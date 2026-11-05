# Kiểm tra phần mềm Nối

Ngày 05/11/2026. Chạy trên Windows với Edge và Node 24.18.0. Các phép thử trình duyệt dùng hồ sơ tạm, dữ liệu ảnh kiểm thử và mô phỏng đầu vào camera.

| Kiểm tra | Kết quả |
|---|---|
| TypeScript và Vite | `npm run build` thành công. |
| 14 kiểm thử tự động | Đạt. Bao gồm phân biệt góc 90° và quaternion đổi dấu, hướng di chuyển, frame gián đoạn, dữ liệu nhập sai, tách phiên, TFJS train thật và giải phóng tensor. |
| Hai quỹ đạo tổng hợp | CNN phân biệt chuyển động lên và ngang với cùng hình và hướng bàn tay. |
| MediaPipe trong Web Worker | 21 điểm cho bàn tay phải trên ảnh test của Google. Xoay ảnh 90° cho chênh lệch orientation khoảng 87,8°. Tracker phát hiện lại sau khi đổi ảnh đột ngột. |
| Train, lưu và tải lại | Temporal CNN hai nhãn có 52.330 tham số. Lưu IndexedDB, tải lại trang, hiện nhãn kiểm thử A trên camera và thêm được vào câu. Lớp nền bị từ chối. |
| Thu mẫu | Camera canvas từ ảnh, MediaRecorder WebM, khoảng 3 giây và 76 frame. Phát lại, đổi nhãn, xuất ZIP và nhập lại được. |
| Bản build | Worker nhận tay từ ảnh. Quyền camera bị từ chối có thông báo. |
| Khả năng tiếp cận | Axe không báo lỗi trong bốn trạng thái đã quét. Escape đóng hộp thoại từ vựng và kiểm tra hướng. Bố cục 390 px không tràn ngang trong kiểm tra. |
| Kết nối | Không thấy yêu cầu mạng ngoài localhost trong bài kiểm tra tích hợp. |

Nguồn ảnh là [fixture của MediaPipe](https://storage.googleapis.com/mediapipe-assets/right_hands.jpg) dùng trong [bộ test chính thức](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/cc/vision/hand_landmarker/hand_landmarks_detector_graph_test.cc). Nhãn A và các mẫu trong hồ sơ tạm chỉ kiểm tra luồng kỹ thuật. Bản build bắt đầu với bộ dữ liệu trống.

Các kiểm tra chưa thực hiện gồm độ chính xác trên ký hiệu Nối do người thật thực hiện, độ trễ từ đầu động tác đến chữ, đánh giá người ký mới, tốc độ so với đánh máy và mức mỏi. Axe chỉ kiểm tra các lỗi phát hiện tự động trong những trạng thái đã mở.

Chạy lại với `npm run test`, `npm run test:browser` khi dev server đang mở và `npm run test:production` khi bản preview đang mở. Kết quả máy nằm trong `qa/integration-report.json`, `qa/accessibility-report.json` và `qa/production-report.json`.
