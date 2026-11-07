import assert from "node:assert/strict";
import {
  createGitHubInstallationAuthorizationHeader,
  isGitHubInstallationToken,
} from "../src/server/githubInstallationToken.ts";

// Classic stateful opaque installation token fixture.
const classicToken = `ghs_${"a".repeat(36)}`;

// Stateless JWT-format fixture. Its size deliberately exceeds 520 characters
// so this test catches truncation and fixed-length assumptions.
const statelessToken = `ghs_${"A".repeat(36)}.${"B".repeat(240)}.${"C".repeat(240)}`;

assert.equal(classicToken.length, 40);
assert.ok(statelessToken.length >= 520);
assert.equal((statelessToken.match(/\./g) ?? []).length, 2);

assert.equal(isGitHubInstallationToken(classicToken), true);
assert.equal(isGitHubInstallationToken(statelessToken), true);

for (const token of [classicToken, statelessToken]) {
  const authorization = createGitHubInstallationAuthorizationHeader(token);
  assert.equal(authorization, `Bearer ${token}`);
  assert.equal(authorization.slice("Bearer ".length), token);
}

for (const invalid of [
  "",
  null,
  undefined,
  "ghp_abcdefghijklmnopqrstuvwxyz1234567890",
  "ghs_short",
  `ghs_${"a".repeat(36)} with-space`,
  `ghs_${"a".repeat(36)}\n`,
]) {
  assert.equal(isGitHubInstallationToken(invalid), false);
  assert.throws(
    () => createGitHubInstallationAuthorizationHeader(invalid),
    TypeError,
  );
}

console.log("GitHub App installation-token compatibility: 8 assertions passed.");
