# Project VEIL — Studio Guide & Guardrails

Hướng dẫn vận hành gọn nhẹ cho **Project VEIL** (2D Top-down Turn-based Grid Sandbox RPG — TypeScript + Vite + HTML5 Canvas), trích lọc từ mô hình `minimal` rigor của *Claude Code Game Studios*.

## Kiến trúc 4 lớp

- `src/core/`: Engine thuần TypeScript (`GameEngine`, `grid`, `types`) — **không phụ thuộc DOM/Canvas**.
- `src/perception/`: `PerceptionService` — chuyển đổi dữ liệu `illusion` / `glitch` / `truth` theo `lucidity` và `filterChoice`.
- `src/data/`: Dữ liệu tĩnh JSON (`maps`, `entities`, `items`, `modifiers`, `races`, `classes`).
- `src/ui/`: `GameUI`, `CanvasRenderer`, `style.css` — chỉ hiển thị & phát action, không sở hữu state game.
- `src/debug/veilHook.ts`: Hook chỉ đọc (`window.__veil`) phục vụ Run & Observe (Playwright QA).

## Lệnh kiểm tra nhanh

```bash
npm run validate:data   # Kiểm tra JSON & tham chiếu chéo trong src/data/
npm test                # Chạy toàn bộ unit test (GameEngine + PerceptionService)
npm run build           # Type-check strict (tsc) + production build (vite)
npm run check           # Chạy gộp validate:data + test + build
npm run qa:visual       # Run & Observe: mở Chrome thật, test desktop & mobile, chụp ảnh vào production/qa/evidence/
```

## Quy tắc cốt lõi

1. **Playable First (`minimal` rigor):** Ưu tiên bản chơi được và kiểm chứng thực tế; tránh viết tài liệu rườm rà trước khi có mã chạy được. Chi tiết: `docs/studio/WORKFLOW.md`.
2. **Cộng tác khi đổi thiết kế / cân bằng:** Khi thêm cơ chế, phòng mới, trait, narrative hoặc sửa balance, luôn theo luồng **Hỏi → Đưa 2–4 phương án (ưu/nhược điểm) → Chờ chọn → Nháp → Duyệt** dựa trên `docs/studio/DESIGN-RUBRIC.md`.
3. **Chuẩn mã nguồn theo thư mục:** Tuân thủ bất biến của từng lớp trong `docs/studio/RULES.md`.
4. **Run & Observe bắt buộc cho UI/Canvas:** Mọi thay đổi ở `src/ui/`, `src/style.css` hoặc `src/perception/` chỉ được coi là hoàn tất sau khi chạy `npm run qa:visual` và kiểm tra trực quan ảnh chụp ở Desktop (`1280x800`) và Mobile (`375x667`, `390x844`).
5. **Fail-First Regression Test:** Mỗi bản sửa lỗi phải kèm test tái hiện lỗi — chạy cho thấy **FAIL** trước khi sửa, sau đó **PASS** sau khi sửa.
6. **Bộ nhớ phiên (`production/session-state/active.md`):** Đọc vùng `<!-- CHECKPOINT -->` đầu mỗi phiên mới hoặc sau khi compact context; cập nhật đè vùng này (giữ dưới 25 dòng) khi kết thúc đầu việc.
