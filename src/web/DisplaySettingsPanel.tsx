import {
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
  { value: "scrolled", label: "Scrolling" },
  { value: "paginated", label: "Paginated" },
];

interface Props {
  settings: DisplaySettings;
  onChange(settings: DisplaySettings): void;
}

/** The Reader's display controls. Every control is always visible once the panel is open; none needs hover. */
export function DisplaySettingsPanel({ settings, onChange }: Props) {
  const set = (change: Partial<DisplaySettings>) => onChange({ ...settings, ...change });

  return (
    <section id="display-settings" class="display-settings" aria-label="Display settings">
      <label class="setting">
        <span>Font</span>
        <select value={settings.fontFamily} onChange={(e) => set({ fontFamily: e.currentTarget.value as DisplaySettings["fontFamily"] })}>
          {fontFamilies.map((font) => (
            <option key={font.value} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>
      </label>

      <div class="setting">
        <label for="display-size">Text size</label>
        <output for="display-size">{settings.fontSize}</output>
        <input
          id="display-size"
          type="range"
          {...fontSizeRange}
          value={settings.fontSize}
          onInput={(e) => set({ fontSize: Number(e.currentTarget.value) })}
        />
      </div>

      <div class="setting">
        <label for="display-spacing">Line spacing</label>
        <output for="display-spacing">{settings.lineSpacing.toFixed(1)}</output>
        <input
          id="display-spacing"
          type="range"
          {...lineSpacingRange}
          value={settings.lineSpacing}
          onInput={(e) => set({ lineSpacing: Number(e.currentTarget.value) })}
        />
      </div>

      <label class="setting">
        <span>Margins</span>
        <select value={settings.margins} onChange={(e) => set({ margins: e.currentTarget.value as Margins })}>
          {Object.entries(marginSizes).map(([value, size]) => (
            <option key={value} value={value}>
              {size.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset class="setting choices">
        <legend>Theme</legend>
        {(Object.keys(themes) as Theme[]).map((theme) => (
          <label key={theme}>
            <input type="radio" name="theme" value={theme} checked={settings.theme === theme} onChange={() => set({ theme })} />
            {themes[theme].label}
          </label>
        ))}
      </fieldset>

      <fieldset class="setting choices">
        <legend>Layout</legend>
        {flows.map(({ value, label }) => (
          <label key={value}>
            <input type="radio" name="flow" value={value} checked={settings.flow === value} onChange={() => set({ flow: value })} />
            {label}
          </label>
        ))}
      </fieldset>
    </section>
  );
}
