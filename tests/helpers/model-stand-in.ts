// The model stand-in: a small real HTTP server that speaks the OpenAI-style streaming chat-completions protocol
// (POST /v1/chat/completions with stream:true, GET /v1/models) and answers from a script. It replaces the real model in
// tests; it decides nothing about translation quality. It has no dependency on Vitest or Playwright, so API tests
// (tests/api) and browser tests (tests/e2e, through fixtures.ts) share it.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";

/** What the stand-in does for one chat-completions request. Every field is optional. */
export interface StandInReply {
  /** Content deltas to stream, one chunk each. Default: a short fixed Chinese reply. */
  chunks?: string[];
  /** Reasoning/thinking deltas streamed before the content (the field name differs between servers). */
  reasoning?: string[];
  /** Which field carries the reasoning. Default "reasoning_content" (llama-server); Ollama uses "reasoning". */
  reasoningField?: "reasoning_content" | "reasoning";
  /** Wait for this promise before sending anything (a test holds a request open, then releases it). */
  waitFor?: Promise<unknown>;
  /** Wait this long before the first chunk. */
  delayMs?: number;
  /** Wait this long between chunks. */
  chunkDelayMs?: number;
  /** Answer with this HTTP status and `body` instead of a stream (a refusal, an overloaded server, a bad key). */
  status?: number;
  body?: string;
  /** Never answer: hold the connection open until the client goes away. */
  hang?: boolean;
  /** Send this many chunks (default all), then go silent without ending the stream. */
  stallAfter?: number;
  /** Send these raw pieces of text verbatim instead of well-formed events (malformed streams). Replaces `chunks`. */
  raw?: string[];
  /** The finish_reason on the last content event; default "stop". `null` sends none. */
  finishReason?: string | null;
  /** Send `data: [DONE]` at the end. Default true. */
  sendDone?: boolean;
  /** End the stream with this error object as an event, like Ollama does when the model fails mid-way. */
  errorEvent?: unknown;
  /** Put a trailing space and newline on the last chunk, as some servers do. */
  trailingWhitespace?: boolean;
}

/** What a chat-completions request body looks like to the stand-in's tests. */
export interface ChatBody {
  model?: string;
  stream?: boolean;
  messages: Array<{ role: string; content: string }>;
  [key: string]: unknown;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  /** The raw request body text. */
  text: string;
  /** The body parsed as a chat-completions request, when it is one. */
  chat: ChatBody | null;
  /** The system message text, if any. */
  system: string;
  /** All user message text joined, if any. */
  user: string;
  /** When the request arrived. */
  receivedAt: number;
  /** True once the client closed the connection before the stand-in had finished answering. */
  aborted: boolean;
  /** True once the stand-in had sent the whole answer. */
  finished: boolean;
}

export interface StandInOptions {
  /** Used for every chat request unless a queued reply or a function says otherwise. */
  reply?: StandInReply | ((request: RecordedRequest) => StandInReply);
  /** Model ids that GET /v1/models lists. Default one id, "stand-in-model". `null`: the route answers 404. */
  models?: string[] | null;
  /** Answer GET /v1/models after this delay (to test the status timeout). */
  modelsDelayMs?: number;
  /** When set, a request without `Authorization: Bearer <this>` gets 401. */
  apiKey?: string;
}

export interface ModelStandIn {
  /** Base URL, e.g. http://127.0.0.1:41234 (no trailing slash, no /v1). */
  url: string;
  /** Every request received, in arrival order, chat and models alike. */
  requests: RecordedRequest[];
  /** Only the chat-completions requests. */
  chatRequests(): RecordedRequest[];
  /** Replace the default reply. */
  setReply(reply: StandInOptions["reply"]): void;
  /** Use this reply for the next chat request only (queued replies are used in order, before the default reply). */
  replyOnce(reply: StandInReply): void;
  /** Change what GET /v1/models lists (`null` = 404). */
  setModels(models: string[] | null): void;
  /** Chat requests being answered right now. */
  inFlight(): number;
  /** The most chat requests that were ever being answered at once. */
  peakInFlight(): number;
  /** Polls until `condition` holds, or throws after `timeoutMs`. For waiting on background effects (an abort arriving). */
  until(condition: () => boolean, timeoutMs?: number): Promise<void>;
  /** Stops listening and cuts every open connection. */
  close(): Promise<void>;
}

const defaultChunks = ["你好，", "世界。"];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const sse = (data: unknown) => `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;

const contentEvent = (content: string, finishReason: string | null = null) =>
  sse({
    id: "chatcmpl-stand-in",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
  });

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : "")).join("")
      : "";

function parseChat(text: string): ChatBody | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && Array.isArray(parsed.messages) ? parsed : null;
  } catch {
    return null;
  }
}

/** Starts a stand-in on a free local port. */
export async function startModelStandIn(options: StandInOptions = {}): Promise<ModelStandIn> {
  let defaultReply = options.reply ?? {};
  let models = options.models === undefined ? ["stand-in-model"] : options.models;
  const queued: StandInReply[] = [];
  const requests: RecordedRequest[] = [];
  const sockets = new Set<Socket>();
  let inFlight = 0;
  let peak = 0;

  async function answerModels(res: ServerResponse) {
    if (options.modelsDelayMs) await sleep(options.modelsDelayMs);
    if (res.destroyed) return;
    if (models === null) {
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }));
      return;
    }
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ object: "list", data: models.map((id) => ({ id, object: "model" })) }));
  }

  async function answerChat(record: RecordedRequest, reply: StandInReply, res: ServerResponse) {
    // Gone() is true as soon as the client has hung up; every wait below is followed by a check.
    const gone = () => res.destroyed || record.aborted;
    if (reply.waitFor) await reply.waitFor;
    if (reply.delayMs) await sleep(reply.delayMs);
    if (gone()) return;

    if (reply.hang) {
      await new Promise<void>((resolve) => res.once("close", () => resolve()));
      return;
    }
    if (reply.status !== undefined && reply.status !== 200) {
      res.writeHead(reply.status, { "content-type": "application/json" }).end(reply.body ?? JSON.stringify({ error: { message: "stand-in error" } }));
      return;
    }

    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const write = (text: string) => new Promise<void>((resolve) => res.write(text, () => resolve()));

    for (const piece of reply.reasoning ?? []) {
      await write(sse({ choices: [{ index: 0, delta: { [reply.reasoningField ?? "reasoning_content"]: piece, content: null } }] }));
    }

    if (reply.raw) {
      for (const piece of reply.raw) {
        if (gone()) return;
        await write(piece);
        if (reply.chunkDelayMs) await sleep(reply.chunkDelayMs);
      }
      res.end();
      return;
    }

    const chunks = [...(reply.chunks ?? defaultChunks)];
    if (reply.trailingWhitespace && chunks.length) chunks[chunks.length - 1] += " \n";
    const limit = reply.stallAfter ?? chunks.length;
    const finishReason = reply.finishReason === undefined ? "stop" : reply.finishReason;
    for (let index = 0; index < Math.min(limit, chunks.length); index++) {
      if (gone()) return;
      if (index > 0 && reply.chunkDelayMs) await sleep(reply.chunkDelayMs);
      const last = index === chunks.length - 1;
      await write(contentEvent(chunks[index]!, last && limit >= chunks.length ? finishReason : null));
    }
    if (limit < chunks.length) {
      await new Promise<void>((resolve) => res.once("close", () => resolve()));
      return;
    }
    if (reply.errorEvent !== undefined) await write(sse({ error: reply.errorEvent }));
    if (reply.sendDone !== false) await write(sse("[DONE]"));
    res.end();
  }

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    const chat = parseChat(text);
    const record: RecordedRequest = {
      method: req.method ?? "GET",
      path: (req.url ?? "/").split("?")[0]!,
      headers: req.headers,
      text,
      chat,
      system: chat?.messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n") ?? "",
      user: chat?.messages.filter((m) => m.role === "user").map((m) => textOf(m.content)).join("\n") ?? "",
      receivedAt: Date.now(),
      aborted: false,
      finished: false,
    };
    requests.push(record);
    res.on("close", () => {
      if (res.writableFinished) record.finished = true;
      else record.aborted = true;
    });

    if (options.apiKey !== undefined && req.headers.authorization !== `Bearer ${options.apiKey}`) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "bad key" } }));
      return;
    }
    if (record.method === "GET" && record.path === "/v1/models") return answerModels(res);
    if (record.method === "POST" && record.path === "/v1/chat/completions") {
      const reply = queued.shift() ?? (typeof defaultReply === "function" ? defaultReply(record) : defaultReply);
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        await answerChat(record, reply, res);
      } finally {
        inFlight--;
      }
      return;
    }
    res.writeHead(404).end();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    chatRequests: () => requests.filter((r) => r.path === "/v1/chat/completions"),
    setReply(reply) {
      defaultReply = reply ?? {};
    },
    replyOnce(reply) {
      queued.push(reply);
    },
    setModels(next) {
      models = next;
    },
    inFlight: () => inFlight,
    peakInFlight: () => peak,
    async until(condition, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (!condition()) {
        if (Date.now() > deadline) throw new Error("model stand-in: condition not met in time");
        await sleep(15);
      }
    },
    close() {
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      });
    },
  };
}

/** A base URL on 127.0.0.1 where nothing is listening, for "the model server is not running". */
export async function deadModelUrl(): Promise<string> {
  const standIn = await startModelStandIn();
  const { url } = standIn;
  await standIn.close();
  return url;
}
