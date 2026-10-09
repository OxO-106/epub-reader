// The translation engine through its small interface (attach, setEnabled, onStatus, status), with a scripted translate
// endpoint behind a stubbed fetch and a stand-in document made of plain objects. The engine runs in the browser; what is
// tested here is how it copes when code around it misbehaves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslationEngine, type Surface } from "../../src/web/reader/translation/engine.ts";

// findBlocks needs a real DOM; the engine only needs the blocks it returns.
vi.mock("../../src/web/reader/translation/blocks.ts", () => ({
  findBlocks: (doc: { blocks: unknown[] }) => doc.blocks,
}));

/** An element that keeps its attributes and sits at a fixed place on screen. */
function fakeElement(index: number) {
  const attributes = new Map<string, string>();
  return {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
    getClientRects: () => [{ top: index * 20, bottom: index * 20 + 15, left: 0, right: 100 }],
  };
}

function fakeSurface(count: number) {
  const elements = Array.from({ length: count }, (_, index) => fakeElement(index));
  const blocks = elements.map((element, id) => ({ id, element, text: `Paragraph number ${id} of the book.`, heading: false }));
  const doc = { blocks, addEventListener() {}, removeEventListener() {} };
  const surface = {
    doc,
    viewport: () => ({ start: 0, end: 1000 }),
    scrolled: true,
    keepStill: (change: () => void) => change(),
  } as unknown as Surface;
  return { surface, elements };
}

const ndjson = (...events: unknown[]) =>
  new Response(events.map((event) => `${JSON.stringify(event)}\n`).join(""), { headers: { "content-type": "application/x-ndjson" } });

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 0));
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => clearTimeout(handle));
  vi.stubGlobal("fetch", async () => ndjson({ delta: "译文" }, { done: true }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("when something around the engine throws", () => {
  it("carries on translating after a status listener throws", async () => {
    const { surface, elements } = fakeSurface(4);
    const engine = createTranslationEngine({ settleMs: 1 });
    engine.attach(surface);
    const throwing = vi.fn(() => {
      throw new Error("a listener that is broken");
    });
    const healthy = vi.fn();
    engine.onStatus(throwing);
    engine.onStatus(healthy);

    engine.setEnabled(true);

    await vi.waitFor(() => expect(engine.status()).toMatchObject({ state: "ready", translated: 4, waiting: 0, failed: [] }), {
      timeout: 2000,
    });
    // The page is written one animation frame after the status says "ready", so wait for it rather than look at once.
    await vi.waitFor(
      () => expect(elements.map((element) => element.getAttribute("data-reader-tx"))).toEqual(["done", "done", "done", "done"]),
      { timeout: 2000 },
    );
    expect(throwing).toHaveBeenCalled();
    expect(healthy).toHaveBeenCalled(); // one listener's trouble does not hide updates from the next
    engine.dispose();
  });

  it("marks the block failed and carries on with the rest when showing a Translation throws", async () => {
    const { surface } = fakeSurface(4);
    let armed = false;
    let fired = false;
    // The first answer arrives just as the document stops accepting changes; the next ones are fine.
    vi.stubGlobal("fetch", async () => {
      if (!fired) armed = fired = true;
      return ndjson({ delta: "译文" }, { done: true });
    });
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      if (armed) {
        armed = false;
        throw new Error("the document is gone");
      }
      return setTimeout(callback, 0);
    });
    const engine = createTranslationEngine({ settleMs: 1 });
    engine.attach(surface);

    engine.setEnabled(true);

    await vi.waitFor(() => expect(engine.status()).toMatchObject({ state: "ready", translated: 3, waiting: 0 }), { timeout: 2000 });
    expect(engine.status().failed).toHaveLength(1);
    engine.dispose();
  });

  it("carries on when a listener throws only while a block is streaming", async () => {
    const { surface } = fakeSurface(3);
    const engine = createTranslationEngine({ settleMs: 1 });
    engine.attach(surface);
    engine.onStatus((status) => {
      if (status.translated > 0 && status.state === "translating") throw new Error("broken at the wrong moment");
    });

    engine.setEnabled(true);

    await vi.waitFor(() => expect(engine.status()).toMatchObject({ state: "ready", translated: 3 }), { timeout: 2000 });
    engine.dispose();
  });
});
