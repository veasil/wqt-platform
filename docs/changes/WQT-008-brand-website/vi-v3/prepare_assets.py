"""Extract supplied PDF regions and copy existing assets. No generative redraws."""
from pathlib import Path
import json, shutil, hashlib
import pypdfium2 as pdfium

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
OUT=ROOT/'output/wqt-vi-v3'
ASSETS=OUT/'assets'
ASSETS.mkdir(parents=True,exist_ok=True)
manifest=[]
def copied(src,name,source,role):
    shutil.copy2(ROOT/src,ASSETS/name)
    manifest.append(dict(file=name,source=source,operation='Original file copied without pixel changes',role=role,source_path=src))
def region(pdf,page,box,reference_size,name,role):
    doc=pdfium.PdfDocument(ROOT/'output/brand-research/source'/pdf)
    p=doc[page-1]; w,h=p.get_size(); rw,rh=reference_size
    l,t,r,b=box
    crop=(l/rw*w,(rh-b)/rh*h,(rw-r)/rw*w,t/rh*h)
    p.render(scale=5,crop=crop).to_pil().save(ASSETS/name)
    manifest.append(dict(file=name,source=f'{pdf}, page {page}',operation='PDF region raster export, no logo redrawing',reference_box=box,reference_size=reference_size,role=role))
    doc.close()

copied('output/brand-research/extracted/project-introduction-6-X18.png','company-mark.png','S4 project-introduction.pdf p1 embedded X18','Corporate logo, existing version')
copied('public/brand/wu-6-11.png','xiaowu.png','Existing repository public/brand/wu-6-11.png','Existing mascot; no new character design')
copied('output/brand-research/extracted/company-brochure-0-Im0.jpg','orbital-field.jpg','S2 company-brochure.pdf p1 embedded Im0','Original blue orbital field')
copied('output/brand-research/extracted/company-brochure-23-Im4.jpg','light-stream.jpg','S2 company-brochure.pdf p1 embedded Im4','Original blue light stream; limited raster resolution')
region('one-page.pdf',1,(165,39,902,437),(1067,1600),'program-badge-s3.png','S3 orange-name variant with company signature; source comparison only')
region('company-brochure.pdf',1,(106,0,422,222),(1600,534),'program-badge-s2.png','S2 blue-name variant; used in this proposal, not mixed with S3')
region('company-brochure.pdf',1,(1100,2,1595,530),(1600,534),'advocacy-original.png','Original complete advocacy artwork; reference panel only')
region('company-brochure.pdf',1,(33,479,79,524),(1600,534),'series-education.png','Original education series symbol')
region('company-brochure.pdf',1,(207,477,255,526),(1600,534),'series-growth.png','Original growth series symbol')
region('company-brochure.pdf',1,(378,479,418,524),(1600,534),'series-governance.png','Original governance series symbol')
region('company-brochure.pdf',2,(41,147,179,347),(1600,534),'education-pack.png','Existing board game packaging image, source visual only')
region('company-brochure.pdf',2,(616,109,946,243),(1600,534),'family-scene.png','Existing family/boardgame artwork; not evidence of a real customer')

for row in manifest:
    row['sha256']=hashlib.sha256((ASSETS/row['file']).read_bytes()).hexdigest()
(ASSETS/'source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Prepared {len(manifest)} source assets in {ASSETS}')
