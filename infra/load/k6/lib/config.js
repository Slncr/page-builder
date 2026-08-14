import { check, fail } from "k6";

export const apiBaseUrl =
  __ENV.API_BASE_URL || __ENV.BASE_URL || "http://127.0.0.1:18080";
export const frontendBaseUrl =
  __ENV.FRONTEND_BASE_URL || __ENV.BASE_URL || "http://127.0.0.1:15173";

export function integerEnv(name, fallback) {
  const value = Number.parseInt(__ENV[name] || String(fallback), 10);
  if (!Number.isFinite(value) || value < 1) {
    fail(`${name} must be a positive integer`);
  }
  return value;
}

export function requiredEnv(name) {
  const value = __ENV[name];
  if (!value) {
    fail(`${name} is required for this scenario`);
  }
  return value;
}

export function requireMutationOptIn() {
  if (__ENV.ALLOW_MUTATIONS !== "1") {
    fail("Set ALLOW_MUTATIONS=1 to run a mutating load scenario");
  }
}

export function bearerHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

export function checkStatus(response, accepted, label) {
  return check(response, {
    [`${label}: accepted status`]: (result) =>
      accepted.includes(result.status),
  });
}
