(()=>{'use strict';

const FS=16000,SOUND=343,WINDOW=512,FFT_N=1024,HOP=256;
const FMIN=500,FMAX=3500,BIN_STEP=2;
const LAG_MIN=-4,LAG_MAX=4,LAG_STEP=1/32;
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
const LAGS=[];
for(let x=LAG_MIN;x<=LAG_MAX+1e-9;x+=LAG_STEP)LAGS.push(x);

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
        const ur=re[i+j],ui=im[i+j];
        const vr=re[i+j+len/2]*wr-im[i+j+len/2]*wi;
        const vi=re[i+j+len/2]*wi+im[i+j+len/2]*wr;
        re[i+j]=ur+vr;im[i+j]=ui+vi;
        re[i+j+len/2]=ur-vr;im[i+j+len/2]=ui-vi;
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
    for(let i=0;i<WINDOW;i++){
      const w=.5-.5*Math.cos(2*Math.PI*i/(WINDOW-1));
      re[i]=(src[i]-mean)*w;
    }
    fft(re,im,false);out.push({re,im});
  }
  return out;
}

const LAG_STEER=LAGS.map(lag=>{
  const cs=new Float32Array(BINS.length),ss=new Float32Array(BINS.length);
  for(let i=0;i<BINS.length;i++){
    const ph=2*Math.PI*BINS[i]*lag/FFT_N;
    cs[i]=Math.cos(ph);ss[i]=Math.sin(ph);
  }
  return{cs,ss};
});

function pairResponses(channels){
  const spec=spectra(channels);
  return PAIRS.map(p=>{
    const A=spec[MICS[p.a].logical],B=spec[MICS[p.b].logical];
    const cr=new Float32Array(BINS.length),ci=new Float32Array(BINS.length);
    for(let i=0;i<BINS.length;i++){
      const k=BINS[i],ar=A.re[k],ai=A.im[k],br=B.re[k],bi=B.im[k];
      let rr=ar*br+ai*bi,ii=ai*br-ar*bi;
      const mag=Math.hypot(rr,ii)+1e-12;cr[i]=rr/mag;ci[i]=ii/mag;
    }
    const response=new Float32Array(LAGS.length);
    for(let li=0;li<LAGS.length;li++){
      const st=LAG_STEER[li];let score=0;
      for(let i=0;i<BINS.length;i++)score+=cr[i]*st.cs[i]-ci[i]*st.ss[i];
      response[li]=score/BINS.length;
    }
    return response;
  });
}

function createArrayEstimator(){
  const ring=[[],[],[],[]];
  let newFrames=0,lastResult=null,gateDb=-52;
  function estimate(channels){
    let energy=0;
    for(let c=0;c<4;c++)for(let i=0;i<WINDOW;i++)energy+=channels[c][i]*channels[c][i];
    const rms=Math.sqrt(energy/(4*WINDOW)),levelDb=20*Math.log10(Math.max(1e-9,rms));
    if(levelDb<gateDb)return{active:false,levelDb,pairResponses:null};
    return{active:true,levelDb,pairResponses:pairResponses(channels),band:[FMIN,FMAX]};
  }
  function pushInt16(interleaved){
    const frames=interleaved.length/4;
    for(let f=0;f<frames;f++)for(let c=0;c<4;c++)ring[c].push(interleaved[f*4+c]/32768);
    for(let c=0;c<4;c++)if(ring[c].length>FFT_N*2)ring[c].splice(0,ring[c].length-FFT_N*2);
    newFrames+=frames;
    if(ring[0].length<WINDOW||newFrames<HOP)return null;
    newFrames%=HOP;
    lastResult=estimate(ring.map(a=>a.slice(a.length-WINDOW)));
    return lastResult;
  }
  return{pushInt16,setGateDb:v=>{gateDb=Number(v)},getConfig:()=>CONFIG};
}

function axisFromHeading(deg){
  const r=deg*Math.PI/180;
  return{x:Math.cos(r),y:-Math.sin(r)};
}
function micPositions(array){
  const axis=axisFromHeading(array.heading);
  return MICS.map(m=>({x:array.x+m.x*axis.x,y:array.y+m.x*axis.y}));
}

function buildGrid(opts){
  const {arrayA,arrayB,xMin,xMax,yMin,yMax,step}=opts;
  const nx=Math.floor((xMax-xMin)/step+1.000001);
  const ny=Math.floor((yMax-yMin)/step+1.000001);
  const count=nx*ny;
  if(nx<2||ny<2||count>250000)throw new Error('invalid grid size: '+nx+'x'+ny);
  const ma=micPositions(arrayA),mb=micPositions(arrayB);
  const mapsA=PAIRS.map(()=>new Float32Array(count));
  const mapsB=PAIRS.map(()=>new Float32Array(count));
  const validMask=new Uint8Array(count);
  const frontA={x:Math.sin(arrayA.heading*Math.PI/180),y:Math.cos(arrayA.heading*Math.PI/180)};
  const frontB={x:Math.sin(arrayB.heading*Math.PI/180),y:Math.cos(arrayB.heading*Math.PI/180)};
  let idx=0;
  for(let iy=0;iy<ny;iy++){
    const y=yMin+iy*step;
    for(let ix=0;ix<nx;ix++,idx++){
      const x=xMin+ix*step;
      const va=(x-arrayA.x)*frontA.x+(y-arrayA.y)*frontA.y;
      const vb=(x-arrayB.x)*frontB.x+(y-arrayB.y)*frontB.y;
      validMask[idx]=(va>0&&vb>0)?1:0;
      for(let pi=0;pi<PAIRS.length;pi++){
        const p=PAIRS[pi];
        const aa=ma[p.a],ab=ma[p.b],ba=mb[p.a],bb=mb[p.b];
        const da=Math.hypot(x-aa.x,y-aa.y)-Math.hypot(x-ab.x,y-ab.y);
        const db=Math.hypot(x-ba.x,y-ba.y)-Math.hypot(x-bb.x,y-bb.y);
        mapsA[pi][idx]=(da*FS/SOUND-LAG_MIN)/LAG_STEP;
        mapsB[pi][idx]=(db*FS/SOUND-LAG_MIN)/LAG_STEP;
      }
    }
  }
  return{...opts,nx,ny,count,mapsA,mapsB,validMask,micA:ma,micB:mb};
}

function sampleResponse(response,pos){
  if(pos<=0)return response[0];
  const max=response.length-1;
  if(pos>=max)return response[max];
  const i=pos|0,t=pos-i;
  return response[i]*(1-t)+response[i+1]*t;
}

function scan(grid,a,b){
  if(!a?.active||!b?.active||!a.pairResponses||!b.pairResponses)return{valid:false,reason:'array response unavailable'};
  const scores=new Float32Array(grid.count);
  let best=-Infinity,bestIndex=0,sum=0,sum2=0,weightSum=0;
  for(const p of PAIRS)weightSum+=p.weight*2;
  for(let idx=0;idx<grid.count;idx++){
    if(!grid.validMask[idx]){scores[idx]=NaN;continue}
    let s=0;
    for(let pi=0;pi<PAIRS.length;pi++){
      const w=PAIRS[pi].weight;
      s+=w*sampleResponse(a.pairResponses[pi],grid.mapsA[pi][idx]);
      s+=w*sampleResponse(b.pairResponses[pi],grid.mapsB[pi][idx]);
    }
    s/=weightSum;scores[idx]=s;sum+=s;sum2+=s*s;
    if(s>best){best=s;bestIndex=idx}
  }
  let validCount=0;for(let i=0;i<grid.count;i++)if(grid.validMask[i])validCount++;
  if(!validCount||!Number.isFinite(best))return{valid:false,reason:'no valid foreground grid'};
  const mean=sum/validCount,sd=Math.sqrt(Math.max(0,sum2/validCount-mean*mean))+1e-9;
  const bix=bestIndex%grid.nx,biy=Math.floor(bestIndex/grid.nx);
  let second=-Infinity;
  for(let idx=0;idx<grid.count;idx++){
    const ix=idx%grid.nx,iy=Math.floor(idx/grid.nx);
    if(!grid.validMask[idx]||Math.abs(ix-bix)<=2&&Math.abs(iy-biy)<=2)continue;
    if(scores[idx]>second)second=scores[idx];
  }
  let localMin=Infinity;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const ix=bix+dx,iy=biy+dy;
    if(ix<0||ix>=grid.nx||iy<0||iy>=grid.ny)continue;
    localMin=Math.min(localMin,scores[iy*grid.nx+ix]);
  }
  let wx=0,wy=0,ww=0;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const ix=bix+dx,iy=biy+dy;
    if(ix<0||ix>=grid.nx||iy<0||iy>=grid.ny)continue;
    if(!grid.validMask[iy*grid.nx+ix])continue;
    const q=Math.max(0,scores[iy*grid.nx+ix]-localMin);
    wx+=(grid.xMin+ix*grid.step)*q;wy+=(grid.yMin+iy*grid.step)*q;ww+=q;
  }
  const x=ww?wx/ww:grid.xMin+bix*grid.step;
  const y=ww?wy/ww:grid.yMin+biy*grid.step;
  const z=(best-mean)/sd;
  const prominence=Math.max(0,(best-second)/(Math.abs(best)+1e-9));
  const confidence=Math.max(0,Math.min(1,.45*Math.min(1,z/5)+.55*Math.min(1,prominence*12)));
  return{valid:true,x,y,bestIndex,best,second,mean,sd,z,prominence,confidence,scores,nx:grid.nx,ny:grid.ny};
}

function synthArray(array,source){
  let seed=0x6512ab9d;
  const base=new Float64Array(WINDOW+512);
  for(let i=0;i<base.length;i++){seed=(1664525*seed+1013904223)>>>0;base[i]=((seed/4294967296)*2-1)*.8}
  const mp=micPositions(array);
  const delays=mp.map(m=>Math.hypot(source.x-m.x,source.y-m.y)*FS/SOUND);
  const mn=Math.min(...delays);
  const ch=[new Float64Array(WINDOW),new Float64Array(WINDOW),new Float64Array(WINDOW),new Float64Array(WINDOW)];
  for(let mi=0;mi<MICS.length;mi++){
    const d=delays[mi]-mn+16,logical=MICS[mi].logical;
    for(let i=0;i<WINDOW;i++){
      const pos=i-d+32,p0=Math.floor(pos),t=pos-p0;
      ch[logical][i]=(base[p0]??0)*(1-t)+(base[p0+1]??0)*t;
    }
  }
  return ch;
}
function feedSynthetic(est,ch){
  let out=null;
  for(let off=0;off<WINDOW;off+=128){
    const pcm=new Int16Array(128*4);
    for(let f=0;f<128;f++)for(let c=0;c<4;c++)pcm[f*4+c]=Math.max(-32767,Math.min(32767,Math.round(ch[c][off+f]*32767)));
    const q=est.pushInt16(pcm);if(q)out=q;
  }
  return out;
}
function selfTest(){
  const arrayA={x:0,y:0,heading:18},arrayB={x:.5,y:0,heading:-18};
  const grid=buildGrid({arrayA,arrayB,xMin:-.4,xMax:.9,yMin:.1,yMax:1.4,step:.02});
  const targets=[{x:.2,y:.7},{x:.55,y:1.05},{x:-.1,y:.9}],results=[];
  for(const target of targets){
    const ea=createArrayEstimator(),eb=createArrayEstimator();ea.setGateDb(-120);eb.setGateDb(-120);
    const a=feedSynthetic(ea,synthArray(arrayA,target)),b=feedSynthetic(eb,synthArray(arrayB,target));
    const r=scan(grid,a,b),error=r.valid?Math.hypot(r.x-target.x,r.y-target.y):99;
    results.push({target,estimated:r.valid?{x:r.x,y:r.y}:null,error,pass:r.valid&&error<.07});
  }
  return{pass:results.every(x=>x.pass),results};
}

const CONFIG={sampleRate:FS,windowFrames:WINDOW,hopFrames:HOP,band:[FMIN,FMAX],bins:BINS.length,lagMin:LAG_MIN,lagMax:LAG_MAX,lagStep:LAG_STEP,lagPoints:LAGS.length,mics:MICS,pairs:PAIRS};
window.PsEyeNearfieldFactory={createArrayEstimator,buildGrid,scan,selfTest,config:CONFIG,micPositions};
})();