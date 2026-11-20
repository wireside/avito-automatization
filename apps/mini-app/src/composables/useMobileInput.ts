import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue';

const keyboardFields =
  'input:not([type]), input:is([type="text"], [type="search"], [type="number"], [type="email"], [type="tel"], [type="url"], [type="password"]), textarea';

function focusedInput() {
  const element = document.activeElement;
  if (
    element instanceof HTMLElement &&
    (element.isContentEditable ||
      element.matches(`:is(${keyboardFields}):not(:disabled, [readonly])`))
  ) {
    return element;
  }
}

export function useMobileInput(mdAndUp: Ref<boolean>) {
  const editing = ref(false);
  const keyboardOpen = ref(false);
  const viewport = window.visualViewport;
  const touch = window.matchMedia('(pointer: coarse)');
  // Normalize for pinch zoom and account for WebViews that also resize the layout.
  const viewportHeight = () =>
    viewport
      ? Math.min(window.innerHeight, viewport.height * viewport.scale)
      : window.innerHeight;
  let restingHeight = viewportHeight();
  let layoutWidth = window.innerWidth;
  let editingPointer: number | null = null;
  let focusFrame = 0;

  function updateFocus() {
    const next = Boolean(focusedInput());
    // Keep the bottom bar from covering the tapped control before its click.
    if (!next && editingPointer !== null) return;
    if (!keyboardOpen.value && !next) restingHeight = viewportHeight();
    editing.value = next;
  }

  function onFocusOut() {
    queueMicrotask(updateFocus);
  }

  function onResize() {
    const height = viewportHeight();
    // The browser chrome can also change the height by a small amount.
    const heightLoss = restingHeight - height;
    if (layoutWidth !== window.innerWidth || !touch.matches) {
      layoutWidth = window.innerWidth;
      restingHeight = height;
      keyboardOpen.value = false;
    } else if (!editing.value && !keyboardOpen.value) {
      restingHeight = height;
    } else if (heightLoss >= 120) {
      keyboardOpen.value = true;
    } else if (keyboardOpen.value && heightLoss <= 60) {
      keyboardOpen.value = false;
      // The system can dismiss the keyboard while leaving the field focused.
      focusedInput()?.blur();
    }
  }

  function dismissOnOutsideTap(event: PointerEvent) {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      (mdAndUp.value && event.pointerType === 'mouse')
    )
      return;
    const input = focusedInput();
    if (
      !input ||
      !(event.target instanceof Element) ||
      input.contains(event.target) ||
      event.target.closest(
        `${keyboardFields}, label, .v-field, [contenteditable]`,
      )
    )
      return;

    input.blur();
    const app = window.Telegram?.WebApp;
    try {
      if (app?.isVersionAtLeast?.('9.1') !== false) app?.hideKeyboard?.();
    } catch {
      // Older clients can expose SDK methods they do not support.
    }
  }

  function onPointerDown(event: PointerEvent) {
    if (
      !mdAndUp.value &&
      event.isPrimary &&
      event.button === 0 &&
      focusedInput()
    ) {
      window.cancelAnimationFrame(focusFrame);
      editingPointer = event.pointerId;
    }
  }

  function finishPointer(event: PointerEvent) {
    if (event.pointerId !== editingPointer) return;
    focusFrame = window.requestAnimationFrame(() => {
      editingPointer = null;
      updateFocus();
    });
  }

  function onPointerUp(event: PointerEvent) {
    dismissOnOutsideTap(event);
    finishPointer(event);
  }

  onMounted(() => {
    updateFocus();
    document.addEventListener('focusin', updateFocus);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', finishPointer, true);
    window.addEventListener('resize', onResize);
    viewport?.addEventListener('resize', onResize);
  });

  onUnmounted(() => {
    document.removeEventListener('focusin', updateFocus);
    document.removeEventListener('focusout', onFocusOut);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', finishPointer, true);
    window.cancelAnimationFrame(focusFrame);
    window.removeEventListener('resize', onResize);
    viewport?.removeEventListener('resize', onResize);
  });

  return computed(() => editing.value || keyboardOpen.value);
}
