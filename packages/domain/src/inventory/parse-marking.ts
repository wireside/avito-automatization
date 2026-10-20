export const markingParserProfile = 'light-industry-01-21-91-92-v1';
export type ScannerProfile = 'camera-gs1-v1' | 'keyboard-gs1-v1';
export interface ParsedMarking {
  gtin: string;
  serial: string;
  identity: string;
  maskedCode: string;
  parserProfile: string;
}
export type ParseMarkingResult =
  | { ok: true; marking: ParsedMarking }
  | { ok: false; code: 'INVALID_MARKING' | 'INVALID_GTIN' };

// Only transport decoration is removed. Original input is encrypted unchanged.
// This profile deliberately refuses missing GS separators and other product groups.
export function parseClothingMarking(
  raw: string,
  scannerProfile: ScannerProfile,
): ParseMarkingResult {
  let payload = raw;
  if (scannerProfile === 'keyboard-gs1-v1')
    payload = payload.replace(/(?:\r\n|\r|\n|\t)$/, '');
  if (payload.startsWith(']d2')) payload = payload.slice(3);
  // ZXing emits the initial GS1 FNC1 as GS; this is framing, not the AI separator.
  if (payload.startsWith('\u001d')) payload = payload.slice(1);
  const match =
    // eslint-disable-next-line no-control-regex -- ASCII GS is required by this GS1 profile.
    /^01([0-9]{14})21([!-~]{13})\x1d91([!-~]{4})\x1d92([!-~]{44})$/.exec(
      payload,
    );
  if (!match) return { ok: false, code: 'INVALID_MARKING' };
  const gtin = match[1]!;
  const serial = match[2]!;
  const sum = [...gtin.slice(0, 13)].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1),
    0,
  );
  if ((10 - (sum % 10)) % 10 !== Number(gtin[13]))
    return { ok: false, code: 'INVALID_GTIN' };
  return {
    ok: true,
    marking: {
      gtin,
      serial,
      identity: `01${gtin}21${serial}`,
      maskedCode: `${gtin} · •••${serial.slice(-4)}`,
      parserProfile: markingParserProfile,
    },
  };
}
