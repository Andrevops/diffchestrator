import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** True when the event target accepts text input (typing must not trigger shortcuts). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * True when the event target is any interactive control (buttons, links,
 * form fields, or custom role="button" elements) — global key handlers like
 * Enter must leave those to the control's own activation behaviour.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (isEditableTarget(target)) return true;
  if (target.closest("button, a[href], summary, [role='button'], [role='menuitem'], [role='tab'], [role='link']")) {
    return true;
  }
  return false;
}

/** True when any modifier key is held. */
export function hasModifier(e: KeyboardEvent | ReactKeyboardEvent): boolean {
  return e.altKey || e.ctrlKey || e.metaKey || e.shiftKey;
}

/**
 * Props that make a non-button element keyboard-activatable like a button:
 * role, tabIndex and Enter/Space handling.
 */
export function buttonProps(onActivate: () => void, label?: string) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": label,
    onClick: onActivate,
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
