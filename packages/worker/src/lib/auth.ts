import { SignJWT, jwtVerify } from 'jose'
import type { JWTPayload, User } from '../types'

// Hash password using PBKDF2
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  )
  const hashArray = new Uint8Array(hash)
  const combined = new Uint8Array(salt.length + hashArray.length)
  combined.set(salt)
  combined.set(hashArray, salt.length)
  return btoa(String.fromCharCode(...combined))
}

// Verify password
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const encoder = new TextEncoder()
  const combined = Uint8Array.from(atob(storedHash), (c) => c.charCodeAt(0))
  const salt = combined.slice(0, 16)
  const storedHashBytes = combined.slice(16)

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  )
  const hashArray = new Uint8Array(hash)

  if (hashArray.length !== storedHashBytes.length) return false
  for (let i = 0; i < hashArray.length; i++) {
    if (hashArray[i] !== storedHashBytes[i]) return false
  }
  return true
}

// Generate JWT
export async function generateToken(
  user: User,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder()
  const secretKey = encoder.encode(secret)

  return new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey)
}

// Verify JWT
export async function verifyToken(
  token: string,
  secret: string
): Promise<JWTPayload | null> {
  try {
    const encoder = new TextEncoder()
    const secretKey = encoder.encode(secret)
    const { payload } = await jwtVerify(token, secretKey)
    return payload as unknown as JWTPayload
  } catch {
    return null
  }
}

// Simple encryption for API keys (XOR with secret - in production use proper encryption)
export function encryptApiKey(key: string, secret: string): string {
  const keyBytes = new TextEncoder().encode(key)
  const secretBytes = new TextEncoder().encode(secret)
  const encrypted = new Uint8Array(keyBytes.length)
  for (let i = 0; i < keyBytes.length; i++) {
    encrypted[i] = keyBytes[i] ^ secretBytes[i % secretBytes.length]
  }
  return btoa(String.fromCharCode(...encrypted))
}

export function decryptApiKey(encrypted: string, secret: string): string {
  const encryptedBytes = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0))
  const secretBytes = new TextEncoder().encode(secret)
  const decrypted = new Uint8Array(encryptedBytes.length)
  for (let i = 0; i < encryptedBytes.length; i++) {
    decrypted[i] = encryptedBytes[i] ^ secretBytes[i % secretBytes.length]
  }
  return new TextDecoder().decode(decrypted)
}
