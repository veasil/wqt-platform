"""Offline report export with the installed Python Playwright WebKit or Chromium.

No backend, credentials, AI, or external requests. WebKit is not a real Mac Safari.
"""
import argparse
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--browser', choices=['webkit', 'chromium'], default='webkit')
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[2]
source = (root / 'public/game-review.js').read_text(encoding='utf-8')
vendor = (root / 'public/vendor/html2canvas-1.4.1/html2canvas.min.js').read_text(encoding='utf-8')

with sync_playwright() as p:
    browser = getattr(p, args.browser).launch(headless=True)
    try:
        page = browser.new_page(accept_downloads=True, viewport={'width': 1100, 'height': 950})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('http://localhost/**', lambda route: route.fulfill(content_type='text/html', body='<main></main>'))
        page.goto('http://localhost/fixture')
        page.add_script_tag(content=source)
        html = page.evaluate('''source => GameReview.buildReportHtml(
            {story:{paragraphs:['Synthetic offline report.']},pact:{items:['Practice together.']}},
            {session:{id:1,startedAt:1000,finalScore:80}}, {}, [], [], {}, source)''', vendor)
        report_file = args.output.resolve() / 'report.html'
        report_file.write_text(html, encoding='utf-8')
        network_requests = []
        def block_network(route):
            network_requests.append(route.request.url)
            route.abort()
        page.unroute('http://localhost/**')
        page.route('http*://**', block_network)
        # Refuse HTTP(S) without Playwright's offline mode: this WebKit build
        # also blocks local Blob image previews when offline mode is enabled.
        page.set_content(html, wait_until='networkidle')
        print('REPORT_LOADED_WITH_NETWORK_BLOCKED', flush=True)
        for index in range(2):
            old = page.locator('#export-save').get_attribute('href')
            page.locator('#export-btn').click()
            page.wait_for_function('old => {const link=document.querySelector("#export-save"); return !link.hidden && link.href !== old;}', arg=old)
            print('PNG_READY', index, flush=True)
            page.wait_for_function('document.querySelector("#export-preview").naturalWidth > 0')
            with page.expect_download() as event:
                page.locator('#export-save').click()
            target = args.output / ('report-' + str(index) + '.png')
            event.value.save_as(target)
            assert target.read_bytes()[:8] == bytes.fromhex('89504e470d0a1a0a')
        page.screenshot(path=str(args.output / 'export-page.png'), full_page=True)
        prior = page.locator('#export-save').get_attribute('href')
        page.evaluate('''() => {window.html2canvas=async()=>{throw new TypeError('x.length');}}''')
        page.locator('#export-btn').click()
        page.wait_for_function('!document.querySelector("#export-btn").disabled')
        assert 'length' not in page.locator('#export-status').inner_text()
        assert page.locator('#export-save').get_attribute('href') == prior
        assert page.locator('#poster').is_visible()
        assert errors == [], errors
        assert network_requests == [], network_requests
        print(args.browser.upper() + '_OFFLINE_EXPORT_RETRY_PASS')
    finally:
        browser.close()
