import path from 'path';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';

export type DB = Database<sqlite3.Database, sqlite3.Statement>;

export async function getDb(): Promise<DB> {
  const file = process.env.DB_FILE || './database/app.db';
  return open<sqlite3.Database, sqlite3.Statement>({
    filename: path.resolve(process.cwd(), file),
    driver: sqlite3.Database
  });
}
