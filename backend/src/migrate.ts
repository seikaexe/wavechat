import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : undefined });
  await p.query(fs.readFileSync(path.join(__dirname, '../../database/schema.sql'), 'utf8'));
  console.log('Schema OK'); await p.end();
})();
