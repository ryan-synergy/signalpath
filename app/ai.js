/* ---------- ai.js — let Claude drive SignalPath ----------
   Claude never edits the job file: it proposes COMMANDS (commands.js), the
   app runs them on a copy, checks the result with the validator/advisor, and
   shows a preview the person applies or throws away. Two ways in:
   - handoff: a ready prompt (job summary + findings + vocabulary + request)
     to paste into Claude; paste the reply back → preview. No key, no backend.
   - built-in: the app calls Claude (the person's own key in this browser, or
     a proxy that holds the key), feeds the advisor's verdict back, and lets
     Claude correct itself before the preview.
   Job data leaves the device only when the person asks the AI something. */

import { loadJob, effectiveJob, validate, advise } from "./engine.js";
import { planCommands, vocabularyText, OPS } from "./commands.js";
import { describeNode, productName, TYPE_NAME, SPEAKER_SETUP, SIGNAL_NAME, SCOPE_NAME, AUDIO_BACK_NAME } from "./names.js";
import { readHookup } from "./hookup.js";

export const MODELS = [
  ["claude-opus-5-5", "Claude Opus 5.5 (best)"],
  ["claude-sonnet-5", "Claude Sonnet 5 (faster)"],
  ["claude-haiku-4-5-20251001", "Claude Haiku 4.5 (fastest, cheapest)"],
];

/* what the validator and advisor say about the active solution */
export function assess(job, solIndex, catalog) {
  const { job: j, ix } = loadJob(effectiveJob(job, solIndex));
  const solId = job.solutions[solIndex]?.id;
  const mine = f => !f.solution || f.solution === solId;
  const v = validate(j, ix), a = advise(j, ix, catalog);
  return {
    errors: v.errors.filter(mine).map(e => e.msg),
    warnings: [...v.warnings.filter(mine).map(w => w.msg), ...(a.io || []).filter(i => i.over && mine(i)).map(i => i.msg),
               ...(a.notes || []).filter(n => n.code === "earc-extender" && mine(n)).map(n => n.msg)],
  };
}

/* the job, in words, for a model to reason about */
export function jobSummary(job, solIndex, catalog) {
  const sol = job.solutions[solIndex] || job.solutions[0];
  const name = id => describeNode(job, sol, id).short;
  const L = [];
  L.push(`JOB: ${job.job?.name || "Untitled"} · client ${job.job?.client?.name || "—"} · solution "${sol.name}"`);
  L.push("", "RACK:");
  for (const r of sol.racks || []) for (const d of r.devices || []) {
    const c = d.catalogRef && catalog?.devices?.[d.catalogRef];
    L.push(`- ${d.model || d.id} — ${TYPE_NAME[d.type] || d.type}${c ? ` (catalog: ${productName(c)})` : ""}${d.zones ? `, ${d.zones} zones` : ""}${d.status === "ofe" ? ", owner-furnished" : ""}`);
  }
  if (!(sol.racks || []).some(r => r.devices?.length)) L.push("- (empty)");
  L.push("", "ZONES:");
  for (const z of job.house.zones) {
    const h = readHookup(job, sol, z);
    const parts = [];
    if (h.spk) parts.push(`${SPEAKER_SETUP[h.spk.config || "stereo"] || h.spk.config} speakers${h.spk.status === "ofe" ? " (OFE)" : ""}`);
    if (h.tv) parts.push(`${h.tv.size || "?"}" ${h.tv.displayType === "projector" ? "projector" : "TV"}${h.tv.brand ? " " + h.tv.brand : ""}${h.tv.status === "ofe" ? " (OFE)" : ""}${h.tv.confirm?.length ? " (size unconfirmed)" : ""}`);
    const feed = [];
    if (h.tv) feed.push(`TV ← ${h.video ? `${name(h.video.from)} via ${{ balun: "HDBaseT balun", dec: "MXNet decoder", direct: "direct HDMI" }[h.video.run] || h.video.run}` : "NOT FED"}`);
    if (h.spk) feed.push(`speakers ← ${h.speakers ? name(h.speakers.from) + (h.speakers.channels ? ` outputs ${h.speakers.channels}` : "") : "NOT FED"}`);
    if (h.tv && h.video) feed.push(`TV audio back: ${AUDIO_BACK_NAME[h.audioBack] || h.audioBack}${h.ret ? ` → ${name(h.ret.to)}` : ""}`);
    L.push(`- ${z.name}${z.scope && z.scope !== "included" ? ` [${SCOPE_NAME[z.scope]}]` : ""}: ${parts.join(" + ") || "empty"}${feed.length ? " · " + feed.join(" · ") : ""}`);
  }
  if (!job.house.zones.length) L.push("- (none yet)");
  L.push("", "CONNECTIONS:");
  for (const c of sol.connections || []) L.push(`- ${name(c.from)} → ${name(c.to)} · ${SIGNAL_NAME[c.signal] || c.signal}${c.channels ? ` · outputs ${c.channels}` : ""}${c.earc ? " · eARC back" : ""}${c.earcKit ? " · eARC extender kit (AVPro AC-AEX-DEARC-KIT)" : ""}${c.backup ? " · optical backup" : ""}`);
  if (!(sol.connections || []).length) L.push("- (none)");
  const f = assess(job, solIndex, catalog);
  L.push("", "ADVISOR:", ...(f.errors.map(e => `- PROBLEM: ${e}`)), ...(f.warnings.map(w => `- warning: ${w}`)));
  if (!f.errors.length && !f.warnings.length) L.push("- no issues");
  L.push("", "CATALOG PRODUCTS (for add_device / set_device product):");
  const byType = {};
  for (const c of Object.values(catalog?.devices || {})) (byType[TYPE_NAME[c.type] || c.type] ||= []).push(productName(c));
  for (const [t, list] of Object.entries(byType)) L.push(`- ${t}: ${list.join("; ")}`);
  return L.join("\n");
}

export const SYSTEM = `You help design residential AV systems in SignalPath, the schematic tool used by Synergy Audio Video (Tustin, CA). A job is an equipment rack of boxes (sources, AV receivers, HDMI matrices, multi-zone amps, audio modules, switches) feeding zones (rooms with TVs and speakers).

You change the job ONLY by proposing commands. The app runs them on a copy, checks the result with its validator, and shows the person a preview to accept or reject — nothing you propose applies by itself.

Rules:
- Refer to zones and boxes by the names shown in the job. "<zone> tv" and "<zone> speakers" name a zone's TV and speakers.
- Make only the changes asked for, plus what they strictly need (e.g. a receiver the request implies). Don't remove or rename anything unless asked.
- Prefer catalog products for new gear. Speakers on a multi-zone amp get the next free outputs automatically; leave outputs out unless the person names them.
- A receiver feeding a TV returns the TV's audio by eARC by default; add an optical backup only when asked. For full Atmos from the TV's own apps through an HDBaseT balun, the choice is audio_back "earc-kit" (AVPro AC-AEX-DEARC-KIT, one Cat6A into a receiver HDMI input).
- If something is genuinely ambiguous, make the most common residential choice and add a short question.
- Keep the summary short and plain — a tech will read it.

Commands (JSON objects, run in order):
${vocabularyText()}`;

const TOOL = {
  name: "propose_changes",
  description: "Propose changes to the SignalPath job as a list of commands. They are previewed for the person before anything is applied.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One or two plain sentences for the person: what these changes do." },
      questions: { type: "array", items: { type: "string" }, description: "Anything the person should decide. Omit if none." },
      commands: { type: "array", items: { type: "object", properties: { op: { type: "string", enum: Object.keys(OPS) } }, required: ["op"], additionalProperties: true } },
    },
    required: ["summary", "commands"],
  },
};

/* ---------- handoff: paste into Claude, paste the reply back ---------- */
export function handoffPrompt(job, solIndex, catalog, request) {
  return `${SYSTEM}

Reply with ONLY one JSON code block in exactly this shape:
\`\`\`json
{"summary": "…", "questions": [], "commands": [{"op": "…"}]}
\`\`\`

THE JOB RIGHT NOW:
${jobSummary(job, solIndex, catalog)}

WHAT I WANT:
${request || "(describe the change here)"}`;
}

/* the proposal inside a pasted reply: a fenced JSON block, a bare object, or a bare command array */
export function extractProposal(text) {
  const s = String(text || "");
  const tries = [];
  for (const m of s.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) tries.push(m[1]);
  const o = s.indexOf("{"), a = s.indexOf("[");
  if (o >= 0) tries.push(s.slice(o, s.lastIndexOf("}") + 1));
  if (a >= 0) tries.push(s.slice(a, s.lastIndexOf("]") + 1));
  for (const t of tries) {
    try {
      const v = JSON.parse(t);
      if (Array.isArray(v)) return { summary: "", questions: [], commands: v };
      if (v && Array.isArray(v.commands)) return { summary: String(v.summary || ""), questions: Array.isArray(v.questions) ? v.questions.map(String) : [], commands: v.commands };
    } catch {}
  }
  throw new Error("Couldn't find a command list in that reply — it should contain a JSON block with \"commands\".");
}

/* ---------- built-in: call Claude, let it correct itself ---------- */
async function callClaude(conn, body) {
  const headers = { "content-type": "application/json" };
  let url;
  if (conn.mode === "proxy") { url = conn.proxy; if (conn.code) headers["x-signalpath-code"] = conn.code; }   // see proxy/worker.js
  else {
    url = "https://api.anthropic.com/v1/messages";
    Object.assign(headers, { "x-api-key": conn.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
  }
  if (!url || (conn.mode !== "proxy" && !conn.key)) throw new Error("The AI isn't set up — add your key or proxy in ⚙ Settings → AI.");
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `The AI service answered ${r.status}`);
  return j;
}

export async function askClaude({ conn, job, solIndex, catalog, request, onStatus = () => {} }) {
  const model = conn.model || MODELS[0][0];
  const before = assess(job, solIndex, catalog);
  const messages = [{ role: "user", content: `THE JOB RIGHT NOW:\n${jobSummary(job, solIndex, catalog)}\n\nWHAT I WANT:\n${request}` }];
  let proposal = null, plan = null;
  for (let round = 0; round < 3; round++) {
    onStatus(round ? `Checking and correcting (pass ${round + 1})…` : "Asking Claude…");
    const resp = await callClaude(conn, { model, max_tokens: 4096, system: SYSTEM, tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name }, messages });
    const use = (resp.content || []).find(b => b.type === "tool_use");
    if (!use) throw new Error("Claude didn't propose any changes.");
    proposal = { summary: String(use.input?.summary || ""), questions: use.input?.questions || [], commands: use.input?.commands || [] };
    plan = planCommands(job, solIndex, proposal.commands, catalog);
    const after = assess(plan.job, solIndex, catalog);
    const failed = plan.steps.filter(s => !s.ok);
    const fresh = after.errors.filter(e => !before.errors.includes(e));
    if ((!failed.length && !fresh.length) || round === 2) break;
    // hand the verdict back: what failed, what broke — and ask for the whole corrected list
    messages.push({ role: "assistant", content: resp.content });
    messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: use.id, content:
      `The app ran your commands on a copy of the job:\n${plan.steps.map(s => s.ok ? `✓ ${s.text}` : `✗ ${JSON.stringify(s.cmd)} — ${s.error}`).join("\n")}` +
      (fresh.length ? `\n\nNew problems the validator found:\n${fresh.map(e => "- " + e).join("\n")}` : "") +
      `\n\nFix these and call ${TOOL.name} again with the COMPLETE corrected command list (it replaces the previous one).` }] });
  }
  return { ...proposal, plan, model };
}

/* ---------- connection settings: this browser only, never in the job ---------- */
const KEY = "signalpath.ai";
export function loadConn() { try { return { mode: "off", model: MODELS[0][0], ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { mode: "off", model: MODELS[0][0] }; } }
export function saveConn(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {} }
export const connReady = c => (c.mode === "key" && !!c.key) || (c.mode === "proxy" && /^https:\/\//.test(c.proxy || ""));
