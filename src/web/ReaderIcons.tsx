/** The small line icons of the Reader's chrome. All decorative (`aria-hidden`): the buttons carry their own names. */
function Svg({ size = 18, stroke = 1.9, children }: { size?: number; stroke?: number; children: preact.ComponentChildren }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ChevronLeft = ({ size = 18 }: { size?: number }) => (
  <Svg size={size} stroke={2}>
    <path d="M15 18l-6-6 6-6" />
  </Svg>
);

export const ChevronRight = () => (
  <Svg stroke={2.2}>
    <path d="M9 18l6-6-6-6" />
  </Svg>
);

export const ListIcon = () => (
  <Svg>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </Svg>
);

export const SearchIcon = ({ size = 18 }: { size?: number }) => (
  <Svg size={size} stroke={2}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Svg>
);

export const CloseIcon = ({ size = 20 }: { size?: number }) => (
  <Svg size={size} stroke={2}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Svg>
);

/** A glyph for "A to 文": the Translate button (the path of the ReaderBilingual mockup). */
export const TranslateIcon = () => (
  <Svg>
    <path d="M4 5h9M8.5 3v2M6 5c.5 3 2.5 5.5 5.5 7M12 5c-.6 3.2-3 6-7 7.5M13 21l4-10 4 10M14.5 17.5h5" />
  </Svg>
);

/** The small arrow on a status pill that opens a panel. */
export const ChevronDown = () => (
  <Svg size={14} stroke={2.2}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);

export const TypeIcon = () => (
  <span class="type-icon" aria-hidden="true">
    Aa
  </span>
);

/** A marker pen: the Highlights button. */
export const HighlighterIcon = () => (
  <Svg>
    <path d="M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
  </Svg>
);

/** A book with lines of text: the Glossary button. */
export const GlossaryIcon = () => (
  <Svg>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5M8 7h8M8 11h5" />
  </Svg>
);
