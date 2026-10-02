/** `crypto.randomUUID` only exists in secure contexts; plain-http LAN access lacks it. */
export const uid = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
