import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import {
  createInventoryApi,
  InventoryApiError,
  type ScanInput,
  type ScanResult,
} from '../inventory-api';
import { layout } from '../design/tokens';

export interface ReceiptEntry {
  result: ScanResult;
  scannedAt: string;
}
export function useIntake(
  initData: string,
  canReceive: Ref<boolean>,
  focus: () => void,
) {
  const api = createInventoryApi(initData);
  const queryClient = useQueryClient();
  const raw = ref('');
  const queue = ref<ScanInput[]>([]);
  const processing = ref(false);
  const paused = ref(false);
  const retryableFailure = ref(false);
  const scanError = ref('');
  const errorRequestId = ref<string>();
  const lastResult = ref<ScanResult>();
  const entries = ref<ReceiptEntry[]>([]);
  const acceptedIds = ref(new Set<string>());
  const cameraOpen = ref(false);
  let disposed = false;
  const inputDisabled = computed(
    () =>
      !canReceive.value ||
      paused.value ||
      queue.value.length >= layout.maxScanQueue,
  );
  const receive = useMutation({
    gcTime: 0,
    retry: false,
    mutationFn: (input: ScanInput) => api<ScanResult>('/receipts/scan', input),
  });
  async function processQueue() {
    if (processing.value || disposed || !canReceive.value) return;
    processing.value = true;
    paused.value = false;
    retryableFailure.value = false;
    scanError.value = '';
    errorRequestId.value = undefined;
    try {
      while (queue.value.length && !disposed && canReceive.value) {
        const input = queue.value[0]!;
        try {
          const result = await receive.mutateAsync(input);
          if (disposed) return;
          lastResult.value = result;
          if (result.outcome === 'ACCEPTED')
            acceptedIds.value.add(result.unit.id);
          // Store safe response data only. Original marking stays in the in-memory queue.
          entries.value = [
            { result, scannedAt: new Date().toISOString() },
            ...entries.value.filter(
              (entry) => entry.result.unit.id !== result.unit.id,
            ),
          ].slice(0, 100);
          queue.value.shift();
          if (retryableFailure.value || raw.value === input.raw) raw.value = '';
          // Refresh projections without delaying the next physical scan.
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: ['inventory'] }),
            queryClient.invalidateQueries({ queryKey: ['inventory-units'] }),
          ]);
        } catch (error) {
          if (disposed) return;
          lastResult.value = undefined;
          scanError.value =
            error instanceof Error
              ? error.message
              : 'Не удалось сохранить товар.';
          retryableFailure.value =
            error instanceof InventoryApiError && error.retryable;
          errorRequestId.value =
            error instanceof InventoryApiError ? error.requestId : undefined;
          if (!raw.value) raw.value = input.raw;
          if (!retryableFailure.value) queue.value.shift();
          paused.value = queue.value.length > 0;
          cameraOpen.value = false;
          break;
        } finally {
          receive.reset();
        }
      }
    } finally {
      processing.value = false;
      if (!disposed && !paused.value && canReceive.value) focus();
    }
  }
  function enqueue(value: string, scannerProfile: ScanInput['scannerProfile']) {
    if (!value || inputDisabled.value || disposed) return;
    queue.value.push({
      requestId: crypto.randomUUID(),
      raw: value,
      scannerProfile,
    });
    void processQueue();
  }
  function submitScan() {
    if (!raw.value || inputDisabled.value) return;
    const value = raw.value;
    raw.value = '';
    enqueue(value, 'keyboard-gs1-v1');
    focus();
  }
  function scannerKey(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'Enter' || (event.key === 'Tab' && raw.value)) {
      event.preventDefault();
      submitScan();
    }
    if (event.ctrlKey && (event.key === ']' || event.code === 'BracketRight')) {
      event.preventDefault();
      const target = event.target as HTMLInputElement;
      const start = target.selectionStart ?? raw.value.length;
      const end = target.selectionEnd ?? start;
      raw.value = raw.value.slice(0, start) + '\u001d' + raw.value.slice(end);
      queueMicrotask(() => target.setSelectionRange(start + 1, start + 1));
    }
  }
  function pasteScan(event: ClipboardEvent) {
    const value = event.clipboardData?.getData('text');
    if (value === undefined) return;
    event.preventDefault();
    raw.value = value;
  }
  function cameraScan(value: string) {
    cameraOpen.value = false;
    enqueue(value, 'camera-gs1-v1');
  }
  watch(canReceive, (value) => {
    if (!value) {
      cameraOpen.value = false;
      queue.value = [];
      raw.value = '';
    }
  });
  onBeforeUnmount(() => {
    disposed = true;
    cameraOpen.value = false;
    queue.value = [];
    raw.value = '';
  });
  return {
    raw,
    processing,
    paused,
    retryableFailure,
    scanError,
    errorRequestId,
    lastResult,
    entries,
    cameraOpen,
    inputDisabled,
    queueLength: computed(() => queue.value.length),
    acceptedCount: computed(() => acceptedIds.value.size),
    processQueue,
    submitScan,
    scannerKey,
    pasteScan,
    cameraScan,
  };
}
