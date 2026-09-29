export default async function handler(req,res){
  if(req.method!=="GET"){return res.status(405).json({error:"Method not allowed"});}
  const origin=req.headers.origin||"";
  const allowed=(process.env.ALLOWED_ORIGIN||"").split(",").map(s=>s.trim()).filter(Boolean);
  const isLocal=origin.startsWith("http://localhost:")||origin.startsWith("http://127.0.0.1:");
  if(allowed.length && !allowed.includes(origin) && !isLocal){return res.status(403).json({error:"Forbidden"});}
  const key=process.env.ASSEMBLYAI_API_KEY;
  if(!key){return res.status(500).json({error:"ASSEMBLYAI_API_KEY is not configured"});}
  try{
    const u=new URL("https://agents.assemblyai.com/v1/token");
    u.searchParams.set("expires_in_seconds","300");
    const r=await fetch(u,{headers:{Authorization:"Bearer "+key}});
    const data=await r.json();
    if(!r.ok)return res.status(r.status).json({error:data?.error||"AssemblyAI token request failed"});
    return res.status(200).json({token:data.token});
  }catch(e){return res.status(500).json({error:"Token service failed"});}
}