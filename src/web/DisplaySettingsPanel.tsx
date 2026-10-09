import { useEffect, useRef } from "preact/hooks";
import { stepZoom } from "./pdf-zoom.ts";
import type { Zoom } from "./reader/reader.ts";
import { CloseIcon } from "./ReaderIcons.tsx";
import {
  defaultDisplay,
  fontFamilies,
  fontSizeRange,
  lineSpacingRange,
  marginSizes,
  themes,
  type DisplaySettings,
  type Flow,
  type Margins,
  type Theme,
} from "./display-settings.ts";

const flows: { value: Flow; label: string }[] = [
  { value: "paginated", label: "Paginated" },
  { value: "scrolled", label: "Scrolling" },
];

interface Props {
  settings: DisplaySettings;
  onChange(settings: DisplaySettings): void;
  /**
   * Given while a fixed-layout Book (a PDF) is open: its text does not reflow, so zoom takes the place of the font,
   * size, spacing, margins and layout settings, which are left out with a note saying why.
   */
  fixed?: { zoom: Zoom; onZoom(zoom: Zoom): void };
  /** The sheet's Close button was used. */
  onClose(): void;
}

/**
 * The Reader's display controls, as one compact popover under the Display button (a full-width sheet with its own Close
 * button on a phone, see reader-chrome.css). Every control is always visible once
 * the panel is open; none needs hover. Choices are buttons that say whether they are `aria-pressed`. Changes apply
 * at once (the parent passes them to the Reader, which keeps the reader at the same place).
 */
export function DisplaySettingsPanel({ settings, onChange, onClose, fixed }: Props) {
  const set = (change: Partial<DisplaySettings>) => onChange({ ...settings, ...change });
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    // Keyboard users arrive on the choice that is in force.
    panel.current?.querySelector<HTMLElement>(".swatch[aria-pressed=true]")?.focus();
  }, []);

  return (
    <section ref={panel} id="display-settings" class="reader-panel display-panel" aria-label="Display settings" data-no-page-turn>
      {/* Drawn only where the panel is a full-width sheet (a phone); the popover is closed by its button in the top bar. */}
      <div class="panel-head sheet-head">
        <h2>Display</h2>
        <button type="button" class="icon-button" aria-label="Close display settings" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      <div class="setting">
        <div class="setting-name" id="display-theme">
          Theme
        </div>
        <div class="swatches" role="group" aria-labelledby="display-theme">
          {(Object.keys(themes) as Theme[]).map((theme) => (
            <button
              key={theme}
              type="button"
              class="swatch"
              aria-pressed={settings.theme === theme}
              style={{ background: themes[theme].background, color: themes[theme].text }}
              onClick={() => set({ theme })}
            >
              <span class="swatch-aa" aria-hidden="true">
                Aa
              </span>
              <span class="swatch-label">{themes[theme].label}</span>
            </button>
          ))}
        </div>
      </div>

      {fixed ? (
        <ZoomSetting zoom={fixed.zoom} onZoom={fixed.onZoom} />
      ) : (
        <>
        <div class="setting">
          <div class="setting-head">
            <label for="display-size">Text size</label>
            <output for="display-size" aria-live="off">{`${settings.fontSize} px`}</output>
          </div>
          <div class="range-row">
            <span class="range-end small" aria-hidden="true">
              A
            </span>
            <input
              id="display-size"
              type="range"
              {...fontSizeRange}
              value={settings.fontSize}
              onInput={(e) => set({ fontSize: Number(e.currentTarget.value) })}
            />
            <span class="range-end large" aria-hidden="true">
              A
            </span>
          </div>
        </div>

        <div class="setting">
          <div class="setting-name" id="display-font">
            Font
          </div>
          <div class="font-tiles" role="group" aria-labelledby="display-font">
            {fontFamilies.map((font) => (
              <button
                key={font.value}
                type="button"
                class={`font-tile font-${font.value}`}
                aria-pressed={settings.fontFamily === font.value}
                onClick={() => set({ fontFamily: font.value })}
              >
                <span class="font-sample" aria-hidden="true">
                  {font.sample}
                </span>
                <span class="font-name">{font.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div class="setting">
          <div class="setting-head">
            <label for="display-spacing">Line spacing</label>
            <output for="display-spacing" aria-live="off">
              {settings.lineSpacing.toFixed(1)}
            </output>
          </div>
          <input
            id="display-spacing"
            type="range"
            {...lineSpacingRange}
            value={settings.lineSpacing}
            onInput={(e) => set({ lineSpacing: Number(e.currentTarget.value) })}
          />
        </div>

        <div class="setting">
          <div class="setting-name" id="display-margins">
            Margins
          </div>
          <div class="segments" role="group" aria-labelledby="display-margins">
            {(Object.keys(marginSizes) as Margins[]).map((margins) => (
              <button key={margins} type="button" aria-pressed={settings.margins === margins} onClick={() => set({ margins })}>
                {marginSizes[margins].label}
              </button>
            ))}
          </div>
        </div>

        <div class="setting">
          <div class="setting-name" id="display-layout">
            Layout
          </div>
          <div class="segments" role="group" aria-labelledby="display-layout">
            {flows.map(({ value, label }) => (
              <button key={value} type="button" aria-pressed={settings.flow === value} onClick={() => set({ flow: value })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        </>
      )}

      <button type="button" class="text-button" onClick={() => onChange(defaultDisplay())}>
        Reset to defaults
      </button>
    </section>
  );
}

/** Zoom for a fixed-layout Book: fit the width or the whole page, or step the scale in and out. */
function ZoomSetting({ zoom, onZoom }: { zoom: Zoom; onZoom(zoom: Zoom): void }) {
  const percent = typeof zoom === "number" ? `${Math.round(zoom * 100)}%` : zoom === "fit-width" ? "Fit width" : "Fit page";
  return (
    <>
      <p class="setting-note">This Book has fixed pages, like a printed page, so its text keeps its own fonts, size and spacing. Zoom to read it comfortably.</p>
      <div class="setting">
        <div class="setting-head">
          <span class="setting-name" id="display-zoom">
            Zoom
          </span>
          <output aria-live="off">{percent}</output>
        </div>
        <div class="segments" role="group" aria-labelledby="display-zoom">
          <button type="button" aria-pressed={zoom === "fit-width"} onClick={() => onZoom("fit-width")}>
            Fit width
          </button>
          <button type="button" aria-pressed={zoom === "fit-page"} onClick={() => onZoom("fit-page")}>
            Fit page
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => onZoom(stepZoom(zoom, -1))}>
            −
          </button>
          <button type="button" aria-label="Zoom in" onClick={() => onZoom(stepZoom(zoom, 1))}>
            +
          </button>
        </div>
      </div>
    </>
  );
}

