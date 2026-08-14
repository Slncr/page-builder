import http from "k6/http";
import { checkStatus, frontendBaseUrl, integerEnv } from "./lib/config.js";

const publicRps = integerEnv("PUBLIC_RPS", 500);

export const options = {
  discardResponseBodies: true,
  scenarios: {
    public_500_rps: {
      executor: "constant-arrival-rate",
      exec: "publicTraffic",
      rate: publicRps,
      timeUnit: "1s",
      duration: __ENV.DURATION || "5m",
      preAllocatedVUs: integerEnv("PREALLOCATED_VUS", 200),
      maxVUs: integerEnv("MAX_VUS", 1500),
      gracefulStop: "30s",
    },
  },
  thresholds: {
    "http_req_failed{scenario:public_500_rps}": ["rate<0.01"],
    "http_req_duration{scenario:public_500_rps}": ["p(95)<500", "p(99)<1000"],
    "dropped_iterations{scenario:public_500_rps}": ["count==0"],
  },
};

export function publicTraffic() {
  const path = __ENV.PUBLIC_PATH || "/";
  const response = http.get(`${frontendBaseUrl}${path}`, {
    tags: { operation: "public_page" },
  });

  checkStatus(response, [200], "public page");
}
