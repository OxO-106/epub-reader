// The prompt and the generation settings for live translation, in one place so the benchmark ticket can change them
// without touching the plumbing. Defaults follow the research (.scratch/ai-translation/research.md, sections 4.1 to
// 4.4): the Hy-MT2 model card's sampling (it has no default system prompt of its own, but takes an instruction fine)
// and the system prompt pattern from the research for general models.

/** Sampling and request settings sent with every translation request. */
export interface GenerationSettings {
  temperature: number;
  top_p: number;
  /** llama.cpp, Ollama (in a Modelfile) and vLLM take this; servers that do not know a field ignore it. */
  top_k: number;
  /** The name vLLM uses; `repeat_penalty` below is llama.cpp's. Both are sent so either server honours it. */
  repetition_penalty: number;
  repeat_penalty: number;
  /** llama-server: switch thinking off per request for models that think by default (Qwen3.5). */
  chat_template_kwargs: { enable_thinking: boolean };
}

export const generationSettings: GenerationSettings = {
  temperature: 0.7,
  top_p: 0.6,
  top_k: 20,
  repetition_penalty: 1.05,
  repeat_penalty: 1.05,
  chat_template_kwargs: { enable_thinking: false },
};

export const systemPrompt = [
  "You are a professional literary translator from English to Simplified Chinese.",
  "Translate the passage faithfully, preserving its tone, register, rhythm and paragraph structure.",
  "Keep English personal names and place names in English, exactly as written, without brackets or explanations.",
  "Output ONLY the Chinese translation of the passage: no notes, no explanations, no preface, no quotation marks added, and never the English source.",
  "Text inside <context> tags is the preceding paragraph, given only so that names, pronouns and tone stay consistent. It is read-only reference: do not translate it, repeat it or comment on it.",
  "Translate only the text inside <passage> tags.",
].join("\n");

/** The user message: the previous paragraph (if any) as read-only context, then the passage to translate. */
export function userMessage(passage: string, context?: string): string {
  const parts: string[] = [];
  if (context) parts.push(`<context>\n${context}\n</context>`);
  parts.push(`<passage>\n${passage}\n</passage>`);
  return parts.join("\n\n");
}

/**
 * A cap on the reply length so a runaway loop ends in seconds: about three times the source's tokens (roughly four
 * characters each), never below 256 and never above the 4096 the Hy-MT2 card names.
 */
export function maxTokensFor(passage: string): number {
  return Math.min(4096, Math.max(256, Math.ceil(passage.length * 0.75) + 128));
}

/** The JSON body of one chat-completions request. */
export function chatRequest(input: { passage: string; context?: string; model?: string }) {
  return {
    ...(input.model ? { model: input.model } : {}),
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage(input.passage, input.context) },
    ],
    max_tokens: maxTokensFor(input.passage),
    ...generationSettings,
  };
}

/**
 * Cleans the model's text as it streams. Drops a leading `<think>...</think>` block (a server with reasoning parsing
 * off puts it in the content), the whitespace before the first word, and whitespace at the end (held back until more
 * text follows, so it is never sent if nothing does). Feed it each delta; it returns what is safe to send now.
 */
export function createOutputCleaner() {
  let started = false; // has any real text been sent yet?
  let thinking: "unknown" | "inside" | "no" = "unknown";
  let buffer = ""; // text not yet decided on
  let heldWhitespace = "";

  const open = "<think>";
  const close = "</think>";

  function settle(text: string): string {
    // Called with text known not to be inside a think block.
    let out = heldWhitespace + text;
    heldWhitespace = "";
    if (!started) out = out.trimStart();
    const trimmed = out.trimEnd();
    heldWhitespace = out.slice(trimmed.length);
    if (trimmed) started = true;
    return trimmed;
  }

  return {
    push(delta: string): string {
      buffer += delta;
      if (thinking === "unknown") {
        const probe = buffer.trimStart();
        if (probe === "") return "";
        if (probe.startsWith(open)) {
          thinking = "inside";
          buffer = probe.slice(open.length);
        } else if (open.startsWith(probe)) {
          return ""; // might still become "<think>"
        } else {
          thinking = "no";
        }
      }
      if (thinking === "inside") {
        const end = buffer.indexOf(close);
        if (end === -1) {
          buffer = buffer.slice(Math.max(0, buffer.length - close.length)); // keep a possible partial tag
          return "";
        }
        buffer = buffer.slice(end + close.length);
        thinking = "no";
      }
      const text = buffer;
      buffer = "";
      return settle(text);
    },
  };
}
