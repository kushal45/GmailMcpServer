#!/usr/bin/env node

/**
 * Test script to verify database migration from old schema to new schema with analyzer results
 */

import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { DatabaseManager } from '../build/database/DatabaseManager.js';
import { logger } from '../build/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../');
const storagePath = path.join(projectRoot, process.env.STORAGE_PATH || 'data');
const dbPath = path.join(storagePath, 'gmail-mcp.db');

async function createOldDatabase() {
  logger.info('Creating old database schema without analyzer columns...');
  
  // Ensure storage directory exists
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);
      
      // Create old schema without analyzer columns
      const oldSchema = `
        CREATE TABLE IF NOT EXISTS email_index (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          category TEXT CHECK(category IN ('high', 'medium', 'low')),
          subject TEXT,
          sender TEXT,
          recipients TEXT,
          date INTEGER,
          year INTEGER,
          size INTEGER,
          has_attachments INTEGER,
          labels TEXT,
          snippet TEXT,
          archived INTEGER DEFAULT 0,
          archive_date INTEGER,
          archive_location TEXT,
          created_at INTEGER DEFAULT (strftime('%s', 'now')),
          updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `;
      
      db.run(oldSchema, (err) => {
        if (err) return reject(err);
        
        // Insert some test data
        const insertSql = `
          INSERT INTO email_index (
            id, thread_id, category, subject, sender, recipients,
            date, year, size, has_attachments, labels, snippet
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const testData = [
          'old-email-1', 'thread-1', 'high', 'Old Email 1', 'sender1@example.com',
          JSON.stringify(['recipient1@example.com']), Date.now(), 2024, 1024, 0,
          JSON.stringify(['INBOX']), 'This is an old email'
        ];
        
        db.run(insertSql, testData, (err) => {
          if (err) return reject(err);
          
          db.close((err) => {
            if (err) return reject(err);
            resolve();
          });
        });
      });
    });
  });
}

async function testMigration() {
  try {
    logger.info('Testing database migration functionality...');
    
    // Step 1: Create old database
    await createOldDatabase();
    logger.info('✅ Old database created successfully');
    
    // Step 2: Initialize DatabaseManager (this should trigger migration)
    const dbManager = DatabaseManager.getInstance();
    await dbManager.initialize();
    logger.info('✅ Database migration completed');
    
    // Step 3: Verify old data is preserved
    const oldEmail = await dbManager.getEmailIndex('old-email-1');
    if (!oldEmail) {
      throw new Error('Old email data was lost during migration');
    }
    logger.info('✅ Old data preserved during migration');
    
    // Step 4: Test new functionality with analyzer results
    const newEmail = {
      id: 'new-email-with-analysis',
      threadId: 'thread-new',
      category: 'medium',
      subject: 'New Email with Analysis',
      sender: 'new@example.com',
      recipients: ['recipient@example.com'],
      date: new Date(),
      year: 2024,
      size: 2048,
      hasAttachments: true,
      labels: ['INBOX', 'IMPORTANT'],
      snippet: 'This email has analyzer results',
      
      // New analyzer results
      importanceScore: 0.75,
      importanceLevel: 'medium',
      importanceMatchedRules: ['size-threshold'],
      importanceConfidence: 0.88,
      ageCategory: 'recent',
      sizeCategory: 'medium',
      recencyScore: 0.9,
      sizePenalty: 0.2,
      gmailCategory: 'primary',
      spamScore: 0.02,
      promotionalScore: 0.05,
      socialScore: 0.0,
      spamIndicators: [],
      promotionalIndicators: [],
      socialIndicators: [],
      analysisTimestamp: new Date(),
      analysisVersion: '1.0.0'
    };
    
    await dbManager.upsertEmailIndex(newEmail);
    logger.info('✅ New email with analyzer results inserted successfully');
    
    // Step 5: Verify new email can be retrieved with all analyzer data
    const retrievedNewEmail = await dbManager.getEmailIndex('new-email-with-analysis');
    if (!retrievedNewEmail || !retrievedNewEmail.importanceScore) {
      throw new Error('New analyzer results not properly stored/retrieved');
    }
    
    logger.info('✅ New analyzer results properly stored and retrieved');
    console.log('Migration test results:');
    console.log('- Old email preserved:', !!oldEmail);
    console.log('- New analyzer fields working:', !!retrievedNewEmail.importanceScore);
    console.log('- Importance Score:', retrievedNewEmail.importanceScore);
    console.log('- Gmail Category:', retrievedNewEmail.gmailCategory);
    console.log('- Analysis Version:', retrievedNewEmail.analysisVersion);
    
    await dbManager.close();
    logger.info('🎉 Migration test completed successfully!');
    
  } catch (error) {
    logger.error('❌ Migration test failed:', error);
    throw error;
  }
}

// Run the test
testMigration()
  .then(() => {
    console.log('\n🎉 Database migration test passed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Database migration test failed:', error);
    process.exit(1);
  });