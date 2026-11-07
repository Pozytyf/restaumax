/**
 * GitHub App installation-token compatibility helpers.
 *
 * Treat installation tokens as opaque bearer credentials. Do not decode JWT
 * contents, trim, truncate, or impose a fixed maximum length.
 */
const INSTALLATION_TOKEN_PATTERN = /^ghs_[A-Za-z0-9._-]{36,}$/;

export function isGitHubInstallationToken(value) {
  return typeof value === "string" && INSTALLATION_TOKEN_PATTERN.test(value);
}

export function createGitHubInstallationAuthorizationHeader(token) {
  if (!isGitHubInstallationToken(token)) {
    throw new TypeError("Invalid GitHub App installation token format");
  }

  return `Bearer ${token}`;
}
