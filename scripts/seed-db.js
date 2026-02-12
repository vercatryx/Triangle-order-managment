#!/usr/bin/env node
/**
 * Seed the database with test data (vendors, clients, etc.)
 * Run: npm run db:seed
 * Requires: mysql_schema.sql and mysql_test_data.sql applied first
 * Uses MYSQL_* or DATABASE_* env vars from .env
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mysql = require('mysql2/promise');

const config = {
  host: process.env.MYSQL_HOST || process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || process.env.DATABASE_PORT || '3306', 10),
  user: process.env.MYSQL_USER || process.env.DATABASE_USER || 'root',
  password: process.env.MYSQL_PASSWORD || process.env.DATABASE_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || process.env.DATABASE_NAME || 'triangle_orders',
  multipleStatements: true,
};

async function main() {
  const conn = await mysql.createConnection(config);
  try {
    const seedPath = path.join(__dirname, '..', 'sql', 'mysql_test_data.sql');
    const sql = fs.readFileSync(seedPath, 'utf8');
    await conn.query(sql);
    console.log('Database seeded successfully. Vendors, clients, and test data are ready.');
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main();
