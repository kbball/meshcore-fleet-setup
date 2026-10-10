export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '')
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new Error('invalid hex string')
  return Uint8Array.from(clean.match(/../g) ?? [], (h) => parseInt(h, 16))
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export function bytesToBase64(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s)
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function u32le(v: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, v >>> 0, true)
  return b
}

export function i32le(v: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setInt32(0, v, true)
  return b
}

const enc = new TextEncoder()
const dec = new TextDecoder()

export function utf8(s: string): Uint8Array {
  return enc.encode(s)
}

export function fromUtf8(b: Uint8Array): string {
  return dec.decode(b)
}

/** Zero-padded fixed-size field. Throws if the string does not fit (leaving room for the terminator). */
export function fixedString(s: string, size: number): Uint8Array {
  const b = utf8(s)
  if (b.length > size - 1) throw new Error(`'${s}' is longer than ${size - 1} bytes`)
  const out = new Uint8Array(size)
  out.set(b)
  return out
}

/** Read a NUL-terminated string from a fixed-size field. */
export function cString(b: Uint8Array): string {
  const i = b.indexOf(0)
  return fromUtf8(i < 0 ? b : b.subarray(0, i))
}
