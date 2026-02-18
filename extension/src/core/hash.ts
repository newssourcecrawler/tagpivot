// extension/src/core/hash.ts

export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const bytes = enc.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bufToHex(digest);
}

function bufToHex(buf: ArrayBuffer): string {
  const arr = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < arr.length; i++) {
    s += arr[i].toString(16).padStart(2, "0");
  }
  return s;
}