/* Voice: record a short clip (a reciter playing nearby, or someone saying a verse),
   convert it to 16 kHz mono WAV (a format Gemini accepts everywhere), and quick
   dictation into the search box where the browser offers speech recognition. */
(function (root) {
  "use strict";

  function pickMime() {
    if (!root.MediaRecorder) return "";
    for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac", "audio/ogg;codecs=opus"]) {
      try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {}
    }
    return "";
  }

  /* Start recording. Returns a controller: { stop(), cancel(), done: Promise<Blob> }.
     onLevel(0..1) is called ~20 times a second for the meter. */
  async function record({ maxMs = 10000, onLevel, onTick } = {}) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !root.MediaRecorder) {
      const e = new Error("unsupported"); e.code = "unsupported"; throw e;
    }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }); }
    catch (err) { const e = new Error("denied"); e.code = (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) ? "denied" : "nomic"; throw e; }

    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    let ac, raf, analyser, data;
    try {
      ac = new (root.AudioContext || root.webkitAudioContext)();
      const src = ac.createMediaStreamSource(stream);
      analyser = ac.createAnalyser(); analyser.fftSize = 512; src.connect(analyser);
      data = new Uint8Array(analyser.fftSize);
      const loop = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        onLevel && onLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.2));
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch {}

    const t0 = Date.now();
    const tick = setInterval(() => { onTick && onTick(Date.now() - t0, maxMs); if (Date.now() - t0 >= maxMs) stop(); }, 100);
    let cancelled = false;
    const done = new Promise((resolve, reject) => {
      rec.onstop = () => {
        clearInterval(tick); cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        try { ac && ac.close(); } catch {}
        if (cancelled) { const e = new Error("cancelled"); e.code = "cancelled"; reject(e); return; }
        resolve({ blob: new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }), ms: Date.now() - t0 });
      };
    });
    rec.start(250);
    function stop() { if (rec.state !== "inactive") rec.stop(); }
    function cancel() { cancelled = true; stop(); }
    return { stop, cancel, done };
  }

  /* Decode any recorded blob and re-encode it as 16 kHz mono 16-bit WAV. */
  async function toWavBase64(blob) {
    const buf = await blob.arrayBuffer();
    const AC = root.AudioContext || root.webkitAudioContext;
    const ac = new AC();
    let audio;
    try { audio = await new Promise((res, rej) => { const p = ac.decodeAudioData(buf.slice(0), res, rej); if (p && p.then) p.then(res, rej); }); }
    finally { try { ac.close(); } catch {} }
    const sr = 16000, len = Math.max(1, Math.ceil(audio.duration * sr));
    const off = new (root.OfflineAudioContext || root.webkitOfflineAudioContext)(1, len, sr);
    const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
    const out = await off.startRendering();
    const pcm = out.getChannelData(0);
    const bytes = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(bytes);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0, o = 44; i < pcm.length; i++, o += 2) { const s = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return { b64: bufToB64(bytes), mime: "audio/wav", seconds: audio.duration };
  }
  async function blobToB64(blob) { return bufToB64(await blob.arrayBuffer()); }
  function bufToB64(ab) {
    const u = new Uint8Array(ab); let s = ""; const CH = 0x8000;
    for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
    return btoa(s);
  }

  /* Dictation (fast, free) where available — Chrome on Android, Safari on iPhone. */
  const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
  function dictate({ onInterim, lang = "ar-IQ" } = {}) {
    let rec = null;
    const p = new Promise((resolve, reject) => {
      if (!SR) { const e = new Error("unsupported"); e.code = "unsupported"; reject(e); return; }
      const r = new SR(); rec = r; r.lang = lang; r.interimResults = true; r.maxAlternatives = 1; r.continuous = false;
      let finalText = "", settled = false;
      r.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalText += t; else interim += t;
        }
        onInterim && onInterim((finalText + " " + interim).trim());
      };
      r.onerror = (ev) => { if (settled) return; settled = true; const e = new Error(ev.error || "error"); e.code = ev.error === "not-allowed" ? "denied" : (ev.error || "error"); reject(e); };
      r.onend = () => { if (settled) return; settled = true; resolve(finalText.trim()); };
      try { r.start(); } catch (err) { settled = true; reject(err); }
    });
    p.stop = () => { try { rec && rec.stop(); } catch {} };
    return p;
  }

  root.QVoice = { canRecord: () => !!(navigator.mediaDevices && root.MediaRecorder), canDictate: () => !!SR, record, toWavBase64, blobToB64, dictate };
})(self);
