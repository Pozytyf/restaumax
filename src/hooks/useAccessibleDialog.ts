import { useEffect, useRef } from 'react';

/**
 * Accessible modal behavior shared by the customer product, cart and receipt dialogs.
 * Focus is moved into the dialog, trapped while it is open, and restored on close.
 */
export function useAccessibleDialog<T extends HTMLElement>(
  isOpen: boolean,
  onClose: () => void
) {
  const dialogRef = useRef<T>(null);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null);

    const initialFocus = getFocusable()[0];
    (initialFocus || dialog).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen, onClose]);

  return dialogRef;
}
