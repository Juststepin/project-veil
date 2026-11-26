# Project VEIL — Coding Agent Guardrails

Tài liệu hướng dẫn ngắn gọn cho Coding Agent làm việc trên **Project VEIL** (2D Top-down Turn-based Grid Sandbox RPG — TypeScript + Vite + HTML5 Canvas).

## 1. Nguồn Sự Thật Duy Nhất & Ranh Giới Vai Trò

- **Single Source of Truth (Google Drive):** Toàn bộ thiết kế, từ điển thuật ngữ, đặc tả giai đoạn, quy chuẩn và trạng thái dự án nằm ở 5 tài liệu trên Google Drive (`[VEIL] GDD_CORE`, `[VEIL] STYLE_GLOSSARY`, `[VEIL] CURRENT_SPEC`, `[VEIL] ANTIGRAVITY_RULES`, `[VEIL] DEV_SNAPSHOT`).
- **Game Director (Gemini) + User:** Chốt Spec, Balance, cơ chế gameplay và Narrative/hội thoại.
- **Coding Agent:** Thực thi đúng **Scope Lock** được giao; **không tự ý thay đổi luật chơi, chỉ số cân bằng hay cốt truyện/thuật ngữ**. Giữ xanh `npm run check` (+ `npm run qa:visual` khi chạm UI/Canvas/Perception). Chỉ cập nhật `[VEIL] DEV_SNAPSHOT` trên Google Drive vào cuối giai đoạn khi có yêu cầu.

## 2. Kiến Trúc 4 Thư Mục Phẳng (`src/`) & Bất Biến Kỹ Thuật

- `src/data/`: Dữ liệu tĩnh JSON (`maps`, `entities`, `items`, `modifiers`, `races`, `classes`). Bắt buộc `key === id`, đầy đủ 2 khối `truth` & `illusion`, toàn vẹn tham chiếu chéo (`roomId`, `dropItemId`, `doors`, `raceTalkDialogue`).
- `src/core/`: Engine thuần TypeScript (`GameEngine`, `grid`, `types`).
  - **0% phụ thuộc DOM/Canvas/Browser** và **0% logic ảo giác/hiển thị** (không import `src/perception/` hay `src/ui/`).
  - Mọi `Position` phát ra trong `GameEvent` phải được clone snapshot (`{ ...pos }`) để không bị AI mutate ngầm.
  - Dừng ngay vòng lặp AI phòng (`runRoomAi`) khi xảy ra `GAME_ENDED` hoặc `isGameOver`.
- `src/perception/`: `PerceptionService` — tầng duy nhất chuyển đổi `illusion` / `glitch` / `truth` theo `lucidity` và `filterChoice`; tuyệt đối không rò rỉ dữ liệu Sự Thật trước khi người chơi chọn `BREAK`.
- `src/ui/`: `GameUI`, `CanvasRenderer`, `veilHook` (cùng `src/main.ts`, `src/style.css`).
  - Chỉ hiển thị & gửi `PlayerAction` qua API của `GameEngine`; **0% đọc trực tiếp `src/data/`** và không tự mutate `GameState`.
  - Giữ bất biến **`0px-shift inspect`** (bật/tắt thẻ Inspect không làm giật vị trí Nhật ký/D-pad) và `0px` tràn ngang trên Mobile (`375×667`, `390×844`) lẫn Desktop (`1280×800`).
  - Hook QA `window.__veil` (`src/ui/veilHook.ts`) **chỉ kích hoạt** khi `import.meta.env.DEV` hoặc URL có `?qa=1` (ẩn hoàn toàn trên bản production thường để bảo vệ Truth Data).
- **Fail-First Regression Test:** Khi sửa lỗi, phải viết test tái hiện lỗi trong `tests/` — chạy thấy **FAIL** trước khi sửa, sau đó **PASS** sau khi sửa.

## 3. Lệnh Kiểm Tra Bắt Buộc

```bash
npm run validate:data   # Kiểm tra JSON, cấu trúc 2 mặt truth/illusion & tham chiếu chéo trong src/data/
npm test                # Chạy toàn bộ unit test (GameEngine + PerceptionService)
npm run check           # Chạy gộp: validate:data + test + build (tsc strict + vite build)
npm run qa:visual       # Run & Observe (?qa=1, 8 ảnh smoke test Desktop/Mobile); chỉ chạy khi môi trường có Playwright
```
