# Chẩn đoán nhận diện và sao lưu — 2026-11-06

## Bằng chứng từ dữ liệu thực

Đã xuất model đang gặp lỗi và 90 video/landmark từ tab Nối của chủ dự án, gồm ba nhãn, mỗi nhãn 30 mẫu. Các tệp gốc và model cá nhân nằm trong `.cache` được Git bỏ qua. Không đưa video hoặc landmark cá nhân lên repo công khai.

Model cũ có validation accuracy của mạng là 100%, nhưng toàn bộ bộ giải mã phát lại theo từng frame chỉ nhận được:

| Nhãn | Trước sửa | Sau sửa và train lại |
| --- | ---: | ---: |
| tôi | 10/30 | 30/30 |
| bạn | 13/30 | 30/30 |
| chúng ta | 1/30 | 30/30 |

Sau sửa, mỗi clip phát lại tạo đúng một kết quả; không nhầm nhãn, không lặp. Đây là phép kiểm tra hồi quy trên bộ mẫu đã có, có cả mẫu train, không phải độ chính xác trên người ký hoặc phiên quay mới. Mạng train bằng 72 clip; 18 clip cùng phiên được giữ cho validation. Chưa có dữ liệu phiên mới để đo khả năng tổng quát hóa.

## Nguyên nhân và thay đổi

- Bộ dò điểm kết thúc dùng góc 3D ước lượng: nhiễu khi ngón tay hướng về camera liên tục đặt lại đồng hồ chờ, dù ảnh cho thấy tay đang giữ nguyên. Ranh giới nay dùng chuyển động ảnh đã làm mượt; mạng vẫn nhận các đặc trưng xoay 3D và ngón tay.
- Nhãn trái/phải bị đổi thoáng qua khi xoay tay, làm chuỗi nhảy sang kênh tay khác. Thêm bỏ phiếu theo thời gian cho một bàn tay liên tục ở gần vị trí trước đó. Giữ dữ liệu quay gốc để có thể kiểm tra lại; không đoán thêm landmark ở frame mất tay.
- Mất tracking ngắn từng xóa cả đường đi. Bộ đệm giữ lịch sử qua gián đoạn tối đa 250 ms, nhưng không phát dự đoán trong frame không thấy tay.
- Chỉ có hai mẫu đường đi gần tâm và ngưỡng cố định thấp khiến bộ kiểm tra từ chối nhiều lần thực hiện hợp lệ. Nay giữ tối đa sáu mẫu đại diện đa dạng; học ngưỡng đường đi và tư thế cuối từ tập train. Vẫn kiểm tra mức di chuyển, tổng đường đi và điểm cuối, ngoài xác suất và khoảng cách hỗ trợ của mạng.
- Ký hiệu động có thể được kiểm tra khi đang di chuyển, không bắt buộc một khoảng dừng hoàn toàn trước mỗi lần thử. Ký hiệu tĩnh vẫn cần giữ ổn định. Không phát lại cùng từ do rung tay nhỏ; phải có động tác rời tư thế hoặc một nhãn khác.
- Chế độ tự suy ra Tĩnh/Động được xác định từ tập train trước tiền xử lý, thống nhất với lựa chọn kiểu thủ công.

Giữ tư thế đầu của từng clip động không được nhận thành “chúng ta”. Một vài tư thế đầu có thể giống nhãn tĩnh khác; cần thêm mẫu nền để đo và giảm các trường hợp này. Không coi mọi tiền tố theo phần trăm thời lượng là mẫu âm: động tác có thể hoàn thành trước phần còn lại của video.

## Sao lưu

Hàng chờ cũ đánh dấu “đã thử” trước upload, nên lỗi tạm thời không được thử lại khi trang vẫn mở. Kiểm tra phiên kho cũng chỉ chạy một lần. Hai luồng nay tự thử lại với khoảng chờ tăng từ 5 đến 60 giây; xác nhận upload phải trả đúng ID mẫu mới ghi “Đã lên kho”. Sao lưu thủ công đi qua cùng hàng chờ. Mẫu tải thật từ kho được đánh dấu đã lưu sau khi kiểm tra ID và nhãn.

“Chờ kết nối kho”, “Chờ mạng”, “Đang chờ thử lại” đều chưa xác nhận có bản sao cloud. Không xóa mẫu trong máy khi nhận các trạng thái này. Lỗi 400/409/413 dừng thử tự động và giữ mẫu để sửa nguyên nhân.

## Kiểm tra lại

- Nút **Kiểm tra mẫu** chạy toàn bộ decoder trên mẫu lưu trong trình duyệt, báo số đúng/sai/lặp/bỏ sót và xuất báo cáo JSON; không gửi mẫu ra ngoài.
- `node qa/replay-dataset.mjs <dataset.zip> <model.zip> <report.json>` thực hiện phép phát lại cục bộ, cần dev server.
- `node qa/archive-reload.mjs` kiểm tra recorder/IndexedDB thật với transport giả lập: 503, xác nhận sai ID, tự thử lại không reload, lỗi kiểm tra phiên và trạng thái sau reload.
- Unit test kiểm tra hình học, nhãn tay, nhiễu 3D, tiền tố chưa hoàn chỉnh, giới hạn mất tracking và tính tương thích model.
- Kiểm thử tổng hợp vẫn phân biệt chiều chuyển động, rotation, tốc độ khác nhau và từ chối một phần đường đi. Kiểm thử trình duyệt chạy worker, train, import/export, recorder và kiểm tra accessibility.

Không có cơ sở để cam kết không còn bất kỳ lỗi nhỏ nào. Kiểm tra tiếp bằng phiên quay mới, ánh sáng khác, hai tay giao nhau và cử động ngoài danh mục trước khi mở rộng số nhãn.
