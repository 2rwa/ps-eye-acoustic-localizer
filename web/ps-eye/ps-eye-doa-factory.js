(()=>{'use strict';
const FS=16000,SOUND=343,WINDOW=512,FFT_N=1024,HOP=256;
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
function fft(re,im,inverse=false){
  const n=re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1; for(;j&bit;bit>>=1)j^=bit; j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]]}
  }
  for(let len=2;len<=n;len<<=1){
    const ang=(inverse?2:-2)*Math.PI/len,wr0=Math.cos(ang),wi0=Math.sin(ang);
    for(let i=0;i<n;i+=len){
      let wr=1,wi=0;
      for(let j=0;j<len/2;j++){
        const ur=re[i+j],ui=im[i+j],vr=re[i+j+len/2]*wr-im[i+j+len/2]*wi,vi=re[i+j+len/2]*wi+im[i+j+len/2]*wr;
        re[i+j]=ur+vr;im[i+j]=ui+vi;re[i+j+len/2]=ur-vr;im[i+j+len/2]=ui-vi;
        const nr=wr*wr0-wi*wi0;wi=wr*wi0+wi*wr0;wr=nr;
      }
    }
  }
  if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n}
}
function createEstimator(){
  const ring=[[],[],[],[]];
  let newFrames=0,lastResult=null,smoothAngle=0,smoothConfidence=0,gateDb=-52;
  function spectra(channels){
    return channels.map(src=>{
      const re=new Float64Array(FFT_N),im=new Float64Array(FFT_N);
      let mean=0;for(let i=0;i<WINDOW;i++)mean+=src[i];mean/=WINDOW;
      for(let i=0;i<WINDOW;i++){const w=.5-.5*Math.cos(2*Math.PI*i/(WINDOW-1));re[i]=(src[i]-mean)*w}
      fft(re,im,false);return{re,im};
    });
  }
  function gcc(a,b,maxLag){
    const re=new Float64Array(FFT_N),im=new Float64Array(FFT_N);
    for(let k=0;k<FFT_N;k++){
      let cr=a.re[k]*b.re[k]+a.im[k]*b.im[k],ci=a.im[k]*b.re[k]-a.re[k]*b.im[k];
      const mag=Math.hypot(cr,ci)+1e-12;re[k]=cr/mag;im[k]=ci/mag;
    }
    fft(re,im,true);
    const at=lag=>lag>=0?re[lag]:re[FFT_N+lag];
    let best=-Infinity,second=-Infinity,bestLag=0;const vals=[];
    for(let lag=-maxLag;lag<=maxLag;lag++){const v=at(lag);vals.push(v);if(v>best){second=best;best=v;bestLag=lag}else if(v>second)second=v}
    let frac=0;
    if(bestLag>-maxLag&&bestLag<maxLag){
      const ym=at(bestLag-1),y0=at(bestLag),yp=at(bestLag+1),den=ym-2*y0+yp;
      if(Math.abs(den)>1e-12)frac=Math.max(-.5,Math.min(.5,.5*(ym-yp)/den));
    }
    let sum2=0;for(const v of vals)sum2+=v*v;
    const snr=Math.max(0,best/(Math.sqrt(sum2/vals.length)+1e-9));
    const prominence=Math.max(0,(best-second)/(Math.abs(best)+1e-9));
    return{lag:bestLag+frac,quality:Math.max(.05,Math.min(1,.12*snr+.88*prominence))};
  }
  function estimate(ch){
    let energy=0;for(let c=0;c<4;c++)for(let i=0;i<WINDOW;i++)energy+=ch[c][i]*ch[c][i];
    const rms=Math.sqrt(energy/(4*WINDOW)),levelDb=20*Math.log10(Math.max(1e-9,rms));
    if(levelDb<gateDb)return{active:false,levelDb,angle:lastResult?.angle??0,confidence:0,pairs:[]};
    const spec=spectra(ch);let num=0,den=0;const out=[];
    for(const p of PAIRS){
      const r=gcc(spec[MICS[p.a].logical],spec[MICS[p.b].logical],p.maxLag),w=r.quality*Math.max(1e-6,p.dx*p.dx);
      num+=w*p.dx*r.lag;den+=w*p.dx*p.dx;out.push({...p,...r});
    }
    let st=(SOUND/FS)*(num/Math.max(1e-12,den));st=Math.max(-1,Math.min(1,st));
    const raw=Math.asin(st)*180/Math.PI;
    let err=0,ws=0,q=0;
    for(const r of out){const pred=r.dx*st*FS/SOUND,w=r.quality*Math.max(1e-6,r.dx*r.dx);err+=w*(r.lag-pred)*(r.lag-pred);ws+=w;q+=r.quality}
    const rmse=Math.sqrt(err/Math.max(1e-12,ws)),conf=Math.max(0,Math.min(1,(q/out.length)*Math.exp(-1.4*rmse)));
    const alpha=conf>.55?.32:.16;smoothAngle=smoothAngle*(1-alpha)+raw*alpha;smoothConfidence=smoothConfidence*.7+conf*.3;
    return{active:true,levelDb,angle:smoothAngle,rawAngle:raw,confidence:smoothConfidence,rmse,pairs:out};
  }
  function pushInt16(data){
    const frames=data.length/4;
    for(let f=0;f<frames;f++)for(let c=0;c<4;c++)ring[c].push(data[f*4+c]/32768);
    for(let c=0;c<4;c++)if(ring[c].length>FFT_N*2)ring[c].splice(0,ring[c].length-FFT_N*2);
    newFrames+=frames;if(ring[0].length<WINDOW||newFrames<HOP)return null;newFrames%=HOP;
    lastResult=estimate(ring.map(a=>a.slice(a.length-WINDOW)));return lastResult;
  }
  return{
    pushInt16,
    setGateDb:v=>{gateDb=Number(v)},
    getConfig:()=>({sampleRate:FS,windowFrames:WINDOW,hopFrames:HOP,mics:MICS,pairs:PAIRS})
  };
}
window.PsEyeDoaFactory={createEstimator,config:{sampleRate:FS,windowFrames:WINDOW,hopFrames:HOP,mics:MICS,pairs:PAIRS}};
})();