# Nối: dữ liệu, nhãn và đánh giá nhận diện

Ngày rà soát: 2026-11-05. Phạm vi: ứng dụng web tối giản với hai việc chính — dự đoán nhãn từ video và quay/gắn nhãn mẫu để huấn luyện. Đây là tài liệu nghiên cứu và kế hoạch kiểm chứng, không phải báo cáo độ chính xác đã đạt được.

## Kết luận phục vụ triển khai

Nối cần giữ riêng **nghĩa tiếng Việt**, **ký hiệu được cộng đồng xác nhận hoặc cử chỉ riêng do người dùng quy ước**, **mẫu quay**, và **lớp mô hình đã thực sự học**. Danh mục ban đầu có 772 nghĩa; bản sửa trong đợt này có 775 nghĩa. Không con số nào chứng minh mô hình nhận diện được từng ấy ký hiệu.

Nhận diện một động tác đã cắt sẵn, phát hiện một từ trong video đang chạy, và dịch một câu ký hiệu sang câu tiếng Việt là ba bài toán khác nhau. Bản đầu nên cam kết nhận diện cử chỉ/từ riêng lẻ đã thu mẫu. Nếu dùng câu “dịch ngôn ngữ ký hiệu Việt Nam”, phải có dữ liệu tiếng Việt phù hợp, chuyên gia/người dùng ngôn ngữ ký hiệu tham gia, và đánh giá đúng tác vụ. Một bộ phân loại nhãn đơn lẻ không tự cung cấp ngữ pháp hoặc dịch câu.

Phải giữ thông tin hướng lòng bàn tay và hướng ngón tay song song với hình ngón, vị trí và chuyển động. Bài WLASL minh họa hai ký hiệu ASL READ/DANCE có khác biệt về hướng bàn tay; đây là ví dụ ASL, không phải ánh xạ tự động sang tiếng Việt. Từ đó, **khuyến nghị thiết kế** là không coi phép xoay tay tùy ý là phép tăng cường dữ liệu luôn giữ nguyên nhãn. [WLASL, hình 1](https://openaccess.thecvf.com/content_WACV_2020/papers/Li_Word-level_Deep_Sign_Language_Recognition_from_Video_A_New_Large-scale_WACV_2020_paper.pdf)

## Bằng chứng và giới hạn của nguồn

Các số trong bảng là mô tả của nguồn gốc, không phải số mẫu tối thiểu cho Nối. Không chuyển độ chính xác giữa các bộ dữ liệu, ngôn ngữ, cách chia dữ liệu hoặc phần cứng.

| Nguồn trực tiếp | Nguồn cho biết gì | Giá trị và giới hạn đối với Nối |
| --- | --- | --- |
| [WLASL — bài WACV 2020](https://openaccess.thecvf.com/content_WACV_2020/papers/Li_Word-level_Deep_Sign_Language_Recognition_from_Video_A_New_Large-scale_WACV_2020_paper.pdf), [trang tác giả](https://dxli94.github.io/WLASL/) | 2.000 lớp ASL, 21.083 video, 119 người ký; mỗi video chứa một ký hiệu. | Nghiên cứu gốc và dữ liệu từ tác giả; hữu ích cho nhận diện từ riêng lẻ và kiểm tra khác biệt hướng. Không phải dữ liệu tiếng Việt hoặc bộ kiểm thử video liên tục. |
| [AUTSL — mô tả chính thức của thử thách](https://chalearnlap.cvc.uab.cat/dataset/40/description/), [phòng thí nghiệm tác giả](https://cvml.ankara.edu.tr/datasets/) | 226 ký hiệu tiếng Thổ Nhĩ Kỳ, 43 người ký. Bản gốc: 38.336 video. Bản thử thách dùng test cân bằng: 36.302 video, chia người ký 31/6/6 cho train/validation/test. | Nguồn trực tiếp nêu rõ phiên bản và sự thay đổi từ validation ngẫu nhiên của bài gốc sang validation tách người. Là ví dụ tốt về việc phải ghi phiên bản và giao thức, không chỉ ghi tên dataset. |
| [How2Sign — dự án tác giả](https://how2sign.github.io/), [bài CVPR 2021](https://openaccess.thecvf.com/content/CVPR2021/papers/Duarte_How2Sign_A_Large-Scale_Multimodal_Dataset_for_Continuous_American_Sign_Language_CVPR_2021_paper.pdf) | Hơn 80 giờ ASL liên tục, nhiều góc máy, kèm lời nói/bản chép tiếng Anh và dữ liệu độ sâu. Trang dự án nêu mục đích nghiên cứu. | Nghiên cứu gốc cho bài toán chuỗi/câu; không thể lấy số từ tiếng Anh làm số lớp ký hiệu, hoặc coi toàn bộ chia dữ liệu là tách người ký. |
| [Multi-VSL — bài WACV 2025](https://openaccess.thecvf.com/content/WACV2025/papers/Dinh_Sign_Language_Recognition_A_Large-Scale_Multi-View_Dataset_and_Comprehensive_Evaluation_WACV_2025_paper.pdf) | Bản 1.000 gloss có 84.764 video từ các góc máy, 28.176 lần thực hiện nhiều góc, 30 người ký; chia người 21/4/5. Thu cùng người ký ở Trường chuyên biệt Nhân Chính, Hà Nội. | Bài gốc tiếng Việt, trực tiếp liên quan việc mất thông tin ở góc chính diện. Ba góc của cùng lần thực hiện không phải ba quan sát độc lập. Kết quả nhiều camera không mặc nhiên áp dụng cho một webcam. |
| [VSL400 — Scientific Data 2026](https://www.nature.com/articles/s41597-026-08040-2) | 400 gloss, 74.259 clip, 28 người ký, ba góc đồng bộ. Metadata và mã xử lý công khai; video người thật được truy cập có kiểm soát theo thỏa thuận sử dụng dữ liệu. | Nguồn tác giả đã xuất bản; khác bộ Multi-VSL 400 trong bài WACV 2025. Không suy ra quyền tải/phân phối video từ giấy phép của bài báo. [Bản ghi đầy đủ đã đối chiếu trên SciSpace](https://scispace.com/papers/a-multi-view-dataset-for-vietnamese-word-level-sign-language-dltjoyyc0n8s). |
| [VieSign-10K — bản ghi Zenodo v1, 2026-10-24](https://zenodo.org/records/23610105) | Corpus 10.515 video/3.659 lớp. VieSign-1182 có 7.664 video và có thể trùng người giữa các tập. VieSign-SI447 có 4.252 video/447 lớp, người ký tách nhau 25/13/12; 735 lớp bị loại khi yêu cầu phủ lớp ở cả ba tập. | Bản ghi từ người phát hành, chưa coi là kết quả được tái lập độc lập. Minh họa cụ thể việc tăng số lớp và giữ đánh giá người mới là hai yêu cầu khó đồng thời đáp ứng. Không trộn các cấu hình 447 và 572 lớp. |
| [ViSL One-shot — bài gốc 2024](https://openbooks.itmo.ru/read_ntv/22753/22753.pdf) | Tăng cường từ 4.364 video tiếng Việt thành 436.400 mẫu. Thử nghiệm khoảng 95% trong bài được thực hiện với 60 từ ngôn ngữ ký hiệu Ấn Độ, không phải kết quả phân loại 4.364 từ tiếng Việt. | Nghiên cứu gốc về tăng cường dữ liệu; 100 biến thể từ một nguồn không phải 100 người ký hoặc 100 lần thu độc lập. Không dùng số này quảng bá độ chính xác của Nối. |
| [Digging into Signs — LREC 2016](https://www.sign-lang.uni-hamburg.de/lrec/pub/16015.pdf) | ID gloss nhận diện một hình thức ký hiệu, không phải bản dịch; quy ước được xây dựng từ corpus BSL/NGT. | Nghiên cứu trực tiếp của nhóm làm corpus, tốt cho thiết kế nhãn. Không quy định thay cho người dùng tiếng Việt việc hai biến thể phải cùng hay khác lớp. |
| [BSL Corpus — hướng dẫn chú giải 2017](https://bslcorpusproject.org/wp-content/uploads/BSLCorpus_AnnotationConventions_v3.0_-March2017.pdf) | Tách tầng tay phải, tay trái và bản dịch; mô tả mốc bắt đầu/kết thúc, hoạt động yếu, biến thể và việc giữ tay khi không ký tiếp. | Quy trình corpus thực tế, hữu ích để xây quy tắc chú giải nhất quán. Mốc thời gian của Nối cần được ghi rõ; hướng dẫn BSL không tự là tiêu chuẩn VSL. |

Không tìm thấy bằng chứng đủ để kết luận “ba mẫu mỗi từ là đủ cho mọi người”, “độ trễ nhanh gấp đôi”, hay “775 nghĩa đã tạo thành một ngôn ngữ hoàn chỉnh”. Các bài trên không chứng minh những phát biểu đó.

## Tách nghĩa, ký hiệu và nhãn máy học

**Khuyến nghị cấu trúc:** `conceptId` là nghĩa dự định; `signId` là hình thức ký hiệu đã xác nhận hoặc cử chỉ Nối đã quy ước; `variantId` giữ biến thể nếu cần; `modelClassId` gắn với phiên bản mô hình. Quan hệ không bắt buộc một-một. Một nghĩa có thể có nhiều ký hiệu theo cộng đồng; một ký hiệu có thể có nhiều cách dịch tùy ngữ cảnh. Cần trường `languageOrProtocol`, `regionOrCommunity`, `reviewStatus`, `referenceVideo`, `reviewerId`, `annotationVersion` và ghi chú ý nghĩa.

Không lấy “bố/ba/cha” trong danh mục làm bằng chứng ba cộng đồng dùng cùng một ký hiệu. Các alias hiện chỉ hỗ trợ tìm kiếm tiếng Việt. Ghi vùng/cộng đồng do người tham gia tự mô tả; dùng `unknown` khi chưa rõ. Không suy ra vùng từ gương mặt, địa chỉ IP hoặc vị trí camera. Dữ liệu Hà Nội không tự chứng minh phù hợp với mọi cộng đồng ở Việt Nam. Việc gộp hoặc tách biến thể cần người dùng ngôn ngữ ký hiệu thẩm định.

Nếu người dùng tự định nghĩa hai cử chỉ chỉ khác hướng tay, đặt nhãn là **cử chỉ Nối do người dùng quy ước** cho đến khi có bằng chứng đó là ký hiệu của một ngôn ngữ cụ thể. Các ý định như “không gửi ra ngoài” hay “ưu tiên độ chính xác” có thể là câu lệnh giao diện hoặc chuỗi ký hiệu; danh mục nghĩa không chứng minh chúng là một ký hiệu đơn.

Với ngôn ngữ ký hiệu tự nhiên, hạn chế chỉ dùng landmark hai bàn tay có thể bỏ mất vị trí so với thân/người, nét mặt hoặc chuyển động miệng. Đó là giới hạn cần đo trên bộ nhãn đã chọn. Nếu thiết kế giao thức Nối chỉ dùng tay, ghi rõ đây là quyết định thiết kế; không trình bày như mô tả chung về ngôn ngữ ký hiệu Việt Nam.

## Rà soát và sửa danh mục trong repository

Trước sửa, `src/data/vocabulary.json` có 772 ID và 772 nhãn hiển thị duy nhất; 758 định nghĩa chỉ lặp lại nhãn. Bộ tạo danh mục dùng NFC + `casefold()` để loại nhãn trùng, khiến mất ba nghĩa khác nhau:

| Nghĩa bị gộp trước đây | Mục vẫn có | Mục được phục hồi, mã mới |
| --- | --- | --- |
| AI với câu hỏi “ai” | `NOI0021 ai` | `NOI0774 AI (trí tuệ nhân tạo)` |
| “từ” là đơn vị ngôn ngữ với “từ” chỉ nguồn | `NOI0563 từ` | `NOI0775 từ (đơn vị ngôn ngữ)` |
| “năm” số lượng với “năm” thời gian | `NOI0247 năm` | `NOI0773 năm (số 5)` |

Đã giữ nguyên mã và nhãn của toàn bộ 772 mục cũ, thêm ba mục ở cuối, bổ sung 25 định nghĩa để phân biệt nghĩa và sửa khóa định nghĩa không khớp cho `người không nói được`. Bản mới có 775 mục, 40 định nghĩa không chỉ lặp nhãn. Các nhãn còn lại vẫn cần thẩm định; đây chưa phải từ điển đã chú giải xong. Định nghĩa `có…không?` nay nói rõ toán tử tay riêng là đề xuất Nối chưa xác nhận, không phải nhận định về vai trò nét mặt trong VSL.

`scripts/build-vocabulary.py` tái sử dụng các ID đã xuất bản khi thêm nghĩa hoặc đổi thứ tự nguồn, kiểm tra ID/nhãn hiển thị trùng, rồi tạo hai JSON, CSV và Markdown. [vocabulary-audit.json](vocabulary-audit.json) ghi kết quả kiểm tra. Nhãn hiển thị không nên được đổi tùy tiện vì còn làm khóa tra cứu ID trong bộ tạo hiện tại; đổi nhãn đã phát hành cần một ánh xạ chuyển đổi rõ ràng.

Các việc còn lại: định nghĩa nghĩa và ngữ cảnh cho phần còn lại; phân biệt từ đơn/cụm/câu lệnh; gắn quan hệ giữa chữ số `5` và nghĩa số lượng `năm`; xác nhận có cần hai lớp hay chung một ký hiệu; xây bảng ký hiệu với nguồn và biến thể. Không gộp chúng chỉ vì cách viết hoặc tự phát minh ký hiệu để lấp đủ 775 lớp.

## Thu mẫu: giữ tín hiệu phân biệt hướng và chuyển động

Các mục sau là **đề xuất thu dữ liệu**, không phải số lượng hoặc quy trình bắt buộc từ một bài báo:

1. Mỗi clip bắt đầu ở trạng thái nghỉ, thực hiện một lần, kết thúc có khoảng nghỉ. Giữ video nguyên; mốc `signStartMs`/`signEndMs` có thể được sửa sau. Thu thêm chuỗi nhiều ký hiệu ở bước đánh giá liên tục vì clip cô lập không chứa đủ chuyển tiếp tự nhiên.
2. Thu từng cặp cùng hình ngón nhưng khác hướng trong cùng buổi để tránh mô hình học ánh sáng, áo hoặc nền thay cho hướng. Lặp lại ở buổi khác. Ghi rõ thay đổi nằm ở hướng lòng bàn tay, hướng ngón, vị trí hay chuyển động.
3. Với hai tay, giữ danh tính tay trái/phải, tay thuận và quan hệ giữa hai tay. Thu người thuận tay trái khi có thể. Không tự xem lật ngang là giữ nhãn; chỉ dùng khi quy ước nhãn đã xác nhận phép biến đổi đó.
4. Tách `previewMirrored` khỏi phép biến đổi tọa độ đầu vào. Ghi camera hướng nào, ảnh có xoay hay lật khi lưu không. Chuẩn hóa kích thước và tịnh tiến có thể hữu ích; xoay toàn bộ hệ bàn tay về một hướng chuẩn phải đi kèm một kênh hướng gốc.
5. Thu biến thiên tốc độ, khoảng cách camera, nền và ánh sáng có chủ đích. Chỉ biến đổi dữ liệu train, sau khi chia tập. Một clip tăng cường, một crop khác và các góc camera đồng bộ đều phải giữ cùng `sourceCaptureId`.
6. Thu riêng cảnh nghỉ có tay trong ảnh, không có tay, vươn tay lấy đồ, chỉnh tóc/áo, vẫy tay tự nhiên, chuyển tiếp giữa hai ký hiệu, cử chỉ chưa có nhãn và lỗi tracking. Không dùng toàn bộ chúng như cùng một lớp ngữ nghĩa.
7. Xem lại video ngay sau thu, sửa nhãn và đánh dấu chất lượng trước khi đưa vào train. Một người chú giải mốc/nhãn, người thứ hai rà lại một phần hoặc toàn bộ các cặp dễ nhầm là lựa chọn tốt khi nhóm đủ nguồn lực.

Lưu ba trạng thái khác nhau: `no_sign` là không có ký hiệu mục tiêu đang được thực hiện; `unknown_sign` là ký hiệu/cử chỉ có ý định nhưng ngoài từ vựng của mô hình; `invalid_tracking` là quan sát không đủ. Nếu dùng CTC trong tương lai, token blank là ký hiệu kỹ thuật của bộ giải mã, không mặc nhiên là nhãn ngữ nghĩa “không” hoặc toàn bộ hành vi nghỉ.

## Chia dữ liệu để tránh rò rỉ

**Khuyến nghị thực thi:** chia theo nhóm trước khi cắt cửa sổ hoặc tăng cường; lưu một manifest cố định cho từng lần thử. Bài Multi-VSL và giao thức AUTSL nêu trên là ví dụ tách người ký thực tế. Không có một tỉ lệ train/test duy nhất phù hợp với mọi dự án.

| Câu hỏi cần đo | Cách tách đề xuất | Điều không được suy ra |
| --- | --- | --- |
| Mô hình cá nhân dùng lại ngày sau được không? | Cùng người, nhưng buổi quay mới; train/validation/test tách `sessionId`. | Không gọi đây là nhận diện người ký mới. |
| Người chưa góp mẫu dùng được không? | `signerId` hoàn toàn tách giữa train, validation và test; mọi lớp cần kiểm tra phải có trong các tập tương ứng. | Không dùng chia clip ngẫu nhiên để đưa ra kết luận này. |
| Đổi camera/góc/nền có ổn không? | Giữ một thiết bị hoặc điều kiện camera ngoài train, báo cáo thành thử nghiệm riêng. | Không nhầm đổi máy với đổi người nếu hai biến bị trộn hoàn toàn. |
| Nhiều góc có giúp webcam chính diện không? | Cùng lần ký, mọi góc ở cùng partition; báo cáo riêng test chỉ một camera. | Không đưa góc trái vào train và góc trước cùng lần ký vào test. |

Không cho các cửa sổ chồng lấn của một video nằm ở hai tập. Không fit chuẩn hóa, chọn trọng số đặc trưng, chỉnh ngưỡng từ chối hoặc chọn mô hình bằng test. Chỉ fit trên train, chọn bằng validation, mở test cho báo cáo cuối. Nếu một lớp chỉ có một video nguồn, không thể chứng minh tổng quát hóa lớp đó bằng cách chia các bản tăng cường của chính video ấy sang test.

Mỗi báo cáo cần có số người, buổi, video nguồn, lần thực hiện, lớp được hỗ trợ và clip từng tập; số lớp phải loại vì thiếu phủ tập; phiên bản nhãn/landmark; và danh sách nhóm không trùng. Chạy kiểm tra giao rỗng cho `signerId` ở chế độ người mới, `sessionId` ở chế độ buổi mới, và `sourceCaptureId` ở mọi chế độ.

## Chỉ số đánh giá và độ trễ

Các chỉ số dưới đây là **đề xuất cho Nối**. Chưa có kết quả thực nghiệm của ứng dụng trong tài liệu này.

| Chỉ số | Định nghĩa và cách báo cáo |
| --- | --- |
| Top-1, macro-F1, recall từng lớp | Báo cáo trên clip test có nhãn; kèm số mẫu từng lớp và ma trận nhầm lẫn. Top-5 chỉ là thông tin hỗ trợ nếu sản phẩm hiển thị một từ. |
| Đúng khi chấp nhận và tỷ lệ chấp nhận | `correct accepted / all accepted`, đi kèm `all accepted / all eligible events`. Mô hình không thể đạt chất lượng hữu ích chỉ bằng từ chối tất cả. |
| Nhận nhầm ngoài từ vựng | `unknown events accepted as known / unknown events`, có mẫu số và bộ unknown dùng thực tế. Không gọi score khoảng cách hoặc softmax là xác suất đúng đã được hiệu chỉnh. |
| Tự chèn từ khi nghỉ | Số nhãn đã commit sai trên mỗi phút video nghỉ/động tác nền; tách no-hand, hands-visible và hoạt động đời thường. |
| Nhầm cặp hướng | Ma trận nhỏ cho từng cặp cùng hình tay khác hướng; giữ riêng trường hợp xoay nhỏ trong cùng lớp và xoay làm đổi lớp. |
| Bỏ sót và chèn/lặp từ | Đánh giá theo sự kiện ký hiệu trong video liên tục; đếm một commit cho một sự kiện, không đếm hàng chục frame đúng thành hàng chục từ đúng. |
| Chất lượng chuỗi | Khi có chú giải chuỗi gloss, báo cáo lỗi thay thế/xóa/chèn và WER của chuỗi gloss; không gọi WER gloss là chất lượng dịch câu tiếng Việt. |
| Độ trễ nhìn thấy kết quả | `t_visibleCommit − t_annotatedOnset`, và thêm `t_visibleCommit − t_annotatedEnd`. Báo cáo p50/p95, số sự kiện và số lần không commit; không bỏ qua thất bại. |
| Thời gian xử lý | Đo riêng capture, landmark, phân loại, ổn định kết quả và vẽ UI. Ghi thiết bị, trình duyệt, FPS và cấu hình. Thời gian một lần suy luận không đại diện độ trễ từ lúc bắt đầu ký. |

Mốc khởi đầu/kết thúc phải có quy tắc chú giải cố định. BSL Corpus mô tả việc thay đổi hướng/chuyển động/hình tay giữa các ký hiệu và lưu ý giữ tay không luôn có nghĩa đang ký. Đây là lý do nên có mốc do người xem video xác nhận thay vì lấy “có bàn tay” làm đồng nghĩa với “có từ”. [Hướng dẫn BSL Corpus](https://bslcorpusproject.org/wp-content/uploads/BSLCorpus_AnnotationConventions_v3.0_-March2017.pdf)

Ngưỡng chấp nhận, khoảng cách giữa hai ứng viên, thời gian giữ ổn định và thời gian chờ ký hiệu mới phải được chọn cùng nhau trên validation. Đo đổi chác giữa bỏ sót, nhận nhầm và độ trễ. Không hứa “nhanh hơn 2×” nếu chưa có cùng tác vụ, cùng phần cứng, cùng đầu vào và cùng định nghĩa độ trễ để so sánh.

## Các mốc thử nghiệm có thể thực hiện

Đây là **ngân sách và ngưỡng sản phẩm đề xuất**, không phải yêu cầu học thuật đã được chứng minh. Có thể tăng/giảm sau pilot; số mẫu đủ hay chưa được quyết định bằng test chưa dùng để chỉnh mô hình.

| Mốc | Phạm vi và ngân sách khởi đầu | Điều kiện chuyển bước đề xuất |
| --- | --- | --- |
| A — thử cá nhân | 8 nhãn, có ít nhất 3 cặp khác hướng; 1 người, 4 buổi, 10 lần/nhãn/buổi: 320 video nguồn. Hai buổi train, một validation, một test. Thêm 20 phút hành vi nghỉ/ngoài nhãn, chia theo buổi. | Đúng trên các clip nguồn chưa dùng train; báo cáo recall mỗi nhãn, nhầm hướng và tự chèn từ. Có thể đặt mục tiêu nội bộ macro-F1 ≥0,85 và ≤1 commit sai/phút, nhưng chưa đạt thì không tự hạ chuẩn bằng cách bỏ test khó. |
| B — người mới | Ví dụ 24 nhãn ×8 người ×2 buổi ×6 lần =2.304 video nguồn; chia người 5/1/2. Cố gắng thu mỗi nhãn ở mọi người. | Giữ test người mới và kiểm tra từng cặp hướng. Hai người test vẫn là pilot, không đại diện mọi người hoặc mọi vùng. Chọn mục tiêu chính xác/chấp nhận/độ trễ trước khi mở test. |
| C — mở rộng có kiểm soát | Thêm từng nhóm 20–50 nghĩa có ký hiệu đã xác nhận. Theo dõi lớp có mẫu, đủ train, đủ validation, đủ test và đã vượt tiêu chí riêng. | Chỉ công bố số lớp đã được kiểm tra; giữ các nghĩa chưa có dữ liệu ở trạng thái chưa thu/chưa huấn luyện. Trước hỗ trợ hội thoại, đánh giá thêm chuỗi và chuyển tiếp tự nhiên. |

Ba mẫu cho một nhãn có thể là ngưỡng giao diện để bắt đầu thử một bộ đối chiếu cá nhân; đó không phải bằng chứng đủ dữ liệu để huấn luyện hoặc đánh giá một mô hình nhận diện ngôn ngữ. Học ít mẫu có thể dùng mô hình đã được học biểu diễn và thích nghi; vẫn cần tách mẫu thích nghi với mẫu kiểm thử. Không nhân 1 video thành 100 biến thể rồi gọi đó là 100 lần thu độc lập.

## Lưu trữ video và landmark

**Thiết kế đề xuất, chưa mặc nhiên là định dạng được ứng dụng hiện tại hỗ trợ:** giữ video gốc và dữ liệu mốc tay cạnh nhau, liên kết bằng ID và checksum. Video giúp sửa nhãn, xem lỗi mất tracking và trích lại landmark khi đổi mô hình. Landmark không thay thế hoàn toàn bằng chứng hình ảnh. JSON không tự mang được `Blob`; xuất JSON chỉ chứa metadata/landmark thì phải nói rõ video không đi kèm.

```text
export/
  manifest.json
  vocabulary.json
  splits/personal-session-v1.json
  samples/<sampleId>.json
  videos/<sampleId>.webm
```

Manifest mẫu tối thiểu cho phiên bản dữ liệu tiếp theo:

```json
{
  "datasetSchema": 2,
  "sampleId": "capture-uuid",
  "sourceCaptureId": "original-capture-uuid",
  "conceptId": "NOI0001",
  "signId": "custom-noi-sign-001",
  "labelKind": "custom_noi_gesture",
  "vocabularyVersion": "semantic-inventory-3",
  "annotationVersion": "pilot-1",
  "signerId": "local-pseudonym-01",
  "sessionId": "session-uuid",
  "cameraId": "local-camera-01",
  "dominantHand": "right",
  "regionOrCommunity": "unknown",
  "capture": {"width": 1280, "height": 720, "nominalFps": 30, "previewMirrored": true, "storedPixelsMirrored": false},
  "video": {"path": "videos/capture-uuid.webm", "mimeType": "video/webm", "sha256": "computed-on-export"},
  "landmarks": {"path": "samples/capture-uuid.json", "extractor": "hand-landmarker", "extractorVersion": "record-actual-version", "coordinateConvention": "record-explicitly"},
  "annotation": {"signStartMs": 600, "signEndMs": 1800, "reviewStatus": "unreviewed"},
  "consent": {"localTraining": true, "externalSharing": false, "noticeVersion": "local-pilot-1"},
  "split": "unassigned"
}
```

Các giá trị trên là ví dụ, không phải số đo thật. Trong landmark lưu timestamp tăng đơn điệu, handedness/độ tin cậy, dữ liệu thiếu dưới dạng mask, tọa độ gốc và tọa độ đã chuẩn hóa, phiên bản phép trích đặc trưng. Ghi rõ quaternion dùng thứ tự nào và hệ trục nào. Không biến mất tay thành tọa độ 0 mà không có mask. Với hai tay, giữ khoảng cách và chuyển động tương đối giữa hai cổ tay; chuẩn hóa từng tay độc lập có thể xóa tín hiệu đó.

Theo dõi quyền sử dụng ngay trong quy trình sản phẩm: giải thích mục đích trước khi quay; cho xem, xóa và xuất dữ liệu; phân biệt lưu cục bộ, dùng huấn luyện và chia sẻ ra ngoài; mặc định không chia sẻ. Gắn phiên bản thông báo và định danh giả theo người/buổi, tránh thu tên thật nếu không cần. Khi người dùng yêu cầu xóa, xác định video, landmark, mẫu tăng cường và các bản xuất liên quan; bản mô hình đã phát hành có thể cần huấn luyện lại để loại ảnh hưởng, không nên hứa xóa một hàng sẽ tự xóa mọi ảnh hưởng trong trọng số. Đây là khuyến nghị thiết kế dữ liệu, không phải kết luận tuân thủ pháp luật.

Truy cập camera của trình duyệt không thay thế đồng ý dùng dữ liệu để huấn luyện hoặc chia sẻ. Đồng thời, không tự tuyên bố “landmark vô danh” hay “làm mờ mặt là ẩn danh hoàn toàn”. VSL400 là ví dụ nguồn gốc phân biệt metadata công khai với video truy cập có điều kiện; Nối nên ghi rõ phạm vi dữ liệu được xuất/chia sẻ theo từng mẫu. [VSL400](https://www.nature.com/articles/s41597-026-08040-2)

## Phạm vi tìm kiếm và điều chưa xác minh

Đã tìm bằng Exa theo năm hướng: dữ liệu gốc WLASL/AUTSL/How2Sign; dữ liệu và cộng đồng tiếng Việt; giao thức tách người/unknown/video liên tục; gloss và hướng tay; truy vấn bổ sung tập trung vào bộ dữ liệu tiếng Việt. Không đặt giới hạn năm vì cần cả nghiên cứu nền tảng lẫn bản phát hành hiện có đến 2026-11-05. Đã dùng SciSpace để tìm dữ liệu tiếng Việt và đọc đầy đủ bản ghi VSL400 cùng một bản ghi nghiên cứu VSL lưu trên repository; số liệu quan trọng trong bảng được đối chiếu với tài liệu gốc.

Ưu tiên bài gốc, hướng dẫn do nhóm corpus viết, trang dataset của tác giả và bản phát hành có phiên bản. Không lấy các tập tổng hợp Kaggle, bài hướng dẫn hoặc chỉ mục tìm kiếm làm bằng chứng độc lập. Không dùng bản ghi repository có tuyên bố “không rò rỉ” như bảo đảm khi chưa kiểm tra được tệp chia tập, đặc biệt với lớp chỉ có một video nguồn. Không tải toàn bộ video, chạy lại benchmark hoặc kiểm toán giấy phép từng tệp trong đợt này. Không thẩm định tính đúng ngôn ngữ của 775 ký hiệu vì danh mục mới là các nghĩa và chưa có 775 ký hiệu/video tương ứng.

Năm lệnh `web_search_exa`, mỗi lệnh yêu cầu 10 kết quả: **50 kết quả tìm kiếm được yêu cầu**, không phải 50 bài báo đã đọc, 50 nguồn độc lập hoặc một systematic review đầy đủ. Đây là phạm vi rà soát có mục tiêu cho quyết định xây sản phẩm.
