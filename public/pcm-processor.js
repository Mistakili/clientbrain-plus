class PCMProcessor extends AudioWorkletProcessor{
 constructor(){super();this.frame=0}
 process(inputs){
  const channel=inputs[0]?.[0];
  if(!channel)return true;
  const pcm=new Int16Array(channel.length);
  let sum=0;
  for(let i=0;i<channel.length;i++){
   const s=Math.max(-1,Math.min(1,channel[i]));
   sum+=s*s;
   pcm[i]=s<0?s*0x8000:s*0x7fff;
  }
  this.frame++;
  this.port.postMessage({pcm:pcm.buffer,level:this.frame%4===0?Math.min(1,Math.sqrt(sum/channel.length)*3):undefined},[pcm.buffer]);
  return true;
 }
}
registerProcessor("pcm-processor",PCMProcessor);