/**
 * In-memory qualifier bridge repository test double.
 *
 * Implements the qualifier bridge repository port for unit testing without external services.
 * Uses a Map for O(1) lookups by ID, with secondary indexes for user_id and bridge_type queries.
 *
 * This establishes the pattern for qualifier concepts in juggler, even though juggler
 * does not currently have a qualifier-bridge service. Future features may need similar
 * keyword/metadata bridging concepts.
 *
 * Method signatures mirror the expected production repository interface:
 *   - findById(id, userId) → bridge or null
 *   - findByUserId(userId) → array of bridges
 *   - findByType(userId, bridgeType) → array of bridges of that type
 *   - create(bridge) → created bridge with generated id
 *   - update(id, bridge, userId) → updated bridge or null
 *   - delete(id, userId) → deleted bridge or null
 */

class InMemoryQualifierBridgeRepository {
  constructor() {
    // Primary storage: id → bridge
    this._store = new Map();
    // Secondary index: userId → Set of bridge ids
    this._byUser = new Map();
    // Secondary index: (userId, bridgeType) → Set of bridge ids
    this._byUserAndType = new Map();
    // Auto-increment counter for ID generation
    this._idCounter = 0;
  }

  /**
   * Generate a unique bridge ID.
   * @returns {string}
   * @private
   */
  _generateId() {
    this._idCounter++;
    return `qualifier-bridge-${this._idCounter}`;
  }

  /**
   * Build a secondary index key for user + type lookups.
   * @param {string} userId
   * @param {string} bridgeType
   * @returns {string}
   * @private
   */
  _buildTypeKey(userId, bridgeType) {
    return `${userId}::${bridgeType}`;
  }

  /**
   * Deep clone a bridge to prevent external mutation.
   * @param {object} bridge
   * @returns {object}
   * @private
   */
  _clone(bridge) {
    if (!bridge) return null;
    return JSON.parse(JSON.stringify(bridge));
  }

  /**
   * Find a bridge by ID for a specific user.
   *
   * @param {string} id - Bridge ID
   * @param {string} userId - User ID (ensures user-scoped access)
   * @returns {object|null} Bridge object or null if not found
   */
  findById(id, userId) {
    const bridge = this._store.get(id);
    if (!bridge || bridge.user_id !== userId) {
      return null;
    }
    return this._clone(bridge);
  }

  /**
   * Find all bridges for a specific user.
   *
   * @param {string} userId - User ID
   * @returns {object[]} Array of bridges (may be empty)
   */
  findByUserId(userId) {
    const bridgeIds = this._byUser.get(userId);
    if (!bridgeIds || bridgeIds.size === 0) {
      return [];
    }
    const bridges = [];
    for (const id of bridgeIds) {
      const bridge = this._store.get(id);
      if (bridge) {
        bridges.push(this._clone(bridge));
      }
    }
    return bridges;
  }

  /**
   * Find all bridges of a specific type for a user.
   *
   * @param {string} userId - User ID
   * @param {string} bridgeType - Bridge type (e.g., 'keyword', 'skill', 'technology')
   * @returns {object[]} Array of matching bridges (may be empty)
   */
  findByType(userId, bridgeType) {
    const typeKey = this._buildTypeKey(userId, bridgeType);
    const bridgeIds = this._byUserAndType.get(typeKey);
    if (!bridgeIds || bridgeIds.size === 0) {
      return [];
    }
    const bridges = [];
    for (const id of bridgeIds) {
      const bridge = this._store.get(id);
      if (bridge) {
        bridges.push(this._clone(bridge));
      }
    }
    return bridges;
  }

  /**
   * Create a new bridge.
   *
   * @param {object} bridge - Bridge data (user_id and bridge_type required)
   * @returns {object} Created bridge with generated id
   */
  create(bridge) {
    const id = bridge.id || this._generateId();
    const now = new Date().toISOString();
    
    const newBridge = {
      id,
      user_id: bridge.user_id,
      bridge_type: bridge.bridge_type || 'keyword',
      source_id: bridge.source_id || null,
      target_id: bridge.target_id || null,
      source_value: bridge.source_value || null,
      target_value: bridge.target_value || null,
      confidence: bridge.confidence ?? 1.0,
      metadata: bridge.metadata || {},
      created_at: bridge.created_at || now,
      updated_at: now,
    };

    // Store the bridge
    this._store.set(id, newBridge);

    // Update user index
    const userId = newBridge.user_id;
    if (!this._byUser.has(userId)) {
      this._byUser.set(userId, new Set());
    }
    this._byUser.get(userId).add(id);

    // Update type index
    const typeKey = this._buildTypeKey(userId, newBridge.bridge_type);
    if (!this._byUserAndType.has(typeKey)) {
      this._byUserAndType.set(typeKey, new Set());
    }
    this._byUserAndType.get(typeKey).add(id);

    return this._clone(newBridge);
  }

  /**
   * Update an existing bridge.
   *
   * @param {string} id - Bridge ID
   * @param {object} updates - Partial bridge data to merge
   * @param {string} userId - User ID (ensures user-scoped access)
   * @returns {object|null} Updated bridge or null if not found
   */
  update(id, updates, userId) {
    const existing = this._store.get(id);
    if (!existing || existing.user_id !== userId) {
      return null;
    }

    // Handle bridge_type change (update type index)
    if (updates.bridge_type && updates.bridge_type !== existing.bridge_type) {
      // Remove from old type index
      const oldTypeKey = this._buildTypeKey(userId, existing.bridge_type);
      const oldTypeSet = this._byUserAndType.get(oldTypeKey);
      if (oldTypeSet) {
        oldTypeSet.delete(id);
        if (oldTypeSet.size === 0) {
          this._byUserAndType.delete(oldTypeKey);
        }
      }
      // Add to new type index
      const newTypeKey = this._buildTypeKey(userId, updates.bridge_type);
      if (!this._byUserAndType.has(newTypeKey)) {
        this._byUserAndType.set(newTypeKey, new Set());
      }
      this._byUserAndType.get(newTypeKey).add(id);
    }

    const updated = {
      ...existing,
      ...updates,
      id, // preserve original id
      user_id: existing.user_id, // preserve original user_id
      updated_at: new Date().toISOString(),
    };

    this._store.set(id, updated);
    return this._clone(updated);
  }

  /**
   * Delete a bridge.
   *
   * @param {string} id - Bridge ID
   * @param {string} userId - User ID (ensures user-scoped access)
   * @returns {object|null} Deleted bridge or null if not found
   */
  delete(id, userId) {
    const bridge = this._store.get(id);
    if (!bridge || bridge.user_id !== userId) {
      return null;
    }

    // Remove from store
    this._store.delete(id);

    // Remove from user index
    const userBridges = this._byUser.get(userId);
    if (userBridges) {
      userBridges.delete(id);
      if (userBridges.size === 0) {
        this._byUser.delete(userId);
      }
    }

    // Remove from type index
    const typeKey = this._buildTypeKey(userId, bridge.bridge_type);
    const typeBridges = this._byUserAndType.get(typeKey);
    if (typeBridges) {
      typeBridges.delete(id);
      if (typeBridges.size === 0) {
        this._byUserAndType.delete(typeKey);
      }
    }

    return this._clone(bridge);
  }

  /**
   * Clear all stored data (useful between tests).
   */
  clear() {
    this._store.clear();
    this._byUser.clear();
    this._byUserAndType.clear();
    this._idCounter = 0;
  }

  /**
   * Get total count of stored bridges.
   * @returns {number}
   */
  get size() {
    return this._store.size;
  }
}

module.exports = InMemoryQualifierBridgeRepository;