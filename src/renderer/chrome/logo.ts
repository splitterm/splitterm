// The splitterm logo mark, inlined as an SVG that paints with `currentColor` — so it tints to the
// surrounding text colour automatically: white-ish on dark themes, black-ish on light, no asset
// swapping needed. Source of truth: assets/splitterm-logos/mono.svg.
export function logoMark(size = 18): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 256 256');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.flexShrink = '0';
  svg.innerHTML =
    '<g stroke-linejoin="round">' +
    '<rect x="28" y="28" width="100" height="200" rx="12" stroke="currentColor" stroke-width="10"/>' +
    '<rect x="146" y="137" width="82" height="91" rx="12" stroke="currentColor" stroke-width="10"/>' +
    '<rect x="146" y="28" width="82" height="91" rx="12" fill="currentColor" stroke="currentColor" stroke-width="10"/>' +
    '<rect x="50" y="56" width="28" height="34" rx="3" fill="currentColor"/>' +
    '</g>';
  return svg;
}
