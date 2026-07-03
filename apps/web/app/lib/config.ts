/**
 * Application configuration constants
 * Uses NEXT_PUBLIC_API_URL env var in production, falls back to localhost for development
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
export const WS_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
