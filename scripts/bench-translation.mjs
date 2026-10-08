// Benchmark: paragraph-by-paragraph streaming translation against a local llama-server. Prints JSON.
// PROMPT=plain | term | term+bg   TEMP_C=0.7   OUT=file.json
import { writeFileSync } from "node:fs";

const URL_BASE = "http://127.0.0.1:8080";
const pages = {
  "Pride and Prejudice, ch.1 (a page of 9 paragraphs)": [
    "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
    "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.",
    "“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”",
    "Mr. Bennet replied that he had not.",
    "“But it is,” returned she; “for Mrs. Long has just been here, and she told me all about it.”",
    "Mr. Bennet made no answer.",
    "“Do you not want to know who has taken it?” cried his wife impatiently.",
    "“You want to tell me, and I have no objection to hearing it.” This was invitation enough.",
    "“Why, my dear, you must know, Mrs. Long says that Netherfield is taken by a young man of large fortune from the north of England; that he came down on Monday in a chaise and four to see the place, and was so much delighted with it, that he agreed with Mr. Morris immediately; that he is to take possession before Michaelmas, and some of his servants are to be in the house by the end of next week.”",
  ],
  "Moby-Dick, ch.1": [
    "Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world.",
  ],
  "The Time Machine, ch.1": [
    "The Time Traveller (for so it will be convenient to speak of him) was expounding a recondite matter to us. His grey eyes shone and twinkled, and his usually pale face was flushed and animated. The fire burned brightly, and the soft radiance of the incandescent lights in the lilies of silver caught the bubbles that flashed and passed in our glasses.",
  ],
  "Walden, Economy": [
    "When I wrote the following pages, or rather the bulk of them, I lived alone, in the woods, a mile from any neighbor, in a house which I had built myself, on the shore of Walden Pond, in Concord, Massachusetts, and earned my living by the labor of my hands only.",
  ],
};

const temp = Number(process.env.TEMP_C ?? 0.7);
const MODE = process.env.PROMPT ?? "plain";

const STOP = new Set(
  "The A An It Its However But This That These Those You Your I He She We They His Her Our Their My Me Him Do Does Did Why What When Where Who Which How If In On At As So And Or Nor For Yet To Of By With From Not No Yes One Some Any All Every Each Mr Mrs Miss Dr Sir Lady Call Chapter".split(" "),
);

// Proper names: capitalised words that are not sentence-initial, or sentence-initial but already known as names.
function namesIn(text, known) {
  const words = [];
  const re = /(^|(?<!\b(?:Mr|Mrs|Ms|Dr|St))[.!?—]\s+|[“"]\s*)?\b([A-Z][a-z]+)\b/g;
  let m;
  while ((m = re.exec(text))) words.push({ w: m[2], start: Boolean(m[1]) || m.index === 0 });
  const out = new Set();
  for (const t of words) {
    if (STOP.has(t.w)) continue;
    if (!t.start || known?.has(t.w)) out.add(t.w);
  }
  const phrases = new Set(out);
  for (const a of out) for (const b of out) if (a !== b && text.includes(`${a} ${b}`)) { phrases.add(`${a} ${b}`); phrases.delete(a); phrases.delete(b); }
  return phrases;
}
const KNOWN = new Set();

// Placeholder mode: names are swapped for opaque tokens before translation and restored afterwards.
const PH = { names: new Map(), order: [] };
function tokenFor(i) { return MODE === "ph2" ? `<n${i}>` : `[[${i}]]`; }
function maskNames(text) {
  const found = [...namesIn(text, KNOWN)].sort((a, b) => b.length - a.length);
  let out = text;
  for (const n of found) {
    if (!PH.names.has(n)) { PH.names.set(n, PH.names.size + 1); }
    out = out.replace(new RegExp(`\\b${n}\\b`, "g"), tokenFor(PH.names.get(n)));
  }
  return out;
}
function unmask(zh) {
  let out = zh;
  const lost = [];
  for (const [n, i] of PH.names) {
    const tok = tokenFor(i);
    if (out.includes(tok)) out = out.split(tok).join(n);
  }
  return { out, leftover: (out.match(/\[\[\d+\]\]|<n\d+>/g) ?? []).length };
}
function prompt(text, prev) {
  if (MODE === "ph1bg") {
    const masked = maskNames(text);
    const maskedPrev = prev ? maskNames(prev) : "";
    const bgBlock = maskedPrev ? `[Background Information]\n${maskedPrev}\n\nPlease translate the following text into Simplified Chinese, taking the provided background information into consideration. Tokens like [[1]] are names: keep them exactly as written. Note that you must ONLY output the translated result without any additional explanation.\n\n[Source Text]\n${masked}` : `Translate the following text into Simplified Chinese. Tokens like [[1]] are names: keep them exactly as written. Note that you must ONLY output the translated result without any additional explanation:\n\n${masked}`;
    return bgBlock;
  }
  if (MODE === "ph1" || MODE === "ph2") {
    const masked = maskNames(text);
    const note = MODE === "ph2" ? "Tags like <n1> are names: keep them exactly as written." : "Tokens like [[1]] are names: keep them exactly as written.";
    return `Translate the following text into Simplified Chinese. ${note} Note that you must ONLY output the translated result without any additional explanation:\n\n${masked}`;
  }
  if (MODE === "zh" || MODE === "zhex") {
    // Chinese-language instruction (the model card's Chinese template wording) with an explicit proper-name rule.
    const ex = MODE === "zhex" ? "例如：“Mr. Bennet said”译为“Bennet 先生说”，“Netherfield Park”保持“Netherfield Park”。" : "";
    return `将以下文本翻译为简体中文。人名、地名等专有名词必须保留英文原文，不要音译或意译。${ex}注意只需要输出翻译后的结果，不要额外解释：\n\n${text}`;
  }
  if (MODE === "plain") {
    const bg = prev ? `Background (the previous paragraph, for reference only; do not translate or repeat it):\n${prev}\n\n` : "";
    return `${bg}Translate the following text into Simplified Chinese. Keep English personal and place names in English. Output only the translated result, with no additional explanation.\n\n${text}`;
  }
  // Terminology template from the Hy-MT2 model card; each name maps to itself.
  for (const n of namesIn(text, null)) for (const p of n.split(" ")) KNOWN.add(p);
  const names = [...namesIn(text, KNOWN)];
  const gloss = names.length ? `Reference the following translations:\n${names.map((n) => `${n} translates to ${n}`).join("\n")}\n\n` : "";
  if (MODE === "term+bg" && prev) {
    return `${gloss}[Background Information]\n${prev}\n\nPlease translate the following text into Simplified Chinese, taking the provided background information into consideration. Keep English personal and place names unchanged in English. Note that you must ONLY output the translated result without any additional explanation.\n\n[Source Text]\n${text}`;
  }
  return `${gloss}Translate the following text into Simplified Chinese. Keep English personal and place names unchanged in English. Note that you must ONLY output the translated result without any additional explanation:\n\n${text}`;
}

async function translate(text, prev) {
  const t0 = performance.now();
  const res = await fetch(`${URL_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "hy-mt2",
      stream: true,
      temperature: temp,
      top_p: 0.6,
      top_k: 20,
      repeat_penalty: 1.05,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt(text, prev) }],
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "", ttft = null, timings = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      const j = JSON.parse(data);
      if (j.timings) timings = j.timings;
      const d = j.choices?.[0]?.delta?.content;
      if (d) {
        if (ttft === null) ttft = performance.now() - t0;
        out += d;
      }
    }
  }
  return { out, ttft, total: performance.now() - t0, timings };
}

const EXPECT = {
  "Pride and Prejudice, ch.1 (a page of 9 paragraphs)": ["Bennet", "Netherfield", "Long", "Morris", "Michaelmas"],
  "Moby-Dick, ch.1": ["Ishmael"],
  "The Time Machine, ch.1": [],
  "Walden, Economy": ["Walden Pond", "Concord", "Massachusetts"],
};
const report = {};
let leftoverTotal = 0;
for (const [name, paras] of Object.entries(pages)) {
  // pre-pass over the whole page so sentence-initial names are known (the real app can do this per section)
  for (const p of paras) for (const n of namesIn(p, null)) for (const w of n.split(" ")) KNOWN.add(w);
  const items = [];
  let prev = null;
  const t0 = performance.now();
  for (const p of paras) {
    const r = await translate(p, prev);
    if (MODE === "ph1" || MODE === "ph2" || MODE === "ph1bg") { const u = unmask(r.out); r.out = u.out; leftoverTotal += u.leftover; }
    items.push({
      src: p,
      zh: r.out,
      ttft_s: +(r.ttft / 1000).toFixed(2),
      total_s: +(r.total / 1000).toFixed(2),
      gen_tps: r.timings ? +r.timings.predicted_per_second.toFixed(1) : null,
      out_tokens: r.timings?.predicted_n ?? null,
    });
    prev = p;
  }
  const words = paras.join(" ").split(/\s+/).length;
  const zhAll = items.map((x) => x.zh).join(" ");
  const exp = EXPECT[name] ?? [];
  const missing = exp.filter((n) => !zhAll.includes(n));
  report[name] = { words, wall_s: +((performance.now() - t0) / 1000).toFixed(1), names_kept: `${exp.length - missing.length}/${exp.length}`, missing, items };
  console.error(`${name}: ${words} words, ${report[name].wall_s}s wall, names kept ${report[name].names_kept} missing=${JSON.stringify(missing)}`);
}
console.error(`unrestored placeholder tokens left in output: ${leftoverTotal}`);
writeFileSync(process.env.OUT ?? "bench-result.json", JSON.stringify({ mode: MODE, temperature: temp, report }, null, 2));
