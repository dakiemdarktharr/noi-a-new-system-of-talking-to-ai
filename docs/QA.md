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


## Hồi quy tĩnh/động ngày 06/11/2026

`tests/unit/motion.test.ts` đã qua 7 ca về chuỗi vòng, tiền tố, tư thế giữ, khoảng mất tracking và hủy kết quả bất đồng bộ. Các ca train/infer, serialization và hình học hiện có cũng đã qua.

`node qa/motion-recognition.mjs` chạy TFJS WebGL trong Edge trên máy phát triển. Ba lớp tổng hợp gồm giữ tĩnh, vòng thuận và vòng ngược. Cả 9 trường hợp của ba mức thời lượng 0,7×/1×/1,3× được chấp nhận đúng lớp. Nửa vòng bị từ chối. Replay tiền tố 280 ms rồi đi vòng chỉ phát một từ, 200 ms sau frame cuối của chuyển động. Đây là hình học tổng hợp và timestamp mô phỏng.

Sau warm-up, 30 lượt classifier có p50 6,8 ms và p95 8,8 ms. Phép đo bao gồm chuẩn bị đặc trưng, CNN và kiểm tra chuyển động, chưa gồm tracker/camera, thời gian giữ tay hoặc render. Model ba lớp có 56.971 tham số, ZIP 214.369 byte. Xuất/nhập giữ nguyên kết quả và hồ sơ chuyển động. Validation đạt 1,0 trên tập tổng hợp rất đơn giản, không đại diện độ chính xác của Nối trên người.

`npm run test:browser` qua kiểm thử worker trên ảnh bàn tay, train/lưu/tải lại model trong IndexedDB, camera canvas + MediaRecorder, dữ liệu ZIP và giao diện. Accessibility không có vi phạm trong bốn trạng thái đã kiểm tra. Cần đo trên video người dùng để xác nhận khả năng phân biệt “chúng ta / chúng tôi”.


## Sửa lỗi không nhận diện sau khi train lại — 06/11/2026

Tái hiện trước khi sửa bằng hai ca mới. Tư thế giữ có rung vị trí/rotation nhỏ tạo 0 ứng viên trong 4 giây. Vòng tay kết thúc với rung nhỏ không có ứng viên khớp. Ngoài ra, buffer sau 5 giây tự đánh dấu consumed dù chưa phát từ. Mất một frame cũng xóa toàn bộ đoạn đang thu.

Trong replay TFJS bổ sung, CNN đạt điểm làm tròn 100 cho vòng đúng nhưng verifier từ chối. Khoảng giữ ở đầu/cuối và jitter tạo khoảng cách DTW khoảng 0,110 với ngưỡng 0,09. Điểm softmax này chỉ là số đo trên fixture tổng hợp.

Bản sửa lấy trung bình khoảng 100 ms cho quyết định ranh giới, giữ dữ liệu CNN đo được, cho phép gap ngắn tối đa 120 ms nếu tư thế nối tiếp tương thích. Buffer trượt 5 giây không khóa một từ chưa nhận. Candidate đi vào classifier được chuẩn bị một lần. Verifier giảm jitter ở các điểm trong đường đi, giữ đầu/cuối đo được, lấy mẫu theo độ dài đường đi và chia chi phí DTW cho số bước căn chỉnh thực tế. Kiểm tra lượng chuyển động theo template thay thế ngưỡng biên độ động cố định, còn hướng/quỹ đạo và chênh lệch softmax vẫn được kiểm tra.

11 ca unit về motion đã qua, gồm jitter, dropout, giữ lâu, small dynamic, tiền tố, vòng ngược và bất đồng bộ. Browser regression đã nhận đúng một lần cả static có jitter/dropout và dynamic có jitter. Giữ tĩnh được nhận ở mốc 680 ms trong replay, vòng được nhận sau khi kết thúc 280 ms. Không chấp nhận nửa vòng. Chín trường hợp ba lớp/ba tốc độ vẫn qua.

Đã tạo model fixture bằng mã tại commit 927902d, xuất rồi nhập vào code đã sửa. Model cũ cũng qua các ca noisy stream này. Đây là kiểm chứng tương thích, chưa sử dụng model/video riêng trong trình duyệt người dùng. Không yêu cầu đổi định dạng model. Bảng Thông số theo dõi hiển thị lý do từ chối để phân biệt chờ giữ tay, độ tin cậy thấp, hai nhãn gần nhau, ngoài vùng dữ liệu và quỹ đạo chưa khớp.
