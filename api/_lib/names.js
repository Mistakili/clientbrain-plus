export function nameKey(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function provided(value) {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  return text !== "" && text !== "—";
}

export function matchLead(leads, query) {
  const key = nameKey(query);
  if (!key) return { lead: null, matches: [] };
  const exact = leads.filter((lead) => lead.name_key === key);
  if (exact.length) return { lead: exact.length === 1 ? exact[0] : null, matches: exact };
  if (key.length < 3) return { lead: null, matches: [] };
  const matches = leads.filter((lead) => {
    if (lead.name_key.startsWith(key)) return true;
    return lead.name_key.split(" ").some((part) => part.startsWith(key));
  });
  return { lead: matches.length === 1 ? matches[0] : null, matches };
}
