# Kho video riêng tư của Nối

Nối dùng một Storage Bucket riêng tư trên Hugging Face. Tài khoản được kiểm tra khi kết nối là gói Free và chưa bật thanh toán. [Hạn mức Storage](https://huggingface.co/docs/hub/storage-limits) cấp 100 GB lưu trữ riêng tư, dùng chung cho tài khoản. [Storage Buckets](https://huggingface.co/docs/hub/storage-buckets) cho phép lưu các tệp mà không phải tạo lịch sử commit cho từng video.

Ngân sách thiết kế là 6.000 nhãn × 30 clip = 180.000 clip. Máy chủ giới hạn mỗi gói ZIP ở 480.000 byte, tương đương tối đa 86,4 GB cho bộ gốc. Phần dung lượng còn lại phụ thuộc vào dữ liệu riêng tư khác trong tài khoản. Mỗi thư mục nhãn chứa tối đa 30 mẫu theo luồng thu thông thường. Việc đọc và ghi chỉ truy cập thư mục của nhãn đang chọn. Nối thu video 650 kb/s theo bitrate mục tiêu và nén điểm tay trong gói ZIP. Nếu gói vượt giới hạn, có thể thu clip 2 giây để sao lưu. Mẫu cục bộ vẫn còn khi kho từ chối upload.

## Dùng kho

Trong **Thu mẫu**, chọn một nhãn và mở **Kho video**. Nhập mã kho, bấm **Kết nối**, rồi chọn **Sao lưu nhãn**. Nối gửi từng clip có video, điểm tay, mã mẫu, nhãn và mã phiên. Bấm **Tải về máy** trên thiết bị khác để nhập các mẫu còn thiếu của nhãn. Danh mục hiển thị các nhãn đã đủ 30 video trên máy hoặc trong kho sau lần kết nối gần nhất. Bảng kho hiện số video của nhãn đang chọn.

Kho chỉ nhận mẫu khi có yêu cầu sao lưu. Ai giữ mã kho có thể đọc, ghi và xóa video trong kho. Chỉ chia sẻ mã với người được phép quản lý mẫu. Xóa trên máy và xóa khỏi kho là hai thao tác riêng. Tệp ZIP giữ nhãn và video để kiểm tra hoặc xử lý lại về sau.

## Triển khai

Hàm `/api/archive` kiểm tra mã kho trước khi truy cập Hugging Face. Ba biến môi trường production là `NOI_HF_BUCKET`, `NOI_HF_ACCESS_TOKEN` và `NOI_CLOUD_KEY_SHA256`. Token chỉ dùng phía server. Mã kho có thể được thay bằng cách tạo mã mới và cập nhật SHA-256. API lưu `clips/<labelId>/<sampleId>.zip`. Giữ mã từ khi đổi tên hiển thị. Bộ sao lưu dùng ID mẫu để bỏ qua upload trùng. Mốc hoàn tất được lưu theo nhãn để đọc tiến độ toàn bộ kho mà không cần liệt kê từng video.

Bản này dùng mã truy cập chung cho người quản lý kho. Nếu mở thu mẫu cho nhiều cộng tác viên độc lập, cần thêm tài khoản và phân quyền từng người trước khi chia sẻ quyền ghi. Kiểm tra thực tế bằng mẫu ảnh công khai gồm upload, liệt kê, tải lại và xóa một gói; không có phép thử tải với 180.000 clip.
