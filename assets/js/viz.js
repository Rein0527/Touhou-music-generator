// viz.js — 2.5D Quantum Orbital (p-orbital / figure-eight)
// Beat coupling: vibration (NOT speed)
// - 36 electrons (Kr: 2,8,18,8)
// - Lissajous "8" trajectories
// - Beat drives orbital vibration / uncertainty, not angular velocity

const audio  = document.getElementById("audio");
const canvas = document.getElementById("viz");
const ctx    = canvas.getContext("2d");

/* =======================
   Public toggle API
======================= */
export let VIZ_ENABLED = false;

export function setVizEnabled(v){
  VIZ_ENABLED = !!v;
  if(!VIZ_ENABLED){
    if(rafId) cancelAnimationFrame(rafId);
    rafId = null;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    return;
  }
  if(!audio.paused) start();
}

export function getVizEnabled(){ return VIZ_ENABLED; }

/* =======================
   Config
======================= */
const CFG = {
  shells: [2,8,18,8],

  // Motion
  baseSpeed: 0.75,          // ⬅ 固定角速度（不再跟節奏掛鉤）

  // Lissajous (p-orbital)
  lissaA: 1,
  lissaB: 2,
  lissaAspect: 0.9,

  // Beat-driven vibration
  vibRadial: 26,            // 徑向震動強度
  vibTangential: 18,        // 切向抖動
  vibDepth: 0.35,           // Z 擾動

  // Visual
  trailAlpha: 0.12,
  electronBaseSize: 2.4,
  electronSizeGain: 4.8,
  tailBase: 12,
  tailGain: 40,

  // Depth (stronger)
  zDepth: 1.2,
  zScaleMin: 0.6,
  zScaleMax: 1.3,
  zAlphaMin: 0.2,

  // Orbits
  orbitMin: 0.34,
  orbitMax: 0.6,

  // Nucleus (soft)
  nucleusRatio: 0.16,
  nucleusAlpha: 0.12,
  nucleusGlow: 60,

  // Progress ring (thin)
  progressBg: 0.1,
  progressFg: 0.55,
  progressWBg: 6,
  progressWFg: 4,

  // Audio
  smoothing: 0.78,
  freqGamma: 2.1
};

/* =======================
   Audio
======================= */
let audioCtx, analyser, src;
let dataFreq;

/* =======================
   State
======================= */
let rafId = null;
let lastT = 0;
let electrons = null;
let volEnv = 0, bassEnv = 0, beatEnv = 0;

/* =======================
   Utils
======================= */
const lerp = (a,b,t)=>a+(b-a)*t;
const clamp01 = v=>Math.max(0,Math.min(1,v));

function logMapIndex(t,n,g){
  return Math.min(n-1, Math.floor(Math.pow(t,g)*(n-1)));
}

/* =======================
   Init
======================= */
function ensureAudio(){
  if(audioCtx) return;
  audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = CFG.smoothing;
  src = audioCtx.createMediaElementSource(audio);
  src.connect(analyser);
  analyser.connect(audioCtx.destination);
  dataFreq = new Uint8Array(analyser.frequencyBinCount);
}

function initElectrons(){
  electrons = [];
  const total = CFG.shells.reduce((a,b)=>a+b,0);
  let idx = 0;
  for(let s=0;s<CFG.shells.length;s++){
    for(let i=0;i<CFG.shells[s];i++){
      const t = idx/(total-1);
      electrons.push({
        shell:s,
        tFreq:t,
        hue:260-240*t,
        u:Math.random()*Math.PI*2,
        w:CFG.baseSpeed*(0.8+0.4*Math.random()),
        phase:Math.random()*Math.PI*2,
        e:0
      });
      idx++;
    }
  }
}

/* =======================
   Beat / Energy
======================= */
function computeEnergy(){
  let sum=0;
  for(let i=0;i<dataFreq.length;i++) sum+=dataFreq[i];
  const avg=sum/(dataFreq.length*255);

  let bsum=0;
  const low=Math.floor(dataFreq.length/7);
  for(let i=0;i<low;i++) bsum+=dataFreq[i];
  const bass=bsum/(low*255);

  volEnv=lerp(volEnv,avg, avg>volEnv?0.3:0.08);
  bassEnv=lerp(bassEnv,bass,bass>bassEnv?0.35:0.1);
  beatEnv=lerp(beatEnv, clamp01(bassEnv*0.9+volEnv*0.3),0.25);
}

/* =======================
   Lissajous "8"
======================= */
function lissa(u){
  return {
    x: Math.sin(CFG.lissaA*u),
    y: Math.sin(CFG.lissaB*u)
  };
}

/* =======================
   Draw
======================= */
function draw(t){
  if(!VIZ_ENABLED) return;
  const dt = lastT?(t-lastT)/1000:0;
  lastT=t;

  analyser.getByteFrequencyData(dataFreq);
  computeEnergy();

  const rect=canvas.getBoundingClientRect();
  canvas.width=rect.width*devicePixelRatio;
  canvas.height=rect.height*devicePixelRatio;
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);

  const W=rect.width,H=rect.height;
  const cx=W/2,cy=H/2;
  const short=Math.min(W,H);
  const ring=short/2-40;

  // trail
  ctx.fillStyle=`rgba(0,0,0,${CFG.trailAlpha})`;
  ctx.fillRect(0,0,W,H);

  if(!electrons) initElectrons();

  const rMin=ring*CFG.orbitMin;
  const rMax=ring*CFG.orbitMax;

  const drawList=[];

  for(const el of electrons){
    const idx=logMapIndex(el.tFreq,dataFreq.length,CFG.freqGamma);
    el.e=lerp(el.e,dataFreq[idx]/255,0.2);

    // ⬅ 固定速度，只受時間影響
    el.u += el.w*dt;

    const baseR=lerp(rMin,rMax,el.shell/(CFG.shells.length-1));

    // ✅ Beat-driven vibration
    const vibR = beatEnv*CFG.vibRadial*Math.sin(el.phase+t*0.006);
    const vibT = beatEnv*CFG.vibTangential*Math.cos(el.phase+t*0.004);

    const {x,y}=lissa(el.u);
    let px=x*(baseR+vibR);
    let py=y*(baseR+vibR);

    // tangential jitter
    px += -y*vibT;
    py +=  x*vibT;

    // pseudo-z
    const z = Math.sin(el.u+el.phase)*CFG.vibDepth*beatEnv;
    const zN=(z*CFG.zDepth+1)*0.5;

    drawList.push({
      el,
      X:cx+px,
      Y:cy+py+zN*baseR*0.35,
      zN
    });
  }

  drawList.sort((a,b)=>a.zN-b.zN);

  ctx.globalCompositeOperation="lighter";

  for(const it of drawList){
    const el=it.el;
    const light=36+el.e*54+beatEnv*14;
    const alpha=(0.15+el.e*0.8+beatEnv*0.25)*(CFG.zAlphaMin+(1-CFG.zAlphaMin)*it.zN);
    const color=`hsla(${el.hue},100%,${light}%,${alpha})`;

    ctx.shadowColor=color;
    ctx.shadowBlur=8+beatEnv*18;

    const size=(CFG.electronBaseSize+el.e*CFG.electronSizeGain+beatEnv*2.2)
               *lerp(CFG.zScaleMin,CFG.zScaleMax,it.zN);

    ctx.fillStyle=color;
    ctx.beginPath();
    ctx.arc(it.X,it.Y,size,0,Math.PI*2);
    ctx.fill();
  }

  rafId=requestAnimationFrame(draw);
}

function start(){
  ensureAudio();
  if(audioCtx.state==="suspended") audioCtx.resume();
  lastT=0;
  draw(0);
}

audio.addEventListener("play",()=>{ if(VIZ_ENABLED) start(); });
window.addEventListener("resize",()=>{});
