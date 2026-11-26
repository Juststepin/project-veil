# Active Session State — Project VEIL

<!--
  CÁCH DÙNG FILE NÀY (trích lọc từ Claude Code Game Studios):

  File gồm 2 vùng tách biệt:
    1. Vùng CHECKPOINT (STATUS + CHECKPOINT): dành cho người và AI đọc nhanh đầu
       phiên hoặc sau khi compact context. LUÔN GHI ĐÈ, KHÔNG APPEND, giữ dưới ~25 dòng.
    2. Phần "## Notes" bên dưới: ghi chú tự do về quyết định thiết kế, phương án đã
       bỏ, bối cảnh khó suy luận lại từ git log.
-->

<!-- STATUS -->
Epic: Studio Workflow & QA
Feature: Lean CCGS Cherry-Pick
Task: Data Validator + Unit Test Runner + Playwright Run & Observe
<!-- /STATUS -->

<!-- CHECKPOINT -->
**Updated:** 2026-11-26
**Branch:** `chore/studio-workflow-qa`
**Current task:** Đã hoàn tất tích hợp bộ Studio Workflow gọn nhẹ (AGENTS/CLAUDE/WORKFLOW/RULES/DESIGN-RUBRIC), data validator, unit test runner và Run & Observe Playwright QA.
**Next step:** Review diff nhánh `chore/studio-workflow-qa`, quyết định có push/tạo PR hoặc bổ sung thêm kịch bản QA cho Phòng 2/Phòng 3/Boss.
**Blocked on:** nothing
**Files in progress:** none (ready for review)
**Run result:** PASS | viewports=1280x800,375x667,390x844 | errors=0 | inspect_shift<=1px | evidence=8 shots in production/qa/evidence/
**Open questions:** none
<!-- /CHECKPOINT -->

---

## Notes

### Bối cảnh hiện tại của dự án
- `main` đang ở mốc **Phase 4 UI Polish v0.2.2** (`53ffc4d`): hoàn thành 3 phòng (`room_outpost`, `room_depot`, `room_checkpoint`), 3 Chủng tộc × 3 Lớp nghề với 6 trait dữ liệu hóa, nhánh `KEEP` / `BREAK`, 3 kết cục (`SUMMONER_BLADE`, `Kẻ Phá Luật`, `AWAKENED`), 1-tap Inspect không giật layout trên Mobile (`375×667`, `390×844`).
- Quyết định kiến trúc: **không** sao chép nguyên 794 file của `Donchitos/Claude-Code-Game-Studios` vào `project-veil`; chỉ trích lọc 3 mảnh giá trị cao nhất phù hợp với Web/TS/Canvas và không tăng phụ thuộc `npm` (giữ `deploy.yml` trên GitHub Pages nhẹ và nhanh).
