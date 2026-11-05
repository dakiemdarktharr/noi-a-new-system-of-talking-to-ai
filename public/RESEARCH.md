# Nối: lựa chọn mô hình, dữ liệu và hướng phát triển

Ngày rà soát: **05/11/2026**. Bản web hiện tại phục vụ thu mẫu và thử nhận diện ký hiệu cá nhân. Báo cáo tách kết quả nghiên cứu, quyết định thiết kế và những điều đã kiểm tra bằng phần mềm. Chưa có thử nghiệm với người dùng Nối để kết luận độ chính xác, tốc độ giao tiếp hoặc mức mỏi tay.

## 1. Quyết định chính

**Dùng MediaPipe Hand Landmarker để theo dõi tay, Temporal CNN nhỏ để học chuỗi chuyển động, và thu dữ liệu riêng của Nối.** Đây là lựa chọn triển khai phù hợp với web desktop chạy tại máy, không phải khẳng định một mô hình luôn chính xác nhất.

Ba bài toán phải được đo riêng: tìm các khớp tay; nhận ra một ký hiệu đã học; hiểu một câu hoặc ý định. Một tracker tốt không tự biết chữ “cảm ơn”. Một bộ phân loại từ cũng chưa hiểu hội thoại. Bài tổng quan liên ngành ASSETS phân tích khoảng cách giữa nhận diện kỹ thuật và ứng dụng ngôn ngữ ký hiệu, bao gồm thông tin ngoài bàn tay. [Bragg và cộng sự, 2019](https://doi.org/10.1145/3308561.3353774)

Mục tiêu dài hạn của Nối có thể là giao tiếp và prompt ít vận động. Bản này là công cụ để kiểm chứng: ký hiệu nào dễ thực hiện, khác nhau đủ rõ, học được từ webcam, và vẫn giữ nghĩa khi đổi người hoặc buổi quay.

## 2. App hiện có gì

| Khu vực | Chức năng đã làm |
|---|---|
| **Nhận diện** | Camera thật, 21 điểm mỗi tay, hướng tay, góc xoay trong ảnh, độ nghiêng ước lượng và độ gập ngón. Model cá nhân phân loại chuỗi; từ được chấp nhận hiện trên camera. Dấu cộng đưa từ vào câu để sao chép. |
| **Thu mẫu** | Chọn nhãn, chuẩn bị 1 giây, quay 2/3/4 giây, lưu video không âm thanh cùng landmark. Xem lại, đổi nhãn sau quay, xóa, tạo phiên thu mới, xuất/nhập ZIP. Huấn luyện và lưu trọng số tại máy. |
| **Từ vựng** | 775 mục nghĩa có mã ổn định, tìm kiếm tiếng Việt, nhóm và xuất CSV/JSON. Chưa phải 775 ký hiệu đã thiết kế hoặc được huấn luyện. |

App không chứa video ký hiệu Nối đã được người dùng xác nhận. Không có bộ trọng số nhận diện Nối sẵn. Sau khi thu ít nhất hai nhãn, mỗi nhãn ba mẫu hợp lệ, có thể chạy train thật. Ngưỡng này mở được một thử nghiệm; nó không chứng minh đủ dữ liệu cho sản phẩm.

Camera, model, WASM và font đều được phục vụ tại máy. Không có upload hoặc dịch vụ suy luận bên ngoài. Video và model lưu trong IndexedDB của trình duyệt; nên xuất ZIP định kỳ. Đổi trình duyệt, hồ sơ, hostname hoặc cổng sẽ dùng vùng lưu khác.

## 3. Vì sao hình tay ngang phải khác hình tay hướng lên

Thiết kế biểu diễn cần giữ **hình ngón**, **hướng**, **vị trí** và **quỹ đạo theo thời gian**. Nếu xoay toàn bộ điểm tay về cùng một tư thế rồi chỉ lưu tọa độ đó, hệ thống có thể làm mất chính khác biệt người dùng muốn giữ.

App tạo hệ trục từ cổ tay, gốc ngón giữa, gốc ngón trỏ và gốc ngón út. Hình ngón được chuẩn hóa trong hệ trục bàn tay; hai trục hướng vẫn được lưu trong hệ camera. Vì thế cùng hình ngón quay 90° vẫn cho đặc trưng hướng khác. Quaternion được dùng kiểm tra chênh lệch góc; model nhận biểu diễn 6D gồm hai trục, tránh ranh giới −180°/180° của góc Euler.

MediaPipe cung cấp cả tọa độ ảnh và tọa độ 3D có gốc riêng cho từng tay. Khoảng cách giữa hai tay phải dùng tọa độ ảnh chung hoặc hệ 3D chung được hiệu chuẩn; trừ hai gốc world riêng không cho khoảng cách thật giữa hai tay. [Tài liệu Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)

Lật preview không được âm thầm đổi dữ liệu trái/phải. App chỉ lật hiển thị. Vector pháp tuyến hình học cũng chưa đủ để tự gắn nhãn “lòng bàn tay hướng ra”: cần đối chiếu tay trái/phải, mặt lưng/lòng tay và các góc khó bằng dữ liệu thật.

Một webcam RGB không đo độ sâu trực tiếp. Khi ngón bị che hoặc bàn tay quay cạnh camera, model có thể suy sai khớp nhưng vẫn trả đủ 21 điểm. Không nên gọi số điểm đầy đủ là bằng chứng tracking chính xác. Các giới hạn về che khuất và găng tay được nêu trong model card chính thức. [Google Hand Tracking model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20(Lite_Full)%20with%20Fairness%20Oct%202021.pdf)

## 4. Chọn model tracking nào

| Lựa chọn | Phù hợp khi nào | Quyết định cho Nối |
|---|---|---|
| **MediaPipe Hand Landmarker** | Cần chạy webcam ngay trên web, hai tay, landmark dễ kiểm tra, chi phí triển khai thấp. | Dùng bản đầu. Đo lỗi thực tế trước khi thay tracker. |
| **HaMeR** | Cần mesh và chi tiết tư thế, chấp nhận pipeline Python/GPU. | Làm đối chứng offline trên chính clip bị MediaPipe sai. Không mặc định model lớn sẽ sửa mọi lỗi. |
| **WiLoR** | Cần detector + tái dựng mesh, muốn so với HaMeR trên tập khó. | Nghiên cứu riêng; phải kiểm tra điều khoản trọng số và MANO trước khi đưa vào sản phẩm. |
| **Fast-HaMeR** | Có GPU cục bộ, cần thử model mesh nhẹ hơn HaMeR. | Ứng viên sau pilot; kết quả GPU trong paper không phải tốc độ web. |
| **OmniHands** | Hai tay tương tác, chạm nhau, quan hệ vị trí là điểm yếu chính. | Đáng thử khi lỗi tập trung ở tương tác; chưa xác minh được bản triển khai browser phù hợp. |

HaMeR là mô hình tái dựng mesh từ ảnh tay; nó không đồng thời giải quyết danh tính hai tay qua thời gian và dịch nghĩa. WiLoR báo cáo tốc độ detector riêng, không nên dùng con số đó cho toàn pipeline. Fast-HaMeR là nghiên cứu mới hơn, cần kiểm tra cả checkpoint và điều kiện đo. Các nguồn gốc: [HaMeR](https://geopavlakos.github.io/hamer/), [WiLoR](https://github.com/rolpotamias/WiLoR), [Fast-HaMeR](https://arxiv.org/abs/2603.16444), [OmniHands](https://dl.acm.org/doi/full/10.1145/3807943).

Một lỗi thường gặp khi chọn model là chỉ đọc PA-MPJPE: phép căn chỉnh dùng trong chỉ số này có thể loại bỏ xoay tổng thể. Điểm khớp sau căn chỉnh tốt không tự chứng minh hướng bàn tay trong camera chính xác. Nối cần đo riêng lỗi hướng, nhầm cặp ký hiệu và các lần mất tay.

## 5. Chọn model học chuyển động và nhận ra từ

| Mô hình | Điểm mạnh cho dự án | Chi phí và hạn chế | Vai trò đề xuất |
|---|---|---|---|
| **DTW + mẫu gần nhất** | Thêm vài mẫu là đối chiếu được, dung nạp khác tốc độ. | Chi phí tăng theo số mẫu; cần ngưỡng từ chối, không học được tổng quát hóa chỉ bằng so mẫu. | Baseline ít dữ liệu; mã đã có, không phải model đang chạy ở màn hình chính. |
| **Temporal CNN nhỏ** | Train được tại máy, xử lý chuỗi bằng tích chập, chi phí suy luận tương đối ổn định. | Dễ học quá sát người/buổi; phụ thuộc cửa sổ và chất lượng landmark. | Đang dùng trong app. |
| **GRU/LSTM** | Có trạng thái theo thời gian, phù hợp thử streaming. | Không mặc nhiên nhanh hoặc chính xác hơn CNN; phải đo runtime. | Đối chứng khi tối ưu streaming. |
| **ST-GCN và biến thể** | Dùng cấu trúc liên kết các khớp và thời gian. | Cần tập nhiều người, thao tác graph/export phức tạp hơn trên web. | Baseline tiếp theo cho tập Nối có nhiều người. |
| **Skeleton Transformer / Siformer** | Học quan hệ dài hơn giữa nhóm đặc trưng. | Thường cần nhiều dữ liệu; các paper có thể dùng cách chia tập khác nhau. | Thử sau khi đã có baseline và test cố định. |
| **RGB + keypoint, Two-Stream + CTC** | Dùng cả hình ảnh, khớp và chuỗi nhãn; phù hợp nghiên cứu nhận diện liên tục. | Nặng hơn, cần dữ liệu chuỗi, có thể dùng mặt/thân ngoài phạm vi hiện tại. | Giai đoạn hội thoại, chưa phù hợp vài clip cá nhân. |

Lý do chọn CNN là khả năng triển khai và kiểm chứng nhanh. Đây không phải kết luận CNN thắng mọi kiến trúc. ST-GCN ban đầu đánh giá nhận diện hành động khung xương; nghiên cứu TCN của Bai và cộng sự so các tác vụ chuỗi chung, không chứng minh độ chính xác Nối. [ST-GCN](https://arxiv.org/abs/1801.07455), [TCN](https://arxiv.org/abs/1803.01271)

Đặc biệt, kết quả cao của Siformer dùng những cách chia cụ thể, gồm chia ngẫu nhiên LSA64 và thiết lập riêng trên WLASL100. Không chuyển các phần trăm đó thành độ chính xác cho người ký tiếng Việt chưa gặp. Two-Stream SLR dùng dữ liệu, loss chuỗi và các kênh hình ảnh/khớp khác bản chỉ có tay này. [Siformer](https://arxiv.org/abs/2503.20436), [Two-Stream SLR](https://arxiv.org/abs/2211.01367)

**Kiến trúc đang chạy:** 32 bước ×172 đặc trưng → Conv1D 24 → Conv1D 32 → pooling → Conv1D 48 → dense 32 → dropout → softmax. Hai nhãn có 52.330 tham số. Đây là temporal CNN nhỏ, không phải bản sao kiến trúc TCN causal/dilated trong paper.

App train bằng TensorFlow.js, lưu trọng số và metadata cùng nhau trong IndexedDB. Khi chạy live, độ dài cửa sổ được chọn từ thời lượng mẫu từng lớp. Mỗi lượt dự đoán cách nhau ít nhất 250 ms. Một kết quả vượt ngưỡng được giữ trên màn hình 1,8 giây. Các ngưỡng softmax, chênh hai ứng viên và khoảng cách đến dữ liệu train chưa được hiệu chỉnh bằng tập Nối thật. [TensorFlow.js lưu/tải model](https://www.tensorflow.org/js/guide/save_load)

## 6. Dữ liệu tiếng Việt có thể dùng đến đâu

| Nguồn | Đóng góp có thể dùng | Điều phải tránh |
|---|---|---|
| **Multi-VSL, WACV 2025** | Tập nhiều góc cho nhận diện từ VSL, có giao thức tách người; nghiên cứu lỗi góc camera. | Coi ba góc cùng một lần ký là ba lần độc lập; suy ra đại diện tất cả cộng đồng Việt Nam. |
| **VSL400, Scientific Data 2026** | Dữ liệu nhiều góc và metadata; video được kiểm soát truy cập. | Nhầm với tập Multi-VSL 400; coi bài báo công khai là quyền tải/phân phối mọi video. |
| **VieSign-10K, bản ghi 2026** | Có cấu hình nhiều lớp và cấu hình tách người; tham khảo vấn đề mất phủ lớp khi tách signer. | Trộn số lớp/kết quả giữa cấu hình; coi bản ghi mới đã được tái lập độc lập. |
| **WLASL, AUTSL, How2Sign** | Tham khảo kiến trúc, protocol, nhãn cô lập/chuỗi, và chuyển giao biểu diễn khi quyền sử dụng cho phép. | Đổi tên đầu ra ASL/Thổ Nhĩ Kỳ thành chữ Việt rồi gọi đó là model Nối. |

Nguồn trực tiếp: [Multi-VSL](https://openaccess.thecvf.com/content/WACV2025/papers/Dinh_Sign_Language_Recognition_A_Large-Scale_Multi-View_Dataset_and_Comprehensive_Evaluation_WACV_2025_paper.pdf), [VSL400](https://www.nature.com/articles/s41597-026-08040-2), [VieSign-10K](https://zenodo.org/records/23610105), [WLASL](https://dxli94.github.io/WLASL/), [AUTSL challenge](https://chalearnlap.cvc.uab.cat/dataset/40/description/), [How2Sign](https://how2sign.github.io/).

Một điểm đã kiểm tra lại: bài ViSL One-shot có tăng cường video tiếng Việt, nhưng thí nghiệm khoảng 95% được trình bày trên 60 từ ngôn ngữ ký hiệu Ấn Độ. Không dùng số đó làm bằng chứng model đã nhận diện 4.364 từ tiếng Việt. [Bài gốc](https://openbooks.itmo.ru/read_ntv/22753/22753.pdf)

Nối vẫn phải thu dữ liệu riêng cho các cử chỉ mới. Dataset của một ngôn ngữ tự nhiên hỗ trợ học biểu diễn hoặc giữ ký hiệu có nguồn; nó không tự cung cấp nhãn cho quy ước mới của dự án.

## 7. Thiết kế lõi ngôn ngữ mà không làm mất tín hiệu

Đề xuất giữ ba tầng: **nghĩa tiếng Việt → một hoặc nhiều ký hiệu/biến thể → lớp model**. “Ba/bố/cha” trong danh sách là alias văn bản, không chứng minh các cộng đồng ký giống nhau. Cần video nguồn, người thẩm định và vùng/cộng đồng tự khai để xác nhận từng ánh xạ.

Khái niệm gloss trong corpus nhận diện hình thức ký hiệu, không đồng nhất với mọi bản dịch. Hướng dẫn chú giải BSL cũng giữ các tầng tay và bản dịch riêng. Đây là căn cứ tổ chức dữ liệu, không phải ngữ pháp áp đặt cho VSL. [Digging into Signs](https://www.sign-lang.uni-hamburg.de/lrec/pub/16015.pdf), [BSL Corpus annotation](https://bslcorpusproject.org/wp-content/uploads/BSLCorpus_AnnotationConventions_v3.0_-March2017.pdf)

**Chưa có cơ sở từ nghiên cứu lần này để đưa ra phần trăm ký hiệu chung của ba cộng đồng Việt Nam hoặc một bộ tay thống nhất đã được họ chấp nhận.** Cách làm thực tế là so cùng danh sách nghĩa giữa người dùng từ các cộng đồng, giữ biến thể khi khác, rồi kiểm tra mức hiểu lẫn nhau. Người dùng tham gia chọn từ, thiết kế và thẩm định; không chỉ xuất hiện ở cuối để quay dữ liệu.

Với Nối do dự án thiết kế, có thể thử khung câu gần tiếng Việt: **chủ thể/chủ đề → ý định hoặc hành động → đối tượng → thời gian/điều kiện → toán tử hỏi/phủ định nếu cần**. Các thành phần được phép lược khi ngữ cảnh đã rõ. Đây là đề xuất để thử hiểu câu, chưa là ngữ pháp đã được xác nhận.

Ưu tiên từ hàng ngày: tôi, bạn, chúng ta, ai, gì, đâu, khi nào, có, không, muốn, cần, biết, hiểu, giúp, đi, đến, ăn, uống, ngủ, nghỉ, nhà, đây, đó, hôm nay, ngày mai, cảm ơn, xin lỗi, được, chưa. Đếm nghĩa theo ngữ cảnh, không ép mỗi chữ tiếng Việt phải có đúng một động tác.

Các lệnh AI như “sửa”, “giải thích”, “giữ nguyên”, “thêm ví dụ”, “ngắn hơn” có thể dùng lại lớp từ hàng ngày. Ký hiệu `/`, `$`, tên tệp, số và chuỗi cần giữ nguyên nên có chế độ nhập rõ ràng hoặc bàn phím dự phòng. Không để bộ đoán ngữ cảnh âm thầm đổi số, tên hay lệnh phủ định.

**Đánh giá ý tưởng lặp ký hiệu kiểu multi-tap:** giảm số hình tay cần học nhưng tăng số lần chuyển động, thời gian chờ và lỗi phân ranh giới. “Hai lần ký số 1” có thể là số 11, lặp để nhấn mạnh hoặc từ khác. Vì thế chưa nên dùng như cơ chế mã hóa mọi từ. Nên thử một lớp modifier rõ ràng, vùng số riêng, cơ chế kết thúc hoặc chọn ứng viên; bảo vệ các cặp quan trọng như có/không, gửi/hủy. So trực tiếp với một ký hiệu riêng bằng thời gian hoàn thành đúng, không chỉ đếm số hình tay.

## 8. Ít vận động hơn cần đo thế nào

Ưu tiên vùng thao tác nhỏ, tư thế nghỉ thoải mái, chuyển tiếp ngắn và cho phép biến thể cá nhân. Tuy nhiên, giảm chuyển động cánh tay có thể tăng yêu cầu chính xác ngón và xoay cổ tay; không thể suy ra giảm mỏi chỉ từ video nhìn nhỏ hơn. Không ép ngón áp út/út tách cực đoan hoặc giữ xoay ở biên chỉ để camera dễ thấy.

Mỗi cặp ứng viên ký hiệu nên được thử theo: thời gian học, tỷ lệ làm đúng, tỷ lệ người khác hiểu, khoảng di chuyển, số lần phải làm lại và mức khó chịu người dùng tự báo sau các phiên sử dụng. Cho nghỉ và dừng khi khó chịu. Đây là tiêu chí thiết kế cần thử với người dùng, không phải kết quả y học hoặc bảo đảm công thái học.

Không bắt dùng nét mặt là giới hạn có chủ đích của giao thức Nối. Hệ thống sẽ cần chuyển một số phân biệt nghĩa sang tay, toán tử hoặc ngữ cảnh; không được tuyên bố đã giữ nguyên mọi khả năng biểu đạt của ngôn ngữ ký hiệu tự nhiên. Nghiên cứu đồng thiết kế với người Điếc hỗ trợ việc cho người dùng vai trò quyết định, nhưng không xác nhận thay cho cộng đồng Việt Nam. [Ang và cộng sự, CHI 2022](https://doi.org/10.1145/3491102.3517488)

## 9. Kế hoạch thu và đánh giá

**Bắt đầu 8–20 nhãn thay vì quay đồng loạt 775 mục.** Cần cả cặp dễ và khó: cùng hình ngón khác hướng; cùng hướng khác hình ngón; cùng hình tay đi ngang/đi lên; đổi thứ tự chuyển động; hai tay gần/xa. Thu các cặp trong cùng buổi để tránh model học nền/áo thay cho dấu hiệu phân biệt.

Một pilot có thể dùng 8 nhãn ×1 người ×4 buổi ×10 lần =320 clip nguồn. Giữ hai buổi train, một validation, một test chưa dùng chọn ngưỡng. Thêm video nghỉ, hành vi đời thường và ký hiệu ngoài nhãn. Đây là ngân sách đề xuất, không phải số lượng được chứng minh luôn đủ.

Khi mở cho người khác: ví dụ 24 nhãn ×8 người ×2 buổi ×6 lần =2.304 clip nguồn; chia người 5/1/2. Hai người test vẫn chỉ là pilot. Mọi góc, bản cắt và bản tăng cường của một lần quay phải ở cùng tập. Không chia các frame liền nhau sang train/test.

Schema tiếp theo cần thêm `signerId`, `sourceCaptureId`, `signId`, `variantId`, mốc bắt đầu/kết thúc, phiên bản nhãn và nguồn quyền sử dụng. Bản hiện tại có `sessionId` nhưng chưa có đánh giá signer-independent. Mẫu quay và landmark giữ liên kết để có thể trích lại khi đổi tracker.

| Phép đo bắt buộc | Tại sao cần |
|---|---|
| Macro-F1, recall từng lớp, ma trận nhầm hướng | Tổng accuracy có thể che một cặp hướng hoạt động kém. |
| Đúng trong các kết quả chấp nhận **và** tỷ lệ được chấp nhận | Model từ chối mọi thứ không phải sản phẩm tốt. |
| Nhận nhầm unknown, số từ sai mỗi phút khi nghỉ | Softmax luôn có ứng viên cao nhất ngay cả ngoài từ vựng. |
| Độ trễ p50/p95 từ bắt đầu/kết thúc ký đến chữ hiện | FPS tracker không tính thời gian gom cửa sổ, phân loại và hiển thị. |
| Tốc độ nội dung đúng sau sửa lỗi | Chữ hiện nhanh nhưng phải sửa nhiều không giúp prompt nhanh. |
| Mức mỏi/khó chịu và thời gian học | Tốc độ sau hàng giờ luyện không thể so với người mới gõ lần đầu. |

## 10. Có thể nhanh gấp đôi đánh máy chưa

**Chưa có bằng chứng.** Bản hiện tại dùng cửa sổ 1–4 giây để gom chuyển động trước khi dự đoán. Nó phục vụ thử nhãn và thu dữ liệu, chưa phải hệ nhập tốc độ cao. Không lấy thời gian suy luận 10–20 ms của một frame để quảng bá một từ được nhận trong 10–20 ms.

Muốn tiến tới tốc độ đó, cần phát hiện điểm đầu/cuối sự kiện, phân loại causal/incremental, xử lý ký liên tục và lặp từ, giảm độ trễ mà không tăng nhận nhầm. Tối ưu phải đo trên các cặp từ đổi hướng và hoạt động nền, không chỉ clip được cắt sẵn.

So ký và gõ trên cùng tác vụ, sau thời gian học hợp lý, đổi thứ tự điều kiện giữa người tham gia. Báo cáo riêng sao chép một đoạn và tự nghĩ prompt. Tiếng Việt có từ nhiều âm tiết; đếm phần ngăn bằng dấu cách có thể là đếm âm tiết. Chọn quy tắc trước, kèm số ký tự và các ý bắt buộc còn đúng sau sửa. Các bản thử 300 chữ chỉ có ý nghĩa khi cùng tiêu chí hoàn thành và không cho một phương thức dùng nội dung được nén sẵn hơn phương thức kia.

LLM về sau có thể làm câu đọc tự nhiên hơn từ chuỗi nghĩa, nhưng phải giữ phủ định, con số, chủ thể và điều kiện. Đề xuất hoàn chỉnh câu nên là lựa chọn người dùng xác nhận. Không biến LLM thành nguồn tự thêm ý rồi tính các ý đó là tốc độ truyền đạt của người ký.

## 11. Găng tay và mở rộng

Giữ adapter đầu vào thống nhất: thời gian, tay trái/phải, hệ tọa độ, orientation, khớp và trạng thái quan sát. Găng tay sau này có thể bổ sung nút xác nhận, modifier hoặc cảm biến. Cảm biến gập ngón không tự cho hướng bàn tay; cảm biến hướng ở cổ tay không tự cho vị trí tuyệt đối. Các kênh chưa đo được phải để thiếu, không tạo số giả.

Thử găng tay chỉ khi có một lợi ích đo được: giảm false trigger, vượt che khuất, hoặc thao tác lệnh nhanh hơn. Cần đo hiệu chuẩn, trôi, thoải mái, tháo/đeo và khả năng sử dụng cùng webcam. Mua phần cứng hoặc chuyển toàn bộ pipeline sang mesh GPU chưa có căn cứ trước khi pilot chỉ ra lỗi chính.

## 12. Kiểm tra đã thực hiện và việc còn mở

Kiểm thử phần mềm gồm: hình học giữ được hướng khi chuẩn hóa hình ngón; phân biệt quỹ đạo ngang/dọc; từ chối tọa độ hỏng và camera gián đoạn; train/infer TensorFlow.js thật; lưu/tải model IndexedDB; worker MediaPipe chạy trên ảnh tay chính thức; MediaRecorder ghi video + landmark; đổi nhãn; xuất/nhập ZIP; chữ dự đoán xuất hiện trên UI trong hồ sơ kiểm thử riêng.

Với một ảnh bàn tay xoay 90° trong bài kiểm tra, chênh lệch orientation ước lượng là khoảng **87,8°**. Đây là một phép hồi quy trên ảnh, không phải sai số trung bình hoặc bảo đảm xoay cổ tay thực tế. Frame đầu tải GPU mất khoảng vài giây; frame đã nóng nhanh hơn nhiều. Chưa có phân bố p50/p95 cho webcam người thật, nên không suy rộng các thời gian đơn lẻ.

Chưa thực hiện: đánh giá người dùng Nối, đo tốc độ gõ/độ mỏi, đánh giá người mới, dịch câu liên tục, thiết kế và thẩm định đầy đủ 775 ký hiệu, huấn luyện từ các dataset VSL bên ngoài, và kiểm chứng găng tay. Các bước này cần dữ liệu/đồng thiết kế; báo cáo không điền số độ chính xác giả vào chỗ trống.

## Tài liệu chuyên sâu và nguồn

- [Tracking và orientation](research/TRACKING-RESEARCH.md): model card, hệ tọa độ, handedness, mesh, giấy phép, cảm biến và đối chứng.
- [Chuỗi và mô hình phân loại](research/TEMPORAL-RESEARCH.md): kiến trúc, input, chia tập, nghiên cứu gốc và giới hạn benchmark.
- [Dữ liệu, nhãn và đánh giá](research/DATASET-RESEARCH.md): VSL, phiên bản dataset, schema, quy tắc chú giải và audit từ vựng.
- [Danh mục 775 nghĩa](vocabulary/NOI-VOCABULARY.md), [CSV](vocabulary/noi-vocabulary.csv), [JSON](vocabulary/noi-vocabulary.json).

Phương pháp: dùng Exa tìm nguồn, alphaXiv/SciSpace đọc nghiên cứu, đối chiếu tài liệu nhà phát triển, paper gốc, repo tác giả và giấy phép. Skill chuyên môn dùng gồm agency-agents, frontend-design và Exa; áp dụng hướng dẫn biên tập Turnitout để giữ văn bản rõ và không làm tăng mức chắc chắn của kết luận. Không cần gọi mọi plugin chỉ vì có sẵn. Nguồn tiếng Anh và nguồn công khai chiếm phần lớn; chưa có phỏng vấn người dùng VSL trong lần này.

Ba nhánh Exa yêu cầu tổng **125 lượt kết quả ứng viên** (40 tracking +35 mô hình chuỗi +50 dữ liệu). Con số gồm khả năng trùng/lạc đề, không phải 125 nghiên cứu đã đọc đầy đủ hoặc 125 nguồn độc lập. Các nguồn dùng cho kết luận được dẫn ngay tại nội dung.

sources_reviewed: 125
