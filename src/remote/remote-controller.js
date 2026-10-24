/**
 * Samsung Tizen Remote Controller & 2D Spatial Navigation Engine
 * Handles D-pad arrows, Enter, Back/Return (10009/27), Media keys (Play/Pause/Rewind/FastForward),
 * focus trapping for dialogs, focus restoration, and on-screen keyboard support.
 */

import { logger } from '../utils/logger.js';

const TAG = 'RemoteController';

// Standard Samsung TV Key Codes
export const TV_KEYS = {
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  ENTER: 13,
  BACK: 10009,
  BACK_WEB: 27, // ESC / Backspace on desktop
  BACKSPACE: 8,
  PLAY: 415,
  PAUSE: 19,
  PLAY_PAUSE: 10252,
  STOP: 413,
  FAST_FWD: 417,
  REWIND: 412,
  RED: 403,
  GREEN: 404,
  YELLOW: 405,
  BLUE: 406,
};

export class RemoteController {
  constructor() {
    this.focusStack = [];
    this.currentFocusedElement = null;
    this.customKeyHandlers = [];
    this.backHandlers = [];
    this.isTrapActive = false;
    this.trapContainer = null;

    this.registerTizenKeys();
    this.bindEvents();
  }

  registerTizenKeys() {
    if (typeof window !== 'undefined' && window.tizen && window.tizen.tvinputdevice) {
      const keysToRegister = [
        'MediaPlay',
        'MediaPause',
        'MediaPlayPause',
        'MediaStop',
        'MediaFastForward',
        'MediaRewind',
        'ColorF0Red',
        'ColorF1Green',
        'ColorF2Yellow',
        'ColorF3Blue',
      ];
      for (const key of keysToRegister) {
        try {
          window.tizen.tvinputdevice.registerKey(key);
          logger.debug(TAG, `Registered Tizen TV key: ${key}`);
        } catch (e) {
          logger.debug(TAG, `Key register skipped: ${key} (${e.message})`);
        }
      }
    }
  }

  bindEvents() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => this.handleKeyDown(e), true);
    }
  }

  pushBackHandler(handler) {
    this.backHandlers.push(handler);
  }

  popBackHandler() {
    return this.backHandlers.pop();
  }

  pushKeyHandler(handler) {
    this.customKeyHandlers.push(handler);
  }

  popKeyHandler() {
    return this.customKeyHandlers.pop();
  }

  trapFocus(containerElement) {
    this.isTrapActive = true;
    this.trapContainer = containerElement;
    this.saveFocus();
    const firstFocusable = this.getFocusableElements(containerElement)[0];
    if (firstFocusable) {
      this.focusElement(firstFocusable);
    }
  }

  releaseFocusTrap() {
    this.isTrapActive = false;
    this.trapContainer = null;
    this.restoreFocus();
  }

  saveFocus() {
    if (this.currentFocusedElement) {
      this.focusStack.push(this.currentFocusedElement);
    }
  }

  restoreFocus() {
    const prev = this.focusStack.pop();
    if (prev && document.body.contains(prev)) {
      this.focusElement(prev);
    } else {
      const first = this.getFocusableElements()[0];
      if (first) this.focusElement(first);
    }
  }

  focusElement(element, scrollIntoView = true) {
    if (!element) return;
    if (this.currentFocusedElement && this.currentFocusedElement !== element) {
      this.currentFocusedElement.classList.remove('tv-focused');
      this.currentFocusedElement.blur();
    }

    this.currentFocusedElement = element;
    element.classList.add('tv-focused');
    element.focus();

    if (scrollIntoView) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }

  getFocusableElements(scope = null) {
    const root = scope || (this.isTrapActive && this.trapContainer ? this.trapContainer : document);
    const selector = 'button:not([disabled]), [tabindex="0"]:not([disabled]), input:not([disabled]), .focusable:not([disabled])';
    const elements = Array.from(root.querySelectorAll(selector));
    // Filter visible elements
    return elements.filter((el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetParent !== null;
    });
  }

  handleKeyDown(event) {
    const code = event.keyCode;
    logger.debug(TAG, `KeyDown code: ${code}`);

    // Allow active custom key handler first
    if (this.customKeyHandlers.length > 0) {
      const topHandler = this.customKeyHandlers[this.customKeyHandlers.length - 1];
      const handled = topHandler(event, code);
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    // Back / Return handling
    if (code === TV_KEYS.BACK || code === TV_KEYS.BACK_WEB) {
      event.preventDefault();
      event.stopPropagation();
      if (this.backHandlers.length > 0) {
        const topBack = this.backHandlers[this.backHandlers.length - 1];
        const handled = topBack();
        if (handled) return;
      }
      return;
    }

    // Directional spatial navigation
    if (code === TV_KEYS.LEFT || code === TV_KEYS.RIGHT || code === TV_KEYS.UP || code === TV_KEYS.DOWN) {
      event.preventDefault();
      event.stopPropagation();
      this.navigateDirection(code);
      return;
    }

    // Enter / Select
    if (code === TV_KEYS.ENTER) {
      if (this.currentFocusedElement) {
        event.preventDefault();
        // Trigger press animation
        this.currentFocusedElement.classList.add('tv-pressed');
        setTimeout(() => {
          this.currentFocusedElement?.classList.remove('tv-pressed');
        }, 150);
        this.currentFocusedElement.click();
      }
    }
  }

  navigateDirection(keyCode) {
    const focusables = this.getFocusableElements();
    if (focusables.length === 0) return;

    if (!this.currentFocusedElement || !focusables.includes(this.currentFocusedElement)) {
      this.focusElement(focusables[0]);
      return;
    }

    const currentRect = this.currentFocusedElement.getBoundingClientRect();
    const currentCenter = {
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2,
    };

    let bestCandidate = null;
    let minDistance = Infinity;

    for (const el of focusables) {
      if (el === this.currentFocusedElement) continue;

      const rect = el.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };

      const dx = center.x - currentCenter.x;
      const dy = center.y - currentCenter.y;

      let isCandidate = false;
      let primaryDistance = 0;
      let secondaryDistance = 0;

      switch (keyCode) {
        case TV_KEYS.LEFT:
          if (dx < -5) {
            isCandidate = true;
            primaryDistance = -dx;
            secondaryDistance = Math.abs(dy);
          }
          break;
        case TV_KEYS.RIGHT:
          if (dx > 5) {
            isCandidate = true;
            primaryDistance = dx;
            secondaryDistance = Math.abs(dy);
          }
          break;
        case TV_KEYS.UP:
          if (dy < -5) {
            isCandidate = true;
            primaryDistance = -dy;
            secondaryDistance = Math.abs(dx);
          }
          break;
        case TV_KEYS.DOWN:
          if (dy > 5) {
            isCandidate = true;
            primaryDistance = dy;
            secondaryDistance = Math.abs(dx);
          }
          break;
      }

      if (isCandidate) {
        // Weighted Manhattan distance prioritizing the movement axis
        const weightedDist = primaryDistance + secondaryDistance * 2.5;
        if (weightedDist < minDistance) {
          minDistance = weightedDist;
          bestCandidate = el;
        }
      }
    }

    if (bestCandidate) {
      this.focusElement(bestCandidate);
    }
  }
}

export const remoteController = new RemoteController();
