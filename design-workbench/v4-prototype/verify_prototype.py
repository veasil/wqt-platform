from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent
HTML = ROOT / "wqt-scoring-prototype.html"
SHOTS = ROOT / "screenshots"


def assert_text(page, text: str) -> None:
    page.get_by_text(text, exact=False).first.wait_for(state="visible")


def main() -> None:
    SHOTS.mkdir(exist_ok=True)
    console_errors: list[str] = []
    page_errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on(
            "console",
            lambda message: console_errors.append(message.text)
            if message.type == "error"
            else None,
        )
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        page.goto(HTML.as_uri(), wait_until="networkidle")
        assert_text(page, "待接阿里云验证码服务")
        assert page.locator('[data-action="login"]').is_disabled()
        page.screenshot(path=SHOTS / "01-login.png", full_page=True)

        page.locator('[data-field="phone"]').fill("13800138000")
        page.locator('[data-field="secret"]').fill("demo123")
        page.locator('[data-action="verify"]').click()
        page.locator('[data-action="agree"]').check()
        assert page.locator('[data-action="login"]').is_enabled()
        page.locator('[data-action="login"]').click()
        page.locator('[data-od-id="activity-screen"]').wait_for()

        assert page.locator('[data-action="activity-next"]').is_disabled()
        page.locator('[data-field="activityCode"]').fill("wqtay")
        assert page.locator('[data-field="activityCode"]').input_value() == "WQTAY"
        page.locator('[data-action="validate-code"]').click()
        page.get_by_text("验证成功，已加载授权活动").wait_for()
        assert page.locator('[data-action="pick-activity"]').count() == 2
        page.locator('[data-action="pick-activity"]').first.click()
        assert page.locator('[data-action="activity-next"]').is_enabled()
        page.locator('[data-action="activity-next"]').click()

        page.locator('[data-od-id="config-screen"]').wait_for()
        assert_text(page, "步骤 2 / 2")
        assert page.locator('[data-action="mode"]').count() == 3
        page.locator('[data-action="mode"][data-value="custom"]').click()
        assert_text(page, "活动预设 4200 秒")
        assert page.locator('[data-od-id^="stage-stepper-"]').count() == 3
        page.locator('[data-action="start-game"]').click()

        page.locator('[data-od-id="game-screen"]').wait_for()
        assert_text(page, "下一张情景牌")
        assert page.locator('[data-od-id^="panel-"]').count() == 3
        page.screenshot(path=SHOTS / "02-game-empty.png", full_page=True)

        page.locator('[data-od-id="panel-status"]').click()
        assert_text(page, "当前卡牌")
        page.locator('[data-od-id="panel-skills"]').click()
        assert_text(page, "冷却中")
        assert page.locator(".side-panel").count() == 1
        page.locator('[data-od-id="panel-supervisor"]').click()
        assert_text(page, "开始现场录音")

        page.locator('[data-action="open-picker"]').click()
        page.locator('[data-od-id="quick-card-picker"]').wait_for()
        assert page.locator('[data-action="phase"]').count() == 3
        page.locator('[data-action="filter"][data-value="安全力"]').click()
        assert page.locator('[data-action="picker-card"]').count() >= 1
        page.locator('[data-action="picker-card"]').first.click()
        page.locator('[data-action="confirm-picker"]').click()
        page.locator('[data-od-id="scenario-card"]').wait_for()

        page.locator('[data-action="choice"][data-value="C"]').click()
        page.locator('[data-action="submit-choice"]').click()
        page.locator('[data-od-id="card-feedback"]').wait_for()
        assert_text(page, "安全力 +1")
        assert_text(page, "脑波力 −1")
        page.locator('[data-action="listen"]').click()
        assert_text(page, "正在播放卡牌反馈")
        page.screenshot(path=SHOTS / "03-card-feedback.png", full_page=True)

        page.locator('[data-action="next-card"]').click()
        assert_text(page, "下一张情景牌")
        page.locator('[data-action="pause"]').click()
        page.locator('[data-action="confirm-pause"]').click()
        assert page.locator('[data-field="cardCode"]').is_disabled()
        page.locator('[data-action="resume"]').click()
        assert page.locator('[data-field="cardCode"]').is_enabled()

        page.locator('[data-action="dev"]').click()
        page.locator('[data-od-id="developer-notes"]').wait_for()
        assert_text(page, "真实集成边界")
        page.screenshot(path=SHOTS / "04-developer-notes.png", full_page=True)
        page.locator('[data-action="dev"]').last.click()

        page.locator('[data-action="stop"]').click()
        page.locator('[data-action="confirm-stop"]').click()
        assert_text(page, "已记录你的选择")
        assert page.locator('[data-field="cardCode"]').is_disabled()

        browser.close()

    if console_errors or page_errors:
        raise AssertionError(
            f"Browser errors: console={console_errors!r}, page={page_errors!r}"
        )

    print("PASS: login -> activity -> config -> game -> picker -> feedback -> pause/stop")
    print(f"Screenshots: {SHOTS}")


if __name__ == "__main__":
    main()
