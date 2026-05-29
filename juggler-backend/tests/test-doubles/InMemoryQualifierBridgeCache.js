/**
 * In-memory qualifier bridge cache test double.
 *
 * Simple Map-based cache for qualifier bridge data. Provides key-value storage
 * with optional TTL support for testing cache behavior without Redis or external
 * caching services.
 *
 * This establishes the pattern for qualifier concepts in juggler, even though
 * juggler does not currently have a qualifier-bridge service. Future features
 * may need similar cache patterns for keyword/metadata bridging.
 *
 * Method signatures mirror a typical cache interface:
 *   - get(key) → cached value or null
 *   - set(key, value, ttlMs) → void
 *   - delete(key) → boolean (true if deleted)
 *   - clear() → void
 *   - has(key) → boolean
 */

class InMemoryQualifierBridgeCache {
  constructor() {
    // Primary storage: key → { value, expiresAt }
    this._store = new Map();
    // Default TTL in milliseconds (5 minutes)
    this._defaultTtlMs = 5 * 60 * 1000;
  }

  /**
   * Check if an entry has expired.
   * @param {object} entry - Cache entry with expiresAt
   * @returns {boolean}
   * @private
   */
  _isExpired(entry) {
    if (!entry || !entry.expiresAt) return false;
    return Date.now() > entry.expiresAt;
  }

  /**
   * Clean up expired entries (lazy eviction on access).
   * @param {string} key
   * @private
   */
  _evictIfExpired(key) {
    const entry = this._store.get(key);
    if (entry && this._isExpired(entry)) {
      this._store.delete(key);
    }
  }

  /**
   * Get a cached value by key.
   *
   * @param {string} key - Cache key
   * @returns {*} Cached value or null if not found/expired
   */
  get(key) {
    this._evictIfExpired(key);
    const entry = this._store.get(key);
    if (!entry || this._isExpired(entry)) {
      return null;
    }
    // Return a deep copy to prevent mutation of cached values
    return JSON.parse(JSON.stringify(entry.value));
  }

  /**
   * Set a value in the cache.
   *
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} [ttlMs] - Time-to-live in milliseconds (uses default if omitted)
   */
  set(key, value, ttlMs) {
    const ttl = ttlMs ?? this._defaultTtlMs;
    const entry = {
      value: JSON.parse(JSON.stringify(value)), // Store a copy
      expiresAt: Date.now() + ttl,
      createdAt: Date.now(),
    };
    this._store.set(key, entry);
  }

  /**
   * Delete a cached value.
   *
   * @param {string} key - Cache key
   * @returns {boolean} True if the key was deleted, false if it didn't exist
   */
  delete(key) {
    return this._store.delete(key);
  }

  /**
   * Check if a key exists in the cache (and hasn't expired).
   *
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    this._evictIfExpired(key);
    const entry = this._store.get(key);
    return entry && !this._isExpired(entry);
  }

  /**
   * Clear all cached data.
   */
  clear() {
    this._store.clear();
  }

  /**
   * Get total count of cached entries (including potentially expired ones).
   * @returns {number}
   */
  get size() {
    return this._store.size;
  }

  /**
   * Set the default TTL for this cache instance.
   *
   * @param {number} ttlMs - Default time-to-live in milliseconds
   */
  setDefaultTtl(ttlMs) {
    if (typeof ttlMs === 'number' && ttlMs > 0) {
      this._defaultTtlMs = ttlMs;
    }
  }

  /**
   * Get all keys in the cache (for testing/debugging).
   *
   * @returns {string[]} Array of cache keys
   */
  keys() {
    const validKeys = [];
    for (const [key, entry] of this._store.entries()) {
      if (!this._isExpired(entry)) {
        validKeys.push(key);
      }
    }
    return validKeys;
  }

  /**
   * Force eviction of all expired entries.
   * Useful for testing TTL behavior.
   */
  evictExpired() {
    for (const [key, entry] of this._store.entries()) {
      if (this._isExpired(entry)) {
        this._store.delete(key);
      }
    }
  }

  /**
   * Get cache statistics (for testing/debugging).
   *
   * @returns {object} Stats object with size, expiredCount, and keys
   */
  stats() {
    let expiredCount = 0;
    for (const entry of this._store.values()) {
      if (this._isExpired(entry)) {
        expiredCount++;
      }
    }
    return {
      size: this._store.size,
      validCount: this._store.size - expiredCount,
      expiredCount,
      keys: this.keys(),
    };
  }
}

module.exports = InMemoryQualifierBridgeCache;