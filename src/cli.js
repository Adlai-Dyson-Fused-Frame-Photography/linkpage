// Command line helpers. Usage (inside the container):
//   docker compose exec linkpage node src/cli.js reset-password
import crypto from 'node:crypto';
import * as db from './db.js';
import { hashPassword } from './auth.js';

if (process.argv[2] === 'reset-password') {
  const u = db.firstUser();
  if (!u) { console.log('No account exists yet - open /setup in your browser instead.'); process.exit(1); }
  const pw = crypto.randomBytes(12).toString('base64url');
  db.setPassword(u.id, await hashPassword(pw));
  db.deleteSessionsFor(u.id);
  console.log(`\nPassword reset for "${u.username}".\nNew password:  ${pw}\nSign in, then change it under Account.\n`);
  process.exit(0);
}
console.log('Usage: node src/cli.js reset-password');
