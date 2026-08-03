import { createRequire } from "node:module";

export const API_BASE_URL = "https://crm.rdstation.com/api/v1";

/** Maximum characters returned by any tool before truncation kicks in. */
export const CHARACTER_LIMIT = 25_000;

/** Default page size for list tools (API default is 20, max is 200). */
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 200;

/** Max pages fetched by aggregation tools (pipeline_overview). */
export const MAX_AGGREGATION_PAGES = 5;

export const SERVER_NAME = "rdstation-crm-mcp";

// Read the version from package.json so it can never drift from the published
// package. Works from src/ (tsx, vitest) and from the bundled dist/index.js,
// since both sit one level below the package root.
const pkg = createRequire(import.meta.url)("../package.json") as { version: string };
export const SERVER_VERSION: string = pkg.version;
