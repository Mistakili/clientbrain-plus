import React,{useEffect,useRef,useState} from "react";
import{createRoot}from"react-dom/client";
import"./styles.css";

const SAMPLE_RATE=24000;

const tools=[
 {type:"function",name:"create_lead",description:"Create a new real-estate lead from details the user gives you. Use this when the user says they have a new client or lead.",parameters:{type:"object",properties:{name:{type:"string"},property_type:{type:"string"},location:{type:"string"},budget:{type:"string"},timeline:{type:"string"},notes:{type:"string"}},required:["name"]}},
 {type:"function",name:"get_lead",description:"Look up a lead by name and return their saved details.",parameters:{type:"object",properties:{name:{type:"string"}},required:["name"]}},
 {type:"function",name:"create_followup",description:"Create a follow-up reminder for a lead.",parameters:{type:"object",properties:{name:{type:"string"},when:{type:"string"},note:{type:"string"}},required:["name","when"]}}
];

function b64(buf){const bytes=new Uint8Array(buf);let s="";for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s)}
function unb64(s){const raw=atob(s),a=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)a[i]=raw.charCodeAt(i);return a}

function App(){
 const[status,setStatus]=useState("Ready");
 const[connected,setConnected]=useState(false);
 const[messages,setMessages]=useState([]);
 const[leads,setLeads]=useState([]);
 const[followups,setFollowups]=useState([]);
 const[activeNav,setActiveNav]=useState("Home");
 const ws=useRef(null),ctx=useRef(null),stream=useRef(null),worklet=useRef(null),sources=useRef([]),playAt=useRef(0),session=useRef(null),pendingTools=useRef([]);

 useEffect(()=>()=>disconnect(),[]);

 const add=(role,text,extra={})=>setMessages(m=>[...m,{id:crypto.randomUUID(),role,text,...extra}]);

 function flush(){
  sources.current.forEach(s=>{try{s.stop()}catch{}});
  sources.current=[];
  if(ctx.current)playAt.current=ctx.current.currentTime;
 }

 function play(audio){
  if(!ctx.current||!audio)return;
  const bytes=unb64(audio),i16=new Int16Array(bytes.buffer,bytes.byteOffset,Math.floor(bytes.byteLength/2)),f=new Float32Array(i16.length);
  for(let i=0;i<i16.length;i++)f[i]=i16[i]/0x8000;
  const buf=ctx.current.createBuffer(1,f.length,SAMPLE_RATE);
  buf.getChannelData(0).set(f);
  const src=ctx.current.createBufferSource();
  src.buffer=buf;src.connect(ctx.current.destination);
  const now=ctx.current.currentTime;
  if(playAt.current<now)playAt.current=now;
  src.start(playAt.current);playAt.current+=buf.duration;
  sources.current.push(src);
  src.onended=()=>{sources.current=sources.current.filter(x=>x!==src)};
 }

 async function tool(call){
  let args={};
  try{args=typeof call.arguments==="string"?JSON.parse(call.arguments||"{}"):(call.arguments||{})}catch{}
  if(call.name==="create_lead"){
   const lead={id:crypto.randomUUID(),name:args.name||"Unknown",property_type:args.property_type||"—",location:args.location||"—",budget:args.budget||"—",timeline:args.timeline||"—",notes:args.notes||"",createdAt:new Date().toISOString()};
   setLeads(x=>[lead,...x]);
   return{ok:true,lead};
  }
  if(call.name==="get_lead"){
   const query=String(args.name||"").toLowerCase();
   const lead=leads.find(x=>x.name.toLowerCase()===query)||leads.find(x=>x.name.toLowerCase().includes(query));
   return lead?{ok:true,lead}:{ok:false,message:"No lead found"};
  }
  if(call.name==="create_followup"){
   const f={id:crypto.randomUUID(),name:args.name,when:args.when,note:args.note||"",createdAt:new Date().toISOString()};
   setFollowups(x=>[f,...x]);
   return{ok:true,followup:f};
  }
  return{ok:false,message:"Unknown tool"};
 }

 async function connect(){
  try{
   setStatus("Requesting secure voice session…");
   const r=await fetch("/api/voice-token");
   const d=await r.json();
   if(!r.ok)throw Error(d.error||"Could not get voice token");
   ctx.current=new AudioContext({sampleRate:SAMPLE_RATE});
   await ctx.current.resume();
   await ctx.current.audioWorklet.addModule("/pcm-processor.js");
   stream.current=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});
   worklet.current=new AudioWorkletNode(ctx.current,"pcm-processor");
   const source=ctx.current.createMediaStreamSource(stream.current);
   source.connect(worklet.current);
   const socket=new WebSocket("wss://agents.assemblyai.com/v1/ws?token="+encodeURIComponent(d.token));
   ws.current=socket;
   worklet.current.port.onmessage=e=>{if(socket.readyState===1&&session.current)socket.send(JSON.stringify({type:"input.audio",audio:b64(e.data)}))};
   socket.onopen=()=>{
    socket.send(JSON.stringify({type:"session.update",session:{
     system_prompt:"You are ClientBrain Plus, a concise voice CRM assistant for real-estate agents. Help the realtor capture and manage leads by conversation. Ask only for information that is missing. When the user gives you a new lead, use create_lead. When asked about a saved lead, use get_lead. When asked to remember a follow-up, use create_followup. Never invent saved data. Keep spoken replies short and natural.",
     greeting:"Hi — I'm ClientBrain. Tell me about a lead or ask me about someone you've saved.",
     output:{voice:"ivy"},tools,input:{turn_detection:{vad_threshold:.5,min_silence:600,max_silence:1500,interrupt_response:true}}
    }}));
   };
   socket.onmessage=async ev=>{
    const e=JSON.parse(ev.data);
    if(e.type==="session.ready"){session.current=e.session_id;setConnected(true);setStatus("Listening");}
    else if(e.type==="transcript.user.delta"){setMessages(m=>{const rest=m.filter(x=>!x.partial);return[...rest,{id:"partial-user",role:"user",text:e.text||"",partial:true}]})}
    else if(e.type==="transcript.user"){setMessages(m=>[...m.filter(x=>x.id!=="partial-user"),{id:crypto.randomUUID(),role:"user",text:e.text||""}])}
    else if(e.type==="reply.audio"){play(e.data||e.audio)}
    else if(e.type==="transcript.agent"){if(e.text)add("agent",e.text)}
    else if(e.type==="tool.call"){pendingTools.current.push(e)}
    else if(e.type==="reply.done"){
     if(e.status==="interrupted"){flush();pendingTools.current=[]}
     else if(pendingTools.current.length){
      const calls=pendingTools.current.splice(0);
      for(const call of calls){
       const result=await tool(call);
       socket.send(JSON.stringify({type:"tool.result",call_id:call.call_id,result:JSON.stringify(result)}));
      }
     }
     setStatus("Listening");
    }
    else if(e.type==="session.error"){setStatus("Voice error: "+(e.error||e.message||"unknown"))}
    else if(e.type==="error"){setStatus("Error: "+(e.message||"unknown"))}
   };
   socket.onerror=()=>setStatus("Voice connection error");
   socket.onclose=()=>{setConnected(false);session.current=null;setStatus("Disconnected")};
  }catch(e){setStatus(e.message||"Could not start voice agent");disconnect()}
 }

 function disconnect(){
  try{ws.current?.close()}catch{}
  try{stream.current?.getTracks().forEach(t=>t.stop())}catch{}
  try{worklet.current?.disconnect()}catch{}
  try{ctx.current?.close()}catch{}
  ws.current=null;session.current=null;setConnected(false);setStatus("Ready");
 }

 const latestLead=leads[0];
 const navItems=[["Home","⌂"],["Leads","◎"],["Follow-ups","◌"],["Calendar","□"],["Insights","⌁"]];
 const voiceLabel=connected?(status.toLowerCase().includes("speak")?"ClientBrain is speaking":"Listening…"):"Ready";

 return <div className="shell">
  <aside className="sidebar">
   <div className="brand"><div className="logo">CB</div><div><strong>ClientBrain <em>Plus</em></strong><small>Voice-first CRM</small></div></div>
   <nav>{navItems.map(([name,icon])=><button key={name} className={activeNav===name?"active":""} onClick={()=>setActiveNav(name)}><i>{icon}</i><span>{name}</span>{name==="Leads"&&leads.length>0&&<b>{leads.length}</b>}{name==="Follow-ups"&&followups.length>0&&<b>{followups.length}</b>}</button>)}</nav>
   <div className="agentCard"><span className="liveDot"/><div><strong>Voice Agent</strong><small>{connected?"Live":"Offline"}</small></div><small>Powered by AssemblyAI</small></div>
   <div className="userCard"><div className="userAvatar">A</div><div><strong>Akin Ajobo</strong><small>Free Plan</small></div></div>
  </aside>

  <main className="workspace">
   <header className="topbar">
    <div className="mobileBrand"><div className="logo">CB</div><strong>ClientBrain <em>Plus</em></strong></div>
    <div className="pageTitle"><span className="eyebrow">VOICE WORKSPACE</span><h1>{activeNav}</h1></div>
    <div className={"livePill "+(connected?"on":"")}><span/> {connected?"LIVE":"OFFLINE"}</div>
   </header>

   <section className="voiceCard">
    <div className="voiceTop"><div><span className="eyebrow">VOICE ASSISTANT</span><h2>Talk to your CRM.</h2><p>Capture leads, look up clients, and create follow-ups naturally.</p></div><button className="clearBtn" onClick={()=>setMessages([])}>Clear</button></div>
    <div className={"voiceCore "+(connected?"active":"")}>
     <div className="wave left">{[1,2,3,4,5,6,7].map(i=><span key={i}/>)}</div>
     <button className={"voiceButton "+(connected?"connected":"")} onClick={connected?disconnect:connect} aria-label={connected?"End voice session":"Start voice session"}><div className="mic">⌁</div></button>
     <div className="wave right">{[1,2,3,4,5,6,7].map(i=><span key={i}/>)}</div>
    </div>
    <div className="voiceState"><strong>{voiceLabel}</strong><span>{connected?"Speak naturally — I'm listening":"Tap the microphone to start"}</span></div>
    <div className="suggestions"><button onClick={()=>connect()}>“I have a new lead…”</button><button onClick={()=>connect()}>“Show my leads…”</button><button onClick={()=>connect()}>“Create a follow-up…”</button></div>
   </section>

   <section className="contentGrid">
    <div className="conversation panel">
     <div className="panelHead"><div><span className="eyebrow">LIVE CONVERSATION</span><h2>Conversation</h2></div><span className="count">{messages.length}</span></div>
     <div className="messages">
      {messages.length?messages.map(m=><div key={m.id} className={"msg "+m.role+(m.partial?" partial":"")}><div className="msgIcon">{m.role==="user"?"A":"CB"}</div><div className="msgBody"><div className="msgMeta"><b>{m.role==="user"?"You":"ClientBrain"}</b><span>now</span></div><p>{m.text}</p></div></div>):<div className="empty"><div className="emptyIcon">⌁</div><strong>Your conversation will appear here</strong><span>Start the voice agent and talk naturally.</span></div>}
     </div>
     {connected&&<div className="speakingBar"><div className="miniWave">{[1,2,3,4,5].map(i=><span key={i}/>)}</div><span>ClientBrain is listening…</span><button onClick={disconnect}>■</button></div>}
    </div>

    <div className="rightColumn">
     <div className="panel leadsPanel">
      <div className="panelHead"><div><span className="eyebrow">CRM</span><h2>Leads</h2></div><button className="viewAll">View all →</button></div>
      <div className="stats"><div><strong>{leads.length}</strong><span>Total leads</span></div><div><strong>{followups.length}</strong><span>Need follow-up</span></div></div>
      <div className="leadList">
       {leads.length?leads.slice(0,3).map(l=><article className="lead" key={l.id}><div className="avatar">{l.name[0]?.toUpperCase()}</div><div className="leadBody"><div><strong>{l.name}</strong><b>NEW</b></div><span>{l.property_type} · {l.location}</span><span>{l.budget} · {l.timeline}</span></div><button>View →</button></article>):<div className="empty compact"><div className="emptyIcon">◎</div><strong>No leads yet</strong><span>Your voice agent will create them here.</span></div>}
      </div>
     </div>
     <div className="panel followPanel">
      <div className="panelHead"><div><span className="eyebrow">NEXT UP</span><h2>Recent follow-ups</h2></div><button className="viewAll">View all →</button></div>
      <div className="followList">{followups.length?followups.slice(0,3).map(f=><div className="followItem" key={f.id}><div className="followIcon">↗</div><div><strong>{f.note||"Follow up with "+f.name}</strong><span>{f.name} · {f.when}</span></div></div>):<div className="empty compact"><strong>No follow-ups yet</strong><span>Ask ClientBrain to schedule one.</span></div>}</div>
     </div>
    </div>
   </section>

   <footer><span>ClientBrain Plus · Hackathon prototype</span><span>Voice-first CRM · AssemblyAI</span></footer>
  </main>
 </div>
}

createRoot(document.getElementById("root")).render(<App/>);
