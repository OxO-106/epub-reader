// The prompt and the generation settings for live translation, in one place so they can change without touching the
// plumbing. They follow the benchmark (.scratch/ai-translation/benchmark.md): the Hy-MT2 model card's user-message
// templates with no system prompt, and the card's sampling.

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

/**
 * The instruction about names (ADR 0150): every name is put into Chinese by its sound, never by its meaning, so a
 * character called River is 瑞弗, not 河. `names` are the ones translate-names.ts found in the texts; listing them is
 * what tells the model that a word like River or Hope is a name here. A well-known name keeps its usual Chinese form.
 */
export function namesInstruction(names: readonly string[] = []): string {
  const rule =
    "Transliterate every name of a person or place into Chinese characters by its sound (音译), using its usual Chinese form if it is well known; never translate what a name means.";
  return names.length ? `Names in the text: ${names.join(", ")}. ${rule}` : rule;
}

/**
 * The user message, in the Hy-MT2 model card's wording (there is no system prompt): a plain instruction before the
 * paragraph, or the card's Background Information form when the previous paragraph is given as context, with the
 * instruction about names in either.
 */
export function userMessage(passage: string, context?: string, names: readonly string[] = []): string {
  const aboutNames = namesInstruction(names);
  if (context) {
    return (
      `[Background Information]\n${context}\n\n` +
      `Please translate the following text into Simplified Chinese, taking the provided background information into consideration. ${aboutNames} ` +
      `Note that you must ONLY output the translated result without any additional explanation.\n\n` +
      `[Source Text]\n${passage}`
    );
  }
  return (
    `Translate the following text into Simplified Chinese. ${aboutNames} ` +
    `Note that you must ONLY output the translated result without any additional explanation:\n\n${passage}`
  );
}

/**
 * A cap on the reply length so a runaway loop ends in seconds: about three times the source's tokens (roughly four
 * characters each), never below 256 and never above the 4096 the Hy-MT2 card names.
 */
export function maxTokensFor(passage: string): number {
  return Math.min(4096, Math.max(256, Math.ceil(passage.length * 0.75) + 128));
}

/** The JSON body of one chat-completions request. */
export function chatRequest(input: { passage: string; context?: string; names?: readonly string[]; model?: string }) {
  return {
    ...(input.model ? { model: input.model } : {}),
    stream: true,
    messages: [
      { role: "user", content: userMessage(input.passage, input.context, input.names) },
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
