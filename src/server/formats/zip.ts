import yauzl from "yauzl";

/** Random-access reader for a ZIP file on disk. Only the entries asked for are ever read into memory. */
export interface ZipReader {
  has(name: string): boolean;
  /** Reads one entry fully. Rejects if it is missing or declares more than `maxBytes` once unpacked. */
  read(name: string, maxBytes: number): Promise<Buffer>;
  close(): void;
}

export function openZip(path: string): Promise<ZipReader> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (openError, zip) => {
      if (openError) return reject(openError);
      const entries = new Map<string, yauzl.Entry>();
      zip.on("entry", (entry: yauzl.Entry) => {
        entries.set(entry.fileName, entry);
        zip.readEntry();
      });
      zip.once("error", reject);
      zip.once("end", () =>
        resolve({
          has: (name) => entries.has(name),
          read(name, maxBytes) {
            const entry = entries.get(name);
            if (!entry) return Promise.reject(new Error(`No entry ${name}`));
            if (entry.uncompressedSize > maxBytes) return Promise.reject(new Error(`Entry ${name} is too large`));
            return new Promise((done, fail) => {
              zip.openReadStream(entry, (streamError, stream) => {
                if (streamError) return fail(streamError);
                const chunks: Buffer[] = [];
                stream.on("data", (chunk: Buffer) => chunks.push(chunk));
                stream.once("error", fail);
                stream.once("end", () => done(Buffer.concat(chunks)));
              });
            });
          },
          close: () => zip.close(),
        }),
      );
      zip.readEntry();
    });
  });
}
