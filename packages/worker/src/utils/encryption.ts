// Simple AES-GCM encryption for OAuth tokens
// Uses Web Crypto API (available in Cloudflare Workers)

const ALGORITHM = 'AES-GCM'
const KEY_LENGTH = 256

// Derive a crypto key from the encryption key string
async function deriveKey(encryptionKey: string): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(encryptionKey.padEnd(32, '0').slice(0, 32)), // Ensure 32 bytes
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('brain-trust-salt'), // Static salt (in production, use random per-key)
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  )
}

// Encrypt a string value
export async function encrypt(plaintext: string, encryptionKey: string): Promise<string> {
  const key = await deriveKey(encryptionKey)
  const encoder = new TextEncoder()
  const data = encoder.encode(plaintext)

  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    data
  )

  // Combine IV + ciphertext and encode as base64
  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(encrypted), iv.length)

  return btoa(String.fromCharCode(...combined))
}

// Decrypt a string value
export async function decrypt(ciphertext: string, encryptionKey: string): Promise<string> {
  const key = await deriveKey(encryptionKey)

  // Decode from base64
  const combined = new Uint8Array(
    atob(ciphertext).split('').map(c => c.charCodeAt(0))
  )

  // Extract IV and ciphertext
  const iv = combined.slice(0, 12)
  const data = combined.slice(12)

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    data
  )

  const decoder = new TextDecoder()
  return decoder.decode(decrypted)
}
