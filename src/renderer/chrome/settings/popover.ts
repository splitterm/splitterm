// A shared "dismiss every open settings popover" signal. Both the colour-picker swatch and the custom
// dropdown mount transient popovers into the settings overlay; the modal fires this on close / category
// switch (and on Escape, via close) so no popover can outlive the modal as a zombie + a leaked listener.
const DISMISS = 'settings:dismiss-popover';

/** Fire on `document` — tears down every open settings popover (colour pickers + dropdowns). */
export function dismissSettingsPopovers(): void {
  document.dispatchEvent(new Event(DISMISS));
}

/** Subscribe a popover's teardown to the dismiss signal; returns an unsubscribe to call when it closes. */
export function onDismissPopovers(cb: () => void): () => void {
  document.addEventListener(DISMISS, cb);
  return () => document.removeEventListener(DISMISS, cb);
}
