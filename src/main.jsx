import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const SAMPLE_RATE = 24000;
const DAY = 24 * 60 * 60 * 1000;

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function unb64(value) {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isNewLead(lead) {
  const created = Date.parse(lead.createdAt || "");
  return Number.isFinite(created) && Date.now() - created < DAY;
}

function toolLabel(name, phase) {
  const labels = {
    create_lead: ["Capturing lead…", "Lead captured"],
    update_lead: ["Updating lead…", "Lead updated"],
    get_lead: ["Looking up lead…", "Lead found"],
    create_followup: ["Creating follow-up…", "Follow-up saved"],
    transfer_to_human: ["Requesting handoff…", "Handoff requested"]
  };
  return (labels[name] || ["Processing CRM action…", "CRM updated"])[phase];
}

function App() {
  const [status, setStatus] = useState("Ready");
  const [micLevel, setMicLevel] = useState(0);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [leads, setLeads] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [handoffs, setHandoffs] = useState([]);
  const [toolStatus, setToolStatus] = useState("");
  const [justCaptured, setJustCaptured] = useState(null);
  const [activeNav, setActiveNav] = useState("Home");
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("signin");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [showAllLeads, setShowAllLeads] = useState(false);
  const [showAllFollowups, setShowAllFollowups] = useState(false);
  const ws = useRef(null);
  const ctx = useRef(null);
  const stream = useRef(null);
  const worklet = useRef(null);
  const sources = useRef([]);
  const playAt = useRef(0);
  const session = useRef(null);
  const pendingTools = useRef([]);
  const intentionalClose = useRef(false);
  const readyTimer = useRef(null);

  useEffect(() => () => disconnect(), []);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me").then(async (response) => {
      if (!alive) return;
      if (!response.ok) return;
      const data = await response.json();
      if (data.user) setUser(data.user);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!showWorkspace || !user) return undefined;
    let alive = true;
    const sync = async () => {
      try {
        const response = await fetch("/api/crm");
        if (response.status === 401) {
          if (alive) {
            setUser(null);
            setShowWorkspace(false);
            setShowAuth(true);
          }
          return;
        }
        if (!response.ok) return;
        const data = await response.json();
        if (!alive) return;
        setLeads(data.leads || []);
        setFollowups(data.followups || []);
        const handoffResponse = await fetch("/api/transfer");
        if (handoffResponse.ok) {
          const handoffData = await handoffResponse.json();
          if (alive) setHandoffs(handoffData.handoffs || []);
        }
      } catch {}
    };
    sync();
    const id = setInterval(sync, 2500);
    return () => { alive = false; clearInterval(id); };
  }, [showWorkspace, user]);

  const add = (role, text, extra = {}) => setMessages((items) => [...items, { id: crypto.randomUUID(), role, text, ...extra }]);

  function flush() {
    sources.current.forEach((source) => { try { source.stop(); } catch {} });
    sources.current = [];
    if (ctx.current) playAt.current = ctx.current.currentTime;
  }

  function play(audio) {
    if (!ctx.current || !audio) return;
    const bytes = unb64(audio);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const floats = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) floats[i] = samples[i] / 0x8000;
    const buffer = ctx.current.createBuffer(1, floats.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(floats);
    const source = ctx.current.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.current.destination);
    const now = ctx.current.currentTime;
    if (playAt.current < now) playAt.current = now;
    source.start(playAt.current);
    playAt.current += buffer.duration;
    sources.current.push(source);
    source.onended = () => { sources.current = sources.current.filter((item) => item !== source); };
  }

  async function tool(call) {
    let args = {};
    try { args = typeof call.arguments === "string" ? JSON.parse(call.arguments || "{}") : (call.arguments || {}); } catch {}
    try {
      const endpoint = call.name === "transfer_to_human" ? "/api/transfer" : "/api/crm";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: call.name, arguments: args, ...args })
      });
      const result = await response.json();
      if (call.name === "create_lead" && result.created === false) setToolStatus("Lead updated");
      else setToolStatus(result.ok === false ? (result.error || result.message || "Tool action failed") : toolLabel(call.name, 1));
      setTimeout(() => setToolStatus(""), 2200);
      if (result.lead) setLeads((items) => [result.lead, ...items.filter((item) => item.id !== result.lead.id)]);
      if (call.name === "create_lead" && result.created && result.lead) {
        setJustCaptured(result.lead);
        setTimeout(() => setJustCaptured(null), 5000);
      }
      if (result.followup) setFollowups((items) => [result.followup, ...items.filter((item) => item.id !== result.followup.id)]);
      if (result.handoff) setHandoffs((items) => [result.handoff, ...items.filter((item) => item.id !== result.handoff.id)]);
      return result;
    } catch {
      return { ok: false, message: "CRM service unavailable" };
    }
  }

  function disconnect({ resetStatus = true } = {}) {
    intentionalClose.current = true;
    clearTimeout(readyTimer.current);
    setMicLevel(0);
    try { ws.current?.close(); } catch {}
    try { stream.current?.getTracks().forEach((track) => track.stop()); } catch {}
    try { worklet.current?.disconnect(); } catch {}
    try { ctx.current?.close(); } catch {}
    ws.current = null;
    session.current = null;
    setConnected(false);
    if (resetStatus) setStatus("Ready");
  }

  async function connect() {
    if (connected) return;
    intentionalClose.current = false;
    try {
      setStatus("Requesting secure voice session…");
      const configResponse = await fetch("/api/voice-config");
      const config = await configResponse.json();
      if (!configResponse.ok) throw Error(config.error || "Could not load voice setup");
      const tokenResponse = await fetch("/api/voice-token");
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok) throw Error(tokenData.error || "Could not get voice token");
      ctx.current = new AudioContext({ sampleRate: SAMPLE_RATE });
      await ctx.current.resume();
      await ctx.current.audioWorklet.addModule("/pcm-processor.js");
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      });
      worklet.current = new AudioWorkletNode(ctx.current, "pcm-processor");
      const source = ctx.current.createMediaStreamSource(stream.current);
      source.connect(worklet.current);
      const socket = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${encodeURIComponent(tokenData.token)}`);
      ws.current = socket;
      worklet.current.port.onmessage = (event) => {
        const pcm = event.data?.pcm || event.data;
        if (event.data?.level !== undefined) setMicLevel(event.data.level);
        if (socket.readyState === 1 && session.current) socket.send(JSON.stringify({ type: "input.audio", audio: b64(pcm) }));
      };
      socket.onopen = () => {
        intentionalClose.current = false;
        socket.send(JSON.stringify({
          type: "session.update",
          session: {
            system_prompt: config.system_prompt,
            greeting: config.greeting,
            output: { voice: config.voice },
            tools: config.tools,
            input: { turn_detection: { vad_threshold: .5, min_silence: 700, max_silence: 2500, interrupt_response: true } }
          }
        }));
        clearTimeout(readyTimer.current);
        readyTimer.current = setTimeout(() => {
          if (!session.current && socket.readyState === 1) {
            setStatus("Voice session did not become ready");
            try { socket.close(); } catch {}
          }
        }, 10000);
      };
      socket.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "session.ready") {
          clearTimeout(readyTimer.current);
          session.current = message.session_id;
          setConnected(true);
          setStatus("Listening");
        } else if (message.type === "input.speech.started") setStatus("Listening");
        else if (message.type === "input.speech.stopped") setStatus("Thinking");
        else if (message.type === "reply.started") setStatus("Speaking");
        else if (message.type === "transcript.user.delta") {
          setMessages((items) => [...items.filter((item) => !item.partial), { id: "partial-user", role: "user", text: message.text || "", partial: true }]);
        } else if (message.type === "transcript.user") {
          setMessages((items) => [...items.filter((item) => item.id !== "partial-user"), { id: crypto.randomUUID(), role: "user", text: message.text || "" }]);
        } else if (message.type === "reply.audio") play(message.data || message.audio);
        else if (message.type === "transcript.agent") { if (message.text) add("agent", message.text); }
        else if (message.type === "tool.call") {
          pendingTools.current.push(message);
          setToolStatus(toolLabel(message.name, 0));
          add("system", `⚡ ${message.name} called`, { tool: true });
        } else if (message.type === "reply.done") {
          if (message.status === "interrupted") {
            flush();
            pendingTools.current = [];
            setStatus("Listening");
          } else if (pendingTools.current.length) {
            const calls = pendingTools.current.splice(0);
            for (const call of calls) {
              const result = await tool(call);
              socket.send(JSON.stringify({ type: "tool.result", call_id: call.call_id, result: JSON.stringify(result) }));
            }
          }
          if (message.status !== "interrupted") setStatus("Listening");
        } else if (message.type === "session.error" || message.type === "error") {
          const text = message.message || message.error || message.code || "unknown";
          setStatus(`Voice error: ${text}`);
          add("agent", `Voice error: ${text}`);
        }
      };
      socket.onerror = () => setStatus("Voice WebSocket error");
      socket.onclose = (event) => {
        clearTimeout(readyTimer.current);
        setConnected(false);
        session.current = null;
        if (!intentionalClose.current) setStatus(`Voice connection closed${event.code ? ` (${event.code})` : ""}`);
      };
    } catch (error) {
      setStatus(error.message || "Could not start voice agent");
      disconnect({ resetStatus: false });
    }
  }

  async function openWorkspace() {
    if (user) {
      setShowWorkspace(true);
      return;
    }
    try {
      const response = await fetch("/api/auth/me");
      if (response.ok) {
        const data = await response.json();
        if (data.user) {
          setUser(data.user);
          setShowWorkspace(true);
          return;
        }
      }
    } catch {}
    setAuthError("");
    setShowAuth(true);
  }

  async function submitAuth(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    setAuthBusy(true);
    setAuthError("");
    try {
      const response = await fetch(authMode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          name: form.get("name")
        })
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Could not sign in");
      setUser(data.user);
      setLeads([]);
      setFollowups([]);
      setHandoffs([]);
      setMessages([]);
      setShowAuth(false);
      setShowWorkspace(true);
    } catch (error) {
      setAuthError(error.message || "Could not reach the account service. Start the API with vercel dev.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    disconnect();
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setLeads([]);
    setFollowups([]);
    setHandoffs([]);
    setMessages([]);
    setShowWorkspace(false);
    setShowAuth(false);
  }

  const navItems = [["Home", "⌂"], ["Leads", "◎"], ["Follow-ups", "◌"]];
  const voiceLabel = connected
    ? status === "Speaking" ? "ClientBrain is speaking…" : status === "Thinking" ? "Thinking…" : "Listening…"
    : "Ready";

  if (showAuth) {
    return (
      <div className="authScreen">
        <form className="authCard" onSubmit={submitAuth}>
          <span className="eyebrow">{authMode === "signup" ? "CREATE ACCOUNT" : "SIGN IN"}</span>
          <h2>{authMode === "signup" ? "Open your book." : "Welcome back."}</h2>
          <p>Leads, follow-ups, and handoffs stay with this account.</p>
          {authError && <p className="authError">{authError}</p>}
          {authMode === "signup" && (
            <label className="field"><span>Name</span><input name="name" required maxLength={80} autoComplete="name" /></label>
          )}
          <label className="field"><span>Email</span><input name="email" type="email" required autoComplete="email" /></label>
          <label className="field"><span>Password</span><input name="password" type="password" required minLength={8} autoComplete={authMode === "signup" ? "new-password" : "current-password"} /></label>
          <button className="authSubmit" type="submit" disabled={authBusy}>{authBusy ? "Please wait…" : authMode === "signup" ? "Create account" : "Sign in"}</button>
          <button className="authSwitch" type="button" onClick={() => { setAuthMode(authMode === "signup" ? "signin" : "signup"); setAuthError(""); }}>
            {authMode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
          </button>
          <button className="authBack" type="button" onClick={() => setShowAuth(false)}>Back</button>
        </form>
      </div>
    );
  }

  if (!showWorkspace) {
    return (
      <div className="landing">
        <div className="landingNav">
          <div className="brand"><div className="logo">CB</div><div><strong>ClientBrain <em>Plus</em></strong><small>Voice-first CRM</small></div></div>
          <span className="navMark">Voice CRM</span>
        </div>
        <section className="hero">
          <div className="heroCopy">
            <span className="eyebrow">VOICE-FIRST CRM FOR REAL-ESTATE AGENTS</span>
            <h1>Your CRM<br /><em>should listen.</em></h1>
            <p>Capture leads, look up clients, and schedule follow-ups — naturally, just by talking.</p>
            <button className="heroButton" onClick={openWorkspace}>Open the workspace <span>→</span></button>
            <div className="heroMeta"><span>● Live voice</span><span>→</span><span>Saved leads</span><span>→</span><span>Follow-ups</span></div>
          </div>
          <div className="heroVisual">
            <div className="miniOrb"><div className="miniRing r1" /><div className="miniRing r2" /><div className="miniCore">⌁</div></div>
            <div className="voiceCardMini"><span className="liveDot" /> ClientBrain is listening<span className="miniBars">▂▅▇▅▂</span></div>
          </div>
        </section>
        <section className="featureStrip">
          <article><span>01</span><strong>Capture leads</strong><p>Tell ClientBrain about a new buyer and it creates the lead for you.</p></article>
          <article><span>02</span><strong>Manage clients</strong><p>Ask about saved leads or update their details through conversation.</p></article>
          <article><span>03</span><strong>Never miss a follow-up</strong><p>Say when you want to follow up and ClientBrain schedules it.</p></article>
        </section>
        <footer><span>ClientBrain Plus</span><span>Voice-first CRM</span></footer>
      </div>
    );
  }

  const closeModal = () => { setSelectedLead(null); setShowAllLeads(false); setShowAllFollowups(false); };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="logo">CB</div><div><strong>ClientBrain <em>Plus</em></strong><small>Voice-first CRM</small></div></div>
        <nav>
          {navItems.map(([name, icon]) => (
            <button key={name} className={activeNav === name ? "active" : ""} onClick={() => setActiveNav(name)}>
              <i>{icon}</i><span>{name}</span>
              {name === "Leads" && leads.length > 0 && <b>{leads.length}</b>}
              {name === "Follow-ups" && followups.length > 0 && <b>{followups.length}</b>}
            </button>
          ))}
        </nav>
        <div className="agentCard"><span className="liveDot" /><div><strong>Voice Agent</strong><small>{connected ? "Live" : "Ready"}</small></div><small>Browser voice</small></div>
        <div className="userCard"><div className="userAvatar">{user?.name?.[0]?.toUpperCase() || "A"}</div><div><strong>{user?.name}</strong><small>{user?.email}</small></div></div>
        <button className="signOut" onClick={signOut}>Sign out</button>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div className="mobileBrand"><div className="logo">CB</div><strong>ClientBrain <em>Plus</em></strong></div>
          <div className="pageTitle"><span className="eyebrow">VOICE WORKSPACE</span><h1>{activeNav}</h1></div>
          <div className="topActions">
            <button className="topSignOut" onClick={signOut}>Sign out</button>
            <div className={"livePill " + (connected ? "on" : "")}><span /> {connected ? "LIVE" : "READY"}</div>
          </div>
        </header>
        <section className="voiceCard">
          <div className="voiceTop"><div><span className="eyebrow">VOICE ASSISTANT</span><h2>Talk to your CRM.</h2><p>Capture leads, look up clients, and create follow-ups naturally.</p></div><button className="clearBtn" onClick={() => setMessages([])}>Clear</button></div>
          <div className={"voiceCore " + (connected ? "active" : "")}>
            <div className={"wave left " + (connected ? "live" : "")}>{[1, 2, 3, 4, 5, 6, 7].map((i) => <span key={i} style={connected ? { transform: `scaleY(${Math.max(.35, .55 + micLevel * (i % 3 === 0 ? 1.8 : 1.15))})` } : undefined} />)}</div>
            <button className={"voiceButton " + (connected ? "connected" : "")} onClick={connected ? disconnect : connect} aria-label={connected ? "End voice session" : "Start voice session"}><div className="mic">⌁</div></button>
            <div className={"wave right " + (connected ? "live" : "")}>{[1, 2, 3, 4, 5, 6, 7].map((i) => <span key={i} style={connected ? { transform: `scaleY(${Math.max(.35, .55 + micLevel * (i % 2 === 0 ? 1.5 : .9))})` } : undefined} />)}</div>
          </div>
          <div className="voiceState"><strong>{toolStatus || voiceLabel}</strong><span>{toolStatus ? "ClientBrain is updating your book" : connected ? "Speak naturally — I'm listening" : "Tap the microphone to start"}</span></div>
          <div className="suggestions">
            <button onClick={connect}>“I have a new lead…”</button>
            <button onClick={connect}>“Show my leads…”</button>
            <button onClick={connect}>“Create a follow-up…”</button>
          </div>
          <div className="voiceHint"><span>●</span> Use headphones so the microphone stays clear.</div>
        </section>
        <section className="contentGrid">
          <div className="conversation panel">
            <div className="panelHead"><div><span className="eyebrow">LIVE CONVERSATION</span><h2>Conversation</h2></div><span className="count">{messages.length}</span></div>
            <div className="messages">
              {messages.length ? messages.map((item) => (
                <div key={item.id} className={"msg " + item.role + (item.partial ? " partial" : "")}>
                  <div className="msgIcon">{item.role === "user" ? (user?.name?.[0]?.toUpperCase() || "Y") : "CB"}</div>
                  <div className="msgBody"><div className="msgMeta"><b>{item.role === "user" ? "You" : "ClientBrain"}</b><span>now</span></div><p>{item.text}</p></div>
                </div>
              )) : <div className="empty"><div className="emptyIcon">⌁</div><strong>Your conversation will appear here</strong><span>Start the voice agent and talk naturally.</span></div>}
            </div>
            {connected && <div className="speakingBar"><div className="miniWave">{[1, 2, 3, 4, 5].map((i) => <span key={i} />)}</div><span>{voiceLabel}</span><button onClick={disconnect}>■</button></div>}
          </div>
          <div className="rightColumn">
            <div className="panel leadsPanel">
              <div className="panelHead"><div><span className="eyebrow">CRM</span><h2>Leads</h2></div><button className="viewAll" onClick={() => { setSelectedLead(null); setShowAllFollowups(false); setShowAllLeads(true); }}>View all →</button></div>
              <div className="stats"><div><strong>{leads.length}</strong><span>Total leads</span></div><div><strong>{followups.length}</strong><span>Need follow-up</span></div></div>
              {justCaptured && <div className="captureBanner"><div className="captureCheck">✓</div><div><strong>Lead captured</strong><span>{justCaptured.name} was added to your book.</span></div></div>}
              <div className="leadList">
                {leads.length ? leads.slice(0, 3).map((lead) => (
                  <article className="lead" key={lead.id}>
                    <div className="avatar">{lead.name[0]?.toUpperCase()}</div>
                    <div className="leadBody">
                      <div><strong>{lead.name}</strong>{isNewLead(lead) && <b>NEW</b>}</div>
                      <span>{lead.property_type} · {lead.location}</span>
                      <span>{lead.budget} · {lead.timeline}</span>
                    </div>
                    <button onClick={() => setSelectedLead(lead)}>View →</button>
                  </article>
                )) : <div className="empty compact"><div className="emptyIcon">◎</div><strong>No leads yet</strong><span>Your voice agent will create them here.</span></div>}
              </div>
            </div>
            <div className="panel followPanel">
              <div className="panelHead"><div><span className="eyebrow">ESCALATION</span><h2>Human handoffs</h2></div><span className="count">{handoffs.length}</span></div>
              <div className="followList">{handoffs.length ? handoffs.slice(0, 3).map((handoff) => <div className="followItem" key={handoff.id}><div className="followIcon">↗</div><div><strong>{handoff.reason}</strong><span>{handoff.summary}</span></div></div>) : <div className="empty compact"><strong>No handoffs yet</strong><span>Human escalation requests will appear here.</span></div>}</div>
            </div>
            <div className="panel followPanel">
              <div className="panelHead"><div><span className="eyebrow">NEXT UP</span><h2>Recent follow-ups</h2></div><button className="viewAll" onClick={() => { setSelectedLead(null); setShowAllLeads(false); setShowAllFollowups(true); }}>View all →</button></div>
              <div className="followList">{followups.length ? followups.slice(0, 3).map((followup) => <div className="followItem" key={followup.id}><div className="followIcon">↗</div><div><strong>{followup.note || `Follow up with ${followup.name}`}</strong><span>{followup.name} · {followup.when}</span></div></div>) : <div className="empty compact"><strong>No follow-ups yet</strong><span>Ask ClientBrain to schedule one.</span></div>}</div>
            </div>
          </div>
        </section>
        {(selectedLead || showAllLeads || showAllFollowups) && (
          <div className="modalBackdrop" onClick={closeModal}>
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <div className="modalHead">
                <div><span className="eyebrow">{selectedLead ? "LEAD DETAILS" : showAllLeads ? "CRM" : "NEXT UP"}</span><h2>{selectedLead ? selectedLead.name : showAllLeads ? "All leads" : "Follow-ups"}</h2></div>
                <button className="modalClose" onClick={closeModal}>×</button>
              </div>
              {selectedLead ? (
                <div className="modalBody">
                  <div className="detailRow"><span>Property</span><strong>{selectedLead.property_type}</strong></div>
                  <div className="detailRow"><span>Location</span><strong>{selectedLead.location}</strong></div>
                  <div className="detailRow"><span>Budget</span><strong>{selectedLead.budget}</strong></div>
                  <div className="detailRow"><span>Timeline</span><strong>{selectedLead.timeline}</strong></div>
                  {selectedLead.notes && <div className="detailNotes"><span>Notes</span><p>{selectedLead.notes}</p></div>}
                </div>
              ) : showAllLeads ? (
                <div className="modalList">{leads.length ? leads.map((lead) => (
                  <button className="modalItem" key={lead.id} onClick={() => setSelectedLead(lead)}>
                    <div className="avatar">{lead.name[0]?.toUpperCase()}</div>
                    <div><strong>{lead.name}</strong><span>{lead.property_type} · {lead.location}</span><span>{lead.budget} · {lead.timeline}</span></div>
                    <b>View →</b>
                  </button>
                )) : <div className="empty compact"><strong>No leads yet</strong><span>Your voice agent will create them here.</span></div>}</div>
              ) : (
                <div className="modalList">{followups.length ? followups.map((followup) => (
                  <div className="modalItem" key={followup.id}><div className="followIcon">↗</div><div><strong>{followup.note || `Follow up with ${followup.name}`}</strong><span>{followup.name}</span><span>Scheduled: {followup.when}</span></div></div>
                )) : <div className="empty compact"><strong>No follow-ups yet</strong><span>Ask ClientBrain to schedule one.</span></div>}</div>
              )}
            </div>
          </div>
        )}
        <footer><span>ClientBrain Plus</span><span>Voice-first CRM</span></footer>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
