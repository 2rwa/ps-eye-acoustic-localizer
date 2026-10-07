(()=>{'use strict';

const FS=16000;
const SOUND=343;
const WINDOW=512;
const FFT_N=1024;
const HOP=256;
// Physical left -> right. Values are the working geometry estimate for PS Eye.
// logical channels: ch1, ch3, ch2, ch4
const MICS=[
  {logical:0,x:-0.030,label:'Mic1'},
  {logical:2,x:-0.010,label:'Mic3'},
  {logical:1,x: 0.010,label:'Mic2'},
  {logical:3,x: 0.030,label:'Mic4'}
];
const PAIRS=[];
for(let a=0;a<MICS.length;a++)for(let b=a+1;b<MICS.length;b++){
  const dx=MICS[b].x-MICS[a].x;
  PAIRS.push({a,b,dx,maxLag:Math.ceil(dx*FS/SOUND)+1});
}

const ring=[[],[],[],[]];
let newFrames=0;
let lastResult=null;
let smoothAngle=0;
let smoothConfidence=0;
let enabled=true;
let gateDb=-52;

function fft(re,im,inverse=false){
  const n=re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;
    for(;j&bit;bit>>=1)j^=bit;
    j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]]}
  }
  for(let len=2;len<=n;len<<=1){
    const ang=(inverse?2:-2)*Math.PI/len;
    const wlenR=Math.cos(ang),wlenI=Math.sin(ang);
    for(let i=0;i<n;i+=len){
      let wr=1,wi=0;
      for(let j=0;j<len/2;j++){
        const uR=re[i+j],uI=im[i+j];
        const vr=re[i+j+len/2]*wr-im[i+j+len/2]*wi;
        const vi=re[i+j+len/2]*wi+im[i+j+len/2]*wr;
        re[i+j]=uR+vr; im[i+j]=uI+vi;
        re[i+j+len/2]=uR-vr; im[i+j+len/2]=uI-vi;
        const nwr=wr*wlenR-wi*wlenI;
        wi=wr*wlenI+wi*wlenR; wr=nwr;
      }
    }
  }
  if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n}
}

function spectra(channels){
  const out=[];
  for(let c=0;c<4;c++){
    const re=new Float64Array(FFT_N),im=new Float64Array(FFT_N);
    const src=channels[c];
    let mean=0;
    for(let i=0;i<WINDOW;i++)mean+=src[i];
    mean/=WINDOW;
    for(let i=0;i<WINDOW;i++){
      const w=0.5-0.5*Math.cos(2*Math.PI*i/(WINDOW-1));
      re[i]=(src[i]-mean)*w;
    }
    fft(re,im,false);
    out.push({re,im});
  }
  return out;
}

function gccPair(specA,specB,maxLag){
  const re=new Float64Array(FFT_N),im=new Float64Array(FFT_N);
  for(let k=0;k<FFT_N;k++){
    const ar=specA.re[k],ai=specA.im[k],br=specB.re[k],bi=specB.im[k];
    let cr=ar*br+ai*bi;
    let ci=ai*br-ar*bi;
    const mag=Math.hypot(cr,ci)+1e-12;
    re[k]=cr/mag; im[k]=ci/mag;
  }
  fft(re,im,true);

  const corrAt=lag=>lag>=0?re[lag]:re[FFT_N+lag];
  let bestLag=0,best=-Infinity,second=-Infinity;
  const values=[];
  for(let lag=-maxLag;lag<=maxLag;lag++){
    const v=corrAt(lag);
    values.push(v);
    if(v>best){second=best;best=v;bestLag=lag}
    else if(v>second)second=v;
  }
  let frac=0;
  if(bestLag>-maxLag&&bestLag<maxLag){
    const ym=corrAt(bestLag-1),y0=corrAt(bestLag),yp=corrAt(bestLag+1);
    const den=ym-2*y0+yp;
    if(Math.abs(den)>1e-12) frac=Math.max(-0.5,Math.min(0.5,0.5*(ym-yp)/den));
  }
  let sum2=0;
  for(const v of values)sum2+=v*v;
  const rms=Math.sqrt(sum2/values.length)+1e-9;
  const snr=Math.max(0,best/rms);
  const prominence=Math.max(0,(best-second)/(Math.abs(best)+1e-9));
  const quality=Math.max(0.05,Math.min(1,0.12*snr+0.88*prominence));
  return {lag:bestLag+frac,peak:best,quality};
}

function estimate(channels){
  let energy=0;
  for(let c=0;c<4;c++)for(let i=0;i<WINDOW;i++)energy+=channels[c][i]*channels[c][i];
  const rms=Math.sqrt(energy/(4*WINDOW));
  const levelDb=20*Math.log10(Math.max(1e-9,rms));
  if(levelDb<gateDb)return {active:false,levelDb,angle:lastResult?.angle??0,confidence:0,pairs:[]};

  const specs=spectra(channels);
  const pairResults=[];
  let num=0,den=0;
  for(const p of PAIRS){
    const r=gccPair(specs[MICS[p.a].logical],specs[MICS[p.b].logical],p.maxLag);
    const w=r.quality*Math.max(1e-6,p.dx*p.dx);
    num+=w*p.dx*r.lag;
    den+=w*p.dx*p.dx;
    pairResults.push({...p,...r});
  }
  let sinTheta=(SOUND/FS)*(num/Math.max(1e-12,den));
  sinTheta=Math.max(-1,Math.min(1,sinTheta));
  let angle=Math.asin(sinTheta)*180/Math.PI;

  let err=0,ws=0,q=0;
  for(const r of pairResults){
    const predicted=r.dx*sinTheta*FS/SOUND;
    const w=r.quality*Math.max(1e-6,r.dx*r.dx);
    err+=w*(r.lag-predicted)*(r.lag-predicted);
    ws+=w;
    q+=r.quality;
  }
  const rmse=Math.sqrt(err/Math.max(1e-12,ws));
  const agreement=Math.exp(-1.4*rmse);
  const meanQ=q/pairResults.length;
  let confidence=Math.max(0,Math.min(1,meanQ*agreement));

  const alpha=confidence>0.55?0.32:0.16;
  smoothAngle=smoothAngle*(1-alpha)+angle*alpha;
  smoothConfidence=smoothConfidence*0.7+confidence*0.3;
  angle=smoothAngle; confidence=smoothConfidence;
  return {active:true,levelDb,angle,confidence,rawAngle:Math.asin(sinTheta)*180/Math.PI,rmse,pairs:pairResults};
}

function pushInt16(interleaved){
  const frames=interleaved.length/4;
  for(let f=0;f<frames;f++){
    for(let c=0;c<4;c++)ring[c].push(interleaved[f*4+c]/32768);
  }
  const maxKeep=FFT_N*2;
  for(let c=0;c<4;c++)if(ring[c].length>maxKeep)ring[c].splice(0,ring[c].length-maxKeep);
  newFrames+=frames;
  if(!enabled||ring[0].length<WINDOW||newFrames<HOP)return null;
  newFrames%=HOP;
  const channels=ring.map(a=>a.slice(a.length-WINDOW));
  lastResult=estimate(channels);
  return lastResult;
}

function synth(angleDeg){
  const n=WINDOW+64;
  let seed=0x12345678;
  const base=new Float64Array(n+64);
  for(let i=0;i<base.length;i++){
    seed=(1664525*seed+1013904223)>>>0;
    base[i]=((seed/4294967296)*2-1)*0.8;
  }
  const s=Math.sin(angleDeg*Math.PI/180);
  const delays=MICS.map(m=>-m.x*s*FS/SOUND);
  const min=Math.min(...delays);
  const ch=[new Float64Array(WINDOW),new Float64Array(WINDOW),new Float64Array(WINDOW),new Float64Array(WINDOW)];
  for(let mi=0;mi<MICS.length;mi++){
    const d=delays[mi]-min+8;
    const logical=MICS[mi].logical;
    for(let i=0;i<WINDOW;i++){
      const pos=i-d+20;
      const p0=Math.floor(pos),t=pos-p0;
      ch[logical][i]=(base[p0]??0)*(1-t)+(base[p0+1]??0)*t;
    }
  }
  return ch;
}

function selfTest(){
  const savedA=smoothAngle,savedC=smoothConfidence,savedGate=gateDb;
  gateDb=-120;
  const cases=[-45,-20,0,20,45];
  const results=[];
  for(const target of cases){
    smoothAngle=target; smoothConfidence=1;
    const r=estimate(synth(target));
    const error=Math.abs(r.rawAngle-target);
    results.push({target,estimated:r.rawAngle,error,pass:error<8});
  }
  smoothAngle=savedA;smoothConfidence=savedC;gateDb=savedGate;
  return {pass:results.every(x=>x.pass),results};
}

window.PsEyeDoa={
  pushInt16,
  setEnabled:v=>{enabled=!!v},
  setGateDb:v=>{gateDb=Number(v)},
  getConfig:()=>({sampleRate:FS,windowFrames:WINDOW,hopFrames:HOP,windowMs:WINDOW*1000/FS,hopMs:HOP*1000/FS,mics:MICS,pairs:PAIRS}),
  selfTest
};
})();