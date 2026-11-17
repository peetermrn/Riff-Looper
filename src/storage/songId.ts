/**
 * A stable ID for a song file, computed from its bytes, so saved sections and
 * settings come back when the same file is opened again (even if renamed).
 */
export async function computeSongId(bytes: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return 'sha256-' + toHex(new Uint8Array(digest)).slice(0, 32);
  }
  // crypto.subtle only exists on https/localhost. Fallback: FNV-1a hash.
  return 'fnv-' + fnv1a(new Uint8Array(bytes)) + '-' + bytes.byteLength.toString(16);
}

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function fnv1a(b: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i], 0x01000193);
    h2 = Math.imul(h2 ^ b[i], 0x811c9dc5);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
