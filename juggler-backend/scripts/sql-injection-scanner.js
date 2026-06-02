#!/usr/bin/env node
/**
 * SQL Injection Scanner for Juggler Backend
 * 
 * Scans JavaScript files for potential SQL injection vulnerabilities
 * by detecting unsafe SQL patterns and validating parameterized queries.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const CONFIG = {
  scanPatterns: [
    './src/**/*.js',
    './tests/**/*.js',
    './scripts/**/*.js'
  ],
  excludePatterns: [
    'node_modules',
    'coverage',
    'migrations'
  ],
  dangerousFunctions: [
    'knex.raw',
    'knex.client.raw',
    'queryBuilder.raw',
    'whereRaw',
    'havingRaw',
    'orderByRaw',
    'joinRaw',
    'groupByRaw'
  ],
  safePatterns: [
    /\.raw\([^)]*\?[^)]*\)/,
    /\.raw\([^)]*\$\d+[^)]*\)/,
    /\.raw\([^)]*\:\w+[^)]*\)/,
    /\.whereRaw\([^)]*\?[^)]*\)/,
    /\.havingRaw\([^)]*\?[^)]*\)/,
    /\.orderByRaw\([^)]*\?[^)]*\)/,
    /\.joinRaw\([^)]*\?[^)]*\)/,
    /\.groupByRaw\([^)]*\?[^)]*\)/
  ]
};

class SQLInjectionScanner {
  constructor() {
    this.findings = [];
    this.stats = {
      filesScanned: 0,
      totalLines: 0,
      rawCalls: 0,
      parameterizedCalls: 0,
      unsafeCalls: 0,
      safeCalls: 0
    };
  }

  /**
   * Scan a single file for SQL injection vulnerabilities
   */
  scanFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      this.stats.filesScanned++;
      this.stats.totalLines += lines.length;
      
      let lineNumber = 0;
      for (const line of lines) {
        lineNumber++;
        this.checkLine(line, lineNumber, filePath);
      }
    } catch (error) {
      console.error(`Error reading ${filePath}: ${error.message}`);
    }
  }

  /**
   * Check a single line for dangerous SQL patterns
   */
  checkLine(line, lineNumber, filePath) {
    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) {
      return;
    }

    // Check for dangerous function calls
    for (const func of CONFIG.dangerousFunctions) {
      if (line.includes(func)) {
        this.stats.rawCalls++;
        
        // Check if it's parameterized (safe)
        if (this.isParameterized(line)) {
          this.stats.parameterizedCalls++;
          this.stats.safeCalls++;
          this.addFinding('SAFE', filePath, lineNumber, line.trim(), 'Parameterized query');
        } else {
          // Check if it's using constants only (also safe)
          if (this.isConstantsOnly(line)) {
            this.stats.safeCalls++;
            this.addFinding('SAFE', filePath, lineNumber, line.trim(), 'Constants only');
          } else {
            this.stats.unsafeCalls++;
            this.addFinding('UNSAFE', filePath, lineNumber, line.trim(), 'Potential SQL injection');
          }
        }
      }
    }

    // Check for template string SQL injection patterns
    if (this.hasTemplateStringSQL(line)) {
      this.stats.unsafeCalls++;
      this.addFinding('UNSAFE', filePath, lineNumber, line.trim(), 'Template string SQL injection');
    }

    // Check for string concatenation near SQL
    if (this.hasStringConcatenationSQL(line)) {
      this.stats.unsafeCalls++;
      this.addFinding('UNSAFE', filePath, lineNumber, line.trim(), 'String concatenation SQL injection');
    }
  }

  /**
   * Check if a line uses parameterized queries
   */
  isParameterized(line) {
    for (const pattern of CONFIG.safePatterns) {
      if (pattern.test(line)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a line uses only constants (no variables)
   */
  isConstantsOnly(line) {
    // Skip lines that are just array elements or comments
    if (line.trim().startsWith('[') || line.trim().startsWith(']') || 
        line.trim().startsWith('//') || line.trim().startsWith('/*') || 
        line.trim().startsWith('*') || line.trim().startsWith('"') || 
        line.trim().startsWith("'")) {
      return true;
    }

    // Look for variable patterns
    const variablePatterns = [
      /\$\w+/,
      /req\./,
      /res\./,
      /params\./,
      /body\./,
      /query\./,
      /userInput/,
      /input\./,
      /data\./,
      /config\./
    ];

    for (const pattern of variablePatterns) {
      if (pattern.test(line)) {
        return false;
      }
    }

    // Look for template literals with variables
    if (line.includes('${') || (line.includes('`') && line.includes('SELECT'))) {
      return false;
    }

    return true;
  }

  /**
   * Check for template string SQL injection patterns
   */
  hasTemplateStringSQL(line) {
    const sqlKeywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WHERE', 'FROM', 'JOIN', 'SET'];
    
    if (!line.includes('`') || !sqlKeywords.some(keyword => line.includes(keyword))) {
      return false;
    }
    
    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) {
      return false;
    }
    
    // If it contains parameter placeholders (?), it's likely safe
    if (line.includes('?')) {
      return false;
    }
    
    // Check if it's a multi-line template (more likely to be safe)
    if (line.includes('`') && !line.includes('${')) {
      return false;
    }
    
    // Only flag if it has variable interpolation
    return line.includes('${');
  }

  /**
   * Check for string concatenation SQL patterns
   */
  hasStringConcatenationSQL(line) {
    const sqlKeywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WHERE', 'FROM', 'JOIN', 'SET'];
    const concatenationPatterns = ['+', '.concat(', 'String.concat('];
    
    if (!sqlKeywords.some(keyword => line.includes(keyword))) {
      return false;
    }
    
    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) {
      return false;
    }
    
    // Skip error messages and non-SQL concatenation
    if (line.includes('Error(') || line.includes('new Error')) {
      return false;
    }
    
    // Only flag if it's actual SQL concatenation (not just string building for other purposes)
    return concatenationPatterns.some(pattern => line.includes(pattern)) &&
           (line.includes('knex.raw') || line.includes('.raw('));
  }

  /**
   * Add a finding to the results
   */
  addFinding(severity, filePath, lineNumber, lineContent, description) {
    this.findings.push({
      severity,
      filePath,
      lineNumber,
      lineContent,
      description
    });
  }

  /**
   * Generate report
   */
  generateReport() {
    console.log('='.repeat(80));
    console.log('SQL INJECTION SCAN REPORT');
    console.log('='.repeat(80));
    console.log(`Generated: ${new Date().toISOString()}`);
    console.log(`Project: juggler-backend`);
    console.log();
    console.log('Statistics:');
    console.log(`  Files scanned: ${this.stats.filesScanned}`);
    console.log(`  Total lines: ${this.stats.totalLines}`);
    console.log(`  Raw SQL calls: ${this.stats.rawCalls}`);
    console.log(`  Parameterized calls: ${this.stats.parameterizedCalls}`);
    console.log(`  Safe calls: ${this.stats.safeCalls}`);
    console.log(`  Unsafe calls: ${this.stats.unsafeCalls}`);
    console.log();

    // Group findings by severity
    const safeFindings = this.findings.filter(f => f.severity === 'SAFE');
    const unsafeFindings = this.findings.filter(f => f.severity === 'UNSAFE');

    console.log('Findings Summary:');
    console.log(`  SAFE: ${safeFindings.length}`);
    console.log(`  UNSAFE: ${unsafeFindings.length}`);
    console.log();

    if (unsafeFindings.length > 0) {
      console.log('❌ UNSAFE FINDINGS (require attention):');
      console.log('-'.repeat(80));
      for (const finding of unsafeFindings) {
        console.log(`File: ${finding.filePath}:${finding.lineNumber}`);
        console.log(`Code: ${finding.lineContent}`);
        console.log(`Issue: ${finding.description}`);
        console.log();
      }
    }

    if (safeFindings.length > 0) {
      console.log('✅ SAFE FINDINGS (parameterized or constants):');
      console.log('-'.repeat(80));
      for (const finding of safeFindings) {
        console.log(`File: ${finding.filePath}:${finding.lineNumber}`);
        console.log(`Code: ${finding.lineContent}`);
        console.log(`Status: ${finding.description}`);
        console.log();
      }
    }

    console.log('='.repeat(80));
    
    if (unsafeFindings.length === 0) {
      console.log('🎉 No SQL injection vulnerabilities found!');
    } else {
      console.log(`⚠️  Found ${unsafeFindings.length} potential SQL injection vulnerabilities`);
    }
    console.log('='.repeat(80));

    return {
      stats: this.stats,
      findings: this.findings,
      safeCount: safeFindings.length,
      unsafeCount: unsafeFindings.length
    };
  }

  /**
   * Find all files matching patterns
   */
  findFiles() {
    const files = [];
    
    for (const pattern of CONFIG.scanPatterns) {
      try {
        // Use a simpler approach - list all JS files and filter
        const result = execSync(`find . -name "*.js" ${CONFIG.excludePatterns.map(p => `-not -path "*/${p}/*"`).join(' ')}`, {
          cwd: process.cwd(),
          encoding: 'utf8'
        });
        
        const allFiles = result.trim().split('\n').filter(f => f && fs.existsSync(f) && fs.statSync(f).isFile());
        
        // Filter by our patterns
        for (const file of allFiles) {
          if (this.matchesPattern(file)) {
            files.push(file);
          }
        }
      } catch (error) {
        console.error(`Error finding files: ${error.message}`);
      }
    }

    return files;
  }

  /**
   * Check if file matches any of our scan patterns
   */
  matchesPattern(filePath) {
    for (const pattern of CONFIG.scanPatterns) {
      // Convert pattern to regex
      const regexPattern = pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
      const regex = new RegExp(`^${regexPattern}$`);
      if (regex.test(filePath)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Run the scan
   */
  async run() {
    console.log('Starting SQL injection scan...');
    
    const files = this.findFiles();
    console.log(`Found ${files.length} files to scan...`);

    for (const file of files) {
      this.scanFile(file);
    }

    return this.generateReport();
  }
}

// Run the scanner if executed directly
if (require.main === module) {
  const scanner = new SQLInjectionScanner();
  scanner.run().then(report => {
    process.exit(report.unsafeCount > 0 ? 1 : 0);
  });
}

module.exports = SQLInjectionScanner;