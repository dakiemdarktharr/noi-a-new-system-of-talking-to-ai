# Nối - a new system of talking to A.I

Web desktop để theo dõi hai bàn tay, thu video có nhãn và huấn luyện mô hình nhận diện ký hiệu cá nhân. Giao diện tiếng Việt, hai khu vực, xử lý tại máy.

[Mở Nối trên Vercel](https://noi-a-new-system-of-talking-to-ai.vercel.app).

## Mở ứng dụng

Trong thư mục này, chạy `npm run dev`, rồi mở **http://127.0.0.1:5173** bằng Chrome hoặc Edge. Có thể nhấp `mo-noi.cmd` để khởi động. Giữ cùng địa chỉ, trình duyệt và hồ sơ để dùng lại dữ liệu.

Với bản clone mới, dùng Node.js 24, chạy `npm ci`, `npm run assets`, rồi `npm run dev`. Lệnh chuẩn bị tải model MediaPipe, kiểm tra SHA-256 và chép WASM vào `public`. Camera và huấn luyện chạy trong trình duyệt.

Bản deploy trên Vercel đọc `vercel.json` từ repo. Vercel cài thư viện bằng `npm ci`, chuẩn bị model và xuất web tĩnh từ thư mục `dist`.

## Dùng thử

1. Mở **Thu mẫu**, bật camera và chọn nghĩa. Đưa bàn tay rõ vào khung hình. Quay một lần thực hiện cho mỗi clip; mặc định 3 giây, có 1 giây chuẩn bị. Chọn 2 hoặc 4 giây nếu cần.
2. Xem lại video. Bấm tên nhãn trong bảng để đổi nhãn sai. Xóa mẫu không dùng được.
3. Thu ít nhất **hai nhãn, mỗi nhãn ba mẫu** để mở nút train. Đây chỉ là ngưỡng thử phần mềm. Nên bắt đầu với 8–20 ký hiệu và 15–30 lần thực hiện độc lập mỗi nhãn, qua nhiều buổi. Thu thêm nhãn **Không ký hiệu** với tay đang xuất hiện nhưng không ký.
4. Bấm **Huấn luyện model**. Camera dừng trong lúc train; trọng số và nhãn được lưu trong IndexedDB.
5. Chuyển **Nhận diện**, bật camera. Từ xuất hiện khi kết quả vượt các ngưỡng chấp nhận. Từ được giữ 1,8 giây sau lần chấp nhận gần nhất. Bấm dấu cộng để đưa từ vào câu. Khi không chắc, màn hình hiện “—”.
6. **Xuất ZIP** để sao lưu video và landmark. Chọn lọc theo phiên hoặc nhãn nếu bộ dữ liệu lớn. Mỗi tệp nhập hỗ trợ tối đa 1.000 mẫu và 300 MiB giải nén. **Nhập** nhận ZIP hoặc JSON landmark. Train lại sau khi sửa bộ dữ liệu để cập nhật model.

Danh mục **775 mục nghĩa** là đề xuất mở rộng lõi, chưa phải 775 ký hiệu đã thiết kế hoặc đã được model học. Chưa có trọng số nhận diện Nối được huấn luyện sẵn. MediaPipe chỉ cung cấp điểm tay. App chưa dịch hội thoại liên tục hoặc tự đưa nội dung vào công cụ AI.

## Dữ liệu và quyền riêng tư

Video không có âm thanh. Video gốc, landmark và model nằm trong bộ nhớ trình duyệt của địa chỉ hiện tại; không có tài khoản, analytics hay upload. Lật hiển thị chỉ đổi preview, dữ liệu đầu vào vẫn không lật. Bộ nhớ này không phải bản sao lưu và không được app mã hóa riêng. Xóa dữ liệu trình duyệt sẽ làm mất mẫu/model. Dùng Xuất ZIP trước khi đổi máy hoặc hồ sơ.

## Tài liệu

- [Báo cáo tổng hợp và lộ trình](public/RESEARCH.md).
- [Danh mục 775 nghĩa](public/vocabulary/NOI-VOCABULARY.md), [CSV](public/vocabulary/noi-vocabulary.csv), [JSON](public/vocabulary/noi-vocabulary.json).
- [Tracking, orientation, model lớn và giới hạn](docs/TRACKING-RESEARCH.md).
- [Phân loại chuỗi, kiến trúc và kiểm định](docs/TEMPORAL-RESEARCH.md).
- [Dữ liệu tiếng Việt, nhãn, chia tập và phép đo](docs/DATASET-RESEARCH.md).
- [Model card của bản thử nghiệm](docs/MODEL-CARD.md).
- [Kết quả kiểm tra phần mềm](docs/QA.md).

## Lệnh phát triển

`npm run test` chạy kiểm thử hình học, dữ liệu và backpropagation thật trên dữ liệu tổng hợp. `npm run build` kiểm tra TypeScript và tạo `dist`. `npm run preview` mở bản build ở cổng 4173. Dữ liệu cổng 4173 khác cổng 5173.

`node qa/integration.mjs` kiểm thử worker, ảnh tay chính thức, ghi video, đổi nhãn, ZIP, model IndexedDB và từ trên màn hình trong hồ sơ Edge kiểm thử tách biệt. Bật dev server và lưu [ảnh kiểm thử từ MediaPipe](https://storage.googleapis.com/mediapipe-assets/right_hands.jpg) vào `qa/right_hands.jpg` trước khi chạy. Độ chính xác trên người ký cần một bộ kiểm thử riêng.
