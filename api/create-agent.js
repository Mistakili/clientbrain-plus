export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  const key=process.env.ASSEMBLYAI_API_KEY;
  if(!key)return res.status(500).json({error:"ASSEMBLYAI_API_KEY is not configured"});
  const origin=req.headers.origin||req.headers.referer||"";
  const base=origin.startsWith("http")?new URL(origin).origin:"";
  if(!base)return res.status(400).json({error:"Could not determine app origin"});
  const secret=process.env.CLIENTBRAIN_TOOL_SECRET;
  const toolUrl=base+"/api/crm"+(secret?"?tool_key="+encodeURIComponent(secret):"");
  const transferUrl=base+"/api/transfer"+(secret?"?tool_key="+encodeURIComponent(secret):"");
  const tools=[
    {name:"create_lead",description:"Create a new real-estate lead from details the caller provides. Ask for the person's name if missing. Never invent missing values.",parameters:{type:"object",properties:{name:{type:"string"},property_type:{type:"string"},location:{type:"string"},budget:{type:"string"},timeline:{type:"string"},notes:{type:"string"}},required:["name"]},http:{url:toolUrl,http_method:"POST"}},
    {name:"get_lead",description:"Look up a saved lead by name.",parameters:{type:"object",properties:{name:{type:"string"}},required:["name"]},http:{url:toolUrl,http_method:"POST"}},
    {name:"create_followup",description:"Create a follow-up reminder for a lead.",parameters:{type:"object",properties:{name:{type:"string"},when:{type:"string"},note:{type:"string"}},required:["name","when"]},http:{url:toolUrl,http_method:"POST"}},
    {name:"transfer_to_human",description:"Transfer the caller to a human real-estate agent when they explicitly ask for a person or the request needs human assistance. Tell the caller you are connecting them, then call this tool with a short reason and summary.",parameters:{type:"object",properties:{reason:{type:"string"},summary:{type:"string"}},required:["reason","summary"]},execution_mode:"hold",timeout_seconds:60,http:{url:transferUrl,http_method:"POST"}}
  ];
  const body={name:"ClientBrain Plus Phone Agent",system_prompt:"You are ClientBrain Plus, a concise voice CRM receptionist for real-estate teams. Capture property leads naturally. Ask only for missing details. Use create_lead for new leads, get_lead for saved leads, and create_followup for reminders. Never invent saved data or confirmations. Keep replies short and natural.",greeting:"Hi — you're through to ClientBrain. Tell me what you're looking for and I'll capture the details.",voice:{voice_id:"ivy"},tools};
  try{
    const r=await fetch("https://agents.assemblyai.com/v1/agents",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(body)});
    const data=await r.json();
    if(!r.ok)return res.status(r.status).json({error:data?.error||"AssemblyAI agent creation failed"});
    return res.status(200).json({agent_id:data.id});
  }catch{return res.status(500).json({error:"Agent setup failed"});}
}