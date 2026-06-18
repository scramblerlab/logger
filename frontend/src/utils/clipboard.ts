/**
 * Copy text to the system clipboard.
 *
 * Works across desktop, iOS, and Android — in the browser and installed PWA.
 * Must be called from a user gesture (e.g. a click handler) to satisfy the
 * platforms' clipboard-write restrictions.
 *
 * Returns true on success, false on failure.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Primary path: async Clipboard API (secure/HTTPS contexts, all modern platforms).
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path below.
    }
  }

  // Fallback path: hidden textarea + execCommand('copy') for older browsers or
  // non-secure contexts where navigator.clipboard is unavailable.
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.readOnly = true;
    // Keep it off-screen and non-disruptive.
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);

    // iOS Safari needs an explicit range selection on a readonly textarea.
    const isIOS = /ipad|iphone|ipod/i.test(navigator.userAgent);
    if (isIOS) {
      const range = document.createRange();
      range.selectNodeContents(textarea);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      textarea.setSelectionRange(0, text.length);
    } else {
      textarea.select();
    }

    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
