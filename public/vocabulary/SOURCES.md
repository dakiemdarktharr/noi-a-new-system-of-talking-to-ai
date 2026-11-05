# Nguồn và giới hạn danh mục Nối 6.000 mục

Giữ nguyên 775 mã/nhãn cũ; thêm 420 cụm từ biên soạn cho giao tiếp và yêu cầu AI, cùng 4.805 mục từ từ nguồn từ điển. Không tạo tích Descartes, gắn số hoặc thay một từ hàng nghìn lần để đủ số lượng.

## Nguồn từ điển

- Repository: https://github.com/vntk/dictionary
- Tệp JSON cố định: https://raw.githubusercontent.com/vntk/dictionary/2408c9d2c7e6908d166a773b60fd216492326d97/data/dictionary.json
- Revision: `2408c9d2c7e6908d166a773b60fd216492326d97`
- SHA-256: `fb41663096d6a24de8854567e5a4c5aded5bf39ce7bc2172d3cd0211c360c763`
- Giấy phép repository công bố: [MIT](https://github.com/vntk/dictionary/blob/2408c9d2c7e6908d166a773b60fd216492326d97/LICENSE). Chỉ lấy `data/dictionary.json`; không dùng các wordlist Viet11K/Viet22K/Viet39K/Viet74K.

Chọn mục từ 1–4 âm tiết, viết thường, có định nghĩa; ưu tiên theo số lần xuất hiện trong chính định nghĩa/ví dụ của nguồn. Đây là heuristic bao phủ, không phải bảng tần suất sử dụng thực tế. Ưu tiên nghĩa có ví dụ sử dụng, tránh chọn nghĩa miệt thị cũ làm nghĩa mặc định cho từ đồng hình thông thường. Mỗi mục có `provenance` ghi headword và chỉ số nghĩa.

## Phần biên soạn

420 cụm từ được viết riêng trong `scripts/vocabulary-source/curated.json`, gồm sinh hoạt, ăn uống/mua sắm, tiếp cận giao tiếp, học tập/công việc và bốn nhóm yêu cầu AI. Mỗi cụm được ghi là phrase; không khẳng định một câu yêu cầu tương đương một ký hiệu đơn.

## Giới hạn

Đây là danh mục nghĩa đề xuất, chưa phải 6.000 ký hiệu, lớp đã huấn luyện hoặc ngôn ngữ hoàn chỉnh. Các mục từ có thể có nghĩa khác chưa chọn; nhãn hiển thị duy nhất không chứng minh 6.000 khái niệm ngôn ngữ khác nhau vì còn từ đồng nghĩa và biến thể chính tả. Vẫn cần người dùng/chuyên gia ngôn ngữ ký hiệu kiểm tra ký hiệu, vùng miền, khả năng phân biệt và ngữ cảnh. Đã kiểm tra giấy phép MIT trong repository; chưa kiểm toán lịch sử nguồn gốc độc lập của từng định nghĩa. Một phần mục từ mang tính chuyên môn/lịch sử, không phải toàn bộ đều có tần suất giao tiếp cao.

## Thông báo bản quyền nguồn

MIT License

Copyright (c) 2017 Vietnamese Natural Language Processing (VNTK)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
