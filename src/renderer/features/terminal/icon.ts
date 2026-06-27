// A tiny Lucide-icon helper local to the terminal feature, so its overlays (search bar, context
// menu) render icons without importing the chrome layer. Mirrors chrome/icons.ts intentionally.
import { createElement, type IconNode } from 'lucide';

export const icon = (node: IconNode, size = 14): SVGElement => {
  const svg = createElement(node);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  return svg;
};
