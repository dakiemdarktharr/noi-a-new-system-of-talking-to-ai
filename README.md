# Nối - a new system of talking to A.I

Web desktop để theo dõi hai bàn tay, thu video có nhãn và huấn luyện mô hình nhận diện ký hiệu cá nhân. Camera và model nhận diện chạy tại máy. Kho riêng tư lưu các mẫu bạn chọn sao lưu.

[Mở Nối trên Vercel](https://noi-ai.vercel.app).

## Mở ứng dụng

Trong thư mục này, chạy `npm run dev`, rồi mở **http://127.0.0.1:5173** bằng Chrome hoặc Edge. Có thể nhấp `mo-noi.cmd` để khởi động. Giữ cùng địa chỉ, trình duyệt và hồ sơ để dùng lại dữ liệu.

Với bản clone mới, dùng Node.js 24, chạy `npm ci`, `npm run assets`, rồi `npm run dev`. Lệnh chuẩn bị tải model MediaPipe, kiểm tra SHA-256 và chép WASM vào `public`. Camera và huấn luyện chạy trong trình duyệt.

Bản deploy trên Vercel đọc `vercel.json` từ repo. Vercel cài thư viện bằng `npm ci`, chuẩn bị model và xuất web tĩnh từ thư mục `dist`.

## Dùng thử

1. Mở **Thu mẫu**, bật camera và chọn nghĩa. Đưa bàn tay rõ vào khung hình. Quay một lần thực hiện cho mỗi clip. Mặc định 3 giây, có 1 giây chuẩn bị. Chọn 2 hoặc 4 giây nếu cần.
2. Xem lại video. Bấm tên nhãn trong bảng để đổi nhãn sai. Xóa mẫu không dùng được.
3. Thu ít nhất **hai nhãn, mỗi nhãn ba mẫu** để mở nút train. Đây chỉ là ngưỡng thử phần mềm. Nên bắt đầu với 8–20 ký hiệu và 15–30 lần thực hiện độc lập mỗi nhãn, qua nhiều buổi. Thu thêm nhãn **Không ký hiệu** với tay đang xuất hiện nhưng không ký.
4. Bấm **Huấn luyện model**. Camera dừng trong lúc train; trọng số và nhãn được lưu trong IndexedDB.
5. Chuyển **Nhận diện**, bật camera. Từ xuất hiện khi kết quả vượt các ngưỡng chấp nhận. Từ được giữ 1,8 giây sau lần chấp nhận gần nhất. Bấm dấu cộng để đưa từ vào câu. Khi không chắc, màn hình hiện “—”.
6. **Xuất ZIP** để sao lưu video và landmark. Chọn lọc theo phiên hoặc nhãn nếu bộ dữ liệu lớn. Mỗi tệp nhập hỗ trợ tối đa 1.000 mẫu và 300 MiB giải nén. **Nhập** nhận ZIP hoặc JSON landmark. Train lại sau khi sửa bộ dữ liệu để cập nhật model.
7. **Thêm từ** tạo nhãn riêng trên máy. Danh mục đánh dấu ✓ khi một nhãn có 30 video trên máy hoặc đã đủ trong kho kết nối. Mẫu JSON thiếu video vẫn dùng được để train nếu hợp lệ, nhưng không tính vào chỉ tiêu video.
8. Mở **Kho video**, nhập mã kho và bấm **Kết nối**. Video hợp lệ mới quay được lưu trên máy rồi tự gửi lên kho. Phiên kết nối và hàng chờ được giữ khi tải lại trang. **Sao lưu nhãn** gửi các mẫu đã thu từ trước. **Tải về máy** nhập mẫu từ kho.
9. Sau khi train, dùng **Xuất model** để tải `noi-model.zip`. Mở Nối ở `http://127.0.0.1:5173` và bấm **Nhập model** để chạy webcam tại máy. Tệp ZIP chứa trọng số và thông tin nhận diện. Tệp hai nhãn trong kiểm thử nặng khoảng 191 KiB. Tài sản MediaPipe được cài riêng cùng app. Chọn cùng chế độ Lite hoặc Full như lúc thu mẫu.

Danh mục **6.000 mục nghĩa** dùng để chọn nhãn giao tiếp và prompt. Model cá nhân học các ký hiệu từ mẫu bạn thu. Xem [nguồn từ vựng](public/vocabulary/SOURCES.md) và [kiểm tra tính toàn vẹn](docs/vocabulary-audit.json).

## Dữ liệu và quyền riêng tư

Video không có âm thanh. Mẫu và model nằm trong bộ nhớ trình duyệt của địa chỉ hiện tại. Khi kết nối kho, Nối tự sao lưu video mới và điểm tay tới bucket Hugging Face riêng tư. Mã kho cấp quyền quản lý dữ liệu trong bucket. Token Hugging Face chỉ dùng ở máy chủ. Dùng Xuất ZIP hoặc xác nhận **Đã lên kho** trước khi xóa dữ liệu trình duyệt.

[Thiết kế kho video miễn phí](docs/CLOUD-ARCHIVE.md) · [Theo dõi tay nhanh](docs/FAST-TRACKING.md)

## Tài liệu

- [Báo cáo tổng hợp và lộ trình](public/RESEARCH.md).
- [Danh mục 6.000 nghĩa](public/vocabulary/NOI-VOCABULARY.md), [CSV](public/vocabulary/noi-vocabulary.csv), [JSON](public/vocabulary/noi-vocabulary.json).
- [Tracking, orientation, model lớn và giới hạn](docs/TRACKING-RESEARCH.md).
- [Phân loại chuỗi, kiến trúc và kiểm định](docs/TEMPORAL-RESEARCH.md).
- [Dữ liệu tiếng Việt, nhãn, chia tập và phép đo](docs/DATASET-RESEARCH.md).
- [Model card của bản thử nghiệm](docs/MODEL-CARD.md).
- [Kết quả kiểm tra phần mềm](docs/QA.md).

## Lệnh phát triển

`npm run test` chạy kiểm thử hình học, dữ liệu và backpropagation thật trên dữ liệu tổng hợp. `npm run build` kiểm tra TypeScript và tạo `dist`. `npm run preview` mở bản build ở cổng 4173. Dữ liệu cổng 4173 khác cổng 5173.

`node qa/integration.mjs` kiểm thử worker, ảnh tay chính thức, ghi video, đổi nhãn, ZIP, model IndexedDB và từ trên màn hình trong hồ sơ Edge kiểm thử tách biệt. Bật dev server và lưu [ảnh kiểm thử từ MediaPipe](https://storage.googleapis.com/mediapipe-assets/right_hands.jpg) vào `qa/right_hands.jpg` trước khi chạy. Độ chính xác trên người ký cần một bộ kiểm thử riêng.
