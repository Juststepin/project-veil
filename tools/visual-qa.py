#!/usr/bin/env python3
"""
Run & Observe Visual QA for Project VEIL (adapted from CCGS run-and-observe.md).

Launches the real production build (`vite preview`) in headless Chrome/Chromium via
Playwright, walks through key gameplay & perception states across Desktop (1280x800),
Mobile SE (375x667), and Mobile 14 (390x844), asserts layout & behavioral invariants,
and saves screenshot evidence into production/qa/evidence/.
"""

from __future__ import annotations

import argparse
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE_DIR = ROOT / "production" / "qa" / "evidence"


def find_chrome_binary() -> str | None:
    for name in ("google-chrome", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    return None


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def wait_for_server(url: str, timeout_s: float = 15.0) -> None:
    deadline = time.time() + timeout_s
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as resp:
                if resp.status == 200:
                    return
        except Exception as err:  # noqa: BLE001
            last_err = err
        time.sleep(0.2)
    raise RuntimeError(f"Preview server did not become ready at {url}: {last_err}")


def assert_no_horizontal_overflow(page: Page, label: str) -> None:
    metrics = page.evaluate(
        "() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })"
    )
    if metrics["scrollWidth"] > metrics["clientWidth"] + 1:
        raise AssertionError(
            f"[{label}] Horizontal overflow detected: scrollWidth={metrics['scrollWidth']} > clientWidth={metrics['clientWidth']}"
        )


def assert_canvas_rendered(page: Page, label: str) -> None:
    stats = page.evaluate(
        """() => {
            const canvas = document.querySelector('#game-canvas');
            if (!canvas) return { ok: false, reason: 'missing #game-canvas' };
            const rect = canvas.getBoundingClientRect();
            const ctx = canvas.getContext('2d');
            if (!ctx || rect.width <= 0 || rect.height <= 0) {
                return { ok: false, reason: 'zero-size canvas or missing 2d ctx' };
            }
            const w = canvas.width;
            const h = canvas.height;
            const data = ctx.getImageData(0, 0, w, h).data;
            const colors = new Set();
            // Sample the center of all 8x8 tiles (wall, floor, obstacles, door, player, entities)
            // so sampling never aliases onto tile borders.
            for (let ty = 0; ty < 8; ty++) {
                for (let tx = 0; tx < 8; tx++) {
                    const px = Math.min(w - 1, Math.floor(((tx + 0.5) * w) / 8));
                    const py = Math.min(h - 1, Math.floor(((ty + 0.5) * h) / 8));
                    const idx = (py * w + px) * 4;
                    colors.add(`${data[idx]},${data[idx + 1]},${data[idx + 2]}`);
                }
            }
            return { ok: colors.size >= 5, distinctColors: colors.size, width: rect.width, height: rect.height };
        }"""
    )
    if not stats.get("ok"):
        raise AssertionError(f"[{label}] Canvas appears blank or invalid: {stats}")


def wait_for_hook(page: Page) -> None:
    page.wait_for_function("() => typeof window.__veil?.tileCenter === 'function'", timeout=10000)


def open_app(page: Page, url: str) -> list[str]:
    errors: list[str] = []
    page.on("pageerror", lambda err: errors.append(f"pageerror: {err}"))
    page.on(
        "console",
        lambda msg: errors.append(f"console.error: {msg.text}") if msg.type == "error" else None,
    )
    page.goto(url, wait_until="networkidle")
    wait_for_hook(page)
    return errors


def with_qa_query(url: str) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["qa"] = "1"
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def without_qa_query(url: str) -> str:
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "qa"]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def run_qa(base_url: str, *, check_prod_guard: bool = True) -> list[str]:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    chrome_path = find_chrome_binary()
    qa_url = with_qa_query(base_url)
    plain_url = without_qa_query(base_url)
    shots: list[str] = []

    with sync_playwright() as p:
        launch_kwargs: dict[str, object] = {"headless": True}
        if chrome_path:
            launch_kwargs["executable_path"] = chrome_path
        browser = p.chromium.launch(**launch_kwargs)

        try:
            # --- 0. Production Guard: without ?qa=1, window.__veil must remain undefined & debug button hidden ---
            if check_prod_guard:
                ctx_guard = browser.new_context(viewport={"width": 1280, "height": 800})
                page_guard = ctx_guard.new_page()
                guard_errors: list[str] = []
                page_guard.on("pageerror", lambda err: guard_errors.append(f"pageerror: {err}"))
                page_guard.on(
                    "console",
                    lambda msg: guard_errors.append(f"console.error: {msg.text}") if msg.type == "error" else None,
                )
                page_guard.goto(plain_url, wait_until="networkidle")
                page_guard.locator("#build-screen").wait_for(state="visible", timeout=10000)
                veil_type = page_guard.evaluate("() => typeof window.__veil")
                assert veil_type == "undefined", (
                    f"Security regression: expected window.__veil === undefined on {plain_url}, got '{veil_type}'"
                )
                page_guard.click("#btn-build-start")
                page_guard.locator("#gameplay-view").wait_for(state="visible", timeout=10000)
                assert page_guard.locator("#btn-debug-lucidity").is_hidden(), (
                    f"Public UI regression: expected #btn-debug-lucidity hidden on {plain_url}"
                )
                assert page_guard.locator("#btn-reset").is_visible(), (
                    "Expected #btn-reset to remain visible on plain production URL"
                )
                if guard_errors:
                    raise AssertionError(f"Plain production URL browser errors: {guard_errors}")
                ctx_guard.close()

            # --- 1. Desktop (1280x800): Build -> Illusion -> Glitch -> BREAK -> Escorted Room 3 -> Room 4 Tribunal -> SOVEREIGN_PACT (1/4) ---
            ctx_desktop = browser.new_context(viewport={"width": 1280, "height": 800})
            page = ctx_desktop.new_page()
            errors_desktop = open_app(page, qa_url)

            assert page.evaluate("() => window.__veil.scene") == "build"
            phase_tag = page.locator("#build-screen .phase-tag").inner_text().strip()
            assert phase_tag == "v0.5 · 8×8", f"Expected 'v0.5 · 8×8', got '{phase_tag}'"

            # Verify Meta-Codex 0/4 & 0/9 initial state without spoiling locked ending names
            codex_title = page.locator("#codex-title").inner_text().strip()
            codex_builds = page.locator("#codex-builds").inner_text().strip()
            codex_text = page.locator("#codex-list").inner_text()
            assert codex_title == "HỒ SƠ KẾT CỤC (0/4)", f"Unexpected codex title: '{codex_title}'"
            assert codex_builds == "Build đã vượt màn: 0/9", f"Unexpected codex builds: '{codex_builds}'"
            assert codex_text.count("??? — Chưa mở khóa") == 4, f"Expected 4 locked chips, got: '{codex_text}'"
            for secret in ("Lưỡi Gươm", "Kẻ Phá Luật", "Người Xé Màn Sương", "Khế Ước Ngang Hàng"):
                assert secret not in codex_text, f"Locked codex spoiled '{secret}': {codex_text}"
            assert page.locator("#build-completed-badge").is_hidden(), "Initial 0/9 build must hide #build-completed-badge"

            page.click('button[data-race-id="dark_elf"]')
            page.click('button[data-class-id="spellblade"]')
            summary = page.locator("#build-summary-stats").inner_text().strip()
            assert summary == "HP 85 · ATK 20", f"Expected 'HP 85 · ATK 20', got '{summary}'"
            assert_no_horizontal_overflow(page, "build-desktop")
            s1 = EVIDENCE_DIR / "01-build-desktop.png"
            page.screenshot(path=str(s1), full_page=True)
            shots.append(s1.name)

            # Switch to default human + brawler and start run
            page.click('button[data-race-id="human"]')
            page.click('button[data-class-id="brawler"]')
            page.click("#btn-build-start")
            page.wait_for_function("() => window.__veil.scene === 'play'")
            assert page.locator("#btn-debug-lucidity").is_visible(), "#btn-debug-lucidity must be visible with ?qa=1"
            assert page.locator("#gameplay-view .phase-tag").inner_text().strip() == "v0.5 · 8×8"

            # Verify >=32px Mute button toggle & StorageService localStorage sync
            audio_btn = page.locator("#btn-toggle-audio")
            audio_box = audio_btn.bounding_box()
            assert audio_box is not None and audio_box["height"] >= 32 and audio_box["width"] >= 32, (
                f"Mute button must be >= 32x32px, got {audio_box}"
            )
            assert audio_btn.inner_text().strip() == "🔊"
            assert audio_btn.get_attribute("aria-label") == "Tắt âm thanh"
            audio_btn.click()
            assert audio_btn.inner_text().strip() == "🔇"
            assert audio_btn.get_attribute("aria-label") == "Bật âm thanh"
            stored_muted = page.evaluate(
                "() => JSON.parse(localStorage.getItem('project_veil_meta_v1') || '{}').muted"
            )
            assert stored_muted is True, f"Expected muted=True in localStorage, got {stored_muted}"
            audio_btn.click()
            assert audio_btn.inner_text().strip() == "🔊"

            assert page.evaluate("() => window.__veil.mode") == "illusion"
            assert page.evaluate("() => window.__veil.state.currentRoomId") == "room_outpost"
            assert page.locator("#inventory-title").inner_text().strip() == "HÀNH TRANG (1/6) · 0 Bạc"
            inv_chip = page.locator("#inventory-list .inventory-chip").first
            assert inv_chip.inner_text().strip() == "Lõi Thánh Vật Ngủ Yên"
            inv_chip.click()
            relic_btn_dormant = page.locator("#btn-use-world_relic")
            assert relic_btn_dormant.is_visible() and relic_btn_dormant.is_disabled(), (
                "Dormant world_relic button must be visible and disabled while UNDECIDED"
            )
            assert relic_btn_dormant.inner_text().strip() == "Chưa thức tỉnh"
            inv_chip.click()

            assert_canvas_rendered(page, "outpost-illusion-desktop")
            assert_no_horizontal_overflow(page, "outpost-illusion-desktop")
            s3 = EVIDENCE_DIR / "03-outpost-illusion-desktop.png"
            page.screenshot(path=str(s3), full_page=True)
            shots.append(s3.name)

            # Raise lucidity to 30 -> Glitch mode
            page.click("#btn-debug-lucidity")
            page.click("#btn-debug-lucidity")
            page.wait_for_function("() => window.__veil.mode === 'glitch'")
            assert page.locator(".game-shell").get_attribute("data-mode") == "glitch"
            s6 = EVIDENCE_DIR / "06-glitch-mode.png"
            page.screenshot(path=str(s6), full_page=True)
            shots.append(s6.name)

            # Raise lucidity to >= 70 -> Filter Choice modal
            for _ in range(3):
                page.click("#btn-debug-lucidity")
            page.wait_for_function("() => window.__veil.scene === 'filter_choice'")
            assert page.locator("#filter-choice-panel").is_visible()
            s7 = EVIDENCE_DIR / "07-filter-choice-modal.png"
            page.screenshot(path=str(s7), full_page=True)
            shots.append(s7.name)

            # Choose BREAK -> Truth mode + verify Lăng Kính Thực Tại (keep intact for SOVEREIGN_PACT) + inspect patrol_01
            page.click("#btn-choose-break")
            page.wait_for_function("() => window.__veil.scene === 'play' && window.__veil.mode === 'truth'")
            assert page.locator(".game-shell").get_attribute("data-mode") == "truth"
            assert page.locator("#veil-status").get_attribute("data-veil") == "break"

            truth_chip = page.locator("#inventory-list .inventory-chip").first
            assert truth_chip.inner_text().strip() == "Lăng Kính Thực Tại"
            truth_chip.click()
            relic_btn_break = page.locator("#btn-use-world_relic")
            assert relic_btn_break.is_enabled(), "Expected #btn-use-world_relic enabled in BREAK mode"
            assert relic_btn_break.inner_text().strip() == "Kích hoạt (+5 ATK, +15 Max HP, hồi 30 HP · 1 lượt)"
            truth_chip.click()

            patrol_pt = page.evaluate(
                """() => {
                    const p = window.__veil.state.entities.find(e => e.id === 'patrol_01');
                    return window.__veil.tileCenter(p.position.x, p.position.y);
                }"""
            )
            assert patrol_pt is not None, "Could not resolve patrol_01 canvas coordinates"
            page.mouse.click(patrol_pt["x"], patrol_pt["y"])
            page.wait_for_function("() => window.__veil.inspectedEntityId === 'patrol_01'")
            inspect_text = page.locator("#inspect-text").inner_text()
            inspect_status = page.locator("#inspect-status").inner_text()
            assert "Tuần Vệ Ngoại Vi" in inspect_text, f"Expected Truth name in inspect: {inspect_text}"
            assert "Hòa bình" in inspect_status, f"Expected peaceful status in BREAK: {inspect_status}"
            s8 = EVIDENCE_DIR / "08-break-truth-mode.png"
            page.screenshot(path=str(s8), full_page=True)
            shots.append(s8.name)

            # Walk Room 1 -> Room 2 -> Room 3 -> captain_01 SURRENDER -> Escorted into Room 4 -> magistrate_01 -> PRESENT_RELIC
            for key in (
                "ArrowUp", "ArrowUp", "ArrowRight", "ArrowRight", "ArrowRight",
                "ArrowRight", "ArrowRight", "ArrowDown", "ArrowDown", "ArrowRight",
                "ArrowUp", "ArrowUp", "ArrowRight", "ArrowRight", "ArrowRight",
                "ArrowRight", "ArrowRight", "ArrowDown", "ArrowDown", "ArrowRight",
                "ArrowDown", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight",
            ):
                page.keyboard.press(key)
            page.wait_for_function("() => window.__veil.scene === 'boss_choice'")
            page.click("#btn-boss-surrender")
            page.wait_for_function(
                "() => window.__veil.scene === 'play' && window.__veil.state.currentRoomId === 'room_inner_court'"
            )
            assert page.locator("#room-name").inner_text().strip() == "Tiền Sảnh Nội Thành"
            assert_canvas_rendered(page, "inner-court-escorted-desktop")
            assert_no_horizontal_overflow(page, "inner-court-escorted-desktop")

            # Verify locked West gate (0,3) while ESCORTED does not consume a turn
            turns_before_gate = page.evaluate("() => window.__veil.state.turnCount")
            page.keyboard.press("ArrowLeft")
            assert page.evaluate("() => window.__veil.state.turnCount") == turns_before_gate
            assert (
                "Cổng sắt phía sau đã đóng chốt trong thời gian mở phiên thẩm vấn Pháp Đình."
                in page.locator("#combat-log").inner_text()
            )

            # Walk East 5 steps along clear y=3 ('D......#') to talk to magistrate_01 at (6,3)
            for _ in range(5):
                page.keyboard.press("ArrowRight")
            page.wait_for_function("() => window.__veil.scene === 'tribunal_choice'")
            assert page.locator("#tribunal-choice-panel").is_visible()
            assert page.locator("#btn-tribunal-accept").is_visible()
            assert page.locator("#btn-tribunal-relic").is_visible()
            assert page.locator("#btn-tribunal-defy").is_visible()
            assert "Trình Lăng Kính Thực Tại" in page.locator("#btn-tribunal-relic").inner_text()
            assert_no_horizontal_overflow(page, "tribunal-choice-desktop")
            s9 = EVIDENCE_DIR / "09-tribunal-choice-desktop.png"
            page.screenshot(path=str(s9), full_page=True)
            shots.append(s9.name)

            # Present Lăng Kính Thực Tại -> transitions seamlessly into room_market_street (ENVOY, +40 Bạc, world_relic intact!)
            page.click("#btn-tribunal-relic")
            page.wait_for_function(
                "() => window.__veil.scene === 'play' && window.__veil.state.currentRoomId === 'room_market_street'"
            )
            assert page.locator("#room-name").inner_text().strip() == "Phố Giao Thương Nội Thành"
            assert page.evaluate("() => window.__veil.state.legalStatus") == "ENVOY"
            assert page.evaluate("() => window.__veil.state.silver") == 40
            assert page.evaluate("() => window.__veil.state.inventory.includes('world_relic')") is True, (
                "ENVOY transition must keep world_relic intact in inventory"
            )
            assert page.locator("#inventory-title").inner_text().strip() == "HÀNH TRANG (1/6) · 40 Bạc"
            assert_canvas_rendered(page, "market-street-hub-desktop")
            assert_no_horizontal_overflow(page, "market-street-hub-desktop")

            # Verify West gate (0,3) TRIBUNAL_CONCLUDED lock does not consume a turn
            turns_before_west_hub = page.evaluate("() => window.__veil.state.turnCount")
            page.keyboard.press("ArrowLeft")
            assert page.evaluate("() => window.__veil.state.turnCount") == turns_before_west_hub
            assert (
                "Cổng Tiền Sảnh Pháp Đình đã đóng chốt sau khi tuyên án — không được tự ý quay lại."
                in page.locator("#combat-log").inner_text()
            )

            # Walk East to (6,3) and bump East expedition gate (7,3) before briefing -> EXPEDITION_UNBRIEFED (no turn lost)
            for _ in range(5):
                page.keyboard.press("ArrowRight")
            turns_before_east_hub = page.evaluate("() => window.__veil.state.turnCount")
            page.keyboard.press("ArrowRight")
            assert page.evaluate("() => window.__veil.state.turnCount") == turns_before_east_hub
            assert page.evaluate("() => window.__veil.state.currentRoomId") == "room_market_street"
            assert (
                "Chưa nhận ủy thác hay lệnh di chuyển ngoài thành"
                in page.locator("#combat-log").inner_text()
            )

            # Walk from (6,3) -> (4,4) -> bump dwarf_smith_01 at (4,5) to open #hub-service-panel
            for key in ("ArrowLeft", "ArrowLeft", "ArrowDown", "ArrowDown"):
                page.keyboard.press(key)
            page.wait_for_function("() => window.__veil.scene === 'hub_service'")
            assert page.locator("#hub-service-panel").is_visible()
            assert page.locator("#dpad-panel").is_hidden()
            assert page.evaluate("() => window.__veil.state.hasAcceptedExpedition") is True
            assert "Thợ Rèn Trưởng Người Lùn · 40 Bạc" in page.locator("#hub-service-title").inner_text()
            assert page.locator("#btn-hub-buy").is_enabled()
            assert "Mua tiếp tế — 15 Bạc · +35 HP" in page.locator("#btn-hub-buy").inner_text()
            assert page.locator("#btn-hub-rest").is_disabled()
            assert "HP đã đầy" in page.locator("#btn-hub-rest").inner_text()
            assert page.locator("#btn-hub-close").is_enabled()
            assert_no_horizontal_overflow(page, "hub-service-market-desktop")
            s10 = EVIDENCE_DIR / "10-hub-service-market.png"
            page.screenshot(path=str(s10), full_page=True)
            shots.append(s10.name)

            # Buy border_ration_pack (-15 Bạc -> 25 Bạc, 2/6 inventory), then close Hub menu
            page.click("#btn-hub-buy")
            page.wait_for_function("() => window.__veil.state.silver === 25")
            assert page.locator("#inventory-title").inner_text().strip() == "HÀNH TRANG (2/6) · 25 Bạc"
            assert page.evaluate("() => window.__veil.state.inventory.includes('border_ration_pack')") is True
            assert "Thợ Rèn Trưởng Người Lùn · 25 Bạc" in page.locator("#hub-service-title").inner_text()

            page.click("#btn-hub-close")
            page.wait_for_function("() => window.__veil.scene === 'play'")
            assert page.locator("#hub-service-panel").is_hidden()
            assert page.locator("#dpad-panel").is_visible()

            # Walk from (4,4) -> (4,3) -> East gate (7,3) -> unlock Ending 4: Khế Ước Ngang Hàng (1/4)
            for key in ("ArrowUp", "ArrowRight", "ArrowRight", "ArrowRight"):
                page.keyboard.press(key)
            page.wait_for_function("() => window.__veil.scene === 'ending'")
            ending_panel_text = page.locator("#ending-panel").inner_text()
            assert "Kết cục 4: Khế Ước Ngang Hàng" in ending_panel_text, (
                f"Expected 'Kết cục 4: Khế Ước Ngang Hàng' in #ending-panel, got: {ending_panel_text}"
            )
            assert "Lăng Kính Thực Tại vẫn nằm nguyên vẹn trong hành trang." in ending_panel_text, (
                f"Expected v0.5.0 ENVOY departure body in #ending-panel, got: {ending_panel_text}"
            )
            assert "HỒ SƠ KẾT CỤC (1/4)" in ending_panel_text, (
                f"Expected 'HỒ SƠ KẾT CỤC (1/4)' in #ending-panel, got: {ending_panel_text}"
            )
            assert "Build đã vượt màn: 1/9" in ending_panel_text, (
                f"Expected 'Build đã vượt màn: 1/9' in #ending-panel, got: {ending_panel_text}"
            )
            ending_build_cls = page.locator("#btn-ending-build").get_attribute("class") or ""
            ending_reset_cls = page.locator("#btn-ending-reset").get_attribute("class") or ""
            assert "action-accent" in ending_build_cls and "action-accent" not in ending_reset_cls, (
                f"Expected #btn-ending-build to be primary action-accent CTA, got build='{ending_build_cls}', reset='{ending_reset_cls}'"
            )
            assert_no_horizontal_overflow(page, "sovereign-pact-ending-desktop")
            s11 = EVIDENCE_DIR / "11-sovereign-pact-ending.png"
            page.screenshot(path=str(s11), full_page=True)
            shots.append(s11.name)

            page.click("#btn-ending-build")
            page.wait_for_function("() => window.__veil.scene === 'build'")
            assert page.locator("#codex-title").inner_text().strip() == "HỒ SƠ KẾT CỤC (1/4)"
            assert page.locator("#codex-builds").inner_text().strip() == "Build đã vượt màn: 1/9"
            unlocked_codex = page.locator("#codex-list").inner_text()
            assert "✓ Khế Ước Ngang Hàng" in unlocked_codex, (
                f"Expected unlocked SOVEREIGN_PACT in codex: {unlocked_codex}"
            )
            assert unlocked_codex.count("??? — Chưa mở khóa") == 3
            assert page.locator("#build-completed-badge").is_visible(), (
                "Completed human:brawler build must show #build-completed-badge on #build-screen"
            )
            assert page.locator("#build-completed-badge").inner_text().strip() == "✓ Đã vượt màn"
            page.click('button[data-race-id="dark_elf"]')
            assert page.locator("#build-completed-badge").is_hidden(), (
                "Uncompleted dark_elf:brawler build must hide #build-completed-badge"
            )

            if errors_desktop:
                raise AssertionError(f"Desktop browser errors: {errors_desktop}")
            ctx_desktop.close()

            # --- 2. Mobile SE (375x667): Build Screen + Sticky Footer + 0px-Shift 1-Tap Inspect ---
            ctx_se = browser.new_context(viewport={"width": 375, "height": 667})
            page_se = ctx_se.new_page()
            errors_se = open_app(page_se, qa_url)

            assert_no_horizontal_overflow(page_se, "build-mobile-375")
            assert page_se.locator("#codex-panel").is_visible(), "#codex-panel must be visible on 375x667"
            start_bottom_se = page_se.evaluate(
                "() => document.querySelector('#btn-build-start').getBoundingClientRect().bottom"
            )
            assert start_bottom_se <= 667.5, (
                f"Sticky #btn-build-start pushed out of 375x667 viewport: bottom={start_bottom_se}"
            )
            s2 = EVIDENCE_DIR / "02-build-mobile-375.png"
            page_se.screenshot(path=str(s2), full_page=False)
            shots.append(s2.name)

            # Verify scrolling to bottom of Build Screen never hides 3rd class card under sticky footer
            page_se.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
            overlap_ok = page_se.evaluate(
                """() => {
                    const card = document.querySelector('button[data-class-id="spellblade"]');
                    const footer = document.querySelector('.build-footer');
                    if (!card || !footer) return false;
                    return card.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top + 2;
                }"""
            )
            assert overlap_ok, "Last class card (spellblade) overlapped sticky .build-footer on 375x667"

            page_se.click("#btn-build-start")
            page_se.wait_for_function("() => window.__veil.scene === 'play'")
            assert_canvas_rendered(page_se, "play-mobile-375")
            assert_no_horizontal_overflow(page_se, "play-mobile-375")
            canvas_w_se = page_se.evaluate("() => document.querySelector('#game-canvas').getBoundingClientRect().width")
            assert abs(canvas_w_se - 224) <= 1.0, f"Expected 224px canvas on 375x667, got {canvas_w_se}"
            legend_text_se = page_se.locator("#legend-row").inner_text()
            assert "Chạm thực thể ở xa để xem HP/ATK (không tốn lượt)" in legend_text_se, (
                f"Missing 0px-height remote inspect hint in #legend-row: {legend_text_se}"
            )

            # Verify 0px layout shift on #log-section when toggling 1-tap inspect
            before_y = page_se.evaluate(
                "() => document.querySelector('#log-section').getBoundingClientRect().top"
            )
            patrol_pt_se = page_se.evaluate(
                """() => {
                    const p = window.__veil.state.entities.find(e => e.id === 'patrol_01');
                    return window.__veil.tileCenter(p.position.x, p.position.y);
                }"""
            )
            page_se.mouse.click(patrol_pt_se["x"], patrol_pt_se["y"])
            page_se.wait_for_function("() => window.__veil.inspectedEntityId === 'patrol_01'")
            after_y = page_se.evaluate(
                "() => document.querySelector('#log-section').getBoundingClientRect().top"
            )
            shift = abs(after_y - before_y)
            assert shift <= 1.0, f"Inspect caused layout shift on 375x667: {shift:.2f}px (before={before_y}, after={after_y})"

            inspect_illusion = page_se.locator("#inspect-text").inner_text()
            assert "Chiến Binh Vong Cốt" in inspect_illusion, f"Expected Illusion name, got: {inspect_illusion}"
            assert "Tuần Vệ" not in inspect_illusion, f"Truth leaked in Illusion mode: {inspect_illusion}"

            s5 = EVIDENCE_DIR / "05-inspect-mobile-375.png"
            page_se.screenshot(path=str(s5), full_page=False)
            shots.append(s5.name)

            # Verify Khung Thể Dị Hình · Thiết Vệ + Phản Công +10 keeps full untruncated #build-hud & 1-line secondary HUD on 375x667
            page_se.click("#btn-header-build")
            page_se.wait_for_function("() => window.__veil.scene === 'build'")
            page_se.click('button[data-race-id="undead_outsider"]')
            page_se.click('button[data-class-id="iron_vanguard"]')
            page_se.click("#btn-build-start")
            page_se.wait_for_function("() => window.__veil.scene === 'play'")
            hud_h_before = page_se.evaluate(
                "() => document.querySelector('#hud-row-secondary').getBoundingClientRect().height"
            )
            # Walk toward patrol_01 (1,3 -> 2,3 -> 3,3 -> 4,4) then WAIT to arm Phản Công +10
            for key in ("ArrowRight", "ArrowRight", "ArrowDown", "ArrowRight"):
                page_se.keyboard.press(key)
            for _ in range(4):
                if page_se.evaluate("() => window.__veil.state.isRiposteReady"):
                    break
                page_se.click("#btn-wait")
            assert page_se.evaluate("() => window.__veil.state.isRiposteReady") is True, (
                "Expected isRiposteReady === True after guarding against patrol_01"
            )
            assert page_se.locator("#riposte-badge").inner_text().strip() == "Phản Công +10"

            build_hud_metrics = page_se.evaluate(
                """() => {
                    const el = document.querySelector('#build-hud');
                    if (!el) return null;
                    return {
                        text: (el.textContent || '').trim(),
                        scrollWidth: el.scrollWidth,
                        clientWidth: el.clientWidth,
                    };
                }"""
            )
            assert build_hud_metrics is not None
            assert build_hud_metrics["text"] == "Khung Thể Dị Hình · Thiết Vệ", (
                f"Expected full build label on 375x667, got '{build_hud_metrics['text']}'"
            )
            assert "..." not in build_hud_metrics["text"] and "…" not in build_hud_metrics["text"]
            assert build_hud_metrics["scrollWidth"] <= build_hud_metrics["clientWidth"] + 1, (
                f"#build-hud visually truncated via CSS ellipsis on 375x667: {build_hud_metrics}"
            )

            hud_h_after = page_se.evaluate(
                "() => document.querySelector('#hud-row-secondary').getBoundingClientRect().height"
            )
            assert abs(hud_h_after - hud_h_before) <= 2.0, (
                f"#riposte-badge broke 1-line secondary HUD on 375x667 (before={hud_h_before}, after={hud_h_after})"
            )
            sec_hud_fits = page_se.evaluate(
                """() => {
                    const el = document.querySelector('#hud-row-secondary');
                    return Boolean(el && el.scrollWidth <= el.clientWidth + 1);
                }"""
            )
            assert sec_hud_fits, "#hud-row-secondary clipped pills horizontally on 375x667 with Phản Công +10"
            assert_no_horizontal_overflow(page_se, "riposte-hud-mobile-375")

            if errors_se:
                raise AssertionError(f"Mobile 375x667 browser errors: {errors_se}")
            ctx_se.close()

            # --- 3. Mobile 14 (390x844): Outpost Illusion Gameplay View (320x320 Canvas) + KEEP Relic (-35!) ---
            ctx_m14 = browser.new_context(viewport={"width": 390, "height": 844})
            page_m14 = ctx_m14.new_page()
            errors_m14 = open_app(page_m14, qa_url)

            page_m14.click("#btn-build-start")
            page_m14.wait_for_function("() => window.__veil.scene === 'play'")
            assert_canvas_rendered(page_m14, "outpost-mobile-390")
            assert_no_horizontal_overflow(page_m14, "outpost-mobile-390")
            canvas_w_m14 = page_m14.evaluate(
                "() => document.querySelector('#game-canvas').getBoundingClientRect().width"
            )
            assert abs(canvas_w_m14 - 320) <= 1.0, f"Expected 320px canvas on 390x844, got {canvas_w_m14}"

            # Exercise keyboard movement (ArrowRight) + logged WAIT turn and verify turn-start log divider
            page_m14.keyboard.press("ArrowRight")
            page_m14.wait_for_function("() => window.__veil.state.player.position.x === 2")
            page_m14.click("#btn-wait")
            turn_starts = page_m14.locator("#combat-log li.log-turn-start").count()
            assert turn_starts >= 2, f"Expected >= 2 .log-turn-start entries after logged turn, got {turn_starts}"

            s4 = EVIDENCE_DIR / "04-outpost-illusion-mobile-390.png"
            page_m14.screenshot(path=str(s4), full_page=False)
            shots.append(s4.name)

            # Verify KEEP branch world_relic (Trái Tim Chinh Phạt) deals 35 damage & pins surviving target cleanly
            for _ in range(5):
                page_m14.click("#btn-debug-lucidity")
            page_m14.wait_for_function("() => window.__veil.scene === 'filter_choice'")
            page_m14.click("#btn-choose-keep")
            page_m14.wait_for_function("() => window.__veil.scene === 'play'")
            keep_chip = page_m14.locator("#inventory-list .inventory-chip").first
            assert keep_chip.inner_text().strip() == "Trái Tim Chinh Phạt"
            keep_chip.click()
            page_m14.click("#btn-use-world_relic")
            patrol_hp_after = page_m14.evaluate(
                "() => window.__veil.state.entities.find(e => e.id === 'patrol_01')?.hp"
            )
            assert patrol_hp_after == 15, f"Expected patrol_01 HP 15 after 35 relic damage, got {patrol_hp_after}"
            assert page_m14.evaluate("() => window.__veil.inspectedEntityId") == "patrol_01"
            assert_no_horizontal_overflow(page_m14, "relic-keep-mobile-390")

            if errors_m14:
                raise AssertionError(f"Mobile 390x844 browser errors: {errors_m14}")
            ctx_m14.close()

        finally:
            browser.close()

    return sorted(shots)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run & Observe Playwright Visual QA for Project VEIL.")
    parser.add_argument("--url", help="Use an already running URL instead of starting vite preview.")
    parser.add_argument("--skip-build", action="store_true", help="Skip `npm run build` before vite preview.")
    parser.add_argument(
        "--skip-prod-guard",
        action="store_true",
        help="Skip checking that window.__veil is undefined without ?qa=1 (useful when --url points to vite dev).",
    )
    args = parser.parse_args()

    server_proc: subprocess.Popen[str] | None = None
    try:
        if args.url:
            target_url = with_qa_query(args.url)
        else:
            if not args.skip_build:
                subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True)
            port = find_free_port()
            plain_preview_url = f"http://127.0.0.1:{port}/project-veil/"
            target_url = with_qa_query(plain_preview_url)
            server_proc = subprocess.Popen(
                ["npx", "vite", "preview", "--host", "127.0.0.1", "--port", str(port), "--strictPort"],
                cwd=ROOT,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )
            wait_for_server(plain_preview_url)

        shots = run_qa(target_url, check_prod_guard=not args.skip_prod_guard)
        print(
            f"Run result: PASS | url=?qa=1 | prod_guard=window.__veil===undefined | "
            f"viewports=1280x800,375x667,390x844 | errors=0 | inspect_shift<=1px | "
            f"evidence={len(shots)} shots in production/qa/evidence/"
        )
        for name in shots:
            print(f"  - production/qa/evidence/{name}")
        return 0
    finally:
        if server_proc is not None:
            server_proc.terminate()
            try:
                server_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server_proc.kill()


if __name__ == "__main__":
    sys.exit(main())
