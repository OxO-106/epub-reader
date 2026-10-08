import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readFile, rm, stat, truncate, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer } from "../../src/server/server.ts";
import { eventually, fastLibraryFolder, fixturePath, startTestServer, uploadFixture, type TestServer } from "./helpers.ts";

// Seam: the server's HTTP API, against a real server and a real temporary library folder.
// The folder is settled and rescanned quickly so the tests do not wait for production timings.
const fast = fastLibraryFolder;

let server: TestServer | undefined;
afterEach(async () => {
  await server?.dispose();
  server = undefined;
});

interface Summary {
  id: string;
  title: string;
}
interface Failure {
  path: string;
  fileName: string;
  code: string;
  message: string;
}

const books = async (s: { url: string }) =>
  ((await (await fetch(`${s.url}/api/books`)).json()) as { books: Summary[] }).books;
const failures = async (s: { url: string }) =>
  ((await (await fetch(`${s.url}/api/library-folder`)).json()) as { failures: Failure[] }).failures;
const titles = async (s: { url: string }) => (await books(s)).map((b) => b.title).sort();

/** Time enough for several settle periods, for asserting that something does not happen. */
const quietPeriod = () => new Promise((resolve) => setTimeout(resolve, 800));
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Stops the server but keeps its folders, for tests that start another server on them. */
async function stopKeepingFolders(s: TestServer) {
  await s.close();
  server = { ...s, dispose: () => rm(dirname(s.dataDir), { recursive: true, force: true }) };
}

const copyIn = (s: TestServer, fixture: string, as = fixture) =>
  copyFile(fixturePath(fixture), join(s.libraryDir, as));

describe("a file copied into the watched library folder while the server runs", () => {
  it("appears in the Library without a restart", async () => {
    server = await startTestServer(fast);
    expect(await books(server)).toEqual([]);

    await copyIn(server, "sample.epub");

    await eventually(async () => expect(await books(server!)).toMatchObject([{ title: "Sample Book" }]));
  });
});

describe("files already in the library folder when the server starts", () => {
  it("are imported", async () => {
    server = await startTestServer(fast);
    await stopKeepingFolders(server);
    await copyIn(server, "epub2.epub");
    await copyIn(server, "chinese.epub");

    const restarted = await startServer({ dataDir: server.dataDir, libraryDir: server.libraryDir, port: 0, ...fast });
    try {
      await eventually(async () => expect(await titles(restarted)).toEqual(["Two Authors", "红楼梦"].sort()));
    } finally {
      await restarted.close();
    }
  });

  it("are not imported twice when the server restarts", async () => {
    server = await startTestServer(fast);
    await copyIn(server, "sample.epub");
    await eventually(async () => expect(await books(server!)).toHaveLength(1));
    const { dataDir, libraryDir } = server;
    await stopKeepingFolders(server);

    const restarted = await startServer({ dataDir, libraryDir, port: 0, ...fast });
    try {
      await quietPeriod();
      expect(await books(restarted)).toHaveLength(1);
      expect(await failures(restarted)).toEqual([]);
    } finally {
      await restarted.close();
    }
  });
});

describe("files in the library folder are treated exactly like uploads", () => {
  it("keeps one Book when the same content arrives by upload and by folder, under any name", async () => {
    server = await startTestServer(fast);
    await uploadFixture(server, "sample.epub");

    await copyIn(server, "sample.epub", "same book, other name.epub");
    await copyIn(server, "chinese.epub");

    await eventually(async () => expect(await titles(server!)).toEqual(["Sample Book", "红楼梦"].sort()));
    await quietPeriod();
    expect(await books(server)).toHaveLength(2);
    expect(await failures(server)).toEqual([]); // a duplicate is not an error
  });

  it("detects an EPUB by its content, whatever its name, like an upload does", async () => {
    server = await startTestServer(fast);

    await copyIn(server, "sample.epub", "renamed.zip");
    await copyIn(server, "chinese.epub", "renamed.txt");

    await eventually(async () => expect(await titles(server!)).toEqual(["Sample Book", "红楼梦"].sort()));
    expect(await failures(server)).toEqual([]);
  });

  it("reports a ZIP that is not an EPUB, and text named .epub, with the messages an upload gets", async () => {
    server = await startTestServer(fast);
    await writeFile(join(server.libraryDir, "archive.zip"), zipSync({ "readme.txt": strToU8("just a zip") }));
    await copyIn(server, "sample.txt", "pretend.epub");

    await eventually(async () => expect(await failures(server!)).toHaveLength(2));
    const byName = Object.fromEntries((await failures(server)).map((f) => [f.fileName, f]));
    expect(byName["archive.zip"]).toMatchObject({ code: "unsupported" });
    expect(byName["pretend.epub"]).toMatchObject({ code: "corrupt" });
    expect(byName["pretend.epub"]!.message).toContain("not a valid EPUB");
    expect(await books(server)).toEqual([]);
  });

  it("reports an unsupported file with the message an upload gets", async () => {
    server = await startTestServer(fast);

    await copyIn(server, "sample.pdf");

    await eventually(async () => expect(await failures(server!)).toHaveLength(1));
    const [failure] = await failures(server);
    expect(failure).toMatchObject({ path: "sample.pdf", fileName: "sample.pdf", code: "unsupported" });
    expect(failure!.message).toContain("not a supported file type");
    expect(await books(server)).toEqual([]);
  });

  it("reports a corrupt EPUB", async () => {
    server = await startTestServer(fast);

    await copyIn(server, "corrupt.epub");

    await eventually(async () => expect(await failures(server!)).toHaveLength(1));
    const [failure] = await failures(server);
    expect(failure).toMatchObject({ fileName: "corrupt.epub", code: "corrupt" });
    expect(failure!.message).toContain("not a valid EPUB");
    expect(await books(server)).toEqual([]);
  });

  it("reports a file over 200 MB", async () => {
    server = await startTestServer(fast);
    const big = join(server.libraryDir, "too-big.epub");
    await writeFile(big, "");
    await truncate(big, 200 * 1024 * 1024 + 1);

    await vi.waitFor(async () => expect(await failures(server!)).toHaveLength(1), { timeout: 30_000 });
    const [failure] = await failures(server);
    expect(failure).toMatchObject({ fileName: "too-big.epub", code: "too-large" });
    expect(failure!.message).toContain("200 MB");
    expect(await books(server)).toEqual([]);
  }, 60_000);

  it("imports files in subfolders too", async () => {
    server = await startTestServer(fast);
    await mkdir(join(server.libraryDir, "novels", "chinese"), { recursive: true });

    await copyIn(server, "chinese.epub", join("novels", "chinese", "hlm.epub"));
    await copyIn(server, "corrupt.epub", join("novels", "broken.epub"));

    await eventually(async () => expect(await titles(server!)).toEqual(["红楼梦"]));
    await eventually(async () => expect((await failures(server!)).map((f) => f.path)).toEqual(["novels/broken.epub"]));
  });

  it("ignores hidden files and unfinished downloads", async () => {
    server = await startTestServer(fast);

    await writeFile(join(server.libraryDir, ".DS_Store"), "x");
    await writeFile(join(server.libraryDir, "~$sample.docx"), "x");
    await writeFile(join(server.libraryDir, "book.epub.crdownload"), "x");
    await copyIn(server, "sample.epub");

    await eventually(async () => expect(await books(server!)).toHaveLength(1));
    await quietPeriod();
    expect(await failures(server)).toEqual([]);
  });
});

describe("a file that is still being copied", () => {
  it("is not imported until its size stops changing", async () => {
    server = await startTestServer({ ...fast, librarySettleMs: 400 });
    const bytes = await readFile(fixturePath("chinese.epub"));
    const chunk = Math.ceil(bytes.length / 8);
    const target = await open(join(server.libraryDir, "slow.epub"), "w");

    // Written in pieces with pauses shorter than the settle time: reacting to each change event
    // alone would import a half-written (corrupt) EPUB.
    for (let at = 0; at < bytes.length; at += chunk) {
      await target.write(bytes.subarray(at, at + chunk));
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (at + chunk < bytes.length) {
        expect(await books(server)).toEqual([]);
        expect(await failures(server)).toEqual([]);
      }
    }
    await target.close();

    await eventually(async () => expect(await books(server!)).toMatchObject([{ title: "红楼梦" }]));
    expect(await failures(server)).toEqual([]);
  });
});

describe("a file that changes or disappears", () => {
  it("is imported again when a failed file is replaced by a good one", async () => {
    server = await startTestServer(fast);
    await copyIn(server, "corrupt.epub", "book.epub");
    await eventually(async () => expect(await failures(server!)).toHaveLength(1));

    await copyIn(server, "sample.epub", "book.epub");

    await eventually(async () => expect(await books(server!)).toMatchObject([{ title: "Sample Book" }]));
    expect(await failures(server)).toEqual([]);
  });

  it("stops being reported once it is removed from the folder", async () => {
    server = await startTestServer(fast);
    await copyIn(server, "corrupt.epub");
    await eventually(async () => expect(await failures(server!)).toHaveLength(1));

    await rm(join(server.libraryDir, "corrupt.epub"));

    await eventually(async () => expect(await failures(server!)).toEqual([]));
  });
});

describe("the original files", () => {
  it("are left exactly as they were, whether imported, duplicate or rejected", async () => {
    server = await startTestServer(fast);
    const names = ["sample.epub", "same.epub", "corrupt.epub", "sample.pdf"];
    await copyIn(server, "sample.epub");
    await copyIn(server, "sample.epub", "same.epub");
    await copyIn(server, "corrupt.epub");
    await copyIn(server, "sample.pdf");
    const snapshot = () =>
      Promise.all(
        names.map(async (name) => {
          const path = join(server!.libraryDir, name);
          return { name, mtimeMs: (await stat(path)).mtimeMs, hash: sha256(await readFile(path)) };
        }),
      );
    const before = await snapshot();

    await eventually(async () => expect(await books(server!)).toHaveLength(1));
    await eventually(async () => expect(await failures(server!)).toHaveLength(2));
    await quietPeriod();

    expect(await snapshot()).toEqual(before);
  });
});

describe("a Book deleted while its original is still in the library folder", () => {
  const remove = (s: { url: string }, id: string) => fetch(`${s.url}/api/books/${id}`, { method: "DELETE" });
  /** Time for several rescans and settle periods, with the timings these tests use. */
  const severalRescans = () => new Promise((resolve) => setTimeout(resolve, 1200));

  it("stays deleted across rescans while the file is unchanged", async () => {
    server = await startTestServer({ librarySettleMs: 100, libraryRescanMs: 200 });
    await copyIn(server, "sample.epub");
    await eventually(async () => expect(await books(server!)).toHaveLength(1));

    expect((await remove(server, (await books(server))[0]!.id)).status).toBe(204);
    await severalRescans();

    expect(await books(server)).toEqual([]);
  });

  it("stays deleted when the folder had not been looked at yet, because the Book arrived by upload first", async () => {
    server = await startTestServer({ librarySettleMs: 400, libraryRescanMs: 200 });
    await copyIn(server, "sample.epub");
    expect((await uploadFixture(server, "sample.epub")).status).toBe(201); // well before the folder's file has settled
    expect((await remove(server, (await books(server))[0]!.id)).status).toBe(204);

    await severalRescans();

    expect(await books(server)).toEqual([]);
  });

  it("can still be uploaded again, and is deleted again for good", async () => {
    server = await startTestServer({ librarySettleMs: 100, libraryRescanMs: 200 });
    await copyIn(server, "sample.epub");
    await eventually(async () => expect(await books(server!)).toHaveLength(1));
    await remove(server, (await books(server))[0]!.id);

    expect((await uploadFixture(server, "sample.epub")).status).toBe(201);
    await remove(server, (await books(server))[0]!.id);
    await severalRescans();

    expect(await books(server)).toEqual([]);
  });

  it("is added again when the original file is replaced by a new version", async () => {
    server = await startTestServer({ librarySettleMs: 100, libraryRescanMs: 200 });
    await copyIn(server, "sample.epub", "book.epub");
    await eventually(async () => expect(await books(server!)).toHaveLength(1));
    await remove(server, (await books(server))[0]!.id);

    await copyIn(server, "chinese.epub", "book.epub");

    await eventually(async () => expect(await titles(server!)).toEqual(["红楼梦"]));
  });

  it("comes back when the file is touched without changing its content", async () => {
    server = await startTestServer({ librarySettleMs: 100, libraryRescanMs: 200 });
    await copyIn(server, "sample.epub");
    await eventually(async () => expect(await books(server!)).toHaveLength(1));
    await remove(server, (await books(server))[0]!.id);
    await severalRescans();
    expect(await books(server)).toEqual([]);

    const later = new Date(Date.now() + 60_000);
    await utimes(join(server.libraryDir, "sample.epub"), later, later);

    await eventually(async () => expect(await books(server!)).toHaveLength(1));
  });

  it("returns after a server restart, because the library folder is the source of truth", async () => {
    server = await startTestServer(fast);
    await copyIn(server, "sample.epub");
    await eventually(async () => expect(await books(server!)).toHaveLength(1));
    await remove(server, (await books(server))[0]!.id);
    const { dataDir, libraryDir } = server;
    await stopKeepingFolders(server);

    const restarted = await startServer({ dataDir, libraryDir, port: 0, ...fast });
    try {
      await eventually(async () => expect(await titles(restarted)).toEqual(["Sample Book"]));
    } finally {
      await restarted.close();
    }
  });
});
