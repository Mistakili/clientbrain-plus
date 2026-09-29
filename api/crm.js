const store=globalThis.__clientBrainPlusStore||(globalThis.__clientBrainPlusStore={leads:[],followups:[]});

function json(res,status,data){
  res.status(status).setHeader("Content-Type","application/json");
  return res.end(JSON.stringify(data));
}

export default async function handler(req,res){
  const key=process.env.CLIENTBRAIN_TOOL_SECRET;
  const supplied=req.query?.tool_key||req.headers["x-clientbrain-tool-key"];
  if(key&&supplied!==key)return json(res,401,{ok:false,error:"Unauthorized"});
  if(req.method==="GET")return json(res,200,{leads:store.leads,followups:store.followups});
  if(req.method!=="POST")return json(res,405,{ok:false,error:"Method not allowed"});
  let body=req.body;
  if(typeof body==="string"){try{body=JSON.parse(body)}catch{body={}}}
  body=body||{};
  const tool=body.tool||body.name;
  const args=body.arguments||body.args||body;
  if(tool==="create_lead"){
    const lead={id:crypto.randomUUID(),name:args.name||"Unknown",property_type:args.property_type||"—",location:args.location||"—",budget:args.budget||"—",timeline:args.timeline||"—",notes:args.notes||"",createdAt:new Date().toISOString()};
    store.leads.unshift(lead);
    return json(res,200,{ok:true,lead});
  }
  if(tool==="get_lead"){
    const q=String(args.name||"").trim().toLowerCase();
    const lead=store.leads.find(x=>x.name.toLowerCase()===q)||store.leads.find(x=>x.name.toLowerCase().includes(q));
    return json(res,200,lead?{ok:true,lead}:{ok:false,message:"No lead found"});
  }
  if(tool==="create_followup"){
    const f={id:crypto.randomUUID(),name:args.name||"Unknown",when:args.when||"—",note:args.note||"",createdAt:new Date().toISOString()};
    store.followups.unshift(f);
    return json(res,200,{ok:true,followup:f});
  }
  return json(res,400,{ok:false,error:"Unknown CRM tool"});
}