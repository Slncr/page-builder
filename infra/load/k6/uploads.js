import http from "k6/http";
import {
  apiBaseUrl,
  bearerHeaders,
  checkStatus,
  integerEnv,
  requiredEnv,
  requireMutationOptIn,
} from "./lib/config.js";

const uploadBytes = integerEnv("UPLOAD_BYTES", 1024);

export const options = {
  scenarios: {
    media_uploads: {
      executor: "constant-arrival-rate",
      exec: "uploadMedia",
      rate: integerEnv("UPLOAD_RPS", 20),
      timeUnit: "1s",
      duration: __ENV.DURATION || "5m",
      preAllocatedVUs: integerEnv("PREALLOCATED_VUS", 20),
      maxVUs: integerEnv("MAX_VUS", 200),
      gracefulStop: "30s",
    },
  },
  thresholds: {
    "http_req_failed{scenario:media_uploads}": ["rate<0.02"],
    "http_req_duration{scenario:media_uploads}": [
      "p(95)<2000",
      "p(99)<5000",
    ],
  },
};

export function setup() {
  requireMutationOptIn();
  return {
    token: requiredEnv("EDITOR_TOKEN"),
    siteId: requiredEnv("SITE_ID"),
  };
}

export function uploadMedia({ token, siteId }) {
  const path = __ENV.UPLOAD_PATH || "/api/v1/assets/upload";
  const filename = `k6-${__VU}-${__ITER}.png`;
  const bytes = new Uint8Array(uploadBytes);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const body = {
    file: http.file(
      bytes.buffer,
      filename,
      "image/png",
    ),
    siteId,
    altText: "Load test image",
  };
  const response = http.post(`${apiBaseUrl}${path}`, body, {
    headers: bearerHeaders(token),
    tags: { operation: "media_upload" },
  });

  checkStatus(response, [201], "media upload");
}
