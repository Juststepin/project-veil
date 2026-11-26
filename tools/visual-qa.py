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
            # --- 0. Production Guard: without ?qa=1, window.__veil must remain undefined ---
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
                if guard_errors:
                    raise AssertionError(f"Plain production URL browser errors: {guard_errors}")
                ctx_guard.close()

            # --- 1. Desktop (1280x800): Build Screen -> Illusion -> Glitch -> Filter Choice -> BREAK Truth ---
            ctx_desktop = browser.new_context(viewport={"width": 1280, "height": 800})
            page = ctx_desktop.new_page()
            errors_desktop = open_app(page, qa_url)

            assert page.evaluate("() => window.__veil.scene") == "build"
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

            assert page.evaluate("() => window.__veil.mode") == "illusion"
            assert page.evaluate("() => window.__veil.state.currentRoomId") == "room_outpost"
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

            # Choose BREAK -> Truth mode + inspect patrol_01
            page.click("#btn-choose-break")
            page.wait_for_function("() => window.__veil.scene === 'play' && window.__veil.mode === 'truth'")
            assert page.locator(".game-shell").get_attribute("data-mode") == "truth"
            assert page.locator("#veil-status").get_attribute("data-veil") == "break"

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

            if errors_desktop:
                raise AssertionError(f"Desktop browser errors: {errors_desktop}")
            ctx_desktop.close()

            # --- 2. Mobile SE (375x667): Build Screen + 0px-Shift 1-Tap Inspect ---
            ctx_se = browser.new_context(viewport={"width": 375, "height": 667})
            page_se = ctx_se.new_page()
            errors_se = open_app(page_se, qa_url)

            assert_no_horizontal_overflow(page_se, "build-mobile-375")
            s2 = EVIDENCE_DIR / "02-build-mobile-375.png"
            page_se.screenshot(path=str(s2), full_page=False)
            shots.append(s2.name)

            page_se.click("#btn-build-start")
            page_se.wait_for_function("() => window.__veil.scene === 'play'")
            assert_canvas_rendered(page_se, "play-mobile-375")
            assert_no_horizontal_overflow(page_se, "play-mobile-375")

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

            if errors_se:
                raise AssertionError(f"Mobile 375x667 browser errors: {errors_se}")
            ctx_se.close()

            # --- 3. Mobile 14 (390x844): Outpost Illusion Gameplay View ---
            ctx_m14 = browser.new_context(viewport={"width": 390, "height": 844})
            page_m14 = ctx_m14.new_page()
            errors_m14 = open_app(page_m14, qa_url)

            page_m14.click("#btn-build-start")
            page_m14.wait_for_function("() => window.__veil.scene === 'play'")
            assert_canvas_rendered(page_m14, "outpost-mobile-390")
            assert_no_horizontal_overflow(page_m14, "outpost-mobile-390")

            # Exercise keyboard movement (ArrowRight) and verify player moved from x=1 to x=2
            page_m14.keyboard.press("ArrowRight")
            page_m14.wait_for_function("() => window.__veil.state.player.position.x === 2")

            s4 = EVIDENCE_DIR / "04-outpost-illusion-mobile-390.png"
            page_m14.screenshot(path=str(s4), full_page=False)
            shots.append(s4.name)

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
