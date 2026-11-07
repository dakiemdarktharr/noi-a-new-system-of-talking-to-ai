# Kho video riêng tư của Nối

Nối dùng một Storage Bucket riêng tư trên Hugging Face. Tài khoản được kiểm tra khi kết nối là gói Free và chưa bật thanh toán. [Hạn mức Storage](https://huggingface.co/docs/hub/storage-limits) cấp 100 GB lưu trữ riêng tư, dùng chung cho tài khoản. [Storage Buckets](https://huggingface.co/docs/hub/storage-buckets) cho phép lưu các tệp mà không phải tạo lịch sử commit cho từng video.

Ngân sách thiết kế là 6.000 nhãn × 30 clip = 180.000 clip. Máy chủ giới hạn mỗi gói ZIP ở 480.000 byte, tương đương tối đa 86,4 GB cho bộ gốc. Phần dung lượng còn lại phụ thuộc vào dữ liệu riêng tư khác trong tài khoản. Mỗi thư mục nhãn chứa tối đa 30 mẫu theo luồng thu thông thường. Việc đọc và ghi chỉ truy cập thư mục của nhãn đang chọn. Nối thu video 650 kb/s theo bitrate mục tiêu và nén điểm tay trong gói ZIP. Nếu gói vượt giới hạn, có thể thu clip 2 giây để sao lưu. Mẫu cục bộ vẫn còn khi kho từ chối upload.

## Dùng kho

Trong **Thu mẫu**, mở **Kho video**, nhập mã kho và bấm **Kết nối**. Mỗi clip hợp lệ quay xong được ghi vào trình duyệt trước, sau đó tự gửi video, điểm tay, mã mẫu, nhãn và mã phiên lên kho. Cột **Kho** báo **Đã lên kho** khi máy chủ xác nhận. Nếu mạng lỗi, Nối tiếp tục gửi từ hàng chờ khi tải lại trang hoặc có mạng trở lại. Nút **Thử sao lưu lại** dùng cho mẫu cần xử lý lại. Dùng **Sao lưu nhãn** để gửi clip cũ đã thu trước khi có chức năng tự sao lưu.

Bấm **Tải về máy** trên thiết bị khác để nhập các mẫu còn thiếu của nhãn. Danh mục hiển thị các nhãn đã đủ 30 video trên máy hoặc trong kho sau lần kết nối gần nhất. Bảng kho hiện số video của nhãn đang chọn.

Kết nối kho giữ phiên qua tải lại trang bằng cookie HTTPS có chữ ký, thời hạn 30 ngày. Chọn **Ngắt kết nối** để dừng tự sao lưu trên trình duyệt này. Ai giữ mã kho có thể đọc, ghi và xóa video trong kho. Chỉ chia sẻ mã với người được phép quản lý mẫu. Xóa hoặc đổi nhãn trên máy và cập nhật kho là hai thao tác riêng. Tệp ZIP giữ nhãn và video để kiểm tra hoặc xử lý lại về sau.

## Triển khai

### Graph và danh mục từ

`GET /api/archive?action=workspace` trả các phiên bản graph hiện hành. `POST` nhận `{id, parents, data}` gồm graph và từ tự thêm; dùng cùng mã kho/cookie HttpOnly, kiểm tra origin, giới hạn 1,5 MB và xác minh toàn bộ mã từ/thành viên chuỗi/toạ độ. Không gửi token Hugging Face xuống trình duyệt.

Mỗi lần ghi dùng đường dẫn bất biến `workspace/revisions/<uuid>.json`. Server so sánh phiên bản cha trước khi ghi, đọc lại để xác nhận, rồi dọn các bản đã được thay thế. Nếu hai request độc lập cùng vượt qua bước so sánh, cả hai file vẫn được giữ và lần đọc sau hiển thị xung đột. Đây là đồng bộ nhất quán sau một khoảng trễ, không phải giao dịch khóa toàn bộ bucket. Không dùng thời gian trên máy người dùng để quyết định bản thắng. Các tab cùng trình duyệt dùng Web Locks để không gửi đồng thời; retry dùng lại ID để tránh tạo bản trùng. Dọn phiên bản thất bại không làm mất bản đã xác nhận.

Trạng thái cục bộ lưu dữ liệu và hàng chờ trong một khóa; các khóa graph/từ cũ chỉ là bản tương thích. Việc tải từ kho không chạy khi có thay đổi cục bộ xung đột. Kho graph không chứa video, không thay đổi dataset hay tự tải model xuống máy mới. Các phiên bản đã được thay thế có thể bị dọn, nên đây không phải lịch sử sao lưu dài hạn. Dung lượng thường chỉ còn một bản; nhánh xung đột được giữ đến khi người dùng chọn.

Hàm `/api/archive` kiểm tra mã kho trước khi truy cập Hugging Face. Ba biến môi trường production là `NOI_HF_BUCKET`, `NOI_HF_ACCESS_TOKEN` và `NOI_CLOUD_KEY_SHA256`. Token chỉ dùng phía server. Mã kho có thể được thay bằng cách tạo mã mới và cập nhật SHA-256. API lưu `clips/<labelId>/<sampleId>.zip`. Giữ mã từ khi đổi tên hiển thị. Bộ sao lưu dùng ID mẫu để bỏ qua upload trùng. Mốc hoàn tất được lưu theo nhãn để đọc tiến độ toàn bộ kho mà không cần liệt kê từng video.

Bản này dùng mã truy cập chung cho người quản lý kho. Nếu mở thu mẫu cho nhiều cộng tác viên độc lập, cần thêm tài khoản và phân quyền từng người trước khi chia sẻ quyền ghi. Kiểm tra thực tế bằng mẫu ảnh công khai gồm upload, liệt kê, tải lại và xóa một gói; không có phép thử tải với 180.000 clip.
