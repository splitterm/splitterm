// Color scheme type — shaped to xterm's ITheme so a scheme passes straight into
// term.options.theme. The concrete hex values live as CSS custom properties in
// renderer/styles/tokens.css; theme.ts (renderer) bridges CSS vars → this object.

export interface ColorScheme {
  name: string;
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent?: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const BUILT_IN_SCHEME_NAMES = ['Dark', 'OLED Black', 'Light'] as const;
export type BuiltInSchemeName = (typeof BUILT_IN_SCHEME_NAMES)[number];
