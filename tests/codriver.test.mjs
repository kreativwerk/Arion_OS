import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFields, isSensitiveKey, looksLikeIban } from "../lib/codriver-redact.ts";

test("Schlüssel-Schwärzung", () => {
  assert.equal(isSensitiveKey("iban"), true);
  assert.equal(isSensitiveKey("bankName"), true);
  assert.equal(isSensitiveKey("taxId"), true);
  assert.equal(isSensitiveKey("appPin"), true);
  assert.equal(isSensitiveKey("shipping"), false);
  assert.equal(isSensitiveKey("cubicCapacity"), false);
  assert.equal(isSensitiveKey("driverName"), false);
});

test("IBAN-Erkennung mit Prüfziffer", () => {
  assert.equal(looksLikeIban("DE89 3704 0044 0532 0130 00"), true);
  assert.equal(looksLikeIban("DE89 3704 0044 0532 0130 01"), false);
  assert.equal(looksLikeIban("A1B2C3D4E5"), false);
});

test("Firestore-Werte dekodieren und schwärzen", () => {
  const out = decodeFields({
    name: { stringValue: "Max Muster" },
    weeks: { integerValue: "3" },
    iban: { stringValue: "DE89370400440532013000" },
    notes: { stringValue: "Konto DE89 3704 0044 0532 0130 00 bitte" },
    photo: { stringValue: "https://firebasestorage.googleapis.com/v0/b/x/o/y.jpg" },
    from: { timestampValue: "2026-10-01T00:00:00Z" },
    nested: { mapValue: { fields: { taxId: { stringValue: "123" }, ok: { booleanValue: true } } } },
    list: { arrayValue: { values: [{ stringValue: "a" }, { doubleValue: 1.5 }] } },
  });
  assert.deepEqual(out, {
    name: "Max Muster",
    weeks: 3,
    iban: "[redacted]",
    notes: "Konto [redacted] bitte",
    photo: "[file]",
    from: "2026-10-01T00:00:00Z",
    nested: { taxId: "[redacted]", ok: true },
    list: ["a", 1.5],
  });
});
