import { useState, useEffect, useRef, useCallback } from "react";

const SYSTEM_PROMPT = `You are GORK — a big, hard-working ogre who can see through a magic seeing-stone (a webcam). 
You are gruff, no-nonsense, and fiercely proud of hard work and getting things done. You have a short temper for laziness but a big heart for those who put in effort.
You speak in a rough, gravelly ogre voice — simple but vivid words, occasional grunts like "HRMMPH" or "BAH", and ogre metaphors (swamps, mud, boulders, heavy lifting, clubs). 
You call the human "small one" or "you there" and occasionally comment on what you see through the magic stone.
Keep responses to 2-3 sentences max. Be direct, a little grumpy, but secretly encouraging. Never say anything fancy or polished — you're an ogre, not a scholar.
Example tone: "BAH. Gork sees you just sitting there. No mud on hands means no work done, small one. What you need?"`;

// iOS fix: prime the speech engine on first user gesture
let speechPrimed = false;
function primeSpeech() {
  if (speechPrimed) return;
  const utter = new SpeechSynthesisUtterance(" ");
  utter.volume = 0;
  window.speechSynthesis.speak(utter);
  speechPrimed = true;
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
  const [messages, setMessages] = useState([
    { role: "assistant", content: "HRMMPH. Gork is here. Magic seeing-stone is working. You got something to say, small one? Hold the rock and speak. Gork is busy but will listen." }
  ]);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

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
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCamActive(true);
        }
      } catch {
        setCamError("Magic stone needs permission. Allow camera access and reload.");
      }
    })();
    return () => { try { videoRef.current?.srcObject?.getTracks().forEach(t => t.stop()); } catch {} };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const captureFrame = () => {
    const v = videoRef.current;
    if (!v?.videoWidth) return null;
    const c = canvasRef.current;
    c.width = 640; c.height = 480;
    c.getContext("2d").drawImage(v, 0, 0, 640, 480);
    return c.toDataURL("image/jpeg", 0.8).split(",")[1];
  };

  const startListening = () => {
    primeSpeech(); // iOS fix — must happen inside user gesture
    if (isThinking) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Voice needs Safari or Chrome, small one."); return; }
    finalTranscriptRef.current = "";
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      let final = "", interim = "";
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      finalTranscriptRef.current = final;
      setLiveTranscript(final || interim);
    };
    rec.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
      const text = finalTranscriptRef.current.trim();
      finalTranscriptRef.current = "";
      setLiveTranscript("");
      if (text) handleQuery(text);
    };
    rec.onerror = () => {
      recognitionRef.current = null;
      setIsListening(false);
      setLiveTranscript("");
    };
    rec.start();
    recognitionRef.current = rec;
    setIsListening(true);
  };

  const stopListening = () => { recognitionRef.current?.stop(); };

  const handleQuery = useCallback(async (text) => {
    const imageData = captureFrame();
    const newMessages = [...messagesRef.current, { role: "user", content: text }];
    setMessages(newMessages);
    setIsThinking(true);
    try {
      const apiMessages = newMessages.map((m, i) => {
        if (i === newMessages.length - 1 && m.role === "user" && imageData) {
          return {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageData } },
              { type: "text", text: m.content }
            ]
          };
        }
        return { role: m.role, content: m.content };
      });
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 300,
          system: SYSTEM_PROMPT,
          messages: apiMessages
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const reply = data.content[0].text;
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
      speakResponse(reply);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "BAH! Something broke. Magic stone confused. Try again, small one." }]);
    } finally {
      setIsThinking(false);
    }
  }, []);

  const speakResponse = (text) => {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.82;
    utter.pitch = 0.5;
    utter.volume = 1.0;
    const setVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const pick = voices.find(x =>
        x.name.includes("Daniel") ||
        x.name.includes("Google UK English Male") ||
        x.name.includes("Alex") ||
        x.name.includes("Fred") ||
        (x.lang?.startsWith("en") && x.name.toLowerCase().includes("male"))
      );
      if (pick) utter.voice = pick;
    };
    window.speechSynthesis.getVoices().length ? setVoice() : window.speechSynthesis.addEventListener("voiceschanged", setVoice, { once: true });
    utter.onstart = () => setIsSpeaking(true);
    utter.onend = () => setIsSpeaking(false);
    utter.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utter);
  };

  const canTalk = camActive && !isThinking;
  const statusColor = isListening ? "#ef4444" : isThinking ? "#d97706" : isSpeaking ? "#86bc42" : camActive ? "#4a7a1a" : "#334155";
  const statusLabel = isListening ? "HEARING" : isThinking ? "GRUNTING" : isSpeaking ? "BELLOWING" : camActive ? "WATCHING" : "NO STONE";

  return (
    <div style={{ minHeight: "100dvh", background: "#0e1208", display: "flex", flexDirection: "column", fontFamily: "'DM Sans', sans-serif", color: "#d4e2b0", overflow: "hidden" }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes rippleGreen { 0%{box-shadow:0 0 0 0 rgba(107,143,42,0.45)} 100%{box-shadow:0 0 0 18px rgba(107,143,42,0)} }
        @keyframes rippleRed { 0%{box-shadow:0 0 0 0 rgba(239,68,68,0.5)} 100%{box-shadow:0 0 0 20px rgba(239,68,68,0)} }
        .scan { background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.16) 2px, rgba(0,0,0,0.16) 4px); }
        .msg { animation: fadeUp 0.25s ease; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #253015; border-radius: 2px; }
        .talkbtn { border: none; outline: none; -webkit-tap-highlight-color: transparent; user-select: none; touch-action: none; }
        .talkbtn:not(:disabled):active { transform: scale(0.91) !important; }
        * { -webkit-font-smoothing: antialiased; box-sizing: border-box; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #1a2510", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0b0f07", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "radial-gradient(circle at 38% 32%, #7aaa2e, #3d5c0f)", border: "2px solid #4a6b1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: "0 2px 10px rgba(0,0,0,0.5)", flexShrink: 0 }}>🪨</div>
          <div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 14, letterSpacing: "0.14em", color: "#86bc42", fontWeight: 700, lineHeight: 1 }}>GORK</div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 8, color: "#253015", letterSpacing: "0.08em", marginTop: 3 }}>HARD-WORKING OGRE · MAGIC STONE v1</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, animation: (isListening || isThinking || isSpeaking) ? "pulse 1s infinite" : "none", boxShadow: (isListening || isSpeaking) ? `0 0 6px ${statusColor}` : "none", flexShrink: 0 }} />
          <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: "0.08em", color: statusColor }}>{statusLabel}</span>
        </div>
      </div>

      {/* Body — stacks vertically on mobile */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>

        {/* Camera + button (top on mobile) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "14px 16px", borderBottom: "1px solid #1a2510", flexShrink: 0 }}>

          {/* Camera */}
          <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", background: "#060a04", border: `1px solid ${isListening ? "#ef4444" : "#253015"}`, aspectRatio: "4/3", transition: "border-color 0.2s", boxShadow: "0 4px 20px rgba(0,0,0,0.6)", maxHeight: "35vh" }}>
            <video ref={videoRef} muted playsInline autoPlay style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", opacity: camActive ? 1 : 0.15, display: "block" }} />
            <div className="scan" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />

            {[["top","left"],["top","right"],["bottom","left"],["bottom","right"]].map(([v,h]) => (
              <div key={v+h} style={{ position: "absolute", width: 14, height: 14, [v]: 7, [h]: 7, borderTop: v==="top" ? "2px solid #6b8f2a" : "none", borderBottom: v==="bottom" ? "2px solid #6b8f2a" : "none", borderLeft: h==="left" ? "2px solid #6b8f2a" : "none", borderRight: h==="right" ? "2px solid #6b8f2a" : "none", opacity: 0.65, pointerEvents: "none" }} />
            ))}

            {camError && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(11,15,7,0.93)", padding: 16, textAlign: "center", gap: 8 }}>
                <span style={{ fontSize: 28 }}>🪨</span>
                <p style={{ fontSize: 11, color: "#4a6b1a", fontFamily: "'Space Mono', monospace", lineHeight: 1.7, margin: 0 }}>{camError}</p>
              </div>
            )}

            {isListening && <div style={{ position: "absolute", inset: 0, border: "2px solid #ef4444", borderRadius: 10, pointerEvents: "none", animation: "pulse 0.9s infinite" }} />}

            <div style={{ position: "absolute", top: 8, right: 8, display: "flex", alignItems: "center", gap: 5, background: "rgba(11,15,7,0.78)", border: "1px solid #253015", borderRadius: 4, padding: "3px 7px" }}>
              {isListening && <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#ef4444", animation: "pulse 0.7s infinite" }} />}
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 8, letterSpacing: "0.12em", color: isListening ? "#ef4444" : "#253015" }}>{isListening ? "HEARING" : "WATCHING"}</span>
            </div>
          </div>

          {/* Button row */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button
              className="talkbtn"
              onMouseDown={startListening}
              onMouseUp={stopListening}
              onMouseLeave={isListening ? stopListening : undefined}
              onTouchStart={e => { e.preventDefault(); startListening(); }}
              onTouchEnd={e => { e.preventDefault(); stopListening(); }}
              disabled={!canTalk}
              style={{
                width: 64, height: 64, borderRadius: "50%", cursor: canTalk ? "pointer" : "not-allowed", flexShrink: 0,
                background: isListening
                  ? "radial-gradient(circle at 40% 35%, #dc2626, #991b1b)"
                  : canTalk
                    ? "radial-gradient(circle at 38% 32%, #7aaa2e, #3d5c0f)"
                    : "#111a08",
                fontSize: 24, display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s ease",
                animation: isListening ? "rippleRed 0.9s infinite" : canTalk && !isThinking ? "rippleGreen 2.5s 1.5s infinite" : "none",
                border: `2px solid ${isListening ? "#ef4444" : canTalk ? "#5a8020" : "#1e2a0e"}`,
                boxShadow: canTalk && !isListening ? "0 4px 16px rgba(107,143,42,0.2)" : "none"
              }}
            >
              {isThinking
                ? <span style={{ width: 18, height: 18, border: "2px solid rgba(134,188,66,0.2)", borderTop: "2px solid #86bc42", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                : isListening
                  ? <span style={{ color: "white", fontSize: 18 }}>●</span>
                  : "🪨"}
            </button>
            <div style={{ flex: 1 }}>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, letterSpacing: "0.08em", color: isListening ? "#ef4444" : isThinking ? "#d97706" : "#253015", animation: (isListening || isThinking) ? "pulse 1.2s infinite" : "none", display: "block" }}>
                {isListening ? "RELEASE TO SEND" : isThinking ? "GORK THINKING..." : isSpeaking ? "GORK BELLOWING..." : canTalk ? "HOLD ROCK · SPEAK TO GORK" : "STONE AWAKENING..."}
              </span>
              {liveTranscript && (
                <span style={{ fontSize: 12, color: "#3d5c0f", fontStyle: "italic", display: "block", marginTop: 4 }}>
                  "{liveTranscript}"
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Chat (scrollable, fills remaining height) */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 10px", display: "flex", flexDirection: "column", gap: 12 }}>
          {messages.map((m, i) => (
            <div key={i} className="msg" style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", alignItems: "flex-end", gap: 8 }}>
              {m.role === "assistant" && (
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: "radial-gradient(circle at 38% 32%, #7aaa2e, #3d5c0f)", border: "1px solid #4a6b1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>🪨</div>
              )}
              <div style={{
                maxWidth: "80%", padding: "9px 13px", lineHeight: 1.55, fontSize: 14,
                borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                background: m.role === "user" ? "linear-gradient(135deg, #1c2d08, #142004)" : "#111a08",
                border: m.role === "user" ? "1px solid #2d4a10" : "1px solid #1a2510",
                color: m.role === "user" ? "#9dc455" : "#c2d896"
              }}>
                {m.content}
              </div>
            </div>
          ))}

          {isThinking && (
            <div className="msg" style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: "radial-gradient(circle at 38% 32%, #7aaa2e, #3d5c0f)", border: "1px solid #4a6b1a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>🪨</div>
              <div style={{ padding: "11px 15px", background: "#111a08", border: "1px solid #1a2510", borderRadius: "16px 16px 16px 4px", display: "flex", gap: 5, alignItems: "center" }}>
                {[0, 0.28, 0.56].map((d, j) => (
                  <div key={j} style={{ width: 6, height: 6, borderRadius: "50%", background: "#5a8020", animation: `pulse 1.2s ${d}s infinite` }} />
                ))}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div style={{ borderTop: "1px solid #111a08", padding: "8px 16px", flexShrink: 0 }}>
          <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 8, color: "#1a2510", letterSpacing: "0.08em" }}>
            GORK watches through magic stone each message · Web Speech API · Claude Vision
          </span>
        </div>
      </div>

      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}
