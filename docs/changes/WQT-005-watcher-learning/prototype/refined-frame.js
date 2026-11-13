// Pixel-based geometry: scale straight spans, never stretch bevels or stroke.
const frameHost = document.querySelector('.reader');
const svgNS = 'http://www.w3.org/2000/svg';
const frame = document.createElementNS(svgNS, 'svg');
frame.classList.add('facet-frame');
frame.setAttribute('aria-hidden', 'true');
frame.innerHTML = '<defs><linearGradient id="glass-fill" x2="1" y2="1"><stop stop-color="#c9efff" stop-opacity=".35"/><stop offset=".42" stop-color="#7eaccc" stop-opacity=".1"/><stop offset="1" stop-color="#daeaff" stop-opacity=".28"/></linearGradient><linearGradient id="glass-edge" x2="1" y2="1"><stop stop-color="#fff"/><stop offset=".25" stop-color="#70b0db" stop-opacity=".65"/><stop offset=".5" stop-color="#f3fcff"/><stop offset=".75" stop-color="#9caccd" stop-opacity=".65"/><stop offset="1" stop-color="#fff"/></linearGradient><linearGradient id="edge-glint"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><path class="frame-outline" fill="url(#glass-fill)" stroke="url(#glass-edge)" stroke-width="1.5" vector-effect="non-scaling-stroke"/><path class="frame-inner" fill="none" stroke="url(#glass-edge)" stroke-opacity=".45" stroke-width=".75" vector-effect="non-scaling-stroke"/><path class="frame-glint" fill="none" stroke="url(#edge-glint)" stroke-width="3" vector-effect="non-scaling-stroke"/>';
frameHost.prepend(frame);
const darkEdge=document.createElementNS(svgNS,'path');
darkEdge.classList.add('frame-dark');
darkEdge.setAttribute('vector-effect','non-scaling-stroke');
frame.insertBefore(darkEdge,frame.querySelector('.frame-outline'));
const glints=[frame.querySelector('.frame-glint'),frame.querySelector('.frame-glint').cloneNode()];
frame.append(glints[1]);
const glintGradients=glints.map((path,i)=>{const g=frame.querySelector('#edge-glint').cloneNode(true);g.id='local-glint-'+i;g.setAttribute('gradientUnits','userSpaceOnUse');frame.querySelector('defs').append(g);path.setAttribute('stroke','url(#'+g.id+')');return g});
const glows=glints.map(()=>{const e=document.createElementNS(svgNS,'ellipse');e.classList.add('frame-glow');e.setAttribute('rx','28');e.setAttribute('ry','4');frame.append(e);return e});
function geometry(w,h,inset=1){
  const c=w<500?18:30, n=w<500?10:14;
  const left=inset,right=w-inset,top=inset,bottom=h-inset;
  const a=w*.43,b=w*.76;
  return 'M '+(left+c)+' '+top+' H '+a+' l '+n+' '+n+' H '+(b-n)+' l '+n+' '+(-n)+' H '+(right-c)+' L '+right+' '+(top+c)+' V '+(bottom-c)+' L '+(right-c)+' '+bottom+' H '+(w*.66)+' l '+(-n)+' '+(-n)+' H '+(left+c)+' L '+left+' '+(bottom-n-c)+' V '+(top+c)+' Z';
}
function resizeFrame(){
  const w=frameHost.clientWidth,h=frameHost.clientHeight;
  frame.setAttribute('viewBox','0 0 '+w+' '+h);
  frame.querySelector('.frame-outline').setAttribute('d',geometry(w,h));
  frame.querySelector('.frame-inner').setAttribute('d',geometry(w,h,4));
  darkEdge.setAttribute('d',geometry(w,h,2.5));
  [[w*.24,1],[w*.8,h-1]].forEach(([x,y],i)=>{
    glints[i].setAttribute('d','M '+(x-45)+' '+y+' H '+(x+45));
    glintGradients[i].setAttribute('x1',x-45);glintGradients[i].setAttribute('x2',x+45);glintGradients[i].setAttribute('y1',y);glintGradients[i].setAttribute('y2',y);
    glows[i].setAttribute('cx',x);glows[i].setAttribute('cy',y);
  });
}
new ResizeObserver(resizeFrame).observe(frameHost);
resizeFrame();
