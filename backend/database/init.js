// Run with: npm run db:init (from backend/)
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.env.DB_FILE || './database/app.db';
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) throw err;
  console.log('Connected to SQLite at', dbPath);

  db.exec(schema, (e) => {
    if (e) throw e;
    console.log('Schema executed successfully');
    db.close();
  });
});
