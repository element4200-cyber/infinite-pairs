export const SOL = 'So11111111111111111111111111111111111111112';
export const ROOT_NAME = 'Infinite Pairs';
export const ROOT_SYMBOL = 'INFINITE';
export function base58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n, result = '';
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  while (value > 0n) { result = alphabet[Number(value % 58n)] + result; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = '1' + result; }
  return result;
}
export function baseUnits(value: string, decimals: number): string {
  if (!/^\d{1,12}(\.\d{1,9})?$/.test(value)) throw new Error('Enter a positive amount with at most 9 decimal places.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error(`This pair asset supports ${decimals} decimal places.`);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')).toString();
}
export function fallbackReason(error: unknown): string | null {
  const name = error instanceof Error ? error.name : '';
  if (name === 'CurveDepthExceededError') return 'The previous token reaches Pump.fun’s maximum pair depth. This launch uses SOL and keeps its predecessor link.';
  if (['QuoteBondingCurveNotEligibleError', 'UnsupportedQuoteMintError', 'QuoteReservesOutOfRangeError'].includes(name)) return 'Pump.fun does not currently accept the previous token as a quote. This launch uses SOL and keeps its predecessor link.';
  return null;
}
export function validUri(value: string): boolean {
  if (value.length > 200) return false;
  try { const u = new URL(value); return (u.protocol === 'https:' && !!u.hostname) || (u.protocol === 'ipfs:' && !!u.hostname); } catch { return false; }
}
