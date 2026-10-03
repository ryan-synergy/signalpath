/* SignalPath AI proxy — a Cloudflare Worker that holds the Anthropic API key
   so the crew can use ✦ AI without anyone pasting a key into a browser.

   Deploy (one time, from a Cloudflare account):
     1. Workers & Pages → Create → Worker → paste this file → Deploy.
     2. Settings → Variables and Secrets:
          ANTHROPIC_API_KEY  (secret)  your key from console.anthropic.com
          ACCESS_CODE        (secret)  a long random passphrase for the crew — 20+ characters
                                       (e.g. 5 random words); the proxy refuses to run with a shorter one
          ALLOWED_ORIGINS    (text)    https://ryan-synergy.github.io
     3. In SignalPath: ⚙ Settings → AI → Proxy → paste the worker's https URL
        and the access code.
     4. Recommended: Security → WAF → Rate limiting rules — e.g. 30 requests a minute per IP
        for this worker's hostname. The built-in lockout below only sees one Cloudflare
        location at a time; the rule covers the whole network.

   It forwards only what SignalPath sends (model, messages, tools…), only for
   the listed models, caps the response size, and refuses anything without the
   access code. The key never leaves Cloudflare. */

const MIN_CODE = 20;                       // a short access code can be guessed
const MAX_BODY = 30e6;                     // a request with a 20 MB quote attached, base64'd, fits; nothing bigger
const LOCK_AFTER = 10, LOCK_MS = 15 * 60e3; // wrong codes from one address before it waits
const misses = new Map();                  // ip → { n, until } (per Cloudflare location; the WAF rule covers the rest)
// equal-length, constant-time compare: how many characters matched never shows in the timing
function sameCode(a, b) {
  const x = new TextEncoder().encode(String(a || "")), y = new TextEncoder().encode(String(b || ""));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
const MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"]);
const FIELDS = ["model", "max_tokens", "system", "messages", "tools", "tool_choice"];

export default {
  async fetch(req, env) {
    const origin = req.headers.get("origin") || "";
    const allowed = String(env.ALLOWED_ORIGINS || "https://ryan-synergy.github.io").split(",").map(s => s.trim());
    const cors = {
      "access-control-allow-origin": allowed.includes(origin) ? origin : allowed[0],
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-signalpath-code",
      "vary": "origin",
    };
    const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return reply(405, { error: { message: "POST only" } });
    if (!allowed.includes(origin)) return reply(403, { error: { message: "This proxy only serves SignalPath." } });
    if (!env.ACCESS_CODE || String(env.ACCESS_CODE).length < MIN_CODE)
      return reply(500, { error: { message: `The proxy's access code is missing or shorter than ${MIN_CODE} characters — set a long random one.` } });
    const ip = req.headers.get("cf-connecting-ip") || "?", now = Date.now(), m = misses.get(ip);
    if (m && m.until > now) return reply(429, { error: { message: "Too many wrong access codes — try again in a few minutes." } });
    if (!sameCode(req.headers.get("x-signalpath-code"), env.ACCESS_CODE)) {
      const n = (m && m.until <= now && m.n >= LOCK_AFTER ? 0 : m?.n || 0) + 1;
      misses.set(ip, { n, until: n >= LOCK_AFTER ? now + LOCK_MS : 0 });
      if (misses.size > 5000) misses.clear();      // never grows without bound
      return reply(401, { error: { message: "Wrong or missing access code (⚙ Settings → AI)." } });
    }
    misses.delete(ip);
    if (+req.headers.get("content-length") > MAX_BODY) return reply(413, { error: { message: "That request is too large." } });
    if (!env.ANTHROPIC_API_KEY) return reply(500, { error: { message: "The proxy has no API key set." } });

    let body;
    try { body = await req.json(); } catch { return reply(400, { error: { message: "Bad request body." } }); }
    const clean = Object.fromEntries(FIELDS.filter(k => k in body).map(k => [k, body[k]]));
    if (!MODELS.has(clean.model)) return reply(400, { error: { message: `Model not allowed: ${clean.model}` } });
    clean.max_tokens = Math.min(8192, Math.max(1, +clean.max_tokens || 4096));

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(clean),
    });
    return new Response(r.body, { status: r.status, headers: { ...cors, "content-type": "application/json" } });
  },
};
