require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();

const DB_FILE = process.env.DB_FILE || './database/app.db';
const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
  // backward compatible: clear rows explicitly marked OR named like our test
  db.run(`DELETE FROM examples WHERE is_seed = 1 OR name = 'hello-drift'`, (e) => {
    if (e) { console.error(e); process.exit(1); }
    console.log('✔ Seed rows cleared');
    db.close();
  });
});
