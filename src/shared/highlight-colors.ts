/** The colours a highlight can have, shared by the server (which checks them) and the front end (which paints them per theme). */
export const highlightColors = ["yellow", "green", "blue", "pink"] as const;
export type HighlightColor = (typeof highlightColors)[number];
