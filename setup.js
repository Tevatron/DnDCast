// First-time setup: sets your password and writes config.json.
// Run once with: node setup.js

import { createInterface } from 'readline';
import bcrypt from 'bcryptjs';
const { hashSync } = bcrypt;
import { writeFileSync, existsSync } from 'fs';
import crypto from 'crypto';

if (existsSync('config.json')) {
  console.log('config.json already exists. Delete it first to reset.');
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, resolve));

const dmPassword = (await ask('Choose a DM password for DnDCast: ')).trim();
if (!dmPassword) { console.log('Password cannot be empty.'); rl.close(); process.exit(1); }

// Optional: a separate password for player-only users (restricted access).
const playerPassword = (await ask('Choose a PLAYER password (optional — blank to disable player logins): ')).trim();

const config = {
  passwordHash:  hashSync(dmPassword, 10),
  ...(playerPassword ? { playerPasswordHash: hashSync(playerPassword, 10) } : {}),
  sessionSecret: crypto.randomBytes(32).toString('hex'),
  port:          3000,
};
writeFileSync('config.json', JSON.stringify(config, null, 2));
console.log('\nconfig.json created. Start the server with: npm start');
rl.close();
