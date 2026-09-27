/* SignalPath AI proxy — a Cloudflare Worker that holds the Anthropic API key
   so the crew can use ✦ AI without anyone pasting a key into a browser.

   Deploy (one time, from a Cloudflare account):
     1. Workers & Pages → Create → Worker → paste this file → Deploy.
     2. Settings → Variables and Secrets:
          ANTHROPIC_API_KEY  (secret)  your key from console.anthropic.com
          ACCESS_CODE        (secret)  any passphrase you give the crew
          ALLOWED_ORIGINS    (text)    https://ryan-synergy.github.io
     3. In SignalPath: ⚙ Settings → AI → Proxy → paste the worker's https URL
        and the access code.

   It forwards only what SignalPath sends (model, messages, tools…), only for
   the listed models, caps the response size, and refuses anything without the
   access code. The key never leaves Cloudflare. */

const MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"]);
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
    if (!env.ACCESS_CODE || req.headers.get("x-signalpath-code") !== env.ACCESS_CODE)
      return reply(401, { error: { message: "Wrong or missing access code (⚙ Settings → AI)." } });
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
