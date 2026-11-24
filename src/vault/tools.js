// Password strength, generator and TOTP — all local, no network.

const COMMON = new Set(['123456', '12345678', '123456789', 'password', 'qwerty', '111111', '000000', 'abc123', '1234567', 'password1',
  '12345', '1234567890', 'iloveyou', 'admin', 'welcome', 'letmein', 'monkey', 'dragon', 'football', 'sunshine', 'princess', '123123', '654321', 'qwerty123']);

/** Returns { score: 0..4, label, bits } */
export function strength(pw) {
  pw = String(pw || '');
  if (!pw) return { score: 0, label: '—', bits: 0 };
  if (COMMON.has(pw.toLowerCase())) return { score: 0, label: 'อ่อนมาก', bits: 0 };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  if (/[^\x00-\x7f]/.test(pw)) pool += 60;
  let bits = pw.length * Math.log2(Math.max(pool, 1));
  // penalties: repeats, sequences, only digits
  if (/(.)\1{2,}/.test(pw)) bits -= 10;
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/i.test(pw)) bits -= 12;
  if (/^\d+$/.test(pw)) bits *= 0.7;
  bits = Math.max(0, Math.round(bits));
  const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { score, bits, label: ['อ่อนมาก', 'อ่อน', 'พอใช้', 'ดี', 'แข็งแรงมาก'][score] };
}

const WORDS = ('apple river tiger cloud piano lemon orbit maple stone candle forest silver rocket ocean garden pepper falcon velvet ' +
  'thunder mango coral island marble planet sunset violet winter yellow zebra anchor bamboo cactus dolphin ember feather glacier ' +
  'harbor igloo jungle koala lantern meadow nectar oasis panda quartz raven saffron tulip umbrella valley walnut yogurt cobalt ' +
  'breeze copper dune echo fable galaxy hazel ivory jasmine kettle lagoon mosaic nimbus olive pixel quiver ripple shadow topaz ' +
  'unicorn vortex willow crystal summit canyon prairie comet nova lotus cedar basil cinder delta fjord grove hollow indigo').split(' ');

function randInt(n) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

export function generate(opts = {}) {
  const o = { length: 20, upper: true, lower: true, digits: true, symbols: true, ambiguous: false, mode: 'random', words: 4, sep: '-', ...opts };
  if (o.mode === 'words') {
    const w = Array.from({ length: o.words }, () => WORDS[randInt(WORDS.length)]);
    if (o.upper) w[randInt(w.length)] = w[randInt(w.length)].replace(/^./, (c) => c.toUpperCase());
    if (o.digits) w.push(String(randInt(100)));
    return w.join(o.sep);
  }
  if (o.mode === 'pin') return Array.from({ length: o.length }, () => randInt(10)).join('');
  let sets = [];
  if (o.lower) sets.push('abcdefghijkmnopqrstuvwxyz' + (o.ambiguous ? '' : 'l'));
  if (o.upper) sets.push('ABCDEFGHJKLMNPQRSTUVWXYZ' + (o.ambiguous ? '' : 'IO'));
  if (o.digits) sets.push('23456789' + (o.ambiguous ? '' : '01'));
  if (o.symbols) sets.push('!@#$%^&*-_=+?.:;~');
  if (!sets.length) sets = ['abcdefghijkmnopqrstuvwxyz'];
  const all = sets.join('');
  const chars = sets.map((s) => s[randInt(s.length)]); // at least one from each set
  while (chars.length < o.length) chars.push(all[randInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = randInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.slice(0, o.length).join('');
}

// ---------------- TOTP (RFC 6238) ----------------
function base32(s) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of clean) bits += alpha.indexOf(c).toString(2).padStart(5, '0');
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

/** Accepts a raw base32 secret or an otpauth:// URI. */
export function parseTotp(value) {
  const v = String(value || '').trim();
  if (v.startsWith('otpauth://')) {
    try {
      const u = new URL(v);
      return { secret: u.searchParams.get('secret') || '', digits: Number(u.searchParams.get('digits')) || 6,
        period: Number(u.searchParams.get('period')) || 30, algo: (u.searchParams.get('algorithm') || 'SHA1').toUpperCase() };
    } catch { /* fall through */ }
  }
  return { secret: v, digits: 6, period: 30, algo: 'SHA1' };
}

export async function totp(value, now = Date.now()) {
  const { secret, digits, period, algo } = parseTotp(value);
  const key = base32(secret);
  if (!key.length) return null;
  const counter = Math.floor(now / 1000 / period);
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const hash = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }[algo] || 'SHA-1';
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
  const off = sig[sig.length - 1] & 0xf;
  const bin = ((sig[off] & 0x7f) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3];
  return { code: String(bin % 10 ** digits).padStart(digits, '0'), remaining: period - (Math.floor(now / 1000) % period), period };
}
