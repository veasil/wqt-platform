"""Browser UI contracts with fake HTTP responses; no production or database access."""
import json
import os
from pathlib import Path
import subprocess
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
env = {key: value for key, value in os.environ.items() if key.lower() in {"path", "systemroot", "windir", "temp", "tmp", "pathext"}}
env["NODE_ENV"] = "test"
server = subprocess.Popen(["node", "tests/browser/static-server.mjs"], cwd=root, env=env,
    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
try:
    startup = server.stdout.readline()
    if not startup:
        raise RuntimeError(server.stderr.read())
    base = f"http://127.0.0.1:{json.loads(startup)['port']}"
    file_path = "/api/session-files/00000000-0000-4000-8000-000000000001"
    downloads = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(accept_downloads=True)

        def intercept(route):
            request = route.request
            if not request.url.startswith(base):
                route.abort()
                return
            path = request.url[len(base):].split("?")[0]
            if not path.startswith("/api/"):
                route.continue_()
                return
            if path == file_path:
                downloads.append(request.headers.get("authorization"))
                route.fulfill(status=200, content_type="text/html", body="<h1>fixture report</h1>",
                    headers={"Content-Disposition": "attachment; filename=fixture.html", "Cache-Control": "private, no-store"})
                return
            data = {
                "/api/settings": {"ok": True, "settings": []},
                "/api/cards": {"cards": []},
                "/api/card-groups": {"groups": []},
                "/api/me": {"user": {"id": 1, "guardianName": "测试守望者", "role": "watcher", "watcherLevel": "initial", "isProfileComplete": True}, "validity": {"valid": True, "until": 253402300799000}},
                "/api/me/files": {"files": [{"name": "fixture.html", "type": "report_html", "size": 23, "lastModified": 1789170000000, "url": file_path}]},
                "/api/me/activities": {"activities": []},
                "/api/me/activities/created": {"activities": []},
                "/api/me/sessions": {"sessions": [], "total": 0},
                "/api/me/level-application": {"application": None},
            }.get(path, {})
            route.fulfill(status=200, content_type="application/json", body=json.dumps(data))

        context.route("**/*", intercept)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(base + "/")
        page.wait_for_load_state("networkidle")
        assert page.locator("#dev-login-btn").count() == 0
        assert page.locator("#tab-dev").count() == 0

        page.goto(base + "/admin/")
        page.wait_for_load_state("networkidle")
        assert page.get_by_text("开发者密钥", exact=True).count() == 0
        assert page.locator('input[type="password"]').count() == 1

        page.evaluate("localStorage.setItem('WQT_AUTH_TOKEN', 'browser-fixture-token')")
        page.goto(base + "/my.html")
        page.wait_for_load_state("networkidle")
        page.locator('[data-tab="activities"]').click()
        button = page.locator(".file-download").first
        button.wait_for(state="visible")
        with page.expect_download() as result:
            button.click()
        assert result.value.suggested_filename.endswith(".html")
        assert downloads == ["Bearer browser-fixture-token"]
        rejected = page.evaluate("""async () => {
            const { downloadSessionFile } = await import('/session-files.js');
            let message = '';
            const ok = await downloadSessionFile('https://example.invalid/api/session-files/00000000-0000-4000-8000-000000000001', {onError: e => {message=e.message}});
            return {ok, message};
        }""")
        assert rejected["ok"] is False and rejected["message"]
        assert downloads == ["Bearer browser-fixture-token"]
        assert not errors, errors
        browser.close()
    print("BROWSER_CONTRACTS_PASSED: login, authenticated file download, off-origin rejection")
finally:
    server.terminate()
    try:
        server.wait(timeout=10)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait(timeout=5)
