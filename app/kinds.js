/* ---------- kinds.js — what kind of box is this (color by kind) ----------
   Shared by the schematic (engine.js) and the rack elevation (pages.js). */
/* color by kind (Ryan 2026-10-01): a rack box wears a dark tint and a colored left edge
   for what it does, keyed to the wire colors — video switching red, amps and audio
   blue, data network green; the receiver (video + audio) purple; MXNet (video over a
   network) magenta; AVB (audio over a network) teal; control gold; sources stay
   black. In black & white the edge becomes a pattern that echoes the wire dashes
   (video solid, audio dashed, network dotted). View → Color by kind turns it off. */
export const KIND_STYLE = {
  source:  { label: "Source",          tint: "#1e1e1e", edge: null,      pattern: null },
  video:   { label: "Video switching", tint: "#3b1b1f", edge: "#d22b1f", pattern: "solid" },
  mxnet:   { label: "Video network",   tint: "#3a1830", edge: "#c2378a", pattern: "double" },
  avr:     { label: "Receiver",        tint: "#2d1f3d", edge: "#8a5cc4", pattern: "long" },
  audio:   { label: "Amp / audio",     tint: "#15253b", edge: "#2b6cb8", pattern: "dash" },
  avb:     { label: "Audio network",   tint: "#132f30", edge: "#1f9a96", pattern: "rungs" },
  network: { label: "Data network",    tint: "#173222", edge: "#2f9e44", pattern: "dots" },
  control: { label: "Control",         tint: "#2e2a20", edge: "#c9a227", pattern: "hatch" },
  power:   { label: "Power",           tint: "#3a3a3a", edge: "#bdbdbd", pattern: null },
};
// the MXNet capability (library checkbox) decides video-network over data-network,
// so an older MXNet switch filed as a plain network switch still reads magenta
export function deviceKind(dev, catDev) {
  const t = dev?.type;
  const mx = (catDev?.flags || []).includes("mxnet") || /mxnet/i.test(`${dev?.model || ""} ${dev?.catalogRef || ""}`);
  if (t === "avSwitch" || (t === "networkSwitch" && mx)) return "mxnet";
  if (t === "videoMatrix" || t === "splitter") return "video";
  if (t === "avbSwitch") return "avb";
  if (t === "avr") return "avr";
  if (t === "amp" || t === "audioInputModule" || t === "audioOutputModule" || t === "danteBridge") return "audio";
  if (t === "networkSwitch" || t === "gateway") return "network";
  if (t === "controlBox" || t === "host") return "control";
  if (t === "power") return "power";
  return "source";
}
