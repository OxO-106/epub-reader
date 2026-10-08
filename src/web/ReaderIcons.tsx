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

export const TypeIcon = () => (
  <span class="type-icon" aria-hidden="true">
    Aa
  </span>
);
