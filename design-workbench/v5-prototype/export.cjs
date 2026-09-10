const fs = require('node:fs');
const path = require('node:path');
const source = process.argv[2] || __dirname;
const assets = ['2026B01.webp','banner-bg.png','card-color-background.webp','city.webp','logo.png','wu.webp'];
fs.mkdirSync(path.join(__dirname,'assets'), {recursive:true});
if (path.resolve(source) !== __dirname) {
  for(const name of ['index.html','styles.css','app.js']) fs.copyFileSync(path.join(source,name),path.join(__dirname,name));
  for(const name of assets) fs.copyFileSync(path.join(source,'assets',name),path.join(__dirname,'assets',name));
}
const embed = text => text.replace(/assets\/([\w.-]+)/g, (match,name) => {
  if(!assets.includes(name)) throw new Error('Unexpected asset: '+name);
  return 'data:image/'+(name.endsWith('.png')?'png':'webp')+';base64,'+fs.readFileSync(path.join(__dirname,'assets',name)).toString('base64');
});
let html = fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
html = html.replace('<link rel="stylesheet" href="styles.css">',()=>'<style>'+embed(fs.readFileSync(path.join(__dirname,'styles.css'),'utf8'))+'</style>');
html = html.replace('<script src="app.js"></script>',()=>'<script>'+embed(fs.readFileSync(path.join(__dirname,'app.js'),'utf8'))+'</script>');
fs.writeFileSync(path.join(__dirname,'standalone-prototype.html'),html);
console.log('Exported standalone-prototype.html; only allowlisted assets included.');
