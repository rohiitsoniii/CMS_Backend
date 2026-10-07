import * as crypto from 'crypto';

/**
 * Crypto Service — AES-256-GCM Symmetric Encryption
 *
 * Encrypts sensitive values (API keys, tokens) before storing in MongoDB.
 * The ENCRYPTION_KEY must be a 64-character hex string (32 bytes).
 *
 * Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits — recommended for GCM

function getKey(): Buffer {
    const keyHex = process.env.ENCRYPTION_KEY;
    if (!keyHex || keyHex.length !== 64) {
        throw new Error(
            'ENCRYPTION_KEY environment variable must be a 64-character hex string (32 bytes). ' +
            'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
        );
    }
    return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a plaintext string.
 * Returns a Base64-encoded string in the format: iv:authTag:ciphertext
 */
export function encrypt(plaintext: string): string {
    if (!plaintext) return plaintext;

    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv) as crypto.CipherGCM;

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: base64(iv):base64(tag):base64(ciphertext)
    return [
        iv.toString('base64'),
        authTag.toString('base64'),
        encrypted.toString('base64'),
    ].join(':');
}

/**
 * Decrypt an encrypted string produced by `encrypt()`.
 */
export function decrypt(encryptedString: string): string {
    if (!encryptedString || !encryptedString.includes(':')) {
        // Return as-is if it doesn't look like an encrypted value (backwards compat)
        return encryptedString;
    }

    const key = getKey();
    const [ivB64, tagB64, ciphertextB64] = encryptedString.split(':');

    if (!ivB64 || !tagB64 || !ciphertextB64) {
        throw new Error('Invalid encrypted string format');
    }

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv) as crypto.DecipherGCM;
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
}

/**
 * Check if a string is already encrypted (has the iv:tag:cipher format).
 */
export function isEncrypted(value: string): boolean {
    if (!value) return false;
    const parts = value.split(':');
    return parts.length === 3 && parts.every(p => p.length > 0);
}
