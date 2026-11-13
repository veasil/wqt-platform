"""Render actual PDFs and PNGs; collect asset and text bounds evidence."""
from pathlib import Path
import json
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
import pypdfium2 as pdfium

ROOT=Path(__file__).resolve().parents[4]
OUT=ROOT/'output/wqt-vi-v3'
for d in ['pages','applications']:(OUT/d).mkdir(exist_ok=True)
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto((OUT/'WQT-VI-V3.html').as_uri())
    page.evaluate('document.fonts.ready')
    page.wait_for_load_state('networkidle')
    assert page.evaluate('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
    bounds=page.evaluate('''()=>[...document.querySelectorAll('.board')].flatMap(board=>{
      let b=board.getBoundingClientRect();return [...board.querySelectorAll('h1,h2,h3,p,span,small,b,strong')].filter(e=>!e.closest('.art')).flatMap(e=>{
        let r=e.getBoundingClientRect();return (r.width>0 && (r.left<b.left-1 || r.right>b.right+1 || r.top<b.top-1 || r.bottom>b.bottom+1))?[{page:board.id,text:e.innerText,bounds:[r.x-b.x,r.y-b.y,r.width,r.height]}]:[]
      });})''')
    for n in range(1,13):page.locator(f'#page-{n:02d}').screenshot(path=str(OUT/'pages'/f'preview-{n:02d}.png'))
    page.pdf(path=str(OUT/'WQT-VI-V3.pdf'),print_background=True,prefer_css_page_size=True)
    apps=json.loads((OUT/'application-manifest.json').read_text())
    app_bounds={}
    for name,size in apps.items():
        page.set_viewport_size(size)
        page.goto((OUT/f'{name}.html').as_uri())
        page.evaluate('document.fonts.ready')
        page.wait_for_load_state('networkidle')
        assert page.evaluate('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
        app_bounds[name]=page.evaluate('''()=>{let art=document.querySelector('.art'),b=art.getBoundingClientRect();return [...art.querySelectorAll('h1,h2,h3,p,span,b,strong')].flatMap(e=>{let r=e.getBoundingClientRect();return r.width>0&&(r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1)?[e.innerText]:[]})}''')
        page.locator('.art').screenshot(path=str(OUT/'applications'/f'{name}.png'))
        page.pdf(path=str(OUT/'applications'/f'{name}.pdf'),print_background=True,prefer_css_page_size=True)
    browser.close()
doc=pdfium.PdfDocument(OUT/'WQT-VI-V3.pdf')
assert len(doc)==12
for i,p in enumerate(doc):
    im=p.render(scale=1.5).to_pil()
    im.save(OUT/'pages'/f'page-{i+1:02d}.png')
sheet=Image.new('RGB',(1500,3102),'#e5e9f0');d=ImageDraw.Draw(sheet)
for i in range(12):
    im=Image.open(OUT/'pages'/f'page-{i+1:02d}.png').convert('RGB');im.thumbnail((726,484))
    x=12+(i%2)*750;y=25+(i//2)*515
    sheet.paste(im,(x,y));d.text((x,y-17),f'{i+1:02d} / PDF page',fill='#3e4e69')
sheet.save(OUT/'overview.png')
data={'pages':len(doc),'all_images_loaded':True,'javascript_errors':errors,'book_text_outside_page':bounds,'applications_text_outside_canvas':app_bounds,'pdf_render':'pypdfium2, scale 1.5; actual PDF pages','independent_applications':len(apps)}
(OUT/'render-evidence.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(data,ensure_ascii=False))
