import http from "k6/http";
import { sleep } from "k6";
import {
  apiBaseUrl,
  bearerHeaders,
  checkStatus,
  integerEnv,
  requiredEnv,
  requireMutationOptIn,
} from "./lib/config.js";

export const options = {
  scenarios: {
    batch_publish: {
      executor: "per-vu-iterations",
      exec: "publishBatch",
      vus: integerEnv("BATCH_VUS", 5),
      iterations: integerEnv("BATCH_ITERATIONS_PER_VU", 10),
      maxDuration: __ENV.DURATION || "10m",
    },
  },
  thresholds: {
    "http_req_failed{scenario:batch_publish}": ["rate<0.01"],
    "http_req_duration{scenario:batch_publish}": [
      "p(95)<3000",
      "p(99)<8000",
    ],
  },
};

export function setup() {
  const dryRun = __ENV.BATCH_DRY_RUN !== "0";
  if (!dryRun) {
    requireMutationOptIn();
  }
  const pageIds = requiredEnv("PAGE_IDS")
    .split(",")
    .map((pageId) => pageId.trim())
    .filter(Boolean);
  if (pageIds.length === 0) {
    throw new Error("PAGE_IDS must contain at least one page identifier");
  }
  return {
    token: requiredEnv("ADMIN_TOKEN"),
    pageIds,
    dryRun,
  };
}

export function publishBatch({ token, pageIds, dryRun }) {
  const requests = pageIds.map((pageId) => {
    const operation = dryRun ? "validate" : "publish";
    const path = `/api/v1/pages/${pageId}/${operation}`;
    return {
      method: "POST",
      url: `${apiBaseUrl}${path}`,
      body: dryRun
        ? null
        : JSON.stringify({ message: `k6 batch ${__VU}-${__ITER}` }),
      params: {
        headers: bearerHeaders(token, {
          "Content-Type": "application/json",
          "Idempotency-Key": `k6-${pageId}-${__VU}-${__ITER}`,
        }),
        tags: { operation: dryRun ? "batch_validate" : "batch_publish" },
      },
    };
  });

  const responses = http.batch(requests);
  responses.forEach((response) =>
    checkStatus(response, [200], dryRun ? "batch validate" : "batch publish"),
  );
  sleep(1);
}
