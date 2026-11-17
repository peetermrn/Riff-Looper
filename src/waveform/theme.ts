/** Canvas colours, read from CSS custom properties in styles.css (so CSS stays the single source). */
export interface CanvasTheme {
  bg: string;
  labelStrip: string;
  wave: string;
  playhead: string;
  selection: string;
  selectionEdge: string;
  loop: string;
  beat: string;
  bar: string;
  viewport: string;
}

export function readTheme(): CanvasTheme {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--wave-bg', '#111827'),
    labelStrip: v('--wave-label-strip', '#0b1220'),
    wave: v('--wave-fg', '#9ca3af'),
    playhead: v('--playhead', '#f43f5e'),
    selection: v('--selection', 'rgba(96,165,250,0.25)'),
    selectionEdge: v('--selection-edge', '#60a5fa'),
    loop: v('--loop', '#facc15'),
    beat: v('--beat-line', 'rgba(255,255,255,0.08)'),
    bar: v('--bar-line', 'rgba(255,255,255,0.25)'),
    viewport: v('--viewport', 'rgba(255,255,255,0.15)'),
  };
}
