const SQLInjectionScanner = require('../scripts/sql-injection-scanner');
const fs = require('fs');
const path = require('path');

describe('SQL Injection Scanner', () => {
  let scanner;

  beforeEach(() => {
    scanner = new SQLInjectionScanner();
  });

  describe('isParameterized', () => {
    it('should detect parameterized queries with ? placeholders', () => {
      const line = "knex.raw('SELECT * FROM users WHERE id = ?', [userId])";
      expect(scanner.isParameterized(line)).toBe(true);
    });

    it('should detect parameterized queries with $1 placeholders', () => {
      const line = "knex.raw('SELECT * FROM users WHERE id = $1', [userId])";
      expect(scanner.isParameterized(line)).toBe(true);
    });

    it('should detect parameterized queries with :name placeholders', () => {
      const line = "knex.raw('SELECT * FROM users WHERE id = :id', {id: userId}) ";
      expect(scanner.isParameterized(line)).toBe(true);
    });

    it('should return false for non-parameterized queries', () => {
      const line = "knex.raw(`SELECT * FROM users WHERE id = ${userId}`)";
      expect(scanner.isParameterized(line)).toBe(false);
    });
  });

  describe('isConstantsOnly', () => {
    it('should return true for lines with only constants', () => {
      const line = "knex.raw('DROP TABLE IF EXISTS temp_table')";
      expect(scanner.isConstantsOnly(line)).toBe(true);
    });

    it('should return true for array elements', () => {
      const line = "['where', 'whereRaw', 'whereNotNull']";
      expect(scanner.isConstantsOnly(line)).toBe(true);
    });

    it('should return false for lines with variables', () => {
      const line = "knex.raw(`SELECT * FROM users WHERE id = ${userId}`)";
      expect(scanner.isConstantsOnly(line)).toBe(false);
    });

    it('should return false for lines with req/res objects', () => {
      const line = "knex.raw('SELECT * FROM users WHERE id = ' + req.params.id)";
      expect(scanner.isConstantsOnly(line)).toBe(false);
    });
  });

  describe('hasTemplateStringSQL', () => {
    it('should detect template string SQL with variable interpolation', () => {
      const line = "knex.raw(`SELECT * FROM users WHERE id = ${userId}`)";
      expect(scanner.hasTemplateStringSQL(line)).toBe(true);
    });

    it('should return false for safe template strings with placeholders', () => {
      const line = "knex.raw(`INSERT INTO users VALUES (?, ?, ?)`)";
      expect(scanner.hasTemplateStringSQL(line)).toBe(false);
    });

    it('should return false for comments', () => {
      const line = "// knex.raw(`SELECT * FROM users WHERE id = ${userId}`)";
      expect(scanner.hasTemplateStringSQL(line)).toBe(false);
    });

    it('should return false for non-SQL template strings', () => {
      const line = "const message = `Hello ${name}`";
      expect(scanner.hasTemplateStringSQL(line)).toBe(false);
    });
  });

  describe('hasStringConcatenationSQL', () => {
    it('should detect string concatenation in SQL queries', () => {
      const line = "knex.raw('SELECT * FROM users WHERE id = ' + userId)";
      expect(scanner.hasStringConcatenationSQL(line)).toBe(true);
    });

    it('should return false for error messages', () => {
      const line = "new Error('SQL error: ' + error.message)";
      expect(scanner.hasStringConcatenationSQL(line)).toBe(false);
    });

    it('should return false for non-SQL concatenation', () => {
      const line = "const message = 'Hello ' + name";
      expect(scanner.hasStringConcatenationSQL(line)).toBe(false);
    });
  });

  describe('Integration test', () => {
    it('should scan a file and find safe patterns', () => {
      // Create a test file
      const testFile = path.join(__dirname, 'test-file-safe.js');
      const testContent = `
        const knex = require('knex');
        
        // Safe parameterized query
        knex.raw('SELECT * FROM users WHERE id = ?', [userId]);
        
        // Safe constants only
        knex.raw('DROP TABLE IF EXISTS temp_table');
        
        // Safe Knex builder
        knex('users').where('id', userId);
      `;

      fs.writeFileSync(testFile, testContent);

      scanner.scanFile(testFile);
      const report = scanner.generateReport();

      expect(report.unsafeCount).toBe(0);
      expect(report.safeCount).toBeGreaterThan(0);

      // Clean up
      fs.unlinkSync(testFile);
    });

    it('should scan a file and find unsafe patterns', () => {
      // Create a test file
      const testFile = path.join(__dirname, 'test-file-unsafe.js');
      const testContent = `
        const knex = require('knex');
        
        // Unsafe template string
        knex.raw(\`SELECT * FROM users WHERE id = ${userId}\`);
        
        // Unsafe string concatenation
        knex.raw('SELECT * FROM users WHERE id = ' + userId);
      `;

      fs.writeFileSync(testFile, testContent);

      scanner.scanFile(testFile);
      const report = scanner.generateReport();

      expect(report.unsafeCount).toBeGreaterThan(0);

      // Clean up
      fs.unlinkSync(testFile);
    });
  });
});