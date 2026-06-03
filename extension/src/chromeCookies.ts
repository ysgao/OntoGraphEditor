import { exec } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execAsync = promisify(exec);

export interface ChromeCookie {
  name: string;
  value: string;
  host: string;
}

/**
 * Reads cookies from Chrome's macOS profile for hosts matching the given filter,
 * decrypting them with the Keychain-stored "Chrome Safe Storage" password.
 *
 * Mechanics:
 *   - Cookies SQLite at ~/Library/Application Support/Google/Chrome/Default/Cookies
 *   - encrypted_value column starts with "v10" or "v11" prefix
 *   - AES-128-CBC, PBKDF2(password, salt="saltysalt", iter=1003, len=16)
 *   - IV = 16 bytes of 0x20
 *
 * The Cookies DB is copied to /tmp first to avoid contention if Chrome is running.
 */
export async function readChromeCookiesForHost(hostFilter: string): Promise<ChromeCookie[]> {
  if (process.platform !== 'darwin') {
    throw new Error('Auto cookie import currently supports macOS only');
  }

  const candidateProfiles = [
    'Default',
    'Profile 1',
    'Profile 2',
    'Profile 3',
  ];

  const chromeRoot = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
  let cookiesPath: string | null = null;
  for (const profile of candidateProfiles) {
    const candidate = path.join(chromeRoot, profile, 'Cookies');
    if (fs.existsSync(candidate)) {
      cookiesPath = candidate;
      break;
    }
  }
  if (!cookiesPath) {
    throw new Error(`Chrome Cookies DB not found under ${chromeRoot}/{Default,Profile *}`);
  }
  console.log('[OntoGraph] Chrome cookies path:', cookiesPath);

  const tmpPath = path.join(os.tmpdir(), `ontograph-chrome-cookies-${Date.now()}.db`);
  fs.copyFileSync(cookiesPath, tmpPath);

  try {
    // Keychain: service "Chrome Safe Storage", account "Chrome"
    let password: string;
    try {
      const { stdout } = await execAsync(
        'security find-generic-password -w -s "Chrome Safe Storage" -a "Chrome"'
      );
      password = stdout.trim();
    } catch (e) {
      throw new Error('Could not read Chrome Safe Storage from Keychain. macOS may have prompted you to allow access — retry. Underlying error: ' + (e instanceof Error ? e.message : String(e)));
    }

    const key = crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
    const iv = Buffer.alloc(16, 0x20);

    const safeFilter = hostFilter.replace(/'/g, "''");
    const query = `SELECT name, host_key, hex(encrypted_value) FROM cookies WHERE host_key LIKE '%${safeFilter}%';`;
    const { stdout } = await execAsync(`sqlite3 -separator '|' "${tmpPath}" "${query}"`);

    const cookies: ChromeCookie[] = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('|');
      if (parts.length < 3) continue;
      const [name, host, hexValue] = parts;
      if (!hexValue) continue;

      const encrypted = Buffer.from(hexValue, 'hex');
      if (encrypted.length < 4) continue;
      const prefix = encrypted.slice(0, 3).toString('utf8');
      if (prefix !== 'v10' && prefix !== 'v11') {
        console.warn('[OntoGraph] Unknown cookie prefix for', name, '@', host, '— hex prefix:', encrypted.slice(0, 8).toString('hex'));
        continue;
      }

      const ciphertext = encrypted.slice(3);
      try {
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        const decryptedRaw = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

        // Chrome on macOS may prepend a 32-byte SHA256 of the domain since Chrome 89.
        // Detect by trying both: strip 32 bytes if the rest looks printable, else use raw.
        const tryStripped = decryptedRaw.length > 32 ? decryptedRaw.slice(32) : null;
        const isPrintable = (b: Buffer) => {
          for (let i = 0; i < b.length; i++) {
            const c = b[i];
            if (c < 0x20 || c >= 0x7f) return false;
          }
          return true;
        };
        let plain: Buffer = decryptedRaw;
        if (tryStripped && isPrintable(tryStripped) && !isPrintable(decryptedRaw)) {
          plain = tryStripped;
        }

        const value = plain.toString('utf8');
        const valuePrintable = isPrintable(plain);
        console.log(
          `[OntoGraph] decrypt ok name=${name}@${host} cipher.len=${ciphertext.length} ` +
          `plain.len=${plain.length} printable=${valuePrintable} preview="${value.slice(0, 20).replace(/[\x00-\x1f\x7f-\xff]/g, '?')}…"`
        );
        if (!valuePrintable) {
          console.warn(`[OntoGraph] skipping ${name}: decrypted bytes not printable. First 16 hex: ${plain.slice(0, 16).toString('hex')}`);
          continue;
        }
        cookies.push({ name, host, value });
      } catch (e) {
        console.warn('[OntoGraph] Decrypt failed for', name, '@', host, ':', (e as Error).message);
      }
    }

    console.log(`[OntoGraph] Read ${cookies.length} cookie(s) for host filter "${hostFilter}"`);
    return cookies;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

/**
 * Composes a Cookie header string ("name=value; name=value; ...") from a list of cookies,
 * deduplicating by name (last one wins) and skipping empty values.
 */
export function cookiesToHeader(cookies: ChromeCookie[]): string {
  const map = new Map<string, string>();
  for (const c of cookies) {
    if (c.value) { map.set(c.name, c.value); }
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
