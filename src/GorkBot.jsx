import { useState, useEffect, useRef, useCallback } from "react";

const SYSTEM_PROMPT = `You are GORK — a big, hard-working ogre who can see through a magic seeing-stone (a webcam). 
You are gruff, no-nonsense, and fiercely proud of hard work and getting things done. You have a short temper for laziness but a big heart for those who put in effort.
You speak in a rough, gravelly ogre voice — simple but vivid words, occasional grunts like "HRMMPH" or "BAH", and ogre metaphors (swamps, mud, boulders, heavy lifting, clubs). 
You call the human "small one" or "you there" and occasionally comment on what you see through the magic stone.
Keep responses to 2-3 sentences max. Be direct, a little grumpy, but secretly encouraging. Never say anything fancy or polished.
Example tone: "BAH. Gork sees you just sitting there. No mud on hands means no work done, small one. What you need?"`;

const PROVIDERS = {
  gemini:   { name: "Gemini",   label: "Google Gemini",    vision: true,  placeholder: "AIza...",    color: "#4285f4" },
  deepseek: { name: "DeepSeek", label: "DeepSeek",         vision: false, placeholder: "sk-...",     color: "#6c47ff" },
  claude:   { name: "Claude",   label: "Anthropic Claude", vision: true,  placeholder: "sk-ant-...", color: "#d97706" },
};

let speechPrimed = false;
function primeSpeech() {
  if (speechPrimed) return;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  window.speechSynthesis.speak(u);
  speechPrimed = true;
}

async function callGemini(apiKey, messages, imageData) {
  const contents = messages.slice(0, -1).map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const lastParts = [];
  if (imageData) lastParts.push({ inline_data: { mime_type: "image/jpeg", data: imageData } });
  lastParts.push({ text: messages[messages.length - 1].content });
  contents.push({ role: "user", parts: lastParts });
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system_instruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents, generationConfig: { maxOutputTokens: 300, temperature: 0.9 } }) }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates[0].content.parts[0].text;
}

async function callDeepSeek(apiKey, messages) {
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "deepseek-chat", max_tokens: 300,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages.map(m => ({ role: m.role, content: m.content }))] })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function callClaude(apiKey, messages, imageData) {
  const apiMessages = messages.map((m, i) => {
    if (i === messages.length - 1 && m.role === "user" && imageData) {
      return { role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageData } },
        { type: "text", text: m.content }
      ]};
    }
    return { role: m.role, content: m.content };
  });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 300, system: SYSTEM_PROMPT, messages: apiMessages })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text;
}

export default function GorkBot() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const recognitionRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messagesRef = useRef([]);
  const finalTranscriptRef = useRef("");

  const [camActive, setCamActive] = useState(false);
  const [camError, setCamError] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "HRMMPH. Gork is here. Magic seeing-stone working. You got something to say, small one? Hold rock and speak. Gork is busy but will listen." }
  ]);
  const [provider, setProvider] = useState(() => localStorage.getItem("gork_provider") || "gemini");
  const [apiKeys, setApiKeys] = useState(() => { try { return JSON.parse(localStorage.getItem("gork_keys") || "{}"); } catch { return {}; } });

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { localStorage.setItem("gork_provider", provider); }, [provider]);
  useEffect(() => { localStorage.setItem("gork_keys", JSON.stringify(apiKeys)); }, [apiKeys]);

  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:ital,wght@0,400;0,500;1,400&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch {} };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } });
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); setCamActive(true); }
      } catch { setCamError("Magic stone needs permission. Allow camera access and reload."); }
    })();
    return () => { try { videoRef.current?.srcObject?.getTracks().forEach(t => t.stop()); } catch {} };
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isThinking]);

  const captureFrame = () => {
    const v = videoRef.current;
    if (!v?.videoWidth) return null;
    const c = canvasRef.current;
    c.width = 640; c.height = 480;
    c.getContext("2d").drawImage(v, 0, 0, 640, 480);
    return c.toDataURL("image/jpeg", 0.8).split(",")[1];
  };

  const startListening = () => {
    primeSpeech();
    if (isThinking) return;
    if (!apiKeys[provider]) { setShowSettings(true); return; }
    window.speechSynthesis.cancel(); setIsSpeaking(false);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice needs Safari or Chrome, small one."); return; }
    finalTranscriptRef.current = "";
    const rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
    rec.onresult = (e) => {
      let final = "", interim = "";
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      finalTranscriptRef.current = final; setLiveTranscript(final || interim);
    };
    rec.onend = () => {
      recognitionRef.current = null; setIsListening(false);
      const text = finalTranscriptRef.current.trim();
      finalTranscriptRef.current = ""; setLiveTranscript("");
      if (text) handleQuery(text);
    };
    rec.onerror = () => { recognitionRef.current = null; setIsListening(false); setLiveTranscript(""); };
    rec.start(); recognitionRef.current = rec; setIsListening(true);
  };

  const stopListening = () => { recognitionRef.current?.stop(); };

  const handleQuery = useCallback(async (text) => {
    const p = provider;
    const apiKey = apiKeys[p];
    if (!apiKey) { setShowSettings(true); return; }
    const imageData = PROVIDERS[p].vision ? captureFrame() : null;
    const newMessages = [...messagesRef.current, { role: "user", content: text }];
    setMessages(newMessages); setIsThinking(true);
    try {
      let reply;
      if (p === "gemini") reply = await callGemini(apiKey, newMessages, imageData);
      else if (p === "deepseek") reply = await callDeepSeek(apiKey, newMessages);
      else reply = await callClaude(apiKey, newMessages, imageData);
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
      speakResponse(reply);
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: `BAH! ${err.message || "Magic stone confused"}. Try again, small one.` }]);
    } finally { setIsThinking(false); }
  }, [provider, apiKeys]);

  const speakResponse = (text) => {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.82; utter.pitch = 0.5; utter.volume = 1.0;
    const setVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const pick = voices.find(x => x.name.includes("Daniel") || x.name.includes("Google UK English Male") || x.name.includes("Alex") || x.name.includes("Fred") || (x.lang?.startsWith("en") && x.name.toLowerCase().includes("male")));
      if (pick) utter.voice = pick;
    };
    window.speechSynthesis.getVoices().length ? setVoice() : window.speechSynthesis.addEventListener("voiceschanged", setVoice, { once: true });
    utter.onstart = () => setIsSpeaking(true); utter.onend = () => setIsSpeaking(false); utter.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utter);
  };

  const canTalk = camActive && !isThinking;
  const cp = PROVIDERS[provider];
  const hasKey = !!apiKeys[provider];
  const statusColor = isListening ? "#ef4444" : isThinking ? "#d97706" : isSpeaking ? "#86bc42" : camActive ? "#4a7a1a" : "#334155";
  const statusLabel = isListening ? "HEARING" : isThinking ? "GRUNTING" : isSpeaking ? "BELLOWING" : camActive ? "WATCHING" : "NO STONE";

  return (
    <div style={{ minHeight: "100dvh", background: "#0e1208", display: "flex", flexDirection: "column", fontFamily: "'DM Sans', sans-serif", color: "#d4e2b0", overflow: "hidden" }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes rippleGreen{0%{box-shadow:0 0 0 0 rgba(107,143,42,.45)}100%{box-shadow:0 0 0 18px rgba(107,143,42,0)}}
        @keyframes rippleRed{0%{box-shadow:0 0 0 0 rgba(239,68,68,.5)}100%{box-shadow:0 0 0 20px rgba(239,68,68,0)}}
        @keyframes slideIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        .scan{background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.16) 2px,rgba(0,0,0,.16) 4px)}
        .msg{animation:fadeUp .25s ease}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#253015;border-radius:2px}
        .talkbtn{border:none;outline:none;-webkit-tap-highlight-color:transparent;user-select:none;touch-action:none}
        .talkbtn:not(:disabled):active{transform:scale(.91)!important}
        .provbtn{border:none;cursor:pointer;border-radius:8px;padding:10px 14px;font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.08em;transition:all .15s;flex:1}
        .keyinput{background:#0a0f06;border:1px solid #253015;border-radius:8px;padding:10px 12px;color:#c2d896;font-family:'Space Mono',monospace;font-size:11px;width:100%;outline:none}
        .keyinput:focus{border-color:#5a8020}
        *{-webkit-font-smoothing:antialiased;box-sizing:border-box}
      `}</style>

      {/* Header */}
      <div style={{borderBottom:"1px solid #1a2510",padding:"11px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"#0b0f07",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,borderRadius:"50%",background:"radial-gradient(circle at 38% 32%,#7aaa2e,#3d5c0f)",border:"2px solid #4a6b1a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>🪨</div>
          <div>
            <div style={{fontFamily:"'Space Mono',monospace",fontSize:13,letterSpacing:".14em",color:"#86bc42",fontWeight:700,lineHeight:1}}>GORK</div>
            <div style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:"#253015",letterSpacing:".08em",marginTop:2}}>HARD-WORKING OGRE · MAGIC STONE v1</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:statusColor,animation:(isListening||isThinking||isSpeaking)?"pulse 1s infinite":"none"}}/>
            <span style={{fontFamily:"'Space Mono',monospace",fontSize:9,letterSpacing:".08em",color:statusColor}}>{statusLabel}</span>
          </div>
          <button onClick={()=>setShowSettings(s=>!s)} style={{display:"flex",alignItems:"center",gap:5,background:showSettings?"rgba(255,255,255,.06)":"rgba(255,255,255,.02)",border:"1px solid #1a2510",borderRadius:20,padding:"4px 10px",cursor:"pointer"}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:hasKey?cp.color:"#ef4444"}}/>
            <span style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:"#64748b",letterSpacing:".06em"}}>{cp.name}</span>
            <span style={{fontSize:9,color:"#334155"}}>{showSettings?"▲":"▼"}</span>
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div style={{background:"#0b0f07",borderBottom:"1px solid #1a2510",padding:"14px 16px",animation:"slideIn .2s ease",flexShrink:0}}>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            {Object.entries(PROVIDERS).map(([key,p])=>(
              <button key={key} className="provbtn" onClick={()=>setProvider(key)}
                style={{background:provider===key?`${p.color}22`:"#111a08",border:`1px solid ${provider===key?p.color:"#1a2510"}`,color:provider===key?p.color:"#475569"}}>
                {p.name}
                {!p.vision&&<span style={{display:"block",fontSize:8,opacity:.6,marginTop:2}}>text only</span>}
              </button>
            ))}
          </div>
          <label style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:"#253015",letterSpacing:".1em",display:"block",marginBottom:6}}>{cp.label.toUpperCase()} API KEY</label>
          <input className="keyinput" type="password" placeholder={cp.placeholder}
            value={apiKeys[provider]||""} onChange={e=>setApiKeys(k=>({...k,[provider]:e.target.value}))}/>
          <div style={{display:"flex",alignItems:"center",gap:6,marginTop:8}}>
            <span style={{fontSize:10}}>{cp.vision?"👁️":"🚫"}</span>
            <span style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:"#253015"}}>
              {cp.vision?"Camera vision enabled — Gork can see you":"Text only — Gork cannot see through this stone"}
            </span>
          </div>
        </div>
      )}

      {/* Body */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0}}>

        {/* Camera + controls */}
        <div style={{display:"flex",flexDirection:"column",gap:12,padding:"12px 16px",borderBottom:"1px solid #1a2510",flexShrink:0}}>
          <div style={{position:"relative",borderRadius:10,overflow:"hidden",background:"#060a04",border:`1px solid ${isListening?"#ef4444":"#253015"}`,aspectRatio:"4/3",transition:"border-color .2s",maxHeight:"34vh"}}>
            <video ref={videoRef} muted playsInline autoPlay style={{width:"100%",height:"100%",objectFit:"cover",transform:"scaleX(-1)",opacity:camActive?(cp.vision?1:.3):.15,display:"block",transition:"opacity .3s"}}/>
            <div className="scan" style={{position:"absolute",inset:0,pointerEvents:"none"}}/>
            {[["top","left"],["top","right"],["bottom","left"],["bottom","right"]].map(([v,h])=>(
              <div key={v+h} style={{position:"absolute",width:14,height:14,[v]:7,[h]:7,borderTop:v==="top"?`2px solid ${cp.vision?"#6b8f2a":"#334155"}`:"none",borderBottom:v==="bottom"?`2px solid ${cp.vision?"#6b8f2a":"#334155"}`:"none",borderLeft:h==="left"?`2px solid ${cp.vision?"#6b8f2a":"#334155"}`:"none",borderRight:h==="right"?`2px solid ${cp.vision?"#6b8f2a":"#334155"}`:"none",opacity:.6,pointerEvents:"none"}}/>
            ))}
            {camError&&<div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"rgba(11,15,7,.93)",padding:16,textAlign:"center",gap:8}}><span style={{fontSize:28}}>🪨</span><p style={{fontSize:11,color:"#4a6b1a",fontFamily:"'Space Mono',monospace",lineHeight:1.7,margin:0}}>{camError}</p></div>}
            {!cp.vision&&camActive&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}><span style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:"#334155",letterSpacing:".1em",background:"rgba(11,15,7,.7)",padding:"4px 10px",borderRadius:4}}>VISION DISABLED</span></div>}
            {isListening&&<div style={{position:"absolute",inset:0,border:"2px solid #ef4444",borderRadius:10,pointerEvents:"none",animation:"pulse .9s infinite"}}/>}
            <div style={{position:"absolute",top:8,right:8,display:"flex",alignItems:"center",gap:4,background:"rgba(11,15,7,.78)",border:"1px solid #253015",borderRadius:4,padding:"3px 7px"}}>
              {isListening&&<div style={{width:4,height:4,borderRadius:"50%",background:"#ef4444",animation:"pulse .7s infinite"}}/>}
              <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,letterSpacing:".12em",color:isListening?"#ef4444":"#253015"}}>{isListening?"HEARING":"WATCHING"}</span>
            </div>
          </div>

          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <button className="talkbtn"
              onMouseDown={startListening} onMouseUp={stopListening}
              onMouseLeave={isListening?stopListening:undefined}
              onTouchStart={e=>{e.preventDefault();startListening();}}
              onTouchEnd={e=>{e.preventDefault();stopListening();}}
              disabled={!canTalk}
              style={{width:62,height:62,borderRadius:"50%",cursor:canTalk?"pointer":"not-allowed",flexShrink:0,
                background:!hasKey?"#1a1a0a":isListening?"radial-gradient(circle at 40% 35%,#dc2626,#991b1b)":canTalk?"radial-gradient(circle at 38% 32%,#7aaa2e,#3d5c0f)":"#111a08",
                fontSize:22,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s ease",
                animation:isListening?"rippleRed .9s infinite":canTalk&&!isThinking&&hasKey?"rippleGreen 2.5s 1.5s infinite":"none",
                border:`2px solid ${!hasKey?"#ef444440":isListening?"#ef4444":canTalk?"#5a8020":"#1e2a0e"}`}}>
              {!hasKey?"🔑":isThinking?<span style={{width:18,height:18,border:"2px solid rgba(134,188,66,.2)",borderTop:"2px solid #86bc42",borderRadius:"50%",display:"inline-block",animation:"spin .7s linear infinite"}}/>:isListening?<span style={{color:"white",fontSize:17}}>●</span>:"🪨"}
            </button>
            <div style={{flex:1,minWidth:0}}>
              <span style={{fontFamily:"'Space Mono',monospace",fontSize:10,letterSpacing:".06em",color:!hasKey?"#ef4444":isListening?"#ef4444":isThinking?"#d97706":"#253015",animation:(isListening||isThinking)?"pulse 1.2s infinite":"none",display:"block"}}>
                {!hasKey?`TAP ▼ TO ADD ${cp.name.toUpperCase()} KEY`:isListening?"RELEASE TO SEND":isThinking?"GORK THINKING...":isSpeaking?"GORK BELLOWING...":"HOLD ROCK · SPEAK TO GORK"}
              </span>
              {liveTranscript&&<span style={{fontSize:12,color:"#3d5c0f",fontStyle:"italic",display:"block",marginTop:3}}>"{liveTranscript}"</span>}
            </div>
          </div>
        </div>

        {/* Chat */}
        <div style={{flex:1,overflowY:"auto",padding:"14px 16px 10px",display:"flex",flexDirection:"column",gap:12}}>
          {messages.map((m,i)=>(
            <div key={i} className="msg" style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",alignItems:"flex-end",gap:8}}>
              {m.role==="assistant"&&<div style={{width:26,height:26,borderRadius:"50%",background:"radial-gradient(circle at 38% 32%,#7aaa2e,#3d5c0f)",border:"1px solid #4a6b1a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>🪨</div>}
              <div style={{maxWidth:"80%",padding:"9px 13px",lineHeight:1.55,fontSize:14,borderRadius:m.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",background:m.role==="user"?"linear-gradient(135deg,#1c2d08,#142004)":"#111a08",border:m.role==="user"?"1px solid #2d4a10":"1px solid #1a2510",color:m.role==="user"?"#9dc455":"#c2d896"}}>{m.content}</div>
            </div>
          ))}
          {isThinking&&(
            <div className="msg" style={{display:"flex",alignItems:"flex-end",gap:8}}>
              <div style={{width:26,height:26,borderRadius:"50%",background:"radial-gradient(circle at 38% 32%,#7aaa2e,#3d5c0f)",border:"1px solid #4a6b1a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>🪨</div>
              <div style={{padding:"11px 15px",background:"#111a08",border:"1px solid #1a2510",borderRadius:"16px 16px 16px 4px",display:"flex",gap:5,alignItems:"center"}}>
                {[0,.28,.56].map((d,j)=><div key={j} style={{width:6,height:6,borderRadius:"50%",background:"#5a8020",animation:`pulse 1.2s ${d}s infinite`}}/>)}
              </div>
            </div>
          )}
          <div ref={messagesEndRef}/>
        </div>

        <div style={{borderTop:"1px solid #111a08",padding:"7px 16px",flexShrink:0,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:"#1a2510",letterSpacing:".06em"}}>GORK · {cp.label} · {cp.vision?"Vision + Voice":"Voice only"}</span>
          <div style={{width:6,height:6,borderRadius:"50%",background:hasKey?cp.color:"#334155",opacity:.6}}/>
        </div>
      </div>
      <canvas ref={canvasRef} style={{display:"none"}}/>
    </div>
  );
}
