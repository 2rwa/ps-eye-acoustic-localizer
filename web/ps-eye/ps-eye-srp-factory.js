(()=>{'use strict';

const FS=16000,SOUND=343,WINDOW=512,FFT_N=1024,HOP=256;
const FMIN=500,FMAX=3500,BIN_STEP=2,SCAN_STEP=1;
const MICS=[
  {logical:0,x:-0.030,label:'Mic1'},
  {logical:2,x:-0.010,label:'Mic3'},
  {logical:1,x: 0.010,label:'Mic2'},
  {logical:3,x: 0.030,label:'Mic4'}
];
const PAIRS=[];
for(let a=0;a<MICS.length;a++)for(let b=a+1;b<MICS.length;b++){
  const dx=MICS[b].x-MICS[a].x;
  PAIRS.push({a,b,dx,weight:.45+.55*(Math.abs(dx)/.06)});
}
const BINS=[];
for(let k=Math.ceil(FMIN*FFT_N/FS);k<=Math.floor(FMAX*FFT_N/FS);k+=BIN_STEP)BINS.push(k);
const ANGLES=[];
for(let a=-90;a<=90;a+=SCAN_STEP)ANGLES.push(a);

function fft(re,im,inverse=false){
  const n=re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]]}
  }
  for(let len=2;len<=n;len<<=1){
    const ang=(inverse?2:-2)*Math.PI/len,c=Math.cos(ang),s=Math.sin(ang);
    for(let i=0;i<n;i+=len){
      let wr=1,wi=0;
      for(let j=0;j<len/2;j++){
        const ur=re[i+j],ui=im[i+j],vr=re[i+j+len/2]*wr-im[i+j+len/2]*wi,vi=re[i+j+len/2]*wi+im[i+j+len/2]*wr;
        re[i+j]=ur+vr;im[i+j]=ui+vi;re[i+j+len/2]=ur-vr;im[i+j+len/2]=ui-vi;
        const nwr=wr*c-wi*s;wi=wr*s+wi*c;wr=nwr;
      }
    }
  }
  if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n}
}

function spectra(channels){
  const out=[];
  for(let c=0;c<4;c++){
    const re=new Float64Array(FFT_N),im=new Float64Array(FFT_N),src=channels[c];
    let mean=0;for(let i=0;i<WINDOW;i++)mean+=src[i];mean/=WINDOW;
    for(let i=0;i<WINDOW;i++){const w=.5-.5*Math.cos(2*Math.PI*i/(WINDOW-1));re[i]=(src[i]-mean)*w}
    fft(re,im,false);out.push({re,im});
  }
  return out;
}

const STEER=ANGLES.map(angle=>{
  const st=Math.sin(angle*Math.PI/180);
  return PAIRS.map(p=>{
    const lag=p.dx*st*FS/SOUND;
    const cs=new Float32Array(BINS.length),ss=new Float32Array(BINS.length);
    for(let i=0;i<BINS.length;i++){
      const ph=2*Math.PI*BINS[i]*lag/FFT_N;
      cs[i]=Math.cos(ph);ss[i]=Math.sin(ph);
    }
    return{cs,ss};
  });
});

function createEstimator(){
  const ring=[[],[],[],[]];
  let newFrames=0,lastResult=null,smoothAngle=0,smoothConfidence=0,gateDb=-52;

  function estimate(channels){
    let energy=0;
    for(let c=0;c<4;c++)for(let i=0;i<WINDOW;i++)energy+=channels[c][i]*channels[c][i];
    const rms=Math.sqrt(energy/(4*WINDOW)),levelDb=20*Math.log10(Math.max(1e-9,rms));
    if(levelDb<gateDb)return{active:false,levelDb,angle:lastResult?.angle??0,confidence:0,rawAngle:lastResult?.rawAngle??0,scores:[]};

    const spec=spectra(channels);
    const cross=PAIRS.map(p=>{
      const A=spec[MICS[p.a].logical],B=spec[MICS[p.b].logical];
      const cr=new Float32Array(BINS.length),ci=new Float32Array(BINS.length);
      for(let i=0;i<BINS.length;i++){
        const k=BINS[i],ar=A.re[k],ai=A.im[k],br=B.re[k],bi=B.im[k];
        let rr=ar*br+ai*bi,ii=ai*br-ar*bi;
        const mag=Math.hypot(rr,ii)+1e-12;cr[i]=rr/mag;ci[i]=ii/mag;
      }
      return{cr,ci};
    });

    const scores=new Array(ANGLES.length);
    let bestI=0,best=-Infinity,second=-Infinity,mean=0;
    for(let ai=0;ai<ANGLES.length;ai++){
      let score=0,ws=0;
      for(let pi=0;pi<PAIRS.length;pi++){
        const p=PAIRS[pi],c=cross[pi],st=STEER[ai][pi];
        let pairScore=0;
        for(let i=0;i<BINS.length;i++)pairScore+=c.cr[i]*st.cs[i]-c.ci[i]*st.ss[i];
        pairScore/=BINS.length;
        score+=p.weight*pairScore;ws+=p.weight;
      }
      score/=ws;scores[ai]={angle:ANGLES[ai],score};mean+=score;
      if(score>best){second=best;best=score;bestI=ai}else if(score>second)second=score;
    }
    mean/=scores.length;
    let varSum=0;for(const q of scores)varSum+=(q.score-mean)*(q.score-mean);
    const sd=Math.sqrt(varSum/scores.length)+1e-9;
    let refined=ANGLES[bestI];
    if(bestI>0&&bestI<scores.length-1){
      const ym=scores[bestI-1].score,y0=scores[bestI].score,yp=scores[bestI+1].score,den=ym-2*y0+yp;
      if(Math.abs(den)>1e-12)refined+=Math.max(-.5,Math.min(.5,.5*(ym-yp)/den))*SCAN_STEP;
    }
    const z=Math.max(0,(best-mean)/sd),prom=Math.max(0,(best-second)/(Math.abs(best)+1e-9));
    const confidence=Math.max(0,Math.min(1,.22*Math.min(3,z)/3+.78*Math.min(1,prom*18)));
    const alpha=confidence>.55?.30:.14;
    smoothAngle=smoothAngle*(1-alpha)+refined*alpha;
    smoothConfidence=smoothConfidence*.72+confidence*.28;
    return{active:true,levelDb,angle:smoothAngle,rawAngle:refined,confidence:smoothConfidence,score:best,secondScore:second,peakZ:z,scores,band:[FMIN,FMAX]};
  }

  function pushInt16(interleaved){
    const frames=interleaved.length/4;
    for(let f=0;f<frames;f++)for(let c=0;c<4;c++)ring[c].push(interleaved[f*4+c]/32768);
    for(let c=0;c<4;c++)if(ring[c].length>FFT_N*2)ring[c].splice(0,ring[c].length-FFT_N*2);
    newFrames+=frames;if(ring[0].length<WINDOW||newFrames<HOP)return null;newFrames%=HOP;
    lastResult=estimate(ring.map(a=>a.slice(a.length-WINDOW)));return lastResult;
  }
  return{pushInt16,setGateDb:v=>{gateDb=Number(v)},getConfig:()=>({sampleRate:FS,windowFrames:WINDOW,hopFrames:HOP,band:[FMIN,FMAX],bins:BINS.length,angles:ANGLES.length,mics:MICS,pairs:PAIRS})};
}

function synth(angleDeg){
  let seed=0x5eed1234;const base=new Float64Array(WINDOW+192);
  for(let i=0;i<base.length;i++){seed=(1664525*seed+1013904223)>>>0;base[i]=((seed/4294967296)*2-1)*.8}
  const st=Math.sin(angleDeg*Math.PI/180),delays=MICS.map(m=>-m.x*st*FS/SOUND),mn=Math.min(...delays);
  const ch=[new Float64Array(WINDOW),new Float64Array(WINDOW),new Float64Array(WINDOW),new Float64Array(WINDOW)];
  for(let mi=0;mi<MICS.length;mi++){
    const d=delays[mi]-mn+12,logical=MICS[mi].logical;
    for(let i=0;i<WINDOW;i++){const pos=i-d+24,p0=Math.floor(pos),t=pos-p0;ch[logical][i]=(base[p0]??0)*(1-t)+(base[p0+1]??0)*t}
  }
  return ch;
}
function selfTest(){
  const cases=[-70,-55,-30,0,30,55,70],results=[];
  for(const target of cases){
    const est=createEstimator();est.setGateDb(-120);const ch=synth(target);let r=null;
    for(let off=0;off<WINDOW;off+=128){
      const pcm=new Int16Array(128*4);
      for(let f=0;f<128;f++)for(let c=0;c<4;c++)pcm[f*4+c]=Math.max(-32767,Math.min(32767,Math.round(ch[c][off+f]*32767)));
      const q=est.pushInt16(pcm);if(q)r=q;
    }
    const got=r?r.rawAngle:999,error=Math.abs(got-target);results.push({target,estimated:got,error,pass:error<4});
  }
  return{pass:results.every(x=>x.pass),results};
}
window.PsEyeSrpFactory={createEstimator,selfTest,config:{sampleRate:FS,windowFrames:WINDOW,hopFrames:HOP,band:[FMIN,FMAX],bins:BINS.length,angles:ANGLES.length,mics:MICS,pairs:PAIRS}};
})();