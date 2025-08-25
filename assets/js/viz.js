// assets/js/viz.js
// 簡易可視化（頻譜圓環 + 漸層），與 <audio id="audio"> 相連

import { audio } from './player.js';

const canvas = document.getElementById('viz');
if (!canvas) return;
const ctx = canvas.getContext('2d');

let audioCtx, analyser, srcNode;
let data;

function makeAudioGraph(){
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  data = new Uint8Array(analyser.frequencyBinCount);

  // MediaElementSource 只能綁一次；因為我們切歌時不換 <audio> 節點，只換 src，所以綁一次即可
  srcNode = audioCtx.createMediaElementSource(audio);
  srcNode.connect(analyser);
  analyser.connect(audioCtx.destination);
}

function draw(){
  requestAnimationFrame(draw);
  if (!analyser) return;
  analyser.getByteFrequencyData(data);

  const w = canvas.width, h = canvas.height;
  const cx = w/2, cy = h/2;
  const radius = Math.min(w,h)*0.28;

  ctx.clearRect(0,0,w,h);

  // 背景漸層
  const grad = ctx.createLinearGradient(0,0,w,h);
  grad.addColorStop(0, '#a6c0fe');
  grad.addColorStop(1, '#f68084');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 6;

  // 環形頻譜
  const N = data.length;
  for (let i=0;i<N;i+=4){
    const v = data[i]/255;
    const ang = (i/N)*Math.PI*2;
    const r1 = radius;
    const r2 = radius + v*120; // 依音量外擴
    const x1 = cx + r1*Math.cos(ang);
    const y1 = cy + r1*Math.sin(ang);
    const x2 = cx + r2*Math.cos(ang);
    const y2 = cy + r2*Math.sin(ang);
    ctx.beginPath();
    ctx.moveTo(x1,y1);
    ctx.lineTo(x2,y2);
    ctx.stroke();
  }

  // 外圈 glow（音量加權）
  const avg = data.reduce((a,b)=>a+b,0)/(N*255);
  ctx.beginPath();
  ctx.arc(cx, cy, radius + avg*140, 0, Math.PI*2);
  ctx.globalAlpha = 0.15 + avg*0.35;
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.globalAlpha = 1;
}

document.addEventListener('click', ()=>{ // 首次互動後解鎖 AudioContext
  try { makeAudioGraph(); audioCtx.resume(); } catch(e){}
},{ once:true });

draw();
