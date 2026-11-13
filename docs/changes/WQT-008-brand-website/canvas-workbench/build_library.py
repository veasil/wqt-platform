"""Produce independent brand SVG assets, UI catalog, applications and Canvas additions.

Raster backgrounds are made with the built-in image model, not this script.
Existing Canvas nodes are retained; generated nodes use a managed K- prefix.
"""
import argparse
import hashlib
import html
import json
import math
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT/'output/wqt-brand-library'
ASSETS = OUT/'assets'
PAGES = OUT/'pages'
for path in [ASSETS, PAGES]:
    path.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--vault', required=True)
parser.add_argument('--draft-ui', action='store_true')
args = parser.parse_args()
vault = Path(args.vault).resolve()
target = vault/'06-Apps/伍仟天品牌素材工作台'
stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
source = ROOT/'output/wqt-vi-v3/assets'
for name in ['company-mark.png', 'program-badge-s2.png', 'program-badge-s3.png', 'education-pack.png', 'family-scene.png']:
    shutil.copy2(source/name, ASSETS/name)
for name in ['logo.png', 'wu-2-5.png', 'wu-6-11.png', 'wu-12-15.png']:
    shutil.copy2(ROOT/'public/brand'/name, ASSETS/name)

COLORS = {'brand':'#354AAD','electric':'#337CFF','navy':'#111D42','gold':'#DEB657','paper':'#F5F8FF',
          'text':'#163151','muted':'#516B87','success':'#227743','warning':'#986009','error':'#B33838',
          'education':'#354AAD','growth':'#7544AF','governance':'#D95A27'}
(ASSETS/'tokens.json').write_text(json.dumps({'colors':COLORS,'spacing':[4,8,12,16,24,32,48,64],
 'font':{'family':'Microsoft YaHei, PingFang SC, sans-serif','body':18,'label':14,'title':32},
 'radius':{'control':10,'card':18},'status':'候选设计变量；未作为全品牌定稿'},ensure_ascii=False,indent=2),encoding='utf-8')

# Explicit silhouettes, not automatically mapped between domain classifications.
SHAPES = {
 'shield':'<path d="M32 8 51 16v14c0 13-8 21-19 27-11-6-19-14-19-27V16Z"/><path d="m23 32 6 6 12-14"/>',
 'brain':'<path d="M31 15c-8-11-22-1-17 9-10 6-7 20 3 21 0 10 15 14 15 3V19m0 0c8-13 24-3 19 8 10 6 6 18-3 20-1 11-16 10-16 1"/><path d="m21 21 4 5-3 7m-7 5 9-1 4 5m14-20-4 6 6 5m-6 9 6-4 6 3"/>',
 'body':'<circle cx="32" cy="14" r="6"/><path d="M17 28 32 23l15 5m-15-5v19m0-4L20 54m12-16 12 16"/>',
 'heart':'<path d="M32 51C7 34 6 18 18 14c6-2 11 1 14 6 3-5 8-8 14-6 12 4 11 20-14 37Z"/><path d="M17 31h8l4-7 6 14 4-7h9"/>',
 'people':'<circle cx="32" cy="19" r="7"/><circle cx="14" cy="25" r="5"/><circle cx="50" cy="25" r="5"/><path d="M21 51V39c0-11 22-11 22 0v12M6 47V36c0-5 8-8 13-4m39 15V36c0-5-8-8-13-4"/>',
 'wallet':'<path d="M12 19h38v34H12Z"/><path d="M12 19v-5l31-5v10m7 14H37v11h13"/><circle cx="42" cy="38" r="1.5"/>',
 'lock':'<rect x="16" y="28" width="32" height="26" rx="5"/><path d="M22 28V19c0-14 20-14 20 0v9"/><circle cx="32" cy="40" r="3"/><path d="M32 43v5"/>',
 'device':'<rect x="9" y="10" width="32" height="28" rx="3"/><path d="M25 38v9m-8 0h16"/><rect x="40" y="25" width="15" height="29" rx="3"/><path d="M46 49h3"/>',
 'algorithm':'<path d="m32 10 20 13-7 25-27-1-7-24Z"/><path d="m32 10-7 25 20 13M11 23l34 25m-27-1L52 23M25 35h27"/><circle cx="32" cy="10" r="3"/><circle cx="25" cy="35" r="3"/>',
 'content':'<rect x="10" y="14" width="44" height="36" rx="6"/><path d="m27 23 15 9-15 9Z"/>',
 'search':'<circle cx="27" cy="27" r="17"/><path d="m40 40 14 14"/><path d="M27 18v12m0 6v1"/>',
 'spark':'<path d="M32 7c2 17 7 22 24 25-17 2-22 7-24 25-2-18-7-23-24-25 17-3 22-8 24-25Z"/><path d="m49 8 1 6 6 1-6 1-1 6-1-6-6-1 6-1Z"/>',
 'book':'<path d="M32 16C23 9 13 9 7 13v36c7-4 17-4 25 2 8-6 18-6 25-2V13c-6-4-16-4-25 3Zm0 0v35"/><path d="M14 20h11m-11 8h11m14-8h11m-11 8h11"/>',
 'code':'<path d="m23 20-13 12 13 12m18-24 13 12-13 12M36 12l-8 40"/>',
 'report':'<path d="M15 9h26l9 9v37H15Z"/><path d="M40 9v11h10M23 30h19m-19 9h19m-19 9h12"/>',
 'chat':'<path d="M10 11h44v32H30L17 54V43h-7Z"/><path d="M20 22h24m-24 10h18"/>',
 'hand':'<path d="M24 52 12 35c-4-7 3-11 8-4l4 5V16c0-8 9-8 9 0v12-16c0-7 9-7 9 0v16-9c0-7 9-7 9 0v11c0-7 9-7 9 0v11c0 14-10 16-10 16H30Z"/>',
 'lightbulb':'<path d="M23 43c0-10-10-11-10-23 0-23 38-23 38 0 0 12-10 13-10 23Z"/><path d="M23 49h18m-15 6h12M27 24l5 6 5-6m-5 6v13"/>',
 'check':'<path d="m13 32 13 13 25-27"/>',
 'arrow':'<path d="M10 32h42M37 17l15 15-15 15"/>',
 'close':'<path d="m17 17 30 30m-30 0 30-30"/>',
 'download':'<path d="M32 9v31m-12-12 12 12 12-12M12 43v12h40V43"/>',
 'pause':'<rect x="18" y="12" width="9" height="40" rx="2"/><rect x="37" y="12" width="9" height="40" rx="2"/>',
 'play':'<path d="m21 10 32 22-32 22Z"/>',
 'settings':'<path d="m27 8 10 0 3 9 9-3 7 10-6 8 6 8-7 10-9-3-3 9H27l-3-9-9 3-7-10 6-8-6-8 7-10 9 3Z"/><circle cx="32" cy="32" r="9"/>',
 'clock':'<circle cx="32" cy="32" r="24"/><path d="M32 17v17l12 7"/>',
}
ICON_GROUPS = {
 'dimensions':[('device','设备','#354AAD'),('algorithm','算法','#7544AF'),('content','内容','#D95A27'),('people','相关方','#378534')],
 'risks':[('body','身体','#354AAD'),('heart','心理','#7544AF'),('people','社交','#D95A27'),('wallet','经济','#378534'),('lock','数字权益','#354AAD')],
 'series':[('people','教育支持','#354AAD'),('spark','成长支持','#7544AF'),('report','技术治理','#D95A27')],
 'process':[('search','风险预演','#354AAD'),('brain','能力激活','#7544AF'),('shield','免疫形成','#D95A27')],
 'abilities':[('shield','安全力','#354AAD'),('brain','脑波力','#7544AF'),('hand','实感力','#227743'),('lightbulb','创心力','#D95A27'),('chat','沟通力','#20888C')],
 'actions':[(name,label,'#354AAD') for name,label in [('check','确认'),('arrow','下一步'),('close','关闭'),('download','下载'),('pause','暂停'),('play','继续'),('settings','设置'),('clock','时长')]],
}
icons = []
for family, items in ICON_GROUPS.items():
    for i, (shape, label, color) in enumerate(items):
        name = f'icon-{family}-{shape}.svg'
        contents = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="{label}"><defs><linearGradient id="p" x2="0" y2="1"><stop stop-color="#fff"/><stop offset="1" stop-color="#EDF2FF"/></linearGradient></defs><circle cx="64" cy="64" r="59" fill="url(#p)" stroke="{color}" stroke-width="2.5"/><circle cx="64" cy="64" r="53" fill="none" stroke="{color}" stroke-opacity=".18"/><path d="M34 14A55 55 0 0 1 85 13" fill="none" stroke="#DEB657" stroke-width="3"/><g transform="translate(30 30) scale(1.06)" fill="none" stroke="{color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">{SHAPES[shape]}</g></svg>'''
        (ASSETS/name).write_text(contents,encoding='utf-8')
        icons.append(dict(file=name,label=label,family=family,status='新矢量候选；语义分类独立'))

def frame(w,h,theme):
    c=24 if w>400 else 16
    d=f'M{c} 4H{w*.4}l12 12H{w*.73}l12-12H{w-c}L{w-4} {c}V{h-c}L{w-c} {h-4}H{w*.66}l-12-12H{c}L4 {h-c}V{c}Z'
    dark = theme=='dark'
    fill = '#0B192C' if dark else '#F4FAFF'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><defs><linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#FFF"/><stop offset=".28" stop-color="#4874A6"/><stop offset=".62" stop-color="#BCEDFF"/><stop offset="1" stop-color="#284B7A"/></linearGradient><linearGradient id="fill" x2="1" y2="1"><stop stop-color="{fill}"/><stop offset="1" stop-color="{'#122B45' if dark else '#E7F3FF'}"/></linearGradient><linearGradient id="glint" gradientUnits="userSpaceOnUse" x1="{w*.08}" x2="{w*.4}"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><path d="{d}" fill="url(#fill)" stroke="#183654" stroke-width="5"/><path d="{d}" fill="none" stroke="url(#edge)" stroke-width="2"/><path d="{d}" transform="translate(5 5) scale({(w-10)/w} {(h-10)/h})" fill="none" stroke="url(#edge)" stroke-opacity=".45"/><path d="M{w*.08} 4H{w*.4}" fill="none" stroke="url(#glint)" stroke-width="3"/></svg>'''
for theme in ['light','dark']:
    for size,w,h in [('card',600,420),('banner',1200,360),('panel',900,680)]:
        (ASSETS/f'frame-{size}-{theme}.svg').write_text(frame(w,h,theme),encoding='utf-8')

CSS = '''
:root{--blue:#354AAD;--electric:#337CFF;--ink:#163151;--muted:#516B87;--gold:#DEB657;--paper:#F5F8FF;--line:#C8D8EC;--success:#227743;--error:#B33838;--warning:#986009}
*{box-sizing:border-box}body{margin:0;background:#091327;color:var(--ink);font-family:"Microsoft YaHei","PingFang SC",sans-serif}button,input,select,textarea{font:inherit}button{cursor:pointer}a{color:inherit}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,a:focus-visible{outline:3px solid var(--gold);outline-offset:4px}button:disabled{cursor:default;opacity:.45}button{border:0}img{max-width:100%}
.board{width:1400px;height:1000px;padding:40px;overflow:hidden;background:var(--paper);position:relative;display:flex;flex-direction:column;gap:24px}.board.dark{color:#EAF5FF;background:#0A152B}.board header{display:flex;justify-content:space-between;align-items:center;gap:20px;height:72px;flex-shrink:0}.board h1{font-size:32px;line-height:1.25;margin:0}.board header p{font-size:14px;margin:8px 0 0;color:var(--muted)}.board.dark header p{color:#A4BAD3}.board header img{width:150px;height:60px;object-fit:contain}.board footer{margin-top:auto;border-top:1px solid var(--line);padding-top:12px;display:flex;justify-content:space-between;font-size:13px;color:var(--muted)}.board.dark footer{color:#A4BAD3;border-color:#304967}
h2,h3,p{margin-top:0}h2{font-size:23px;margin-bottom:16px}h3{font-size:18px;margin-bottom:10px}p{line-height:1.7}.grid{display:grid;gap:20px}.cols2{grid-template-columns:repeat(2,minmax(0,1fr))}.cols3{grid-template-columns:repeat(3,minmax(0,1fr))}.cols4{grid-template-columns:repeat(4,minmax(0,1fr))}.tile{padding:24px;background:#fff;border:1px solid var(--line);border-radius:16px;min-width:0}.dark .tile{background:#0F223A;border-color:#30506D}.tile p{font-size:15px;color:var(--muted)}.dark .tile p{color:#A4BAD3}.row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.stack{display:flex;flex-direction:column;gap:16px}.caption{font-size:13px;color:var(--muted);margin:8px 0 0}.dark .caption{color:#A4BAD3}.icon{width:64px;height:64px}.icon-tile{text-align:center;padding:20px}.icon-tile img{width:100px;height:100px}.icon-tile h3{margin-top:14px}.eyebrow{font-size:13px;letter-spacing:1px;color:var(--blue);font-weight:700}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:10px 22px;border:1px solid transparent;border-radius:10px;background:var(--blue);color:white;font-weight:700;font-size:16px;transition:background .15s,transform .15s;white-space:nowrap}.btn:hover,.btn.hover{background:#293C95}.btn:active,.btn.pressed{transform:translateY(1px);background:#213479}.btn.secondary{color:var(--blue);border-color:#9DB3DF;background:white}.btn.quiet{background:#EAF1FF;color:var(--blue)}.btn.danger{background:var(--error)}.btn.focus{outline:3px solid var(--gold);outline-offset:4px}.btn.small{min-height:36px;font-size:14px;padding:7px 14px}.btn.icon-only{width:46px;padding:10px}.spinner{width:16px;height:16px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;display:inline-block;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
label{display:block;font-size:15px;font-weight:700;margin-bottom:8px}input:not([type=checkbox]):not([type=radio]),select,textarea{width:100%;padding:12px 14px;border:1px solid #A7BBDC;border-radius:10px;background:white;color:var(--ink);min-height:46px}textarea{resize:vertical;min-height:110px}.field{margin-bottom:18px}.hint{font-size:13px;margin:8px 0 0;color:var(--muted)}.error-text{color:var(--error);font-size:13px;margin-top:8px}.invalid{border-color:var(--error)!important;box-shadow:0 0 0 2px #B3383810}.checkline{display:flex;align-items:center;gap:12px;font-weight:400;min-height:40px}.checkline input{accent-color:var(--blue);width:20px;height:20px}.switch{display:flex;align-items:center;gap:12px}.switch button{width:48px;height:28px;border-radius:30px;background:#91A6C0;position:relative}.switch button:before{content:"";position:absolute;width:20px;height:20px;left:4px;top:4px;border-radius:50%;background:white}.switch button[aria-checked=true]{background:var(--blue)}.switch button[aria-checked=true]:before{left:24px}
.tag{display:inline-flex;gap:6px;align-items:center;padding:5px 10px;border-radius:7px;font-size:13px;font-weight:700;background:#EAF1FF;color:var(--blue)}.tag.success{background:#E5F4E9;color:var(--success)}.tag.warning{background:#FFF0D3;color:var(--warning)}.tag.error{background:#FCE9E9;color:var(--error)}.tag.purple{background:#F1EAF9;color:#7544AF}.tag.orange{background:#FFF0E7;color:#D95A27}
.tabs{display:flex;gap:5px;border-bottom:1px solid var(--line);margin-bottom:20px}.tab{padding:12px 20px;background:transparent;color:var(--muted);border-bottom:3px solid transparent;font-weight:700}.tab[aria-selected=true],.tab.active{color:var(--blue);border-color:var(--blue)}.segmented{display:flex;gap:4px;padding:5px;border-radius:12px;background:#E5EDF9}.segmented button{padding:10px 16px;border-radius:8px;color:var(--muted);background:transparent}.segmented button.active{background:white;color:var(--blue);box-shadow:0 2px 6px #24426E16}.nav{display:flex;gap:24px;align-items:center;padding:18px 24px;background:white;border-radius:14px;border:1px solid var(--line)}.nav img{width:135px}.nav a{text-decoration:none;font-weight:700;font-size:15px}.nav a.active{color:var(--blue)}.nav .right{margin-left:auto}.side{width:220px;padding:20px;background:white;border:1px solid var(--line);border-radius:14px}.side a{display:block;padding:13px;border-radius:8px;text-decoration:none;font-size:15px}.side a.active{background:#EAF1FF;color:var(--blue);font-weight:700}.pagination{display:flex;gap:8px}.pagination button{width:40px;height:40px;border:1px solid var(--line);border-radius:8px;background:white;color:var(--ink)}.pagination button.active{background:var(--blue);color:white}.steps{display:flex;gap:16px;align-items:center}.steps span{display:inline-flex;align-items:center;gap:10px;font-size:14px}.steps b{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#E1EAF7;color:var(--blue)}.steps .done b{background:var(--blue);color:white}.divider{height:1px;background:var(--line);margin:20px 0}
.alert{padding:16px 18px;border-radius:12px;border:1px solid #BBCFED;display:flex;gap:14px;background:#EDF4FF;font-size:15px;line-height:1.6}.alert img{width:36px;height:36px;flex-shrink:0}.alert.success{background:#EEF8F0;border-color:#BCD8C3}.alert.warning{background:#FFF6E6;border-color:#E7CD96}.alert.error{background:#FFF0F0;border-color:#E4B8B8}.alert h3{margin:0 0 4px}.alert p{margin:0;font-size:14px}.empty{text-align:center;padding:36px 24px}.empty img{width:90px;height:90px;margin-bottom:16px}.empty p{max-width:340px;margin:0 auto 20px}.skeleton{height:14px;background:linear-gradient(90deg,#E4ECF8,#F4F7FC,#E4ECF8);border-radius:6px;margin:14px 0;width:100%}.progress{height:8px;background:#E5ECF6;border-radius:20px;overflow:hidden}.progress i{height:100%;display:block;background:var(--blue)}.stat{font-size:40px;font-weight:700;color:var(--blue);margin:8px 0}.stat small{font-size:14px;font-weight:400;color:var(--muted)}table{border-collapse:collapse;width:100%;font-size:15px}th,td{text-align:left;padding:16px;border-bottom:1px solid var(--line);vertical-align:middle}th{font-size:13px;color:var(--muted);background:#EDF3FC}tr:last-child td{border:0}.table-card{background:white;border:1px solid var(--line);border-radius:14px;overflow:hidden}.table-toolbar{padding:20px;display:flex;gap:16px;align-items:center}.table-toolbar input{max-width:330px}.table-toolbar .btn{margin-left:auto}.modal-stage{background:#10274A20;padding:30px;display:grid;place-items:center;border-radius:14px}.modal{background:white;border-radius:18px;border:1px solid var(--line);box-shadow:0 20px 45px #18335B22;width:100%;max-width:480px;padding:28px}.modal .actions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px}.popover{border-radius:12px;padding:18px;background:white;box-shadow:0 12px 32px #16315122;border:1px solid var(--line)}.tooltip{display:inline-block;background:#163151;color:white;padding:10px 16px;border-radius:8px;font-size:14px}
.glass{padding:28px;background:linear-gradient(135deg,#102B44F2,#09172AED);border:1px solid #91BEDB;border-radius:18px;box-shadow:inset 0 0 0 4px #D8F4FF0D;color:#EAF5FF}.glass p{color:#B5CBDF}.choice{width:100%;background:#152F48;color:#EAF5FF;border:1px solid #4A6A86;display:flex;align-items:center;text-align:left;gap:16px;padding:18px;border-radius:12px;line-height:1.7;margin:12px 0}.choice b{display:grid;place-items:center;width:36px;height:36px;border-radius:7px;background:#D1E9FF15;flex-shrink:0}.choice[aria-pressed=true]{border-color:#A4F0FF;background:#1D455C;box-shadow:inset 0 0 0 1px #A4F0FF}.choice.selected:after{content:"已选";margin-left:auto;color:#B5F5FF;font-size:13px;white-space:nowrap}.glass .btn{background:#D3EDFF;color:#153852}.glass .btn:disabled{opacity:.4}.game-layout{display:grid;grid-template-columns:200px 1fr;gap:24px}.game-side{padding:22px;border-right:1px solid #395A74;color:#B4CEE5}.game-side h3{color:#EDF6FF}.game-side p{font-size:14px}.game-side .divider{background:#395A74}.score-row{display:flex;gap:12px;align-items:center;margin-bottom:18px}.score-row img{width:42px;height:42px}.score-row label{width:90px;margin:0}.score-row input{width:80px!important}.score-row .progress{flex:1}.asset-image{height:270px;display:flex;align-items:center;justify-content:center;background:#EBF2FF;border-radius:12px;padding:20px}.asset-image img{max-height:100%;max-width:100%;object-fit:contain}.asset-image.darkbg{background:#102044}.asset-image.posterbg{background:url(assets/bg-portrait.png) center/cover}
.campaign{position:relative;overflow:hidden;background:url(assets/bg-landscape.png) center/cover;color:white;border-radius:18px;min-height:550px;padding:38px}.campaign h2{font-size:52px;line-height:1.3;margin:48px 0 20px;max-width:700px}.campaign p{max-width:550px;font-size:18px;color:#D6E4FF}.campaign .logo-strip{width:170px;background:white;padding:10px;border-radius:5px}.campaign .mascot{position:absolute;right:55px;bottom:50px;width:210px;max-height:480px;object-fit:contain}.campaign .gold{color:var(--gold)}.campaign .stamp{position:absolute;bottom:35px;left:38px;font-size:14px;color:#C2D7F5}.poster{background:url(assets/bg-portrait.png) center/cover;width:420px;height:650px;padding:30px;position:relative;overflow:hidden;color:white;border-radius:12px}.poster .company{width:130px;background:white;padding:8px}.poster .badge{width:300px;margin:22px auto;display:block}.poster h2{font-size:30px;line-height:1.5;max-width:320px;margin-top:25px}.poster p{color:#C9E0FF;font-size:14px;max-width:260px}.poster .mascot{position:absolute;right:25px;bottom:40px;width:130px}.poster .bottom{position:absolute;bottom:30px;font-size:12px}.paper-app{background:white;border:1px solid var(--line);padding:32px;min-height:650px;border-radius:12px}.paper-app h2{font-size:30px;margin-top:28px;line-height:1.5}.paper-app .band{background:url(assets/bg-light.png) center/cover;padding:28px;border-radius:12px;margin:24px 0}.report-cover{background:url(assets/bg-light.png) center/cover;padding:38px;height:650px;border-radius:12px;position:relative;border:1px solid #C8D8EC}.report-cover h2{font-size:44px;line-height:1.4;margin-top:100px}.report-cover img{width:170px}.report-cover .bottom{position:absolute;bottom:35px}.report-inside{background:white;padding:32px;height:650px;border:1px solid var(--line);border-radius:12px}.report-inside .section{margin:20px 0;padding-bottom:18px;border-bottom:1px solid var(--line)}.header-line{display:flex;justify-content:space-between;align-items:center}.body-copy{font-size:16px}.brand-tag{color:#337CFF;font-weight:700}.swatch{height:130px;border-radius:12px;padding:18px;color:white}.swatch b{display:block;margin-top:38px}.typography-sample{font-size:48px;font-weight:700;line-height:1.4}.large-badge{max-height:220px;object-fit:contain}.logo-pair{display:flex;align-items:center;justify-content:center;gap:28px;width:100%}.logo-pair .company{width:200px}.logo-pair .badge{width:250px;max-height:180px;object-fit:contain}.logo-pair .separator{height:90px;width:1px;background:#C6D3EB}.download-note{font-size:13px;color:var(--muted)}
dialog{border:1px solid var(--line);border-radius:18px;padding:28px;max-width:480px;width:90%;color:var(--ink)}dialog::backdrop{background:#0A1739A0}.mobile-demo{width:340px;padding:18px;background:#0A1A30;border-radius:22px;border:1px solid #507499;color:#EAF5FF}.mobile-demo .glass{padding:18px}.mobile-demo .choice{font-size:14px;padding:12px}.mobile-demo h3{line-height:1.6}.mobile-demo .btn{width:100%}.mobile-demo .logo{width:170px;margin-bottom:16px}.panel-content{min-width:0}.reduced-motion *,@media(prefers-reduced-motion:reduce){animation:none!important}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}@media(max-width:760px){body.live .board{width:100%;height:auto;min-height:100vh;padding:20px}.live .grid{grid-template-columns:1fr}.live .nav{flex-wrap:wrap}.live .game-layout{grid-template-columns:1fr}.live .game-side{display:none}.live .board header img{width:100px}.live .board h1{font-size:24px}.live .campaign h2{font-size:32px;max-width:65%}.live .campaign .mascot{width:110px;right:20px}.live .table-card{overflow-x:auto}.live .table-card table{min-width:600px}}
'''
(OUT/'library.css').write_text(CSS,encoding='utf-8')
with (OUT/'library.css').open('a',encoding='utf-8') as f:
    f.write('\n.cols5{grid-template-columns:repeat(5,minmax(0,1fr))}.icon-tile{padding:12px}.icon-tile img{width:80px;height:80px}.icon-tile h3{font-size:16px;margin:10px 0 4px}.icon-tile p{margin:0;font-size:12px}.asset-image{height:220px}.paper-app>.company{width:160px;height:55px;object-fit:contain}.glass{position:relative;background:none;border:0;border-radius:0;box-shadow:none;padding:38px}.glass>.material-frame{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0}.glass>*:not(.material-frame){position:relative;z-index:1}.board.dark{background:linear-gradient(#071327EE,#071327F5),url(assets/bg-landscape.png) center/cover}.mobile-demo .glass{padding:26px}\n')
    f.write('\n.poster{background:white}.poster:before{content:"";position:absolute;left:0;right:0;top:340px;bottom:0;background:url(assets/bg-portrait.png) center bottom/cover}.poster>*{position:relative;z-index:1}.poster .mascot,.poster .bottom{position:absolute}.poster h2{color:white}.poster .badge{margin-top:14px;margin-bottom:32px}.live .row>.stack{max-width:100%}\n')

def image(name,cls='',alt=''):
    return f'<img src="assets/{name}" class="{cls}" alt="{alt}">'
def ico(family,shape):
    return image(f'icon-{family}-{shape}.svg','icon')
def button(text,cls='',attrs=''):
    return f'<button class="btn {cls}" {attrs}>{text}</button>'
def tile(content,cls=''):
    return f'<div class="tile {cls}">{content}</div>'
def grid(contents,cols=3):
    return f'<div class="grid cols{cols}">'+''.join(contents)+'</div>'
def tag(text,cls=''):
    return f'<span class="tag {cls}">{text}</span>'
def icon_sheet(families):
    items=[]
    for family in families:
        for shape,label,color in ICON_GROUPS[family]:
            items.append(tile(image(f'icon-{family}-{shape}.svg')+f'<h3>{label}</h3><p class="caption">{family} / {shape}</p>','icon-tile'))
    return grid(items,5 if len(items)>8 else 4)
def alert(title,body,cls=''):
    shape='check' if cls=='success' else 'search' if cls in ['warning','error'] else 'report'
    family='actions' if shape=='check' else 'process' if shape=='search' else 'series'
    return f'<div class="alert {cls}">{ico(family,shape)}<div><h3>{title}</h3><p>{body}</p></div></div>'

boards=[]
def add(id_,title,desc,content,category,theme=''):
    boards.append(dict(id=id_,title=title,desc=desc,content=content,category=category,theme=theme))

add('brand-identity','身份资产与组合署名','公司 / 计划 / 产品分别保留；组合是本轮候选应用。',grid([
 tile('<div class="asset-image">'+image('company-mark.png')+'</div><h3>公司简洁标识</h3><p>原图原比例，保留蓝色身份。</p>'),
 tile('<div class="asset-image">'+image('program-badge-s2.png')+'</div><h3>计划标识 · 三折页版本</h3><p>作为真实业务传播中的现有标识。</p>'),
 tile('<div class="asset-image">'+image('logo.png')+'</div><h3>伍力全开 · 产品标识</h3><p>像素语言属于具体产品。</p>'),
 tile('<div class="asset-image"><div class="logo-pair">'+image('company-mark.png','company')+'<span class="separator"></span>'+image('program-badge-s2.png','badge')+'</div></div><h3>公司 × 计划组合</h3><p>适用于合作单页和活动署名。</p>'),
 tile('<div class="asset-image darkbg">'+image('program-badge-s2.png')+'</div><h3>深色承载</h3><p>不改标识颜色，不拉伸比例。</p>'),
 tile('<div class="asset-image">'+image('wu-6-11.png')+'</div><h3>小伍角色</h3><p>原有形象，按内容角色参与构图。</p>'),
],3),'identity')
swatches=[tile(f'<div class="swatch" style="background:{value};'+('color:#163151' if key=='gold' else '')+f'">{label}<b>{value}</b></div>') for key,value,label in [('brand',COLORS['brand'],'标识蓝'),('electric',COLORS['electric'],'科技电蓝'),('navy',COLORS['navy'],'深靛蓝'),('gold',COLORS['gold'],'金色强调')]]
add('brand-type','颜色、字体与信息层级','颜色源于原有标识和三折页；语义反馈单独定义。',grid(swatches,4)+grid([
 tile('<p class="eyebrow">品牌标题 / 中文优先</p><div class="typography-sample">让儿童友好<br>成为 AI 产品的真“芯”</div><p class="caption">原有倡导语；正式广告字形沿用原图。</p>'),
 tile('<h2>科技向善，支持儿童数智成长</h2><p class="body-copy">安全守护 · 成长赋能 · 技术共治</p><div class="divider"></div><h3>正文：清晰阅读</h3><p>面向人工智能时代儿童青少年数智成长，推动儿童友好 AI 治理。</p><div class="row">'+tag('教育支持')+tag('成长支持','purple')+tag('技术治理','orange')+'</div>'),
],2),'identity')
add('icons-domain','领域图标 · 不同分类独立表达','四大切面、五类风险、三大系列；颜色不表示它们一一对应。',icon_sheet(['dimensions','risks','series']),'icons')
add('icons-capability','能力、干预逻辑与通用操作','五力用当前官方术语；图形是本轮候选，名称不从图形反推。',icon_sheet(['abilities','process','actions']),'icons')
add('frames','玻璃容器 · 六种独立 SVG','继承产品已认可的切角、凹口和反射；每个尺寸独立计算。',grid([
 tile('<div class="asset-image '+('darkbg' if theme=='dark' else '')+'">'+image(f'frame-{size}-{theme}.svg')+f'</div><h3>{label} · '+('暗版' if theme=='dark' else '亮版')+'</h3>')
 for size,label in [('card','卡面'),('banner','横幅'),('panel','内容面板')] for theme in ['light','dark']
],3),'frames')
states=[('默认','',''),('悬停','hover',''),('按下','pressed',''),('键盘焦点','focus',''),('禁用','','disabled'),('加载','','aria-busy="true"')]
add('ui-buttons','按钮、选择与标签','尺寸、操作优先级与状态；焦点和选中都有可见标记。',grid([
 tile(f'<h3>{label}</h3>'+button(('<span class="spinner"></span>处理中' if label=='加载' else '确认选择'),cls,attrs)) for label,cls,attrs in states
],3)+grid([
 tile('<h3>操作层级</h3><div class="row">'+button('主要操作')+button('次要操作','secondary')+button('低优先级','quiet')+button('结束场次','danger')+'</div><div class="row" style="margin-top:18px">'+button('小尺寸','small')+button('↗','icon-only','aria-label="查看详情"')+'</div>'),
 tile('<h3>分段选择</h3><div class="segmented"><button class="active">全部</button><button>进行中</button><button>已完成</button></div><h3 style="margin-top:24px">分类与状态</h3><div class="row">'+tag('教育支持')+tag('成长支持','purple')+tag('技术治理','orange')+tag('已完成','success')+tag('待处理','warning')+tag('失败','error')+'</div>'),
],2),'controls')
add('ui-inputs','输入与表单状态','可见标签、用途说明、错误定位、禁用与多种选择控件。',grid([
 tile('<div class="field"><label for="name">活动名称</label><input id="name" placeholder="输入活动名称"><p class="hint">与现场活动使用相同的名称。</p></div><div class="field"><label for="org">所属组织</label><input id="org" value="当前组织" disabled><p class="hint">由当前登录上下文确定。</p></div><div class="field"><label for="notes">活动备注</label><textarea id="notes" placeholder="填写活动说明"></textarea></div>'),
 tile('<div class="field"><label for="email">邮箱</label><input id="email" class="invalid" value="name@" aria-invalid="true" aria-describedby="email-error"><p id="email-error" class="error-text">请填写完整的邮箱地址。</p></div><div class="field"><label for="type">产品系列</label><select id="type"><option>教育支持</option><option>成长支持</option><option>技术治理</option></select></div><div class="field"><label for="count">阶段卡牌数量</label><input id="count" type="number" min="1" max="20" value="3"></div>'),
 tile('<h3>复选与单选</h3><label class="checkline"><input type="checkbox" checked>显示已结束活动</label><label class="checkline"><input type="checkbox">仅显示我的活动</label><div class="divider"></div><label class="checkline"><input type="radio" name="radio" checked>亮版</label><label class="checkline"><input type="radio" name="radio">暗版</label><div class="divider"></div><div class="switch"><button role="switch" aria-label="显示提示" aria-checked="true"></button><span>显示提示</span></div><div class="divider"></div><h3>搜索</h3><input aria-label="搜索活动" placeholder="搜索活动名称…">'),
],3),'controls')
add('ui-navigation','导航、分页与进度','不同产品页面共享操作语言；不强制共享游戏侧栏。',
 '<nav class="nav">'+image('company-mark.png')+'<a class="active" href="#">产品与服务</a><a href="#">品牌资料</a><a href="#">合作交流</a><span class="right">'+button('联系团队','small')+'</span></nav>'+grid([
 tile('<div class="row" style="align-items:flex-start"><nav class="side"><a class="active" href="#">活动管理</a><a href="#">场次记录</a><a href="#">账号资料</a><a href="#">下载资料</a></nav><div class="stack"><span class="caption">管理端导航样式</span><div class="tabs"><button class="tab active" aria-selected="true">概览</button><button class="tab" aria-selected="false">记录</button></div><p>活动 / 场次记录 / 详情</p></div></div>'),
 tile('<h3>分页</h3><div class="pagination"><button aria-label="上一页">‹</button><button class="active" aria-current="page">1</button><button>2</button><button>3</button><button aria-label="下一页">›</button></div><div class="divider"></div><h3>流程进度</h3><div class="steps"><span class="done"><b>1</b>选择活动</span><span><b>2</b>配置阶段</span><span><b>3</b>进入游戏</span></div><div class="divider"></div><h3>文件处理进度</h3><p>正在准备文件…</p><div class="progress"><i style="width:45%"></i></div>'),
],2),'navigation')
add('ui-surfaces','卡片、弹窗、抽屉与辅助信息','关闭、取消、确认和焦点返回有明确行为。',grid([
 tile('<h3>活动卡片</h3><p>学校 / 社区活动</p><div class="row">'+tag('进行中')+tag('教育支持')+'</div><div class="divider"></div><p>配置阶段数量后进入游戏。</p>'+button('查看活动','secondary')+' '+button('开始新游戏')),
 tile('<h3>说明气泡</h3><div class="popover"><h3>阶段卡牌数量</h3><p>这里配置各阶段数量，进入游戏后再选择具体卡牌。</p></div><div style="margin-top:20px" class="tooltip">返回查看不会重新提交</div>'),
],2)+grid([
 '<div class="modal-stage"><section class="modal"><h2>确认结束场次？</h2><p>请先检查当前操作。确认后进入结束与复盘流程。</p><div class="actions">'+button('继续游戏','secondary')+button('确认结束','danger')+'</div></section></div>',
 tile('<h3>资料抽屉</h3><div class="header-line"><b>场次详情</b>'+button('×','quiet icon-only','aria-label="关闭抽屉"')+'</div><div class="divider"></div><p>活动名称</p><h3>示例活动</h3><p>查看状态与复盘入口。</p><div class="divider"></div>'+button('打开交互弹窗','secondary','id="open-dialog"')+'<dialog id="demo-dialog"><h2>场次操作说明</h2><p>仅用于检查组件交互，不连接业务服务。</p><form method="dialog">'+button('关闭')+'</form></dialog>'),
],2),'navigation')
add('ui-feedback','状态反馈、异常与恢复','颜色、图标和文字共同表达；每种异常都有明确下一步。',grid([
 '<div class="stack">'+alert('操作已完成','本次处理已完成，可继续查看记录。','success')+alert('需要确认','结束前请检查当前场次。','warning')+alert('保存失败','连接暂时中断。保留当前输入后重试。','error')+alert('正在处理','请等待当前任务完成。')+'</div>',
 tile('<div class="empty">'+ico('process','search')+'<h3>还没有活动记录</h3><p>完成一场游戏后，在这里查看记录。</p>'+button('返回活动','secondary')+'</div>'),
 tile('<div class="empty">'+ico('risks','lock')+'<h3>当前账号无法访问</h3><p>检查当前组织与账号权限，再返回可访问的页面。</p>'+button('返回','secondary')+'</div>'),
],3)+grid([
 tile('<h3>加载占位</h3><div class="skeleton" style="width:40%"></div><div class="skeleton"></div><div class="skeleton" style="width:75%"></div><div class="skeleton" style="height:65px"></div>'),
 tile('<h3>下载失败</h3><p>文件暂时无法获取，请稍后重试。</p><div class="row">'+button('重试')+button('返回资料','secondary')+'</div>'),
 tile('<h3>处理中</h3><p><span class="spinner"></span> 正在生成报告…</p><p class="hint">状态样式演示，不调用报告服务。</p>'),
],3),'feedback')
table='<div class="table-card"><div class="table-toolbar"><input aria-label="搜索记录" placeholder="搜索活动名称…">'+button('新建活动','small')+'</div><table><thead><tr><th>活动名称</th><th>产品系列</th><th>状态</th><th>操作</th></tr></thead><tbody>'+''.join(f'<tr><td>示例活动 {i+1}</td><td>教育支持</td><td>{tag(state,cls)}</td><td>{button("查看", "quiet small")}</td></tr>' for i,(state,cls) in enumerate([('进行中',''),('已完成','success'),('待开始','warning')]))+'</tbody></table></div>'
add('ui-data','数据列表与信息密度','表格、查询、状态标签与分页。所有数字仅为排版示例。',grid([
 tile('<p>示例活动数</p><div class="stat">12 <small>场</small></div>'+tag('排版示例','warning')),
 tile('<p>示例完成数</p><div class="stat">8 <small>场</small></div>'+tag('排版示例','warning')),
 tile('<p>示例处理中</p><div class="stat">4 <small>项</small></div>'+tag('排版示例','warning')),
],3)+table+'<div class="row" style="justify-content:flex-end"><div class="pagination"><button class="active">1</button><button>2</button></div></div>','feedback')
add('ui-game','卡牌选择 → 明确确认 → 独立反馈','延续产品视觉；选中不提交，返回查看不重复提交。',
 '<div class="game-layout"><aside class="game-side"><h3>本局状态</h3><p>示例阶段 · 1 / 3</p><div class="divider"></div><h3>伍力技能</h3><p>技能入口保留</p><div class="divider"></div><h3>现场督导</h3><p>现场操作辅助</p></aside><div class="glass" id="game-panel"><div id="question-view"><div class="row">'+tag('身体风险')+'<span class="caption">排版与交互示例</span></div><h2 style="margin-top:22px">吃饭时，屏幕占据了你的注意力</h2><p>你会如何安排屏幕与用餐的关系？请选择一个选项，再确认。</p><button class="choice" aria-pressed="false" data-choice="A"><b>A</b><span>先看完视频，再继续吃饭。</span></button><button class="choice" aria-pressed="false" data-choice="B"><b>B</b><span>把屏幕放到旁边，继续听声音。</span></button><button class="choice" aria-pressed="false" data-choice="C"><b>C</b><span>暂时放下屏幕，把注意力带回用餐。</span></button><div class="row" style="justify-content:space-between;margin-top:24px"><span id="choice-status" role="status">尚未选择</span>'+button('确认选择','','id="confirm-choice" disabled')+'</div></div><div id="feedback-view" hidden inert><h2 id="feedback-title" tabindex="-1">查看本次选择</h2><p id="feedback-copy"></p><p>这张样板只检查视觉和交互，不执行计分。</p><div class="row">'+button('返回查看','secondary','id="back-choice"')+button('重置样例','','id="reset-choice"')+'</div></div></div></div>','business','dark')
add('ui-business','活动配置、技能状态与监督输入','桌游不展示伍力值；监督与游戏职责分开。',grid([
 tile('<h3>新游戏 · 已有活动</h3><label for="activity">选择活动</label><select id="activity"><option>请选择已有活动</option><option>示例活动</option></select><div class="divider"></div><h3>阶段数量</h3>'+''.join(f'<div class="field"><label for="phase{i}">阶段 {i}</label><input id="phase{i}" type="number" min="1" value="3"></div>' for i in [1,2,3])+button('下一步')),
 tile('<h3>技能状态</h3><div class="row">'+ico('abilities','shield')+'<div><h3>安全力</h3>'+tag('可使用','success')+'</div></div><p style="margin-top:16px">效果与使用条件依实际业务契约。</p>'+button('查看技能','secondary')+'<div class="divider"></div><div class="row">'+ico('abilities','brain')+'<div><h3>脑波力</h3>'+tag('已使用')+'</div></div>'+button('本局已使用','','disabled')),
 tile('<h3>监督 · 五力输入</h3>'+''.join(f'<div class="score-row">{ico("abilities",shape)}<label for="score-{shape}">{label}</label><input id="score-{shape}" type="number" min="0" max="10" value="5" aria-label="{label}"></div>' for shape,label,_ in ICON_GROUPS['abilities'])+'<p class="hint">0–10 输入边界；样板数据不写入场次。</p>'+button('查看统计','secondary')),
],3),'business')
add('ui-mobile','窄屏与长内容验证','手机组件承载；保留触控面积，不靠缩字截断内容。',
 '<div class="row" style="justify-content:center;align-items:flex-start;gap:45px"><div class="mobile-demo">'+image('logo.png','logo')+'<div class="glass"><h3>这是一段需要完整阅读的较长卡牌标题</h3><p>当信息较长时，允许内容纵向展开，让阅读和操作仍然清楚。</p><button class="choice" aria-pressed="true"><b>A</b><span>在进行下一步之前，先认真阅读并确认自己的选择。</span></button>'+button('确认选择')+'</div></div><div style="width:440px" class="stack">'+tile('<h3>长标签</h3><label for="long-label">这是一项较长的活动配置说明，仍应保持可读</label><input id="long-label" placeholder="填写内容"><p class="hint">标签可换行，输入框保持完整宽度。</p>')+tile('<h3>状态变化</h3>'+alert('连接暂时中断','当前输入已保留在样板内，检查网络后重试。','error')+'<div style="margin-top:18px">'+button('重试')+'</div>')+'</div></div>','business')

add('app-campaign','倡导横幅 · 真实业务叙事','沿用三折页倡导语，以生图背景承载原有角色。','<div class="campaign">'+image('company-mark.png','logo-strip')+'<h2>让儿童友好<br>成为 AI 产品的<br><span class="gold">真“芯”</span></h2><p>安全守护 · 成长赋能 · 技术共治</p>'+image('wu-6-11.png','mascot')+'<div class="stamp">AI5000天 · 数智免疫力计划</div></div>','applications')
add('app-education','教育支持 · 活动海报与机构合作单页','产品信息来自真实三折页；不编造活动时间、客户或价格。',
 '<div class="row" style="justify-content:center;gap:40px;align-items:flex-start"><div class="poster">'+image('company-mark.png','company')+image('program-badge-s2.png','badge')+'<h2>先看见风险，<br>再练习选择。</h2><p>数智免疫力桌游<br>负责任开发者营<br>数智守望者培训</p>'+image('wu-6-11.png','mascot')+'<div class="bottom">教育支持 · 安全探索与能力激活</div></div><div class="paper-app" style="width:680px">'+image('company-mark.png','company','伍仟天科技')+'<h2>教育支持<br>从情境体验进入数智成长</h2><div class="band"><div class="row">'+ico('series','people')+'<div><h3>数智免疫力计划</h3><p>风险预演 → 能力激活 → 免疫形成</p></div></div></div><div class="stack"><div><h3>数智免疫力桌游</h3><p>以情境与选择组织参与和复盘。</p></div><div><h3>负责任开发者营</h3><p>面向负责任创新的教育支持。</p></div><div><h3>数智守望者培训</h3><p>支持教育与陪伴中的行动者。</p></div></div></div></div>','applications')
add('app-report','研究与治理 · 报告封面与内页','技术治理业务身份来源于三折页；此处不虚构测评结果。',
 '<div class="grid cols2"><div class="report-cover">'+image('company-mark.png')+'<p class="eyebrow" style="margin-top:35px">AI5000天 · 技术治理</p><h2>儿童友好 AI<br>产品测评体系</h2><p>安全风险 · 成长发展 · 协同治理</p><div class="bottom">上海伍仟天数字科技有限公司</div></div><div class="report-inside"><p class="eyebrow">研究与治理 / 报告结构示例</p><h2>让儿童的真实体验<br>进入产品判断。</h2>'+''.join(f'<div class="section"><div class="row">{ico("series","report")}<h3>{title}</h3></div><p>{body}</p></div>' for title,body in [('安全风险','记录需要识别与回应的风险。'),('成长发展','关注产品如何支持儿童成长。'),('协同治理','形成可讨论、可复核的改进依据。')])+'</div></div>','applications')
add('app-website','企业官网区块 · 完整品牌组合','页面仅作为设计应用样张，按钮不连接商业提交服务。',
 '<nav class="nav">'+image('company-mark.png')+'<a class="active" href="#">数智免疫力计划</a><a href="#">产品与服务</a><a href="#">技术治理</a><span class="right">'+button('合作交流','small')+'</span></nav><div class="campaign" style="min-height:430px"><h2 style="font-size:44px;margin-top:20px">支持儿童<br>安全、健康地数智成长</h2><p>用 AI 优化 AI，连接教育实践、成长支持与技术治理。</p>'+button('了解产品与服务')+image('wu-6-11.png','mascot')+'</div>'+grid([
 tile('<div class="row">'+ico('series','people')+'<h3>教育支持</h3></div><p>桌游 · 开发者营 · 守望者培训</p>'),
 tile('<div class="row">'+ico('series','spark')+'<h3>成长支持</h3></div><p>家庭体验与日常成长支持</p>'),
 tile('<div class="row">'+ico('series','report')+'<h3>技术治理</h3></div><p>儿童友好 AI 产品测评</p>'),
],3),'applications')

add('app-growth','成长支持 · 人与技术的组合应用','新生图是插画候选；产品系列来自公司材料。',
 '<div class="paper-app" style="min-height:710px;background:url(assets/bg-light.png) center/cover;position:relative;overflow:hidden">'+image('company-mark.png','company')+'<p class="eyebrow" style="margin-top:40px">AI5000天 · 成长支持</p><h2 style="font-size:46px;max-width:650px">成长支持<br>家庭与日常中的数智成长</h2><div style="max-width:620px;margin-top:35px" class="stack"><div class="row">'+ico('series','spark')+'<h3>数智风险家庭桌游</h3></div><div class="row">'+ico('dimensions','algorithm')+'<h3>负责任开发者 AI Tutor</h3></div><div class="row">'+ico('abilities','chat')+'<h3>RASPE 风险识别与应对陪伴智能体</h3></div></div>'+image('scene-companion.png','','儿童与技术陪伴插画候选').replace('<img ','<img style="position:absolute;width:500px;right:30px;bottom:20px" ')+'</div>','applications')

JS = '''
document.querySelectorAll('.glass').forEach(host=>{const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.classList.add('material-frame');svg.setAttribute('aria-hidden','true');host.prepend(svg);const update=()=>{const w=host.clientWidth,h=host.clientHeight,c=w<500?18:30,n=w<500?10:14;const d=i=>`M ${i+c} ${i} H ${w*.43} l ${n} ${n} H ${w*.76-n} l ${n} ${-n} H ${w-i-c} L ${w-i} ${i+c} V ${h-i-c} L ${w-i-c} ${h-i} H ${w*.66} l ${-n} ${-n} H ${i+c} L ${i} ${h-i-n-c} V ${i+c} Z`;svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.innerHTML=`<defs><linearGradient id="mf-${w}" x2="1" y2="1"><stop stop-color="#112C45"/><stop offset="1" stop-color="#081A2C"/></linearGradient><linearGradient id="me-${w}" x2="1" y2="1"><stop stop-color="#F5FCFF"/><stop offset=".3" stop-color="#4C769E"/><stop offset=".6" stop-color="#C5EFFF"/><stop offset="1" stop-color="#27445F"/></linearGradient><linearGradient id="mg-${w}" gradientUnits="userSpaceOnUse" x1="${w*.08}" x2="${w*.4}"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><path d="${d(3)}" fill="url(#mf-${w})" stroke="#051021" stroke-width="5"/><path d="${d(3)}" fill="none" stroke="url(#me-${w})" stroke-width="1.8"/><path d="${d(7)}" fill="none" stroke="url(#me-${w})" stroke-width=".8" stroke-opacity=".55"/><path d="M${w*.08} 3H${w*.4}" stroke="url(#mg-${w})" stroke-width="3"/>`};new ResizeObserver(update).observe(host);update()});
document.querySelectorAll('.segmented').forEach(group=>group.querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>{group.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===btn))})));
document.querySelectorAll('[role=switch]').forEach(btn=>btn.addEventListener('click',()=>btn.setAttribute('aria-checked',String(btn.getAttribute('aria-checked')!=='true'))));
document.querySelectorAll('.tabs').forEach(group=>group.querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>group.querySelectorAll('button').forEach(b=>{b.classList.toggle('active',b===btn);b.setAttribute('aria-selected',String(b===btn))}))));
const dlg=document.querySelector('#demo-dialog'),open=document.querySelector('#open-dialog');if(open){open.addEventListener('click',()=>dlg.showModal());dlg.addEventListener('close',()=>open.focus())}
let choice=null,confirmed=false,submissions=0;const choices=[...document.querySelectorAll('[data-choice]')],confirm=document.querySelector('#confirm-choice'),q=document.querySelector('#question-view'),f=document.querySelector('#feedback-view');
if(confirm){choices.forEach(btn=>btn.addEventListener('click',()=>{if(confirmed)return;choice=btn.dataset.choice;choices.forEach(b=>{b.setAttribute('aria-pressed',String(b===btn));b.classList.toggle('selected',b===btn)});document.querySelector('#choice-status').textContent='已选择 '+choice+' · 尚未确认';confirm.disabled=false}));const show=()=>{q.hidden=true;q.inert=true;f.hidden=false;f.inert=false;document.querySelector('#feedback-title').focus()};confirm.addEventListener('click',()=>{if(!choice)return;if(!confirmed){confirmed=true;submissions++;choices.forEach(b=>b.disabled=true);document.querySelector('#feedback-copy').textContent='你选择了 '+choice+'。把注意力带回身体与当前情境，是一次值得讨论的尝试。'}show()});document.querySelector('#back-choice').addEventListener('click',()=>{f.hidden=true;f.inert=true;q.hidden=false;q.inert=false;confirm.textContent='查看反馈';confirm.focus()});document.querySelector('#reset-choice').addEventListener('click',()=>{choice=null;confirmed=false;submissions=0;choices.forEach(b=>{b.disabled=false;b.classList.remove('selected');b.setAttribute('aria-pressed','false')});f.hidden=true;f.inert=true;q.hidden=false;q.inert=false;confirm.disabled=true;confirm.textContent='确认选择';document.querySelector('#choice-status').textContent='尚未选择';choices[0].focus()});window.getDemoSubmissions=()=>submissions}
'''
if args.draft_ui:
    boards=[b for b in boards if b['category']!='applications']
else:
    for required in ['bg-landscape.png','bg-portrait.png','bg-light.png','ornament-gold.png','scene-companion.png']:
        assert (ASSETS/required).is_file(),f'Missing generated asset: {required}'
    for b in boards:
        if b['id']=='app-education':
            b['content']=b['content'].replace('<div class="poster">','<div class="poster">'+image('ornament-gold.png','','金色手绘装饰').replace('<img ','<img style="position:absolute;right:25px;top:35px;width:140px" '))
        if b['id']=='app-report':
            b['content']=b['content'].replace('<div class="report-cover">','<div class="report-cover">'+image('ornament-gold.png','','金色手绘装饰').replace('<img ','<img style="position:absolute;right:30px;bottom:70px;width:220px" '))
(OUT/'library.js').write_text(JS,encoding='utf-8')
def doc(board,live=False):
    content=f'<section class="board {board["theme"]}"><header><div><h1>{board["title"]}</h1><p>{board["desc"]}</p></div>{image("company-mark.png")}</header>{board["content"]}<footer><span>伍仟天 · 品牌素材与组件候选库</span><span>{board["id"]} · 本地设计样板 / 未接业务服务</span></footer></section>'
    return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+board['title']+'</title><link rel="stylesheet" href="library.css"><body'+(' class="live"' if live else '')+'>'+content+'<script src="library.js"></script></body></html>'
for b in boards:
    (OUT/(b['id']+'.html')).write_text(doc(b,True),encoding='utf-8')

errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1400,'height':1000},reduced_motion='reduce')
    page.on('pageerror',lambda e:errors.append(str(e)))
    for b in boards:
        # Fixed review boards use the same source as responsive standalone demos.
        review=OUT/'_review.html'
        review.write_text(doc(b),encoding='utf-8')
        page.goto(review.as_uri(),wait_until='load')
        page.evaluate('document.fonts.ready')
        # Relative CSS backgrounds are resolved against the CSS file, not the transient document.
        assert page.evaluate('[...document.images].every(i=>i.complete&&i.naturalWidth>0)'),b['id']
        overflow=page.locator('.board').evaluate('(e)=>({x:e.scrollWidth>e.clientWidth+1,y:e.scrollHeight>e.clientHeight+1})')
        if overflow['x'] or overflow['y']:
            raise AssertionError((b['id'],overflow))
        page.locator('.board').screenshot(path=str(PAGES/(b['id']+'.png')))
    # Check meaningful behavioral invariants in the exported interactive examples.
    page.goto((OUT/'ui-game.html').as_uri())
    assert page.locator('#confirm-choice').is_disabled()
    page.locator('[data-choice=C]').click()
    assert page.evaluate('window.getDemoSubmissions()')==0
    page.locator('#confirm-choice').click()
    assert page.locator('#feedback-view').is_visible()
    assert page.evaluate('window.getDemoSubmissions()')==1
    page.locator('#back-choice').click()
    page.locator('#confirm-choice').click()
    assert page.evaluate('window.getDemoSubmissions()')==1
    page.goto((OUT/'ui-surfaces.html').as_uri())
    page.locator('#open-dialog').click()
    assert page.locator('#demo-dialog').is_visible()
    page.keyboard.press('Escape')
    assert page.locator('#open-dialog').evaluate('(e)=>e===document.activeElement')
    for id_ in ['ui-inputs','ui-game','ui-feedback','ui-buttons','ui-mobile']:
        page.set_viewport_size({'width':390,'height':844})
        page.goto((OUT/(id_+'.html')).as_uri())
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),id_
    browser.close()
assert not errors,errors
if args.draft_ui:
    print(json.dumps({'ui_boards':len(boards),'rendered':True,'interaction_checks':'passed'},ensure_ascii=False))
    sys.exit(0)

gallery='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>伍仟天品牌素材与组件库</title><style>body{margin:0;background:#091327;color:#EAF3FF;font-family:"Microsoft YaHei",sans-serif;padding:32px}header{display:flex;justify-content:space-between;gap:30px;align-items:center;max-width:1600px;margin:auto}header img{width:150px}h1{font-size:30px}p{color:#ACC3DF;line-height:1.7}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:20px;max-width:1600px;margin:30px auto}.card{background:#13223B;border:1px solid #365270;border-radius:14px;overflow:hidden;color:inherit;text-decoration:none}.card img{width:100%;display:block}.card div{padding:18px}.card h2{font-size:18px;margin:0 0 8px}.card p{font-size:13px;margin:0}.card:focus-visible{outline:3px solid #DEB657;outline-offset:4px}</style><header><div><h1>伍仟天 · 品牌素材与组件库</h1><p>点选样张打开交互源文件。独立素材位于 assets/。新制作候选，等待视觉验收。</p></div>'+image('company-mark.png')+'</header><div class="grid">'
for b in boards:
    gallery+=f'<a class="card" href="{b["id"]}.html"><img src="pages/{b["id"]}.png" alt="{b["title"]}"><div><h2>{b["title"]}</h2><p>{b["desc"]}</p></div></a>'
gallery+='</div></html>'
(OUT/'index.html').write_text(gallery,encoding='utf-8')

# Keep user-owned existing Canvas content, moving it down once to make new deliverables primary.
canvas_path=target/'伍仟天品牌素材总白板.canvas'
canvas=json.loads(canvas_path.read_text(encoding='utf-8'))
first=not any(n['id']=='K-title' for n in canvas['nodes'])
old=[n for n in canvas['nodes'] if not n['id'].startswith('K-')]
if first:
    for n in old:
        n['y']+=4000
for n in old:
    if n['id'] in ['R01-label','R02-label','A01-label','A02-label']:
        n['text']=n['text'].replace('取材依据；不作为当前业务事实','公司三折页；用户确认真实业务事实').replace('原始应用参考；新应用待制作','公司三折页；真实业务应用')
    if n['id']=='title':
        n['text']='# 原始取材与历史诊断\n公司三折页已由用户于 2026-10-14 确认是真实业务事实；历史资方材料和单页的版本差异仍单独保留。'

new=[]
def txt(id_,text,x,y,w,h):
    new.append(dict(id='K-'+id_,type='text',text=text,x=x,y=y,width=w,height=h))
txt('title','# 伍仟天 · 品牌素材与组件库\n原始材料取材 / 生图背景 / 独立矢量素材 / 组件状态 / 应用样张｜新制作候选，等待视觉验收',0,0,5700,140)
categories=[('identity','01 身份组合与基础规范'),('raster','02 生图背景与透明装饰'),('icons','03 领域图标 · 独立 SVG'),('frames','04 产品玻璃容器'),('controls','05 按钮、选择与输入'),('navigation','06 导航、弹窗与容器'),('feedback','07 状态反馈与数据列表'),('business','08 业务组件与窄屏'),('applications','09 品牌应用样张')]
manifest=[]
column_y=[200,200,200]
for ci,(cat,label) in enumerate(categories):
    gx=(ci%3)*1920; gy=column_y[ci%3]
    category_boards=[b for b in boards if b['category']==cat]
    entries=[(PAGES/(b['id']+'.png'),b['title'],'样张 / 独立 HTML 可交互',b['id']) for b in category_boards]
    if cat=='raster':
        entries=[(f,f.stem,'生图新素材 / 候选',f.stem) for f in sorted(ASSETS.glob('bg-*.png'))]+[(f,f.stem,'透明生图装饰 / 候选',f.stem) for f in sorted(ASSETS.glob('ornament-*.png'))]+[(f,'儿童与技术陪伴插画','透明生图 / 非客户照片',f.stem) for f in sorted(ASSETS.glob('scene-*.png'))]
    if cat=='frames':
        entries += [(f,f.stem,'独立可缩放 SVG',f.stem) for f in sorted(ASSETS.glob('frame-*.svg'))]
    if cat=='icons':
        entries += [(ASSETS/i['file'],i['label'],'独立 SVG · '+i['family'],Path(i['file']).stem) for i in icons]
    columns=4 if cat=='icons' else 2
    cellw=430 if columns==4 else 880
    cellh=212 if columns==4 else 410
    ih=156 if columns==4 else 340
    group_height=math.ceil(len(entries)/columns)*cellh+80
    new.append(dict(id='K-group-'+cat,type='group',label=label,x=gx,y=gy,width=1860,height=group_height,color='5'))
    column_y[ci%3]+=group_height+80
    for i,(f,label,status,id_) in enumerate(entries):
        x=gx+40+(i%columns)*(cellw+20); y=gy+40+(i//columns)*cellh
        if y+cellh>gy+group_height:
            raise AssertionError(('category too dense',cat))
        dest=target/'新素材'/f.relative_to(OUT)
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(f,dest)
        rel=dest.relative_to(vault).as_posix()
        new.append(dict(id='K-file-'+id_,type='file',file=rel,x=x,y=y,width=cellw,height=ih))
        demo=(OUT/(id_+'.html'))
        link=f' · [[{(target/"新素材"/(id_+".html")).relative_to(vault).as_posix()}|交互源文件]]' if demo.exists() else ''
        txt('label-'+id_,f'**{label}**\n{status}{link}',x,y+ih+5,cellw,50)
        manifest.append(dict(file=f.relative_to(OUT).as_posix(),label=label,status=status,sha256=hashlib.sha256(f.read_bytes()).hexdigest()))

# Entire independent library is available locally in the vault, including backgrounds and demos.
for f in OUT.rglob('*'):
    if f.is_file() and f.suffix!='.zip':
        dest=target/'新素材'/f.relative_to(OUT)
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(f,dest)
backup=target/'历史备份'/stamp
backup.mkdir(parents=True,exist_ok=True)
shutil.copy2(canvas_path,backup/canvas_path.name)
canvas['nodes']=new+old
canvas_path.write_text(json.dumps(canvas,ensure_ascii=False,indent=2),encoding='utf-8')
notes_path=target/'工作台说明.md'
if notes_path.exists():
    shutil.copy2(notes_path,backup/notes_path.name)
    lines=[]
    for line in notes_path.read_text(encoding='utf-8').splitlines():
        if line.startswith('本轮是原始材料取材与资产盘点'):
            line='最新状态：候选素材与组件库已交付。V2/V3 未通过；公司三折页为用户确认的真实业务事实。新视觉候选等待用户验收。'
        if 'company-brochure-' in line:
            line=line.replace('取材依据；不作为当前业务事实','公司三折页；用户确认真实业务事实').replace('原始应用参考；新应用待制作','公司三折页；真实业务应用')
        lines.append(line)
    notes='\n'.join(lines)+'\n'
    marker='## 2026-10-14 · 素材与组件库交付'
    if marker not in notes:
        notes+='\n'+marker+'\n\n公司三折页已由用户确认是真实业务事实。新素材在白板顶部九区，原始取材及历史诊断保留在下方。交付 6 件生图素材、28 个 SVG 图标、6 个玻璃容器、19 张样张及交互源文件。\n\n浏览入口：[[06-Apps/伍仟天品牌素材工作台/新素材/index.html]]。新素材均为候选，等待视觉验收；以下记录是先前取材阶段的盘点。\n'
    notes_path.write_text(notes,encoding='utf-8')
source_list=target/'素材清单.json'
if source_list.exists():
    records=json.loads(source_list.read_text(encoding='utf-8'))
    for record in records:
        if record['id'] in ['R01','R02','A01','A02']:
            record['status']='公司三折页；2026-10-14 用户确认真实业务事实'
    shutil.copy2(source_list,backup/source_list.name)
    source_list.write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
for n in canvas['nodes']:
    if n['type']=='file':
        assert (vault/n['file']).is_file(),n['file']
assert len({n['id'] for n in canvas['nodes']})==len(canvas['nodes'])

# Render the same native positions as a compact review preview. Native Obsidian is editable.
parts=['<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#091327;color:#E7F0FF;font-family:"Microsoft YaHei",sans-serif}.board{position:relative;width:5700px;height:3800px;transform:scale(.5);transform-origin:top left}.node{position:absolute;box-sizing:border-box;overflow:hidden;border-radius:10px}.group{background:#111F35;border:1px solid #3D557B}.group span{position:absolute;top:10px;left:22px;font-size:22px;font-weight:bold}.file{background:#F5F8FF;padding:6px;border:1px solid #324969}.file img{width:100%;height:100%;object-fit:contain}.text{white-space:pre-wrap;padding:4px 8px;font-size:15px;line-height:20px}.title{font-size:30px;line-height:42px;padding:20px}</style><div class="board">']
for n in sorted(new,key=lambda n:n['type']!='group'):
    styles=f'left:{n["x"]}px;top:{n["y"]}px;width:{n["width"]}px;height:{n["height"]}px'
    cls='node '+('group' if n['type']=='group' else 'file' if n['type']=='file' else 'text')
    if n['id']=='K-title':
        cls+=' title'
    if n['type']=='file':
        body=f'<img src="{(vault/n["file"]).as_uri()}">'
    elif n['type']=='group':
        body='<span>'+html.escape(n['label'])+'</span>'
    else:
        body=html.escape(n['text'].split(' · [[')[0].replace('**','').replace('# ',''))
    parts.append(f'<div class="{cls}" style="{styles}">{body}</div>')
parts.append('</div>')
(OUT/'canvas-preview.html').write_text(''.join(parts),encoding='utf-8')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':2850,'height':1900})
    page.goto((OUT/'canvas-preview.html').as_uri())
    page.evaluate('document.fonts.ready')
    assert page.evaluate('[...document.images].every(i=>i.complete&&i.naturalWidth>0)')
    page.screenshot(path=str(OUT/'canvas-overview.png'))
    browser.close()

(OUT/'asset-manifest.json').write_text(json.dumps({'boards':[dict(id=b['id'],title=b['title'],category=b['category']) for b in boards],
 'icons':icons,'canvas_items':manifest,'original_brand_assets':'copied byte-for-byte; no logo or mascot redrawing',
 'business_facts':'company tri-fold brochure confirmed by user 2026-10-14',
 'generation':'built-in image_gen; prompt provenance in generation-prompts.json'},ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'README.md').write_text('''# 伍仟天品牌素材与组件候选库

原始公司三折页由用户于 2026-10-14 确认是真实业务事实。标识和角色为原图；新背景由内置生图模型参照三折页制作；矢量图标参照原有圆章式信息语法；玻璃容器来自已认可的产品视觉。全库是可审阅候选，不冒充已通过 VI。

assets/：独立 PNG 背景、透明装饰、28 个分类 SVG 图标、6 个尺寸独立的玻璃容器、原有标识和角色、设计变量。
pages/：实际渲染的状态与应用样张。每份同名 HTML 在本目录中，可直接打开，引用 library.css/library.js。
index.html：素材与组件浏览入口。点击样张打开对应可交互源文件；不需要启动后端。

UI 覆盖按钮、选择、标签、文本与数字输入、下拉、复选、单选、开关、导航、分页、进度、卡片、弹窗、提示、加载、空状态、访问失败、下载失败、表格、卡牌确认与反馈、活动配置、技能状态、监督输入和窄屏。

交互样板无后端连接；游戏确认不计分；返回反馈不重复提交。所有统计数字都是排版样例。新图标是候选语义图形，不表示五类风险与五力有一一对应关系。

字体使用本机微软雅黑 / 苹方回退。图标可作为矢量编辑；位图背景不是矢量母版。正式印刷仍需 CMYK、出血与字体授权校准。未修改生产页面或技能标准。
''',encoding='utf-8')
rasters=list(ASSETS.glob('bg-*.png'))+list(ASSETS.glob('ornament-*.png'))+list(ASSETS.glob('scene-*.png'))
alpha_checks={}
for f in rasters:
    with Image.open(f) as im:
        if f.name.startswith(('ornament-','scene-')):
            assert im.mode=='RGBA' and im.getchannel('A').getextrema()[0]==0 and im.getchannel('A').getextrema()[1]>128,f.name
            alpha_checks[f.name]='true transparent pixels present'
evidence=dict(boards=len(boards),svg_icons=len(icons),svg_frames=6,raster_assets=len(rasters),alpha_checks=alpha_checks,
 javascript_errors=errors,images_loaded=True,board_overflow=False,mobile_horizontal_overflow=False,
 game_select_does_not_submit=True,game_feedback_return_does_not_resubmit=True,dialog_focus_return=True,
 visual_review='pending human review; rendered images must be inspected by executor',business_source='tri-fold brochure user-confirmed',
 canvas=str(canvas_path),canvas_nodes=len(canvas['nodes']))
(OUT/'checks.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
with zipfile.ZipFile(OUT/'WQT-Brand-Library.zip','w',zipfile.ZIP_DEFLATED) as z:
    for f in OUT.rglob('*'):
        if f.is_file() and f.suffix!='.zip':
            z.write(f,f.relative_to(OUT).as_posix())
for f in OUT.rglob('*'):
    if f.is_file():
        dest=target/'新素材'/f.relative_to(OUT)
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(f,dest)
print(json.dumps(evidence,ensure_ascii=False))
