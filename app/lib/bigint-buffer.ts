// Workers cannot load native Node addons. Match bigint-buffer's JS fallback
// without invoking its native bindings loader (which mutates Error stack hooks).
import { Buffer } from 'buffer';
export function toBigIntBE(bytes: Uint8Array): bigint {
  const hex=Buffer.from(bytes).toString('hex'); return hex?BigInt('0x'+hex):0n;
}
export function toBigIntLE(bytes: Uint8Array): bigint { return toBigIntBE(Buffer.from(bytes).reverse()); }
export function toBufferBE(value: bigint, width: number): Buffer {
  const hex=value.toString(16).padStart(width*2,'0');
  return Buffer.from(hex,'hex').subarray(0,width);
}
export function toBufferLE(value: bigint, width: number): Buffer { return toBufferBE(value,width).reverse(); }
