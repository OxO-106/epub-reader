// Types for the parts of mobi.js that Reader uses. Written for this project, not part of foliate-js.
import type { FoliateBook } from "./view.js";

export class MOBI {
  /** `unzlib` inflates the zlib-compressed fonts some KF8 files carry (vendor/fflate.js). */
  constructor(options: { unzlib: (data: Uint8Array) => Uint8Array });
  /** Reads a MOBI 6 or KF8 (AZW3) file; throws for one it cannot read (a damaged or DRM-encrypted file). */
  open(file: Blob): Promise<FoliateBook>;
}
