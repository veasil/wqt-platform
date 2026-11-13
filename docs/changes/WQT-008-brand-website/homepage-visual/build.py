"""Build folder and portable single-file versions of the homepage prototype."""
import base64
import json
import shutil
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
OUT=ROOT/'output/wqt-company-home'
ASSETS=ROOT/'output/wqt-brand-story/assets'
(OUT/'assets').mkdir(parents=True,exist_ok=True)
names=['company-mark.png','01-era.png','03-literacy.png','04-family.png','06-research.png','07-activities.png','09-industry.png','10-cultivation.png','11-communication.png']
for name in names:
    shutil.copy2(ASSETS/name,OUT/'assets'/name)
for name in ['index.html','style.css','script.js']:
    shutil.copy2(HERE/name,OUT/name)
css=(HERE/'style.css').read_text(encoding='utf-8')
js=(HERE/'script.js').read_text(encoding='utf-8')
sources={name:'data:image/png;base64,'+base64.b64encode((ASSETS/name).read_bytes()).decode('ascii') for name in names}
# Let dynamic tabs and dialogs use the same embedded map as static images.
js=js.replace("image.src='assets/'+data.image", "image.src=window.WQT_IMAGES[data.image]")
js=js.replace('src="assets/${data.image}"','src="${window.WQT_IMAGES[data.image]}"')
html=(HERE/'index.html').read_text(encoding='utf-8')
html=html.replace('<link rel="stylesheet" href="style.css">','<style>'+css+'</style>')
html=html.replace('<script src="script.js"></script>','<script>window.WQT_IMAGES='+json.dumps(sources)+';'+js+'</script>')
# Reference the shared data map from short inline bootstrapping rather than duplicate image data.
for name in names:
    html=html.replace('src="assets/'+name+'"','data-asset="'+name+'"')
html=html.replace('updateNavigation();\n</script>', 'updateNavigation();\n</script>')
bootstrap="document.querySelectorAll('img[data-asset]').forEach(i=>{i.src=window.WQT_IMAGES[i.dataset.asset];});"
html=html.replace('<script>window.WQT_IMAGES=', '<script>window.WQT_IMAGES=')
html=html.replace(';'+js+'</script>', ';'+bootstrap+js+'</script>')
(OUT/'preview.html').write_text(html,encoding='utf-8')
print(json.dumps({'output':str(OUT),'assets':len(names),'single_file_bytes':(OUT/'preview.html').stat().st_size},ensure_ascii=False))
