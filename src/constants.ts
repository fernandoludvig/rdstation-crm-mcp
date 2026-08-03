export const API_BASE_URL = "https://crm.rdstation.com/api/v1";

/** Maximum characters returned by any tool before truncation kicks in. */
export const CHARACTER_LIMIT = 25_000;

/** Default page size for list tools (API default is 20, max is 200). */
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 200;

/** Max pages fetched by aggregation tools (pipeline_overview). */
export const MAX_AGGREGATION_PAGES = 5;

export const SERVER_NAME = "rdstation-crm-mcp";
export const SERVER_VERSION = "0.1.0";
