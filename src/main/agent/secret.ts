import { randomBytes } from 'node:crypto'

/** 32 random bytes, in memory only. Never persisted, logged or sent to the renderer. */
export const APPROVAL_SECRET = randomBytes(32).toString('base64url')
