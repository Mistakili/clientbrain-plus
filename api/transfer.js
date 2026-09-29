const store=globalThis.__clientBrainPlusHandoffs||(globalThis.__clientBrainPlusHandoffs={items:[]});

function json(res,status,data){
  res.status(status).setHeader("Content-Type","application/json");
  return res.end(JSON.stringify(data));
}

export default async function handler(req,res){
  const key=process.env.CLIENTBRAIN_TOOL_SECRET;
  const supplied=req.query?.tool_key||req.headers["x-clientbrain-tool-key"];
  if(key&&supplied!==key)return json(res,401,{ok:false,error:"Unauthorized"});

  if(req.method==="GET")return json(res,200,{ok:true,handoffs:store.items});

  if(req.method!=="POST")return json(res,405,{ok:false,error:"Method not allowed"});

  let body=req.body;
  if(typeof body==="string"){try{body=JSON.parse(body)}catch{body={}}}
  body=body||{};

  const reason=String(body.reason||"Human assistance requested").trim();
  const summary=String(body.summary||"Caller requested human assistance.").trim();
  const target=String(body.target_user||process.env.HUMAN_TRANSFER_NUMBER||"").trim();

  const handoff={
    id:crypto.randomUUID(),
    reason,
    summary,
    target_user:target||null,
    status:"pending",
    createdAt:new Date().toISOString()
  };

  store.items.unshift(handoff);

  if(!process.env.TWILIO_ACCOUNT_SID||!process.env.TWILIO_AUTH_TOKEN||!target){
    return json(res,200,{
      ok:true,
      status:"pending_setup",
      message:"Human transfer is not connected yet. Take the caller's details and offer a callback.",
      handoff
    });
  }

  return json(res,200,{
    ok:true,
    status:"ready_for_twilio_call_control",
    message:"Human handoff request accepted.",
    handoff
  });
}
