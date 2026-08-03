import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

export const mockApi = setupServer();

beforeAll(() => mockApi.listen({ onUnhandledRequest: "error" }));
afterEach(() => mockApi.resetHandlers());
afterAll(() => mockApi.close());
