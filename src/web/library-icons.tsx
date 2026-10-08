/** The small line icons of the Library screen, after the mockups. All decorative: the buttons carrying them have text or an aria-label. */
import type { ComponentChildren } from "preact";

function Icon({ size, width = 2, children }: { size: number; width?: number; children: ComponentChildren }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={width}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const LogoIcon = () => (
  <Icon size={20} width={1.8}>
    <path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2V5z" />
    <path d="M8 7h6" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon size={18}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon size={18} width={2.2}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const UploadIcon = ({ size = 22 }: { size?: number }) => (
  <Icon size={size} width={1.9}>
    <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
  </Icon>
);

export const ChevronRightIcon = () => (
  <Icon size={18} width={2.2}>
    <path d="M9 18l6-6-6-6" />
  </Icon>
);

export const ChevronDownIcon = () => (
  <Icon size={16}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon size={18} width={1.8}>
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
  </Icon>
);

/** Four books on a shelf, for the empty Library. Colours come from the cover palette in library.css. */
export const ShelfIllustration = () => (
  <svg class="shelf" width="220" height="150" viewBox="0 0 220 150" fill="none" aria-hidden="true" focusable="false">
    <rect class="shelf-board" x="20" y="104" width="180" height="10" rx="5" />
    <rect class="shelf-book shade-0" x="42" y="44" width="34" height="62" rx="5" />
    <rect class="shelf-book shade-1" x="80" y="30" width="30" height="76" rx="5" />
    <rect class="shelf-book shade-3" x="114" y="52" width="38" height="54" rx="5" />
    <rect class="shelf-book shade-2" x="156" y="38" width="28" height="68" rx="5" />
    <rect class="shelf-bar shade-0" x="50" y="56" width="18" height="3" rx="1.5" />
    <rect class="shelf-bar shade-1" x="88" y="44" width="14" height="3" rx="1.5" />
    <rect class="shelf-bar shade-3" x="124" y="64" width="18" height="3" rx="1.5" />
    <rect class="shelf-bar shade-2" x="164" y="50" width="12" height="3" rx="1.5" />
  </svg>
);
