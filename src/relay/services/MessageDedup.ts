/**
 * Shared deduplication between clipboard and Telegram transports.
 * Prevents the same .nohack message from being forwarded to NoHack twice.
 */

const forwarded = new Set<string>();

export function markForwarded(id: string): void {
  forwarded.add(id);
  setTimeout(() => forwarded.delete(id), 60000);
}

export function wasForwarded(id: string): boolean {
  return forwarded.has(id);
}
