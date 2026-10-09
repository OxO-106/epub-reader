// Types for the part of pdf.js (foliate-js's PDF adapter) that Reader uses. Written for this project, not part of foliate-js.
import type { FoliateBook } from "./view.js";

/** A fixed-layout Book (`rendition.layout` "pre-paginated") whose sections are the PDF's pages. */
export function makePDF(file: Blob): Promise<FoliateBook>;
