# Coding & Architecture Rules — Project VEIL

Tập hợp các quy tắc theo phạm vi thư mục (rút gọn từ `.claude/rules/` của CCGS và hiệu chỉnh đúng kiến trúc 4 lớp của `project-veil`).

---

## 1. Gameplay Core (`src/core/**`)

- **Thuần TypeScript, 0 phụ thuộc DOM/Canvas/Browser:** Không import `window`, `document`, `src/ui/*` hay `src/perception/*`. Engine phải chạy độc lập được hoàn toàn trong Node.js.
- **Tách dữ liệu khỏi logic:** Chỉ số thực thể, vật phẩm, chủng tộc, lớp nghề, modifier và bản đồ phải đọc từ `src/data/*.json`, không hardcode chỉ số mới rải rác trong hàm xử lý.
- **Snapshot bất biến trong Event:** Mọi `position` hoặc object lồng nhau phát ra trong `GameEvent` phải được clone (`{ ...pos }`) để không bị biến đổi ngầm bởi các bước AI chạy sau trong cùng lượt.
- **Quyết định rõ thứ tự xử lý lượt:** Sau khi `GAME_ENDED` hoặc `isGameOver` xảy ra, dừng ngay vòng lặp AI phòng (`runRoomAi` không được chạy tiếp).
- **Bảo toàn cờ trạng thái khi Reset:** `reset()` không tham số phải giữ nguyên `selectedRaceId` / `selectedClassId` nhưng xóa sạch mọi cờ chiến đấu tạm (`provoked`, `hasSpokenCombatBark`, `isGuardingFromWait`, `consecutiveHitsOnTarget`, v.v.).

---

## 2. Perception Layer (`src/perception/**`)

- **Nguồn chân lý duy nhất cho hiển thị nhận thức:** Mọi tên hiển thị, hội thoại, mô tả vật phẩm, nhãn chế độ và thông điệp kết cục đều đi qua `PerceptionService`.
- **Không rò rỉ Sự Thật (No Truth Leakage):**
  - Ở chế độ `illusion` (`lucidity < 30`) và nhánh `KEEP`, tuyệt đối không lộ tên thật, trạng thái hòa bình hay bí mật chủng tộc (`undead_outsider`).
  - Ở chế độ `glitch`, mọi log/inspect nháy sang sự thật phải hoàn nguyên đúng thời lượng `GLITCH_DURATION_MS` trừ khi người chơi chọn `BREAK`.
- **Nhất quán thuật ngữ tiếng Việt:** Không thêm dấu ngoặc kép thừa xung quanh chuỗi hội thoại đã có sẵn định dạng; giữ đúng từ khóa giao diện (`Độ Tỉnh Táo`, `Màn Che`, `Hòa bình — Tiếp cận để giao tiếp`, `Thù địch`, v.v.).

---

## 3. Data Files (`src/data/*.json`)

- **Hợp lệ tuyệt đối:** JSON hỏng làm gãy toàn bộ bản build. Luôn chạy `npm run validate:data` sau khi sửa bất kỳ file nào trong `src/data/`.
- **Khớp khóa và `id`:** Mọi mục trong `maps`, `entities`, `items`, `modifiers`, `races`, `classes` phải có trường `id` trùng chính xác với khóa cấp trên của nó.
- **Hợp đồng 2 mặt (`truth` & `illusion`):** Mọi thực thể (`entities.json`) và vật phẩm (`items.json`) đều phải có đủ cả hai khối `truth` và `illusion` với `name` không rỗng.
- **Tính toàn vẹn tham chiếu chéo:**
  - `entity.roomId` phải tồn tại trong `maps.json`; `startPosition` phải nằm trong lưới 8×8 và nằm trên ô đi được (`.`).
  - `entity.dropItemId` (nếu có) phải tồn tại trong `items.json`.
  - Mọi cửa trong `maps.json` phải đặt đúng ô `D` trên `layout`, trỏ tới `targetRoomId` hợp lệ và có `spawnPosition` đi được.
  - Mọi khóa trong `raceTalkDialogue` phải tồn tại trong `races.json`.
- **Không để dữ liệu mồ côi:** Cảnh báo ngay khi có item/modifier/race/class không được tham chiếu bởi code hoặc dữ liệu khác.

---

## 4. UI & Canvas (`src/ui/**`, `src/style.css`)

- **Chỉ hiển thị & gửi Action:** UI không tự tính sát thương, hồi máu hay mutate trực tiếp `GameState`. Mọi thay đổi gameplay phải đi qua `engine.handleAction(...)` hoặc API công khai của `GameEngine`.
- **Bền vững trên Mobile & Desktop:** Hỗ trợ đủ điều khiển bàn phím (Arrow/WASD/Space/Escape) lẫn cảm ứng (D-pad, chạm ô liền kề, 1-tap Inspect). Không được vỡ bố cục hay tràn ngang ở `375×667`, `390×844` và `1280×800`.
- **0px Layout Shift cho Inspect:** Chuyển đổi giữa thanh Legend (`#legend-row`) và thẻ Inspect (`#inspect-card`) không được đẩy nhảy vị trí phần Nhật ký (`#log-section`) và D-pad.
- **Vẽ lại khi đổi kích thước:** Sự kiện `resize` phải căn chỉnh kích thước Canvas (bội số của 8) và render lại khung hình ngay lập tức.
- **Dọn timer sạch sẽ:** Mọi `setTimeout` hiệu ứng (glitch log, lucidity pulse, inspect flash) phải được hủy khi chuyển cảnh, đổi nhánh `KEEP`/`BREAK` hoặc reset.

---

## 5. Testing (`tests/**`, `tools/**`)

- **Cấu trúc Arrange / Act / Assert rõ ràng** và tên test mô tả chính xác kịch bản + kết quả mong đợi.
- **Tất định (Deterministic) & cô lập:** Unit test không phụ thuộc thời gian thực, DOM, mạng hay trạng thái dùng chung giữa các test case.
- **Script xuất dữ kiện, không phán đoán mơ hồ:** Các script trong `tools/` (`validate-data.mjs`, `visual-qa.py`) báo cáo rõ từng lỗi/cảnh báo kèm đường dẫn & giá trị thực tế để dễ truy vết.
