import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { RdCrmClient } from "../src/client/http.js";
import { getContact, searchContacts, upsertContact } from "../src/tools/contacts.js";
import { API_BASE_URL } from "../src/constants.js";
import { mockApi } from "./setup.js";
import { makeContact, TOKEN } from "./fixtures.js";

const client = new RdCrmClient(TOKEN);

describe("searchContacts", () => {
  it("formats results as compact lines with pagination footer", async () => {
    mockApi.use(
      http.get(`${API_BASE_URL}/contacts`, () =>
        HttpResponse.json({ contacts: [makeContact()], total: 42, has_more: true }),
      ),
    );
    const text = await searchContacts(client, { query: "joão", page: 1, limit: 20 });
    expect(text).toContain("João Souza (id: contact1)");
    expect(text).toContain("joao@acme.com");
    expect(text).toContain("page=2");
  });

  it("returns a helpful message when nothing matches", async () => {
    mockApi.use(
      http.get(`${API_BASE_URL}/contacts`, () =>
        HttpResponse.json({ contacts: [], total: 0, has_more: false }),
      ),
    );
    const text = await searchContacts(client, { query: "zzz", page: 1, limit: 20 });
    expect(text).toContain("No contacts found");
    expect(text).toContain("rdcrm_upsert_contact");
  });
});

describe("getContact", () => {
  it("includes linked deals with status", async () => {
    mockApi.use(
      http.get(`${API_BASE_URL}/contacts/contact1`, () =>
        HttpResponse.json(
          makeContact({
            deals: [{ _id: "deal9", name: "Old deal", win: true, closed_at: "2026-01-01" }],
          }),
        ),
      ),
    );
    const text = await getContact(client, { contact_id: "contact1" });
    expect(text).toContain("# João Souza");
    expect(text).toContain("Old deal (id: deal9) | status: won");
  });
});

describe("upsertContact", () => {
  it("creates a new contact when the email is unknown", async () => {
    mockApi.use(
      http.get(`${API_BASE_URL}/contacts`, () =>
        HttpResponse.json({ contacts: [], total: 0, has_more: false }),
      ),
      http.post(`${API_BASE_URL}/contacts`, async ({ request }) => {
        const body = (await request.json()) as { contact: { name: string } };
        expect(body.contact.name).toBe("Nova Pessoa");
        return HttpResponse.json(makeContact({ _id: "new1", name: "Nova Pessoa" }));
      }),
    );
    const text = await upsertContact(client, {
      email: "nova@acme.com",
      name: "Nova Pessoa",
    });
    expect(text).toContain("Created contact");
    expect(text).toContain("new1");
  });

  it("updates the existing contact when the email matches", async () => {
    let putCalled = false;
    mockApi.use(
      http.get(`${API_BASE_URL}/contacts`, () =>
        HttpResponse.json({ contacts: [makeContact()], total: 1, has_more: false }),
      ),
      http.put(`${API_BASE_URL}/contacts/contact1`, () => {
        putCalled = true;
        return HttpResponse.json(makeContact({ name: "João Souza Jr" }));
      }),
    );
    const text = await upsertContact(client, {
      email: "joao@acme.com",
      name: "João Souza Jr",
    });
    expect(putCalled).toBe(true);
    expect(text).toContain("Updated existing contact");
  });
});
