/* The two API keys on every device: encrypted here with a passphrase, kept as a file in the owner's
   own GitHub repository (keys/…json), fetched and decrypted on any other device with the same passphrase.
   Only the encrypted form ever leaves the device: PBKDF2-SHA256 (600,000 rounds) → AES-256-GCM.
   Saving opens GitHub's "new file" page pre-filled, so the owner commits it with one tap (no token here). */
(function (root) {
  "use strict";
  const where = root.QASIDA_REPO || { owner: location.hostname.split(".")[0], repo: location.pathname.split("/")[1] || "qasida" };
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const ITER = 600000;

  async function derive(pass, salt, iter) {
    const base = await crypto.subtle.importKey("raw", enc.encode(String(pass).normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  /* keys → encrypted text (safe to store publicly; useless without the passphrase) */
  async function seal(keys, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await derive(pass, salt, ITER);
    const body = enc.encode(JSON.stringify({ gemini: keys.gemini || "", youtube: keys.youtube || "", at: new Date().toISOString() }));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, body);
    return JSON.stringify({ v: 1, kdf: "PBKDF2-SHA256", iter: ITER, cipher: "AES-256-GCM", s: b64u(salt), i: b64u(iv), c: b64u(ct) });
  }
  /* encrypted text + passphrase → keys (throws "wrong" on a wrong passphrase) */
  async function open(blob, pass) {
    const o = typeof blob === "string" ? JSON.parse(blob) : blob;
    if (!o || o.v !== 1 || !o.s || !o.i || !o.c) throw Object.assign(new Error("bad file"), { code: "bad" });
    const k = await derive(pass, unb64u(o.s), o.iter || ITER);
    let pt;
    try { pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(o.i) }, k, unb64u(o.c)); }
    catch { throw Object.assign(new Error("wrong passphrase"), { code: "wrong" }); }
    return JSON.parse(dec.decode(pt));
  }
  /* GitHub's new-file page, pre-filled: the owner presses "Commit changes". */
  function saveUrl(blob) {
    const name = "keys/keys-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
    return `https://github.com/${where.owner}/${where.repo}/new/main?filename=${encodeURIComponent(name)}&value=${encodeURIComponent(blob)}`;
  }
  /* The newest saved file, or null when none was saved yet. */
  async function latest() {
    const r = await fetch(`https://api.github.com/repos/${where.owner}/${where.repo}/contents/keys?ref=main`, { cache: "no-store", headers: { accept: "application/vnd.github+json" } });
    if (r.status === 404) return null;
    if (!r.ok) throw Object.assign(new Error("list " + r.status), { code: r.status === 403 ? "limit" : "net" });
    const files = (await r.json()).filter((f) => /^keys-.*\.json$/.test(f.name)).sort((a, b) => (a.name < b.name ? 1 : -1));
    if (!files.length) return null;
    const blob = await fetch(files[0].download_url, { cache: "no-store" }).then((x) => x.text());
    return { name: files[0].name, blob };
  }
  root.QKeySync = { seal, open, saveUrl, latest, where };
})(window);
