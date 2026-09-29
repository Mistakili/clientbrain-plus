const store=globalThis.__clientBrainPlusStore||(globalThis.__clientBrainPlusStore={leads:[],followups:[],activities:[]});

function json(res,status,data){
  res.status(status).setHeader("Content-Type","application/json");
  return res.end(JSON.stringify(data));
}

function activity(type,message,meta={}){
  store.activities.unshift({id:crypto.randomUUID(),type,message,createdAt:new Date().toISOString(),...meta});
  store.activities=store.activities.slice(0,50);
}

function findLead(name){
  const q=String(name||"").trim().toLowerCase();
  if(!q)return null;
  return store.leads.find(x=>x.name.toLowerCase()===q)||store.leads.find(x=>x.name.toLowerCase().includes(q));
}

export default async function handler(req,res){
  const key=process.env.CLIENTBRAIN_TOOL_SECRET;
  const supplied=req.query?.tool_key||req.headers["x-clientbrain-tool-key"];
  if(key&&supplied!==key)return json(res,401,{ok:false,error:"Unauthorized"});

  if(req.method==="GET"){
    return json(res,200,{leads:store.leads,followups:store.followups,activities:store.activities});
  }

  if(req.method!=="POST")return json(res,405,{ok:false,error:"Method not allowed"});

  let body=req.body;
  if(typeof body==="string"){try{body=JSON.parse(body)}catch{body={}}}
  body=body||{};
  const tool=body.tool||body.name;
  const args=body.arguments||body.args||body;

  if(tool==="create_lead"){
    const lead={
      id:crypto.randomUUID(),
      name:args.name||"Unknown",
      property_type:args.property_type||"—",
      location:args.location||"—",
      budget:args.budget||"—",
      timeline:args.timeline||"—",
      notes:args.notes||"",
      createdAt:new Date().toISOString()
    };
    store.leads.unshift(lead);
    activity("lead_created","New lead captured",{leadId:lead.id,name:lead.name});
    return json(res,200,{ok:true,lead});
  }

  if(tool==="get_lead"){
    const lead=findLead(args.name);
    if(lead){
      activity("lead_viewed","Lead looked up",{leadId:lead.id,name:lead.name});
      return json(res,200,{ok:true,lead});
    }
    return json(res,200,{ok:false,message:"No lead found"});
  }

  if(tool==="update_lead"){
    const lead=findLead(args.name);
    if(!lead)return json(res,404,{ok:false,message:"No lead found"});
    const fields=["property_type","location","budget","timeline","notes"];
    fields.forEach(key=>{
      if(args[key]!==undefined&&args[key]!==null&&String(args[key]).trim()!=="")lead[key]=args[key];
    });
    lead.updatedAt=new Date().toISOString();
    activity("lead_updated","Lead details updated",{leadId:lead.id,name:lead.name});
    return json(res,200,{ok:true,lead});
  }

  if(tool==="create_followup"){
    const f={
      id:crypto.randomUUID(),
      name:args.name||"Unknown",
      when:args.when||"—",
      note:args.note||"",
      createdAt:new Date().toISOString()
    };
    store.followups.unshift(f);
    activity("followup_created","Follow-up scheduled",{name:f.name,when:f.when});
    return json(res,200,{ok:true,followup:f});
  }

  return json(res,400,{ok:false,error:"Unknown CRM tool"});
}