# Nối: chuyển nghĩa và dữ liệu

Mỗi chu kỳ **nắm → mở** hoàn chỉnh chuyển một bước trong chuỗi nghĩa của từ vừa nhận diện. Mặc định: `tôi → chúng tôi → tôi`. Hai hoặc ba chu kỳ được xử lý thành hai hoặc ba sự kiện riêng. Chỉ cần thu mẫu cho ký hiệu gốc; các nghĩa thay thế là quy ước do người dùng gán, không phải các lớp CNN được tự học thêm.

## Graph chuỗi nghĩa

Mở **Thu mẫu → Block** hoặc **Chuyển nghĩa**. Graph mở ở mức tổng quan toàn bộ danh mục trên nền blueprint. Tìm từ để tới block, lăn chuột hoặc chụm hai ngón để zoom, kéo nền để di chuyển. Thêm từ trong danh mục tự tạo block; thêm ngay trong graph sẽ đặt block gần từ đang chọn.

- Kéo một block tới gần block khác: ô nét chấm sáng nhất là vị trí sẽ snap khi thả. Có thể chèn trên, dưới hoặc giữa chuỗi. Các block bị cản sẽ được đẩy ra để tránh che nhau.
- Chuỗi đọc từ trên xuống dưới. Đặt `chúng ta` ngay dưới `tôi` sẽ tạo `tôi → chúng ta`; mỗi lần nắm–mở đi một bước và cuối chuỗi quay về đầu. Nhận diện trực tiếp một từ ở giữa chuỗi thì bắt đầu từ chính từ đó.
- Một block thuộc tối đa một chuỗi. Kéo di chuyển một từ; phần chuỗi còn lại nối tiếp nhau. Thả vào vùng trống hoặc dùng **Tách** sẽ tách từ khỏi chuỗi, không xóa từ hay mẫu đã quay.
- Có **Hoàn tác / Làm lại**, **Esc** hủy kéo, phím mũi tên di chuyển khung nhìn. **Ghép dưới** là lựa chọn dùng bàn phím thay cho kéo thả. Mất focus, hủy pointer hoặc bắt đầu zoom hai ngón sẽ hủy thao tác kéo dở.

Vị trí, chuỗi và từ tự thêm được lưu cùng một bản trong trình duyệt (`noi-workspace-v1`); bộ nhận diện dùng cùng thứ tự này. Nếu lưu thất bại, thay đổi không được áp dụng. Cấu hình chuyển nghĩa cũ được chuyển sang graph khi chưa có graph; các nghĩa cũ ngoài danh mục vẫn có block riêng. Hoàn tác giữ tối đa 40 thay đổi trong phiên mở graph.

Khi kết nối **Kho video**, graph và từ tự thêm tự đồng bộ vào cùng kho riêng tư. Sửa liên tiếp được gộp trước khi gửi; **Đã đồng bộ** chỉ xuất hiện sau xác nhận đúng phiên bản. Mất mạng giữ bản trên máy và hàng chờ qua reload. Thiết bị mới kết nối cùng kho sẽ tải graph về. Bản đang mở kiểm tra cập nhật khi lấy focus, có mạng trở lại và mỗi 30 giây khi tab đang hiện. Thay đổi từ máy khác làm mới graph và xóa lịch sử hoàn tác cũ để tránh hoàn tác đè bản mới.

Nếu hai máy sửa từ cùng một bản cũ, app giữ các phiên bản và hiện **Chọn bản graph**. Mở bản kho để xem chuỗi, rồi chọn bản trên máy hoặc bản kho. Không tự hợp nhất thứ tự nghĩa vì hai thứ tự khác nhau làm lệnh nắm–mở có nghĩa khác nhau. Các nút chọn bản thay toàn bộ cấu hình graph, không thay mẫu video hoặc trọng số model. Graph chưa nằm trong ZIP dataset/model; trạng thái đồng bộ là cách kiểm tra bản sao kho.

Lệnh có hiệu lực trong 5 giây sau từ gốc hoặc sau một lần chuyển. Bốn ngón dài phải cùng nắm rồi cùng mở, dùng cùng một bàn tay cho trọn chu kỳ. Ngưỡng nắm/mở có khoảng trễ riêng để tránh rung qua lại; nắm được xác nhận sau ít nhất 65 ms, mở sau 50 ms, cần nhiều hơn một quan sát mỗi pha. Giữ nắm không lặp tự động. Mất tay hoặc khoảng trống tracking trên 180 ms hủy chu kỳ chưa hoàn tất. Tư thế mở kết thúc không được đưa trở lại bộ đoán từ cho đến khi có thay đổi tư thế/vị trí/hướng hoặc hết cửa sổ lệnh.

Đây là lệnh dành riêng khi đang có từ có chuỗi nghĩa. Một ký hiệu thông thường cũng chứa nắm–mở có thể xung đột trong cửa sổ này; cần thiết kế từ vựng tránh trùng lệnh hoặc bỏ chuỗi nghĩa của từ đó. Hiện chưa có dữ liệu nắm–mở thực tế của người dùng để đo tỷ lệ kích hoạt nhầm. Bộ đếm dùng landmark và góc khớp, không tuyên bố là CNN đã học lệnh từ video chưa được thu.

## Dữ liệu và train

- Mỗi mẫu được lưu IndexedDB trước khi đưa vào hàng chờ kho. “Chờ gửi” vẫn là dữ liệu trên trình duyệt; “Đã lên kho” cần phản hồi đúng ID từ backend.
- JSON/ZIP bị từ chối nếu trùng ID trong cùng tệp, một ID đổi nhãn/chuyển động, hoặc một mã nhãn có nhiều tên. Nhập lại JSON hợp lệ giữ video và trạng thái kho đã xác nhận. Loại tĩnh/động đi theo ZIP.
- **Nạp tất cả** tải các nhãn trong kho riêng, kiểm tra ID/nhãn của từng ZIP và ghi bền vững từng nhãn. Mẫu đã có JSON nhưng thiếu video vẫn được bổ sung video.
- Train sử dụng toàn bộ tập mẫu đã nạp, không phụ thuộc bộ lọc danh sách. Không âm thầm bỏ mẫu lỗi hoặc gộp ID trùng. Tập này được chia train/validation theo phiên khi có thể; validation không được dùng để fit và không được mô tả là toàn bộ mẫu đã được fit.
- Xóa dataset trên máy dừng camera, đợi upload đang chạy kết thúc, xóa model đã lưu và toàn bộ mẫu, kể cả mẫu bị ẩn bởi bộ lọc. Danh mục từ và chuỗi nghĩa được giữ.
- Xóa clip trên kho ghi dấu xóa riêng trước khi xóa nội dung. Dấu xóa chỉ giữ mốc thời gian, không giữ video/landmark. Tab cũ gửi lại ID đó sẽ nhận HTTP 410 và dừng retry; quay mới tạo ID mới. Token kho không nằm trong mã frontend.

## Tracking và giới hạn kiểm chứng

Hai detection có cùng nhãn Left/Right không còn làm mất một tay. Bộ ghép tay dùng vị trí và vận tốc cổ tay, thử hai cách ghép, giữ kênh tay ổn định qua xoay và che khuất ngắn. Không tạo landmark cho tay bị che và không làm trơn mạnh dữ liệu ngón tay đầu vào. Hai tay trùng nhau hoàn toàn hoặc mất tracking lâu vẫn có thể làm sai danh tính; một camera RGB không quan sát được phần tay bị khuất.

Hình ngón được chuẩn hóa riêng, hướng camera vẫn được giữ bằng cơ sở 3D và quaternion. Góc 180° và ranh giới ±180° được kiểm tra; không loại bỏ orientation chỉ để tăng độ bất biến. Theo [tài liệu Hand Landmarker của Google](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker), handedness là nhãn trái/phải, còn ngưỡng tracking dùng để quyết định khi nào cần phát hiện lại bàn tay. Nó không phải chứng nhận độ chính xác từng ngón.

Kiểm chứng: unit tests cho ba chu kỳ, nắm giữ, rung ngắn, mất tay, đổi tay, hai tay giao nhau và xoay 180°; browser test với TF thật cho train, lưu/tải lại, xuất/nhập model, giữ video khi nhập JSON, bốn nghĩa và quay vòng, xóa toàn bộ dưới bộ lọc nhãn. Ảnh tay thật xoay 180° được tracker đo khoảng 177,6° trên lần chạy đã ghi nhận. Các thử nghiệm này **không thay thế** kiểm tra người thật ký hiệu nhanh, ánh sáng khác, hai tay che nhau hoặc lật lòng/bàn tay trước camera.

Thay đổi ghép tay có thể làm model cũ không còn khớp toàn bộ mẫu: chạy lại model cũ trên 90 clip cũ được 87/90 đúng, 3 không nhận, 0 nhãn sai. Dataset/model cũ được xóa theo yêu cầu; không dùng con số này làm độ chính xác model mới. Cần thu bộ mới, kiểm thử ở phiên khác và đo độ trễ đầu-cuối/FPS thực tế trước khi kết luận nhanh hơn đánh máy.
