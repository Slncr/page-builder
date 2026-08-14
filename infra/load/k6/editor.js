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
    concurrent_editors: {
      executor: "constant-vus",
      exec: "editorSession",
      vus: integerEnv("EDITOR_VUS", 50),
      duration: __ENV.DURATION || "10m",
      gracefulStop: "30s",
    },
  },
  thresholds: {
    "http_req_failed{scenario:concurrent_editors}": ["rate<0.01"],
    "http_req_duration{scenario:concurrent_editors}": [
      "p(95)<750",
      "p(99)<1500",
    ],
  },
};

export function setup() {
  const token = requiredEnv("EDITOR_TOKEN");
  const pageId = requiredEnv("EDITOR_PAGE_ID");
  const autosave = __ENV.EDITOR_AUTOSAVE === "1";
  if (autosave) {
    requireMutationOptIn();
  }
  return { token, pageId, autosave };
}

export function editorSession({ token, pageId, autosave }) {
  const readPath =
    __ENV.EDITOR_READ_PATH || `/api/v1/pages/${pageId}/draft`;
  const headers = bearerHeaders(token);
  const readResponse = http.get(`${apiBaseUrl}${readPath}`, {
    headers,
    tags: { operation: "editor_read" },
  });
  checkStatus(readResponse, [200], "editor read");

  if (autosave && readResponse.status === 200) {
    const savePath =
      __ENV.EDITOR_SAVE_PATH || `/api/v1/pages/${pageId}/draft`;
    const draft = readResponse.json();
    const payload = JSON.stringify({
      expectedVersion: draft.version,
      document: draft.document,
    });
    const saveResponse = http.patch(`${apiBaseUrl}${savePath}`, payload, {
      headers: bearerHeaders(token, { "Content-Type": "application/json" }),
      tags: { operation: "editor_autosave" },
    });
    checkStatus(saveResponse, [200, 202, 204, 409], "editor autosave");
  }

  sleep(1 + Math.random() * 2);
}
