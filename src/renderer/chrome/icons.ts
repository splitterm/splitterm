import { createElement, type IconNode } from 'lucide';

/** Render a Lucide icon as an inline SVG (inherits currentColor, so it themes automatically). */
export function icon(node: IconNode, size = 18): SVGElement {
  const el = createElement(node);
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('aria-hidden', 'true');
  return el;
}
