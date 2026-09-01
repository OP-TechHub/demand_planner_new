// Generate a CRM_USERS entry with a hashed password.
//
//   node scripts/hash-password.mjs nimal sales
//
// Prints a JSON object to paste into the CRM_USERS array in Netlify's
// environment settings. The password is prompted for rather than passed as an
// argument, so it does not end up in your shell history or in `ps` output.
//
// Uses scrypt from Node's built-in crypto — no dependency to install.

import crypto from 'node:crypto';
import readline from 'node:readline';

const [username, role = 'sales'] = process.argv.slice(2);

if (!username) {
  console.error('Usage: node scripts/hash-password.mjs <username> [role]');
  console.error('Roles used by dp-skus.js: admin, sales (see DP_ALLOWED_ROLES).');
  process.exit(1);
}

const password = await prompt(`Password for "${username}": `);
if (password.length < 12) {
  // These credentials guard cost and margin data, and a Netlify function is
  // reachable by anyone who guesses the URL — so the password is the whole of
  // the defence. Short ones are worth refusing outright.
  console.error('\nRefusing: use at least 12 characters.');
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 64);
const stored = `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;

console.log('\nAdd this object to the CRM_USERS array:\n');
console.log(JSON.stringify({ username, role, password: stored }));
console.log('\nCRM_USERS is a JSON array, e.g.');
console.log('[{"username":"nimal","role":"sales","password":"scrypt$..."}]');

/** Read a line without echoing it to the terminal. */
function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    // Suppress the echo of typed characters, leaving the question visible.
    const onWrite = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (s) => { if (s.includes(question)) onWrite(s); };

    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}
