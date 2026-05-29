/**
 * In-memory user repository test double.
 *
 * Implements the user repository port for unit testing without a real database.
 * Uses a Map for O(1) lookups by ID, with a secondary index for email queries.
 *
 * Method signatures match the production Knex-based repository:
 *   - findById(id) → user or null
 *   - findByEmail(email) → user or null
 *   - create(user) → created user with generated id
 *   - update(id, user) → updated user or null
 *   - delete(id) → deleted user or null
 *   - findAll() → array of all users
 */

class InMemoryUserRepository {
  constructor() {
    // Primary storage: id → user
    this._store = new Map();
    // Secondary index: email → userId (unique)
    this._byEmail = new Map();
    // Auto-increment counter for ID generation
    this._idCounter = 0;
  }

  /**
   * Generate a unique user ID.
   * @returns {string}
   * @private
   */
  _generateId() {
    this._idCounter++;
    return `user-${this._idCounter}`;
  }

  /**
   * Deep clone a user to prevent external mutation.
   * @param {object} user
   * @returns {object}
   * @private
   */
  _clone(user) {
    if (!user) return null;
    return JSON.parse(JSON.stringify(user));
  }

  /**
   * Find a user by ID.
   *
   * @param {string} id - User ID
   * @returns {object|null} User object or null if not found
   */
  findById(id) {
    const user = this._store.get(id);
    return this._clone(user);
  }

  /**
   * Find a user by email address.
   *
   * @param {string} email - Email address (case-insensitive lookup)
   * @returns {object|null} User object or null if not found
   */
  findByEmail(email) {
    if (!email) return null;
    const normalizedEmail = email.toLowerCase();
    const userId = this._byEmail.get(normalizedEmail);
    if (!userId) return null;
    return this.findById(userId);
  }

  /**
   * Find all users by a specific user ID (returns single user in array for consistency).
   *
   * Note: In a real multi-tenant system, this would return all users for a tenant.
   * For testing purposes, this returns the user if found.
   *
   * @param {string} userId - User ID
   * @returns {object[]} Array containing the user, or empty array
   */
  findByUserId(userId) {
    const user = this.findById(userId);
    return user ? [user] : [];
  }

  /**
   * Create a new user.
   *
   * @param {object} user - User data (email required)
   * @returns {object} Created user with generated id
   * @throws {Error} If email is already in use
   */
  create(user) {
    if (!user.email) {
      throw new Error('Email is required');
    }

    const id = user.id || this._generateId();
    const normalizedEmail = user.email.toLowerCase();
    const now = new Date().toISOString();

    // Check for duplicate email
    if (this._byEmail.has(normalizedEmail)) {
      throw new Error(`User with email "${user.email}" already exists`);
    }

    const newUser = {
      id,
      email: user.email,
      name: user.name || null,
      timezone: user.timezone || 'America/New_York',
      created_at: user.created_at || now,
      updated_at: now,
    };

    // Store the user
    this._store.set(id, newUser);

    // Update email index
    this._byEmail.set(normalizedEmail, id);

    return this._clone(newUser);
  }

  /**
   * Update an existing user.
   *
   * @param {string} id - User ID
   * @param {object} updates - Partial user data to merge
   * @returns {object|null} Updated user or null if not found
   * @throws {Error} If email update conflicts with existing user
   */
  update(id, updates) {
    const existing = this._store.get(id);
    if (!existing) {
      return null;
    }

    // Handle email change
    if (updates.email && updates.email.toLowerCase() !== existing.email.toLowerCase()) {
      const normalizedNewEmail = updates.email.toLowerCase();
      const existingUserId = this._byEmail.get(normalizedNewEmail);
      if (existingUserId && existingUserId !== id) {
        throw new Error(`Email "${updates.email}" is already in use by another user`);
      }
      // Remove old email from index
      this._byEmail.delete(existing.email.toLowerCase());
      // Add new email to index
      this._byEmail.set(normalizedNewEmail, id);
    }

    const updated = {
      ...existing,
      ...updates,
      id, // preserve original id
      updated_at: new Date().toISOString(),
    };

    this._store.set(id, updated);
    return this._clone(updated);
  }

  /**
   * Delete a user.
   *
   * @param {string} id - User ID
   * @returns {object|null} Deleted user or null if not found
   */
  delete(id) {
    const user = this._store.get(id);
    if (!user) {
      return null;
    }

    // Remove from store
    this._store.delete(id);

    // Remove from email index
    this._byEmail.delete(user.email.toLowerCase());

    return this._clone(user);
  }

  /**
   * Find all users.
   *
   * @returns {object[]} Array of all users
   */
  findAll() {
    const users = [];
    for (const user of this._store.values()) {
      users.push(this._clone(user));
    }
    return users;
  }

  /**
   * Clear all stored data (useful between tests).
   */
  clear() {
    this._store.clear();
    this._byEmail.clear();
    this._idCounter = 0;
  }

  /**
   * Get total count of stored users.
   * @returns {number}
   */
  get size() {
    return this._store.size;
  }
}

module.exports = InMemoryUserRepository;