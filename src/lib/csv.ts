// Minimal RFC4180-ish CSV parser — no dependency needed for what a guest-list
// export (Wix Contacts, a spreadsheet save-as-CSV, etc.) actually contains:
// quoted fields, escaped "" quotes, commas/newlines inside quotes, and a
// possible leading BOM from Excel. Not a general-purpose CSV library, just
// enough to read this shape of file reliably.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-blank trailing rows (a common artifact of a trailing newline).
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

export type ParsedCsv = { headers: string[]; rows: string[][] };

export function parseCsvWithHeader(text: string): ParsedCsv {
  const all = parseCsv(text);
  const [headers = [], ...rows] = all;
  return { headers: headers.map((h) => h.trim()), rows };
}

export type GuestColumnMapping = {
  nameCol: string | null;
  firstNameCol: string | null;
  lastNameCol: string | null;
  phoneCol: string | null;
  emailCol: string | null;
  notesCol: string | null;
};

function findHeader(headers: string[], candidates: string[]): string | null {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const cand of candidates) {
    const idx = lower.indexOf(cand);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

// Guesses which columns hold what, from common header names used by Wix
// Contacts exports and typical spreadsheet conventions. A manager can
// override any of these on the preview screen before confirming — this is
// just a helpful default, never trusted blindly for the actual import.
export function autoDetectGuestMapping(headers: string[]): GuestColumnMapping {
  const nameCol = findHeader(headers, ["name", "full name", "guest name", "contact name", "customer name"]);
  const firstNameCol = nameCol ? null : findHeader(headers, ["first name", "firstname", "first"]);
  const lastNameCol = nameCol ? null : findHeader(headers, ["last name", "lastname", "last", "surname"]);
  const phoneCol = findHeader(headers, [
    "phone",
    "phone number",
    "mobile",
    "mobile phone",
    "contact phone",
    "cell phone",
    "cell",
  ]);
  const emailCol = findHeader(headers, ["email", "e-mail", "email address"]);
  const notesCol = findHeader(headers, ["notes", "note", "tags", "labels"]);
  return { nameCol, firstNameCol, lastNameCol, phoneCol, emailCol, notesCol };
}

export function resolveName(
  headers: string[],
  row: string[],
  mapping: GuestColumnMapping
): string {
  const at = (col: string | null) => {
    if (!col) return "";
    const idx = headers.indexOf(col);
    return idx === -1 ? "" : (row[idx] ?? "").trim();
  };
  if (mapping.nameCol) return at(mapping.nameCol);
  const first = at(mapping.firstNameCol);
  const last = at(mapping.lastNameCol);
  return [first, last].filter(Boolean).join(" ").trim();
}

export function cellAt(headers: string[], row: string[], col: string | null): string {
  if (!col) return "";
  const idx = headers.indexOf(col);
  return idx === -1 ? "" : (row[idx] ?? "").trim();
}
