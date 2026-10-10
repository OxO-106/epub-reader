// Fetches llama.cpp's Vulkan build for Windows (the translation model's runtime) into the git-ignored runtime/ folder,
// checked against its published SHA-256 and unpacked into runtime/llama-vulkan, so the desktop installer can ship it
// (electron-builder.yml, extraResources) and the installed app needs only the model. `npm run runtime`; does nothing
// when it is already there.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadFile, translationDownloads, unzip } from "../desktop/downloads.ts";

const runtime = fileURLToPath(new URL("../runtime/", import.meta.url));
const target = join(runtime, "llama-vulkan");
if (existsSync(join(target, "llama-server.exe"))) {
  console.log(`llama.cpp is already in ${target}`);
} else {
  const zip = join(runtime, translationDownloads.runtime.name);
  if (!existsSync(zip)) {
    console.log(`Downloading ${translationDownloads.runtime.name} …`);
    await downloadFile(translationDownloads.runtime, zip);
  }
  await unzip(zip, target);
  console.log(`llama.cpp unpacked into ${target}`);
}
