/**
 * Shared deduplication for Telegram transport.
 * Prevents the same .nohack message from being forwarded twice.
 */
const forwarded = new Set();
function markForwarded(id) { forwarded.add(id); setTimeout(() => forwarded.delete(id), 60000); }
function wasForwarded(id) { return forwarded.has(id); }

module.exports = { markForwarded, wasForwarded };
