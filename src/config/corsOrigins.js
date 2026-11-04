// CLIENT_ORIGIN is a comma-separated allowlist (e.g. "https://app.example.com,https://admin.example.com").
// Falls back to the Vite dev server so local development keeps working out of the box.
const origins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  // Browsers send Origin without a trailing slash, so "https://x.app/" would never match.
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

module.exports = origins;
