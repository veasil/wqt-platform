"""Load a genuine challenge without attempting to solve or bypass it."""
from pathlib import Path
from urllib.parse import urlsplit
import sys
from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:8188'
OUT=Path('C:/ArdenDev/tmp/wqt-live-captcha');OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':1440,'height':1000})
 violations=[]
 page.on('console',lambda m:violations.append(m.text) if 'Content Security Policy' in m.text else None)
 options=page.request.get(BASE+'/api/auth/verification-options').json()
 assert options['captchaEnabled'] and options['captchaAppId']
 assert not any('secret' in key.lower() for key in options)
 rejected=page.request.post(BASE+'/api/auth/sms/send',data={'phone':'16600000889','captchaTicket':'wqt-invalid-ticket-probe','captchaRandstr':'wqt-invalid-rand-probe'})
 assert rejected.status==400
 assert 'mockCode' not in rejected.json()
 page.goto(BASE+'/player/')
 page.locator('#enter').click()
 password_mode='--password' in sys.argv
 if not password_mode:page.locator('#auth-sms').click()
 assert page.locator('.human-verification,#human-check').count()==0
 page.locator('[name=phone]').fill('16600000889')
 if password_mode:
  page.locator('[name=password]').fill('synthetic-not-a-real-password')
  page.locator('#auth-form .primary').click()
 else:page.locator('#send-code').click()
 page.wait_for_timeout(6000)
 assert page.evaluate('() => typeof window.TencentCaptcha === "function"')
 frames=[f for f in page.frames if 'captcha' in (urlsplit(f.url).hostname or '')]
 page.screenshot(path=str(OUT/('challenge-password.png' if password_mode else 'challenge.png')),full_page=True)
 assert not violations,violations
 assert frames,'Real captcha frame did not load'
 print('LIVE_CAPTCHA_UI_LOADED',{'mode':'password' if password_mode else 'sms','frames':len(frames),'invalidTicketRejected':True,'humanCompletionPending':True})
 browser.close()
