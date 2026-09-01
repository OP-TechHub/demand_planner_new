// CRM authentication — the server-side replacement for the HTML password.
//
// COPY INTO THE CRM REPO at netlify/functions/crm-auth.js (with lib/session.js).
//
// One function, three verbs:
//   POST   /.netlify/functions/crm-auth   { username, password }  -> sign in
//   GET    /.netlify/functions/crm-auth                           -> who am I
//   DELETE /.netlify/functions/crm-auth                           -> sign out
//
// The GET is what the page calls on load to decide what to render. It returns
// the username and role — never the password list, and never the secret.
//
// Environment variables (Netlify -> Site settings -> Environment):
//
//   CRM_SESSION_SECRET  a long random string. Generate with:
//                         node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//                       Changing it signs everyone out, which is how you revoke
//                       every session at once.
//
//   CRM_USERS           JSON array of users, passwords already hashed:
//                       [{"username":"nimal","role":"sales","password":"scrypt$..."}]
//                       Generate each hash with scripts/hash-password.mjs.
//
// WHY THE ROLES MOVE OUT OF THE HTML
// A role assigned in page JavaScript is a suggestion, not a permission — the
// user can edit it in devtools, and it is invisible to a function called
// directly. Here the role is put into a signed cookie the browser cannot
// forge, so the functions can actually trust it.

const { signSession, sessionCookie, clearCookie, readCookie, verifySession, verifyPassword, json } = require('./lib/session');

exports.handler = async (event) => {
  const secret = process.env.CRM_SESSION_SECRET;
  if (!secret) return json(500, 'not_configured', 'CRM_SESSION_SECRET is not set in the Netlify environment.');

  switch (event.httpMethod) {
    case 'POST':
      return signIn(event, secret);
    case 'GET':
      return whoAmI(event, secret);
    case 'DELETE':
      return { statusCode: 204, headers: { 'Set-Cookie': clearCookie() }, body: '' };
    default:
      return json(405, 'method_not_allowed', 'Use POST to sign in, GET to check the session, DELETE to sign out.');
  }
};

function signIn(event, secret) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, 'bad_request', 'Expected a JSON body.');
  }

  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) return json(400, 'bad_request', 'username and password are required.');

  const users = loadUsers();
  if (!users) return json(500, 'not_configured', 'CRM_USERS is missing or not valid JSON.');

  const record = users.find((u) => u.username === username);

  // Same message and same shape whether the username or the password was
  // wrong: telling an attacker which half they got right hands them a list of
  // valid usernames to work through.
  const ok = record && verifyPassword(password, record.password);
  if (!ok) return json(401, 'invalid_credentials', 'Incorrect username or password.');

  const token = signSession({ username: record.username, role: record.role || 'viewer' }, secret);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(token) },
    body: JSON.stringify({ username: record.username, role: record.role || 'viewer' }),
  };
}

function whoAmI(event, secret) {
  const user = verifySession(readCookie(event), secret);
  if (!user) return json(401, 'unauthorized', 'Not signed in.');
  return {
    statusCode: 200,
    // A session answer must never be cached — a shared cache could hand one
    // person's identity to the next caller.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ username: user.username, role: user.role, expires_at: user.exp }),
  };
}

/** Parse CRM_USERS, returning null when it is missing or malformed. */
function loadUsers() {
  const raw = process.env.CRM_USERS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
