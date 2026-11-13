"""Browser checks for the standalone prototype; never starts the business server.

Start a static HTTP server at 127.0.0.1:4177 rooted at prototype, then:
  python docs/changes/WQT-008-brand-website/verify_preview.py
"""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / 'output' / 'wqt-brand-v1'
OUTPUT.mkdir(parents=True, exist_ok=True)
BASE = 'http://127.0.0.1:4177/'
report = {'viewports': [], 'interactions': [], 'errors': []}

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    page.on('pageerror', lambda error: report['errors'].append(str(error)))
    for width in (375, 768, 1024, 1440):
        page.set_viewport_size({'width': width, 'height': 1000})
        for filename in ('index.html', 'components.html'):
            response = page.goto(BASE + filename)
            assert response.status == 200
            page.wait_for_load_state('networkidle')
            page.locator('.site-footer').scroll_into_view_if_needed()
            page.wait_for_function('Array.from(document.images).every(img => img.complete)')
            assert page.evaluate('Array.from(document.images).every(img => img.naturalWidth > 0)')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width, filename)
            page.evaluate('window.scrollTo({top:0, behavior:"instant"})')
            page.wait_for_timeout(600)
            page.screenshot(path=str(OUTPUT / f'{filename[:-5]}-{width}.png'), full_page=True)
            report['viewports'].append({'page': filename, 'width': width, 'overflow': False, 'assets': 'loaded'})

    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.goto(BASE)
    page.get_by_role('button', name='创心力').click()
    assert page.locator('#power-name').inner_text() == '创心力'
    assert 'power=P' in page.url
    page.get_by_role('button', name='资方与长期伙伴').click()
    assert '长期发展的可能' in page.locator('#partner-title').inner_text()
    assert 'partner=capital' in page.url
    page.reload()
    assert page.locator('[data-partner="capital"]').get_attribute('aria-pressed') == 'true'
    assert page.locator('#power-name').inner_text() == '创心力'
    opener = page.locator('#partner-cta')
    opener.click()
    assert page.locator('#contact-dialog').is_visible()
    assert '长期发展' in page.locator('#contact-context').inner_text()
    page.keyboard.press('Escape')
    assert not page.locator('#contact-dialog').is_visible()
    assert opener.evaluate('(element)=>element === document.activeElement')
    report['interactions'].append('five powers, audience switching, URL/reload, dialog Escape and focus restore')

    page.goto(BASE)
    page.locator('.site-header [data-contact]').click()
    for _ in range(8):
        page.keyboard.press('Tab')
        assert page.evaluate('document.querySelector("#contact-dialog").contains(document.activeElement)')
    page.get_by_role('button', name='关闭合作联系弹窗').click()
    report['interactions'].append('modal keyboard focus containment')

    page.set_viewport_size({'width': 375, 'height': 812})
    page.goto(BASE)
    page.get_by_role('button', name='展开导航').click()
    assert page.locator('#site-nav').is_visible()
    page.locator('#site-nav [data-contact]').click()
    page.keyboard.press('Escape')
    assert page.locator('.menu-toggle').evaluate('(element)=>element === document.activeElement')
    page.get_by_role('button', name='展开导航').click()
    page.get_by_role('navigation', name='主要导航').get_by_role('link', name='合作方向').click()
    assert page.locator('.menu-toggle').get_attribute('aria-expanded') == 'false'
    report['interactions'].append('mobile navigation, anchor close and mobile dialog focus recovery')

    page.goto(BASE + 'components.html')
    page.get_by_role('button', name='演示提交状态').click()
    assert page.locator('#demo-email').get_attribute('aria-invalid') == 'true'
    assert page.locator('#demo-email').evaluate('(element)=>element === document.activeElement')
    page.locator('#demo-email').fill('name@example.com')
    page.get_by_role('button', name='演示提交状态').click()
    assert page.locator('#demo-form button[type="submit"]').is_disabled()
    page.locator('#demo-status').wait_for(state='visible')
    assert '没有发送' in page.locator('#demo-status').inner_text()
    page.get_by_role('button', name='重置演示').click()
    assert page.locator('#demo-email').input_value() == ''
    assert not page.locator('#demo-status').is_visible()
    page.locator('#demo-email').fill('name@example.com')
    page.get_by_role('button', name='演示提交状态').click()
    page.get_by_role('button', name='重置演示').click()
    page.wait_for_timeout(1000)
    assert not page.locator('#demo-status').is_visible()
    report['interactions'].append('form invalid/loading/success/reset and stale timer cancellation')

    page.emulate_media(reduced_motion='reduce')
    page.goto(BASE)
    assert page.locator('.hero-art').evaluate('(el)=>getComputedStyle(el).animationName') == 'none'
    assert page.evaluate('getComputedStyle(document.documentElement).scrollBehavior') == 'auto'
    page.goto(BASE + 'components.html')
    page.get_by_role('button', name='播放一次动效').click()
    assert page.locator('.motion-block').evaluate('(el)=>getComputedStyle(el).animationName') == 'none'
    report['interactions'].append('reduced motion: entry animation and smooth scrolling disabled')
    assert not report['errors'], report['errors']
    browser.close()

print(json.dumps(report, ensure_ascii=True, indent=2))
(OUTPUT / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
