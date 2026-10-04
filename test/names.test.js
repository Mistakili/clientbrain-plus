import assert from "node:assert/strict";
import test from "node:test";
import { matchLead, nameKey } from "../api/_lib/names.js";

const leads = [
  { id: "1", name: "Joanna Blake", name_key: nameKey("Joanna Blake") },
  { id: "2", name: "Ada Okafor", name_key: nameKey("Ada Okafor") },
  { id: "3", name: "Adaeze Okonkwo", name_key: nameKey("Adaeze Okonkwo") }
];

test("short and inner fragments do not open the wrong person", () => {
  assert.equal(matchLead(leads, "Ann").lead, null);
  assert.equal(matchLead(leads, "Jo").lead, null);
  assert.equal(matchLead(leads, "a").lead, null);
});

test("a unique prefix or first name finds one lead", () => {
  assert.equal(matchLead(leads, "Joa").lead.id, "1");
  assert.equal(matchLead(leads, "Ada Okafor").lead.id, "2");
  assert.equal(matchLead(leads, "Okafor").lead.id, "2");
});

test("an ambiguous prefix asks which person", () => {
  const found = matchLead(leads, "Ada");
  assert.equal(found.lead, null);
  assert.equal(found.matches.length, 2);
});
