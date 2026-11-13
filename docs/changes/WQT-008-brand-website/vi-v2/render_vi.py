"""Render the VI study; inspect outputs before treating them as deliverables."""
from pathlib import Path
import json
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[4]
OUT=ROOT/'output'/'wqt-vi-v2'
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1280,'height':850},device_scale_factor=1,reduced_motion='reduce')
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto((OUT/'vi-proposal.html').as_uri())
    page.wait_for_load_state('networkidle')
    page.evaluate('document.fonts.ready')
    assert page.evaluate('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
    sizes=page.locator('.board').evaluate_all('(els)=>els.map(e=>({width:e.offsetWidth,height:e.offsetHeight}))')
    assert len(sizes)==10 and all(s=={'width':1280,'height':800} for s in sizes)
    text_overflow=page.evaluate('''() => [...document.querySelectorAll('.board')].flatMap(board => {
      const b=board.getBoundingClientRect();
      return [...board.querySelectorAll('h1,h2,h3,h4,p,footer')].filter(el => {
        const r=el.getBoundingClientRect();
        return r.width>0 && (r.left<b.left-1 || r.right>b.right+1 || r.top<b.top-1 || r.bottom>b.bottom+1);
      }).map(el => ({board:board.id,text:el.textContent.slice(0,40)}));
    })''')
    assert not text_overflow,text_overflow
    for i in range(1,11):
        page.locator(f'#board-{i}').screenshot(path=str(OUT/f'board-{i:02d}.png'))
    page.locator('#demo-action').click()
    assert '已选择' in page.locator('#demo-feedback').inner_text()
    page.locator('#demo-reset').click()
    assert '选择一个行动' in page.locator('#demo-feedback').inner_text()
    page.locator('#play-motion').click()
    assert page.locator('.motion-window i').first.evaluate('(e)=>getComputedStyle(e).animationName')=='none'
    page.emulate_media(reduced_motion='no-preference')
    page.locator('#play-motion').click()
    page.wait_for_function("getComputedStyle(document.querySelector('.motion-window i')).animationName === 'reveal'")
    page.emulate_media(media='print',reduced_motion='reduce')
    page.pdf(path=str(OUT/'WQT-VI-Proposal-V2.pdf'),print_background=True,prefer_css_page_size=True)
    browser.close()
assert not errors,errors
overview=Image.new('RGB',(1280,2100),'#dce2eb')
draw=ImageDraw.Draw(overview)
for i in range(1,11):
    im=Image.open(OUT/f'board-{i:02d}.png').convert('RGB')
    im.thumbnail((624,390))
    x=((i-1)%2)*640+8;y=((i-1)//2)*420+20
    overview.paste(im,(x,y))
    draw.text((x,y-15),f'{i:02d} / WQT VI V2',fill='#243d66')
overview.save(OUT/'overview.png')
result={'boards':sizes,'all_images_loaded':True,'text_outside_boards':text_overflow,'javascript_errors':errors,'local_state_demo':'passed','normal_motion':'passed','reduced_motion':'passed','pdf':'WQT-VI-Proposal-V2.pdf'}
(OUT/'render-evidence.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=True))
