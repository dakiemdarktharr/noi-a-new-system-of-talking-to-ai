"""Authored semantic inventory; these are NOT trained sign-language classes."""
import json,csv,unicodedata,re,hashlib
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
core_baseline=json.loads((ROOT/'scripts/vocabulary-source/core-775.json').read_text(encoding='utf8'))
assert len(core_baseline)==775
old={'entries':[dict(e,layer='core',id=e.get('previousId')) for e in core_baseline[:140]]}
# Published IDs are labels in saved recordings. Reuse them even when source
# groups are reordered or a new meaning is added earlier in the source below.
inventory_path=ROOT/'src/data/vocabulary.json'
previous=json.loads(inventory_path.read_text(encoding='utf8'))['entries'] if inventory_path.exists() else []
stable_ids={e['label']:e['id'] for e in core_baseline}
stable_ids.update({e['label']:e['id'] for e in previous})
next_id=max(int(label_id[3:]) for label_id in stable_ids.values())+1
ADDITIONS={
'Người và quan hệ':'mình|chúng tôi|chúng ta cùng nhau|anh|chị|em|ông|bà|vợ|chồng|cha mẹ|anh chị em|người yêu|đồng nghiệp|hàng xóm|khách|chủ nhà|trẻ em|người lớn|người lạ|thầy cô|bác sĩ|nhân viên|người phiên dịch|người Điếc|người nghe|người không nói được',
'Bản thân và thông tin':'tên|tuổi|địa chỉ|số điện thoại|ngày sinh|quê quán|quốc tịch|nghề nghiệp|sở thích|thói quen|kinh nghiệm|khả năng|giới thiệu|liên hệ|riêng tư|bí mật',
'Nhu cầu và ý định':'nhờ|xin phép|cho phép|không cho phép|hứa|quyết định|dự định|hy vọng|lo ngại|ưu tiên|chấp nhận|phản đối|yêu cầu|mời|khuyên|cảnh báo|nhắc|đề xuất|thử|cố gắng',
'Hiểu và suy nghĩ':'nghĩ|nhớ|quên|đoán|chắc chắn|chưa chắc|tin|nghi ngờ|nhận ra|tập trung|chú ý|tưởng tượng|hiểu nhầm|không biết|không hiểu|ý tưởng|ý nghĩa|lý do|kết quả|mục đích',
'Hỏi và làm rõ':'của ai|với ai|từ đâu|đi đâu|bao lâu|mấy giờ|bao xa|bao giờ xong|ý bạn là gì|xin nói rõ|xin cho ví dụ|bạn hiểu không|tôi hiểu rồi|tôi chưa hiểu|xin nhắc lại|xin đánh vần|tên riêng|từ mới|đến lượt bạn|đến lượt tôi',
'Thời gian mở rộng':'ngày|tuần|tháng|năm|giờ|phút|giây|hôm kia|ngày kia|tuần này|tuần sau|tuần trước|cuối tuần|buổi đêm|sớm|muộn|đúng giờ|trễ|lúc nãy|lát nữa|vừa mới|sắp|ngay lập tức|tạm thời|lâu dài|thường xuyên|đôi khi|hiếm khi|luôn luôn|không bao giờ',
'Vị trí và phương hướng':'bên trái|bên phải|phía trước|phía sau|ở giữa|bên cạnh|đối diện|xung quanh|bên trong|bên ngoài|bên trên|bên dưới|hướng lên|hướng xuống|hướng vào|hướng ra|thẳng|quay lại|góc|chỗ|vị trí|khoảng cách|đường|ngã rẽ',
'Di chuyển và đi lại':'đứng|ngồi|nằm|chạy|đi bộ|lên|xuống|ra|vào|rời đi|trở lại|dừng lại|đón|tiễn|chở|đi cùng|đi trước|theo sau|xe máy|ô tô|xe buýt|tàu|máy bay|vé|bến xe|sân bay|kẹt xe|bản đồ',
'Ăn uống':'cơm|bánh|rau|thịt|cá|trứng|sữa|trái cây|trà|cà phê|đường ăn|muối|bữa ăn|ăn sáng|ăn trưa|ăn tối|nấu|rửa|cắt|trộn|đun|chiên|luộc|ngon|no|cay|ngọt|chua|mặn|dị ứng thức ăn',
'Nhà và đồ dùng':'phòng|bếp|phòng ngủ|phòng khách|cửa|cửa sổ|bàn|ghế|giường|đèn|quạt|máy lạnh|tủ lạnh|khóa|chìa khóa|quần áo|giày|túi|cốc|bát|đĩa|đũa|thìa|giấy|bút|sách|ổ điện|sạc|pin|đồ dùng',
'Việc nhà và chăm sóc':'dọn|lau|quét|giặt|phơi|gấp|cất|sắp xếp|đổ rác|vứt|sửa chữa|bật điện|tắt điện|tắm|rửa tay|đánh răng|thay đồ|chăm sóc|trông trẻ|nghỉ ngơi',
'Mua bán và dịch vụ':'mua|bán|giá|trả tiền|tiền mặt|chuyển khoản|hóa đơn|giảm giá|đắt|rẻ|đủ tiền|thiếu tiền|đặt hàng|giao hàng|nhận hàng|đổi hàng|trả hàng|còn hàng|hết hàng|kích cỡ|màu sắc|số lượng|chất lượng|bảo hành',
'Cơ thể và sức khỏe':'đầu|mặt|mắt|tai|miệng|răng|cổ|vai|cánh tay|bàn tay|ngón tay|cổ tay|ngực|bụng|lưng|chân|bàn chân|ốm|sốt|ho|chóng mặt|buồn nôn|khó thở|bị thương|chảy máu|đau đầu|đau bụng|dị ứng|khám bệnh|uống thuốc',
'An toàn và hỗ trợ':'cứu|cấp cứu|nguy hiểm|an toàn|cháy|tai nạn|mất đồ|lạc đường|bị đe dọa|gọi giúp|gọi cấp cứu|gọi người thân|đừng chạm|đừng đi|tránh|cẩn thận|bảo vệ|công an|lối thoát|số khẩn cấp',
'Cảm xúc và quan hệ':'sợ|lo|giận|bình tĩnh|xấu hổ|ngạc nhiên|cô đơn|thất vọng|hài lòng|tự hào|yêu|ghét|thương|quan tâm|tôn trọng|tin tưởng|an ủi|chúc mừng|tha thứ|làm quen',
'Đặc điểm và cảm nhận':'đẹp|xấu về hình thức|sạch|bẩn|mới|cũ|dễ|khó|nặng|nhẹ|cao|thấp|rộng|hẹp|dày|mỏng|cứng|mềm|ướt|khô|sáng rõ|tối mờ|ồn|yên tĩnh|đầy|rỗng|hỏng|bình thường|quan trọng|cần thiết',
'Lượng và mức độ':'một|hai|ba|bốn|năm (số 5)|sáu|bảy|tám|chín|mười|không có gì|mỗi|bất kỳ|cả hai|một nửa|gấp đôi|đủ|thiếu|thừa|rất|hơi|quá mức|gần như|chính xác|khoảng|ít nhất|nhiều nhất|bằng nhau|không bằng|giới hạn',
'Nối ý và cấu trúc':'về việc|đối với|bằng cách|theo|từ|đến thời điểm|cho đến khi|trong khi|sau khi|trước khi|mặc dù|tuy nhiên|vì vậy|để|chỉ|ngoại trừ|bao gồm|thay vì|đồng thời|lần lượt|đầu tiên|tiếp theo|cuối cùng|ví dụ|ngược lại|dù thế nào',
'Học tập':'bài học|bài tập|câu hỏi|câu trả lời|thi|điểm|lớp học|giáo viên|học sinh|sinh viên|trường đại học|kiến thức|kỹ năng|luyện tập|giải thích|hướng dẫn|ghi chú|tra cứu|ôn lại|tiến bộ',
'Công việc':'việc|công ty|văn phòng|nhóm|dự án|nhiệm vụ|kế hoạch|lịch hẹn|cuộc họp|báo cáo|thời hạn|nghỉ phép|lương|hợp đồng|phân công|hợp tác|hoàn thành|tiến độ|vấn đề|giải pháp',
'Thiết bị và giao tiếp số':'máy tính|bàn phím|chuột máy tính|màn hình|camera|tai nghe|mạng|internet|wifi|mật khẩu|tài khoản|đăng nhập|đăng xuất|tin nhắn|email|cuộc gọi|gọi video|ảnh|âm thanh|video|tệp|thư mục|liên kết|trang web|ứng dụng',
'Thao tác thông tin':'tạo|tìm|gửi|nhận|lưu|xóa|sao chép|dán|di chuyển mục|đổi tên|tải xuống|tải lên|chia sẻ|đính kèm|chọn tất cả|bỏ chọn|hoàn tác|làm lại|phóng to|thu nhỏ|cuộn lên|cuộn xuống|tiếp tục|hủy|xác nhận',
'AI và soạn nội dung':'AI (trí tuệ nhân tạo)|prompt|nội dung|văn bản|tóm tắt|dịch|so sánh|kiểm tra|giữ nguyên|thay thế|liệt kê|phân loại|phân tích|đánh giá|định dạng|tiêu đề|đoạn văn|câu|từ (đơn vị ngôn ngữ)|bảng|danh sách|nguồn|trích dẫn|dữ liệu|đầu vào|đầu ra|ngữ cảnh|ràng buộc|giọng văn|đối tượng đọc',
'AI và kiểm soát yêu cầu':'chỉ làm việc này|không tự suy đoán|hỏi trước|chờ xác nhận|nêu giả định|nêu điều chưa biết|giải thích lý do|kiểm chứng|giữ cấu trúc|giữ ý chính|bổ sung chi tiết|rút gọn|viết lại|tiếp tục phần trước|quay lại bản trước|đưa phương án khác|chọn phương án|ưu tiên độ chính xác|ưu tiên tốc độ|không gửi ra ngoài',
'Lập trình và công cụ':'mã nguồn|hàm|biến|tệp mã|giao diện|nút bấm|biểu mẫu|trang|thành phần|API|cơ sở dữ liệu|máy chủ|trình duyệt|lỗi|sửa lỗi|chạy thử|kiểm thử|kết quả kiểm thử|cài đặt|thư viện phần mềm|phiên bản|triển khai|bản nháp|bản chính|nhánh mã|thay đổi|đọc mã|viết mã|tối ưu|bảo mật',
'Điều khiển hội thoại':'hết câu|câu mới|lặp lại|chậm lại|sửa ý vừa nói|hủy ý vừa nói|đánh vần / tên riêng|trích nguyên văn|kết thúc trích dẫn|tạm dừng hội thoại'
}
entries=[];seen=set();repeated_labels=[]
def add(label,group,level,old_id=None):
 global next_id
 key=unicodedata.normalize('NFC',label).casefold().strip()
 if key in seen:
  repeated_labels.append({'label':label,'group':group});return
 label_id=stable_ids.get(label)
 if label_id is None:
  label_id=f'NOI{next_id:04}';next_id+=1
 seen.add(key);entries.append({'id':label_id,'label':label,'group':group,'level':level,'aliases':[],
 'definition':label,'status':'Chưa thiết kế ký hiệu','previousId':old_id})
for entry in old['entries']:
 if entry['layer']=='core':add(entry['label'],entry['group'],1,entry['id'])
for group,words in ADDITIONS.items():
 for label in words.split('|'):add(label,group,3 if group.startswith(('AI','Lập trình')) else 2)
for i in range(10):add(str(i),'Chữ số',1)
# New meanings appear at the end, leaving all published IDs and ordering stable.
entries.sort(key=lambda e:int(e['id'][3:]))
aliases={'bố':['ba','cha'],'mẹ':['má','mạ'],'cốc':['ly'],'thìa':['muỗng'],'ngô':['bắp'],'máy lạnh':['điều hòa'],'ô tô':['xe hơi'],'nhà vệ sinh':['toilet','WC']}
aliases.update({'AI (trí tuệ nhân tạo)':['AI','trí tuệ nhân tạo'],'từ (đơn vị ngôn ngữ)':['từ'],'năm (số 5)':['năm']})
definitions={'có':'Tồn tại hoặc sở hữu; tách khỏi xác nhận đúng và đồng ý.','không':'Phủ định nội dung; cần đánh dấu phạm vi phủ định.','chưa':'Sự việc chưa xảy ra tính đến thời điểm nói.','hết':'Không còn một lượng hoặc trạng thái trước đó.','đúng':'Thông tin hoặc kết quả đúng.','đồng ý':'Chấp thuận một đề nghị; không đồng nghĩa thông tin đúng.','con':'Quan hệ con với cha mẹ; không dùng làm loại từ động vật.','trước':'Thứ tự thời gian; vị trí dùng phía trước.','sau':'Thứ tự thời gian; vị trí dùng phía sau.','hỏi':'Hành động đặt câu hỏi.','có…không?':'Ý định hỏi có/không. Đề xuất của giao thức Nối là một ký hiệu tay riêng; chưa được thiết kế hoặc xác nhận. Đây không phải mô tả ngữ pháp hay vai trò nét mặt trong ngôn ngữ ký hiệu Việt Nam.','nên':'Kết quả/suy ra trong vì…nên; lời khuyên dùng khuyên.','lại':'Lặp một hành động; khác với hoàn tác hoặc sửa câu.','xấu':'Đánh giá không tốt; hình thức dùng xấu về hình thức.','người không nói được':'Người không thể phát lời nói bằng giọng ở tình huống được đề cập; không suy ra khả năng nghe hoặc khả năng dùng ngôn ngữ ký hiệu.'}
definitions.update({
 'ai':'Hỏi danh tính một người; không phải AI (trí tuệ nhân tạo).',
 'AI (trí tuệ nhân tạo)':'Lĩnh vực hoặc hệ thống trí tuệ nhân tạo; không phải đại từ nghi vấn ai.',
 'từ':'Chỉ nguồn gốc hoặc điểm bắt đầu trong từ…đến; đơn vị ngôn ngữ có mục riêng.',
 'từ (đơn vị ngôn ngữ)':'Một đơn vị từ vựng trong ngôn ngữ; không phải từ chỉ nguồn gốc.',
 'năm':'Đơn vị thời gian năm hoặc năm lịch; số lượng 5 có mục riêng.',
 'năm (số 5)':'Số lượng bằng 5; không phải năm lịch. Chữ số 5 là cách viết liên quan, chưa khẳng định dùng ký hiệu khác.',
 'bạn':'Người đang được nói chuyện trực tiếp; quan hệ bạn bè có mục riêng.',
 'mình':'Cách người nói tự chỉ bản thân; nghĩa người đối thoại hoặc cơ thể chưa thuộc mục này.',
 'chúng ta':'Nhóm gồm người nói và người đang được nói chuyện trực tiếp.',
 'chúng tôi':'Nhóm có người nói và không gồm người đang được nói chuyện trực tiếp.',
 'cho':'Quan hệ hướng tới người nhận hoặc người hưởng lợi; cho phép có mục riêng.',
 'gấp':'Gập một vật, ví dụ gấp quần áo; không phải khẩn cấp hoặc phép nhân gấp đôi.',
 'khóa':'Vật dùng để khóa cửa hoặc đồ chứa; chưa gồm khóa học hay hành động khóa tài khoản.',
 'sạc':'Thiết bị dùng để nạp điện cho pin; hành động nạp điện cần được xác định riêng khi thu mẫu.',
 'đường':'Đường đi hoặc tuyến đường; chất tạo vị ngọt dùng mục đường ăn.',
 'đường ăn':'Chất tạo vị ngọt dùng trong thực phẩm; không phải đường đi.',
 'ở':'Lưu trú hoặc hiện diện tại một nơi; nghĩa quan hệ vị trí cần ngữ cảnh khi thu mẫu.',
 'làm':'Thực hiện một hoạt động hoặc công việc; cần ghi rõ hoạt động trong câu thu mẫu.',
 'mở':'Chuyển vật từ trạng thái đóng sang mở; mở ứng dụng và bật điện cần mô tả riêng.',
 'đóng':'Chuyển vật đang mở về trạng thái khép; không phải đóng tiền hoặc đóng vai.',
 'tin':'Cho rằng thông tin là đúng; bản tin hoặc tin nhắn không thuộc nghĩa này.',
 'chỉ':'Giới hạn phạm vi với nghĩa chỉ có/chỉ làm; không phải ngón tay chỉ hướng.',
 'về':'Di chuyển trở lại nơi gắn với người nói; chủ đề dùng mục về việc.',
 'sáng':'Buổi sáng trong ngày; độ sáng dùng mục sáng rõ.',
 'tối':'Buổi tối trong ngày; độ tối dùng mục tối mờ.',
})
for e in entries:e['aliases']=aliases.get(e['label'],[]);e['definition']=definitions.get(e['label'],e['definition'])

# Expand with authored practical phrases, followed by dictionary headwords.
# The lexicon file is pinned and offline; no runtime download is required.
source_dir=ROOT/'scripts/vocabulary-source'
source_meta=json.loads((source_dir/'source.json').read_text(encoding='utf8'))
source_meta['id']='vntk-dictionary'
source_meta['licenseText']=(ROOT/'public/vocabulary/VNTK-LICENSE.txt').read_text(encoding='utf8')
source_bytes=(source_dir/'vntk-dictionary.json').read_bytes()
assert hashlib.sha256(source_bytes).hexdigest()==source_meta['sha256'], 'Lexicon checksum mismatch'
lexicon=json.loads(source_bytes)
curated=json.loads((source_dir/'curated.json').read_text(encoding='utf8'))
def append_proposal(label,group,definition,origin,kind='lexical'):
 before=len(entries)
 add(label,group,3 if group.startswith('AI ') else 2)
 if len(entries)>before:
  entries[-1].update(definition=definition,provenance=origin,entryKind=kind)
for group,phrases in curated.items():
 for phrase in phrases.split('|'):
  append_proposal(phrase,group,phrase,{'type':'authored','source':'noi-curated-2026-11-06'},'phrase')

def clean(value):return unicodedata.normalize('NFC',value).casefold().strip()
eligible={}
for word,senses in lexicon.items():
 label=unicodedata.normalize('NFC',word).strip()
 if label!=label.lower() or not re.fullmatch(r'[^\W\d_]+(?: [^\W\d_]+){0,3}',label,re.UNICODE):continue
 if clean(label) in seen or label in {'địt','đéo','đĩ','đụ','đéo mẹ','địt mẹ'}:continue
 usable=[s for s in senses if len(s.get('definition',''))>=15 and not re.search(r'^(như |xem |x\.)|\b(từ cũ|ít dùng|tục ngữ cổ|từ cổ|chửi tục)\b',s.get('definition',''),re.I)]
 if usable:eligible[clean(label)]=(label,usable)
# Rank by actual occurrences in definitions/examples, not alphabetic order.
# This is a lexicon-internal relevance heuristic, not a population frequency claim.
counts=Counter()
for senses in lexicon.values():
 for sense in senses:
  tokens=re.findall(r'[^\W\d_]+',clean(sense.get('definition','')+' '+sense.get('example','')),re.UNICODE)
  for n in range(1,5):
   for i in range(len(tokens)-n+1):
    phrase=' '.join(tokens[i:i+n])
    if phrase in eligible:counts[phrase]+=1
ranked=sorted(eligible,key=lambda k:(-counts[k],len(k.split()),k))
pos_groups={'N':'Danh từ mở rộng','V':'Hành động và trạng thái mở rộng','A':'Tính chất và cảm nhận mở rộng','P':'Đại từ và từ quan hệ mở rộng','R':'Mức độ và cách thức mở rộng','C':'Quan hệ và liên kết mở rộng','E':'Quan hệ và liên kết mở rộng','I':'Biểu đạt cảm xúc mở rộng','M':'Số lượng mở rộng','T':'Biểu đạt giao tiếp mở rộng'}
for key in ranked:
 if len(entries)>=6000:break
 label,senses=eligible[key]
 # Prefer a sense with a concrete usage example; avoid an obsolete slur being
 # selected as the default for an ordinary homograph such as "mọi".
 modern=[s for s in senses if not re.search(r'khinh miệt|kì thị|kỳ thị|thời xưa|thời phong kiến',s['definition'],re.I)]
 choices=modern or senses
 sense=next((s for s in choices if s.get('example','').strip()),choices[0])
 append_proposal(label,pos_groups.get(sense.get('pos'),'Từ vựng phổ thông mở rộng'),sense['definition'],{'type':'lexicon','source':'vntk-dictionary','headword':label,'senseIndex':lexicon[label].index(sense)})
assert len(entries)==6000, f'Expected 6000 meanings; got {len(entries)}'
entries.sort(key=lambda e:int(e['id'][3:]))
current_ids={e['label']:e['id'] for e in entries}
baseline_ids={e['label']:e['id'] for e in core_baseline}
assert all(current_ids.get(label)==label_id for label,label_id in baseline_ids.items()), 'Original 775 IDs changed'
assert entries[:775]==core_baseline, 'Original 775 entries changed'
changed_ids=[{'label':e['label'],'before':e['id'],'after':current_ids.get(e['label'])} for e in previous if current_ids.get(e['label'])!=e['id']]
assert not changed_ids, f'Published vocabulary IDs changed: {changed_ids}'
assert len({e['id'] for e in entries})==len(entries), 'Duplicate vocabulary IDs'
assert len({unicodedata.normalize('NFC',e['label']).casefold().strip() for e in entries})==len(entries), 'Duplicate visible labels'
data={'name':'Nối','version':'semantic-inventory-6000-v1','date':'2026-11-06','count':len(entries),
 'note':'Danh mục nghĩa đề xuất để thu mẫu. Chưa phải bộ ký hiệu vùng miền, nhãn đã huấn luyện hoặc ngôn ngữ hoàn chỉnh.',
 'sources':[source_meta,{'id':'noi-curated-2026-11-06','type':'authored','description':'Cụm từ giao tiếp và yêu cầu AI được biên soạn riêng, không sinh tích Descartes hoặc gắn số để đủ lượng.'}],
 'entries':entries}
for folder in [ROOT/'src/data',ROOT/'public/vocabulary']:folder.mkdir(parents=True,exist_ok=True)
for p in [ROOT/'src/data/vocabulary.json',ROOT/'public/vocabulary/noi-vocabulary.json']:p.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
with (ROOT/'public/vocabulary/noi-vocabulary.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.writer(f);w.writerow(['id','tu_y_nghia','nhom','lop','cach_goi_khac','dinh_nghia','trang_thai','loai_muc','nguon','giay_phep_nguon','thong_bao_ban_quyen'])
 for e in entries:
  p=e.get('provenance',{});is_lexicon=p.get('type')=='lexicon'
  w.writerow([e['id'],e['label'],e['group'],e['level'],'; '.join(e['aliases']),e['definition'],e['status'],e.get('entryKind','meaning-proposal'),source_meta['url'] if is_lexicon else p.get('source','Nối: 775 mục ban đầu'),'MIT' if is_lexicon else 'Biên soạn riêng',source_meta['licenseText'] if is_lexicon else ''])
lines=[f'# Nối — {len(entries)} mục nghĩa đề xuất','',data['note'],'','Lớp 1: 140 nghĩa ban đầu và số 0–9. Lớp 2: giao tiếp mở rộng. Lớp 3: AI/lập trình. Đây là thứ tự thiết kế, không phải khẳng định tần suất sử dụng.','']
for group in dict.fromkeys(e['group'] for e in entries):
 items=[e['label'] for e in entries if e['group']==group];lines += [f'## {group} ({len(items)})','',', '.join(items)+'.','']
(ROOT/'public/vocabulary/NOI-VOCABULARY.md').write_text('\n'.join(lines),encoding='utf8')
provenance_lines=['# Nguồn và giới hạn danh mục Nối 6.000 mục','',
 'Giữ nguyên 775 mã/nhãn cũ; thêm 420 cụm từ biên soạn cho giao tiếp và yêu cầu AI, cùng 4.805 mục từ từ nguồn từ điển. Không tạo tích Descartes, gắn số hoặc thay một từ hàng nghìn lần để đủ số lượng.','',
 '## Nguồn từ điển','',
 f"- Repository: {source_meta['repository']}",f"- Tệp JSON cố định: {source_meta['url']}",f"- Revision: `{source_meta['revision']}`",f"- SHA-256: `{source_meta['sha256']}`",f"- Giấy phép repository công bố: [MIT]({source_meta['licenseUrl']}). Chỉ lấy `data/dictionary.json`; không dùng các wordlist Viet11K/Viet22K/Viet39K/Viet74K.",'',
 'Chọn mục từ 1–4 âm tiết, viết thường, có định nghĩa; ưu tiên theo số lần xuất hiện trong chính định nghĩa/ví dụ của nguồn. Đây là heuristic bao phủ, không phải bảng tần suất sử dụng thực tế. Ưu tiên nghĩa có ví dụ sử dụng, tránh chọn nghĩa miệt thị cũ làm nghĩa mặc định cho từ đồng hình thông thường. Mỗi mục có `provenance` ghi headword và chỉ số nghĩa.','',
 '## Phần biên soạn','',
 '420 cụm từ được viết riêng trong `scripts/vocabulary-source/curated.json`, gồm sinh hoạt, ăn uống/mua sắm, tiếp cận giao tiếp, học tập/công việc và bốn nhóm yêu cầu AI. Mỗi cụm được ghi là phrase; không khẳng định một câu yêu cầu tương đương một ký hiệu đơn.','',
 '## Giới hạn','',
 'Đây là danh mục nghĩa đề xuất, chưa phải 6.000 ký hiệu, lớp đã huấn luyện hoặc ngôn ngữ hoàn chỉnh. Các mục từ có thể có nghĩa khác chưa chọn; nhãn hiển thị duy nhất không chứng minh 6.000 khái niệm ngôn ngữ khác nhau vì còn từ đồng nghĩa và biến thể chính tả. Vẫn cần người dùng/chuyên gia ngôn ngữ ký hiệu kiểm tra ký hiệu, vùng miền, khả năng phân biệt và ngữ cảnh. Đã kiểm tra giấy phép MIT trong repository; chưa kiểm toán lịch sử nguồn gốc độc lập của từng định nghĩa. Một phần mục từ mang tính chuyên môn/lịch sử, không phải toàn bộ đều có tần suất giao tiếp cao.','',
 '## Thông báo bản quyền nguồn','',source_meta['licenseText']]
(ROOT/'public/vocabulary/SOURCES.md').write_text('\n'.join(provenance_lines),encoding='utf8')
audit={'version':data['version'],'count':len(entries),'previousCount':len(previous),
 'uniqueIds':len({e['id'] for e in entries}),'uniqueVisibleLabels':len(seen),
 'preservedPreviousIds':len(previous)-len(changed_ids),'changedPreviousIds':changed_ids,
 'newEntries':[{'id':e['id'],'label':e['label']} for e in entries if e['label'] not in stable_ids],
 'restoredSenses':[{'id':e['id'],'label':e['label']} for e in entries if e['label'] in ['AI (trí tuệ nhân tạo)','từ (đơn vị ngôn ngữ)','năm (số 5)']],
 'definitionsBeyondLabel':sum(e['definition']!=e['label'] for e in entries),
 'repeatedSourceLabels':repeated_labels,
 'sourceCounts':dict(Counter(e.get('provenance',{}).get('type','preserved-core') for e in entries)),
 'original775PreservedExactly':entries[:775]==core_baseline,
 'original775Sha256':hashlib.sha256(json.dumps(core_baseline,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf8')).hexdigest(),
 'entryKindCounts':dict(Counter(e.get('entryKind','meaning-proposal') for e in entries)),
 'groupCounts':dict(Counter(e['group'] for e in entries)),
 'source':source_meta,
 'selectionMethod':'Authored practical phrases, then lower-case 1–4-syllable dictionary headwords ranked by occurrences in source definitions/examples; not a validated usage-frequency ranking.',
 'limits':['Meaning proposals, not trained signs or a complete sign language.','Dictionary entries may have additional senses not selected here.','Unique display labels do not establish 6000 distinct linguistic concepts; synonyms and orthographic variants remain.','Every new sign and regional variant still needs linguistic review.','Source repository declares MIT; independent historical provenance of each sense was not audited.'],
 'note':'Vietnamese aliases aid search only; they do not assert identical signs. Meaning count is not trained-class coverage.'}
(ROOT/'docs').mkdir(exist_ok=True)
audit_path=ROOT/'docs/vocabulary-audit.json'
previous_audit=json.loads(audit_path.read_text(encoding='utf8')) if audit_path.exists() else {}
# Keep the first migration evidence when an unchanged inventory is regenerated.
if previous_audit.get('version')==data['version'] and not audit['newEntries']:
 for key in ['previousCount','preservedPreviousIds','changedPreviousIds','newEntries']:
  audit[key]=previous_audit[key]
audit_path.write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf8')
(ROOT/'public/research').mkdir(exist_ok=True)
(ROOT/'public/research/vocabulary-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf8')
print('VOCABULARY',len(entries),'groups',len(set(e['group'] for e in entries)))
