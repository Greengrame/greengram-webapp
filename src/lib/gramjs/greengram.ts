// Greengram: this build talks to the server that served it. The MTProto
// key comes from the instance's discovery document instead of being
// compiled in, so one build works for any instance; the page itself comes
// from that origin, so pinning buys nothing extra here.

import { SERVER_KEYS } from './crypto/RSA';
import { readBigIntFromBuffer } from './Helpers';

type Discovery = { dc: number; publicKey: string; fingerprint: string };

let instance: Promise<Discovery> | undefined;

export function greengramOrigin() {
  return self.location.origin;
}

// same host and port as the page, wss when the page is https
export function greengramSocketURL() {
  return `${self.location.protocol === 'https:' ? 'wss' : 'ws'}://${self.location.host}/apiws`;
}

// RSA PUBLIC KEY (PKCS#1): SEQUENCE { INTEGER n, INTEGER e }
function parsePKCS1(pem: string) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  let pos = 0;
  const length = () => {
    let len = der[pos++];
    if (len & 0x80) {
      let n = len & 0x7f;
      len = 0;
      while (n--) len = len * 256 + der[pos++];
    }
    return len;
  };
  const integer = () => {
    if (der[pos++] !== 0x02) throw new Error('greengram: bad RSA key');
    const len = length();
    const value = der.slice(pos, pos + len);
    pos += len;
    return readBigIntFromBuffer(value, false, false);
  };
  if (der[pos++] !== 0x30) throw new Error('greengram: bad RSA key');
  length();
  const n = integer();
  const e = integer();
  return { n, e: Number(e) };
}

export function loadGreengramInstance() {
  if (!instance) {
    instance = (async () => {
      const response = await fetch(`${greengramOrigin()}/.well-known/greengram-gateway.json`);
      if (!response.ok) throw new Error(`greengram: discovery ${response.status}`);
      const doc = await response.json() as Discovery;
      SERVER_KEYS.set(BigInt(doc.fingerprint), parsePKCS1(doc.publicKey));
      return doc;
    })();
    instance.catch(() => { instance = undefined; });
  }
  return instance;
}

// The browser's Greengram session (HttpOnly cookie), handed back by the
// server so it can go into auth.importAuthorization. undefined: signed out.
export async function greengramWebToken(): Promise<{ token: string; userId: string } | undefined> {
  const response = await fetch(`${greengramOrigin()}/api/auth/webtoken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    credentials: 'same-origin',
  });
  if (response.status === 401) return undefined;
  if (!response.ok) throw new Error(`greengram: webtoken ${response.status}`);
  const data = await response.json() as { token: string; userId: number };
  return { token: data.token, userId: String(data.userId) };
}
