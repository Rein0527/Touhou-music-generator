const canvas = document.getElementById("viz");
const ctx = canvas.getContext("2d");
const audio = document.getElementById("audio");
let audioCtx, analyser, src, rafId;

function initAudio(){
  if(!audioCtx){
    audioCtx=new AudioContext();
    analyser=audioCtx.createAnalyser();
    src=audioCtx.createMediaElementSource(audio);
    src.connect(analyser);
    analyser.connect(audioCtx.destination);
  }
}
audio.onplay=()=>{
  initAudio(); drawViz();
};

function drawViz(){
  cancelAnimationFrame(rafId);
  const W=canvas.width,H=canvas.height,cx=W/2,cy=H/2;
  const radius=Math.min(W,H)*0.34, progressOuter=radius+52, progressThick=10, freqBins=64;
  const data=new Uint8Array(analyser.frequencyBinCount);
  (function loop(){
    rafId=requestAnimationFrame(loop);
    analyser.getByteFrequencyData(data); ctx.clearRect(0,0,W,H);
    const step=Math.floor(data.length/freqBins);
    for(let i=0;i<freqBins;i++){
      const v=data[i*step]/255, bar=24+v*160, a=(i/freqBins)*Math.PI*2;
      const x1=cx+Math.cos(a)*radius, y1=cy+Math.sin(a)*radius, x2=cx+Math.cos(a)*(radius+bar), y2=cy+Math.sin(a)*(radius+bar);
      ctx.strokeStyle=`rgba(255,255,255,${.3+v*.55})`; ctx.lineWidth=3.5;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    }
    const d=audio.duration||0, ct=audio.currentTime||0, p=d>0?ct/d:0;
    const startA=-Math.PI/2, endA=startA+p*Math.PI*2;
    ctx.strokeStyle="rgba(255,255,255,.18)"; ctx.lineWidth=progressThick;
    ctx.beginPath(); ctx.arc(cx,cy,progressOuter,0,Math.PI*2); ctx.stroke();
    const g=ctx.createLinearGradient(cx-progressOuter,cy-progressOuter,cx+progressOuter,cy+progressOuter); g.addColorStop(0,"#ff8bd1"); g.addColorStop(1,"#6da8ff");
    ctx.strokeStyle=g; ctx.lineCap="round"; ctx.beginPath(); ctx.arc(cx,cy,progressOuter,startA,endA,false); ctx.stroke();
    const hx=cx+Math.cos(endA)*progressOuter, hy=cy+Math.sin(endA)*progressOuter; ctx.fillStyle="#fff"; ctx.beginPath(); ctx.arc(hx,hy,5.5,0,Math.PI*2); ctx.fill();
  })();
}
