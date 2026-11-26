# Workflow — Project VEIL (Minimal Rigor + Run & Observe)

Quy trình phát triển gọn nhẹ lấy cảm hứng từ chế độ `minimal` của *Claude Code Game Studios*: giữ độ chặt ở **chất lượng thực tế khi chơi** thay vì giấy tờ hành chính.

---

## 1. Nhịp làm việc mặc định (Playable First)

1. **Đọc Checkpoint:** Mở `production/session-state/active.md` (vùng `<!-- CHECKPOINT -->`) để nắm nhanh trạng thái hiện tại, nhánh đang làm và việc kế tiếp.
2. **Thiết kế ngắn gọn trước khi sửa cơ chế lớn:**
   - Thay đổi nhỏ / bugfix: đi thẳng vào tái hiện lỗi và viết regression test.
   - Cơ chế mới / cân bằng / phòng mới / narrative: áp dụng **Giao thức Cộng tác** ở Mục 2 và chỉ viết ghi chú thiết kế ≤ 1 trang (không tạo nhiều GDD rời rạc).
3. **Cài đặt từng bước nhỏ & chạy kiểm chứng sớm:**
   - Luôn giữ `npm run check` (`validate:data` + `test` + `build`) xanh sau mỗi thay đổi.
4. **Run & Observe (bắt buộc nếu động tới giao diện / hiển thị):**
   - Chạy `npm run qa:visual`, mở ảnh chụp trong `production/qa/evidence/` để kiểm tra bằng mắt.
5. **Cập nhật Checkpoint:** Ghi đè vùng `<!-- CHECKPOINT -->` trong `production/session-state/active.md` (giữ < 25 dòng) kèm dòng `Run result:`.

---

## 2. Giao thức Cộng tác (Collaborative Protocol)

Áp dụng cho **quyết định thiết kế, cân bằng chỉ số, cốt truyện/hội thoại, thay đổi UX lớn** — không áp dụng máy móc cho lỗi chính tả hay bug kỹ thuật rõ ràng:

1. **Hỏi làm rõ** mục tiêu trải nghiệm và ràng buộc phạm vi.
2. **Trình bày 2–4 phương án** kèm ưu/nhược điểm, tác động tới 4 trụ cột của Project VEIL (`docs/studio/DESIGN-RUBRIC.md`) và đề xuất rõ ràng.
3. **Người dùng quyết định** phương án.
4. **Nháp & Duyệt** trước khi viết thay đổi lớn lên nhiều file hoặc chốt hội thoại/số liệu cân bằng.

---

## 3. Cổng kiểm chứng Run & Observe

> *Unit test pass không phát hiện được HUD bị tràn dòng, chữ đè lên Canvas, hay layout bị giật trên màn hình điện thoại.*

Khi PR/commit chạm vào `src/ui/`, `src/style.css`, `src/perception/` hoặc `index.html`:

1. Chạy `npm run qa:visual`.
2. Kịch bản tự động chạy bản build thực tế trên trình duyệt Chrome thật ở **3 kích thước**:
   - Desktop: `1280×800`
   - Mobile SE: `375×667`
   - Mobile 14: `390×844`
3. Điều kiện **ĐẠT** (tất cả phải thỏa):
   - `0` console error, `0` uncaught pageerror.
   - `0px` tràn ngang (`scrollWidth <= clientWidth`).
   - Canvas vẽ nội dung thật (không trắng/đen đồng nhất).
   - Bấm Inspect thực thể trên Mobile `375×667` có dịch chuyển layout `<= 1px` (giữ bất biến `0px-shift inspect`).
   - Chuyển trạng thái nhận thức (`illusion` → `glitch` → `filter_choice` → `truth`/BREAK) khớp với `PerceptionService`.
4. Kiểm tra trực quan các file PNG trong `production/qa/evidence/` và ghi `Run result:` vào `production/session-state/active.md`.

---

## 4. Quy tắc Fail-First cho Bug Fix

> *Một cổng kiểm tra chưa từng thấy FAIL thì chưa chắc nó kiểm tra đúng thứ cần kiểm tra.*

Khi sửa một lỗi gameplay hoặc perception:
1. Viết test tái hiện lỗi vào `tests/GameEngine.test.ts` hoặc `tests/PerceptionService.test.ts`.
2. Chạy `npm test` trên mã **chưa sửa** và xác nhận test mới **FAIL** đúng nguyên nhân.
3. Sửa mã nguồn.
4. Chạy `npm run check` và xác nhận toàn bộ test **PASS**.
