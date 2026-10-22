// Tests für die ARION-Sprachformatierung (Beträge, Daten, Markdown → Sprechtext).
// Aufruf: npm run test:arion
import { test } from "node:test";
import assert from "node:assert/strict";
import { spokenEuro, formatEuro, parseAmount, spokenDate, spokenMonth, toSpokenText, limitSentences, senderName, taskTitleFromSpeech, compactEuro, formatDateDe } from "../lib/arion-speech.ts";
import { resolveOpenAiUrl, ttsInput, TTS_MAX_CHARS } from "../lib/arion-tts.ts";

test("Beträge sprechen: Euro und Cent", () => {
  assert.equal(spokenEuro(1745.86), "1.745 Euro 86");
  assert.equal(spokenEuro(1745), "1.745 Euro");
  assert.equal(spokenEuro(52340.17), "52.340 Euro 17");
  assert.equal(spokenEuro(0.5), "50 Cent");
  assert.equal(spokenEuro(12.05), "12 Euro 5");
  assert.equal(spokenEuro(-89.9), "minus 89 Euro 90");
  assert.equal(spokenEuro(1234567.999), "1.234.568 Euro");
  assert.equal(spokenEuro(0), "0 Euro");
});

test("Beträge anzeigen und parsen", () => {
  assert.equal(formatEuro(1745.86), "1.745,86\u00a0€");
  assert.equal(formatEuro(-3.5), "−3,50\u00a0€");
  assert.equal(compactEuro(52340.17), "52,3\u00a0T€");
  assert.equal(compactEuro(980.4), "980\u00a0€");
  assert.equal(compactEuro(1745.86), "1.746\u00a0€");
  assert.equal(formatDateDe("2026-11-10"), "10.11.2026");
  // Sprechtext versteht auch die Anzeigeform mit geschütztem Leerzeichen
  assert.equal(toSpokenText(`Saldo ${formatEuro(52340.17)}`), "Saldo 52.340 Euro 17.");
  assert.equal(parseAmount("1.745,86"), 1745.86);
  assert.equal(parseAmount("1.745"), 1745);
  assert.equal(parseAmount("1745.86"), 1745.86);
  assert.equal(parseAmount("-12,5"), -12.5);
});

test("Datum sprechen: relativ und absolut", () => {
  assert.equal(spokenDate("2026-10-18", "2026-10-18"), "heute");
  assert.equal(spokenDate("2026-10-19", "2026-10-18"), "morgen");
  assert.equal(spokenDate("2026-10-20", "2026-10-18"), "übermorgen");
  assert.equal(spokenDate("2026-11-10", "2026-10-18"), "10. November");
  assert.equal(spokenDate("2027-01-03", "2026-10-18"), "3. Januar 2027");
  assert.equal(spokenDate("2026-03-01"), "1. März 2026");
  assert.equal(spokenDate("kein Datum"), "kein Datum");
});

test("Sprechtext: Beträge im Fließtext", () => {
  assert.equal(toSpokenText("Es fehlen 3 Belege über 1.745,86 €."), "Es fehlen 3 Belege über 1.745 Euro 86.");
  assert.equal(toSpokenText("Saldo: € 52.340,17"), "Saldo: 52.340 Euro 17.");
  assert.equal(toSpokenText("Offen sind 120 EUR und 0,99 Euro"), "Offen sind 120 Euro und 99 Cent.");
  // Schon gesprochene Form bleibt unverändert
  assert.equal(toSpokenText("Das sind 1.745 Euro 86."), "Das sind 1.745 Euro 86.");
});

test("Sprechtext: Daten, Abkürzungen, Prozent", () => {
  assert.equal(
    toSpokenText("USt-Voranmeldung fällig am 2026-11-10, z. B. 19 %", "2026-10-18"),
    "Umsatzsteuer-Voranmeldung fällig am 10. November, zum Beispiel 19 Prozent."
  );
  assert.equal(toSpokenText("Frist: 20.10.2026", "2026-10-18"), "Frist: übermorgen.");
  assert.equal(toSpokenText("Termin am 3.11."), "Termin am 3. November.");
});

test("Sprechtext: Markdown wird entfernt", () => {
  const md = "## Überblick\n\n**Wichtig:** zwei Mails\n- Mail von *Amazon*\n- Rechnung von `Aral`\n1. Oktober ist Stichtag\n[Details](https://example.com)";
  assert.equal(
    toSpokenText(md),
    "Überblick. Wichtig: zwei Mails. Mail von Amazon. Rechnung von Aral. 1. Oktober ist Stichtag. Details."
  );
});

test("Sätze begrenzen, ohne an Zahlen zu schneiden", () => {
  const t = "Es fehlen 1.745 Euro 86. Die nächste Frist ist am 20. Oktober. Zwei Mails sind neu. Sonst ist alles ruhig. Gute Nacht.";
  assert.equal(limitSentences(t, 2), "Es fehlen 1.745 Euro 86. Die nächste Frist ist am 20. Oktober. Zwei Mails sind neu.");
  assert.equal(limitSentences("Kurz.", 3), "Kurz.");
});

test("Monatsnamen und Umgebungsvariablen-Namen im Sprechtext", () => {
  assert.equal(spokenMonth("2026-10", "2026-10-18"), "Oktober");
  assert.equal(spokenMonth("2025-12", "2026-10-18"), "Dezember 2025");
  assert.equal(toSpokenText("Es fehlt der Schlüssel (ANTHROPIC_API_KEY)."), "Es fehlt der Schlüssel.");
});

test("TTS/STT-Endpunkte: Basis-URL oder voller Pfad", () => {
  assert.equal(resolveOpenAiUrl("https://voice.example.com", "audio/speech"), "https://voice.example.com/v1/audio/speech");
  assert.equal(resolveOpenAiUrl("https://voice.example.com/v1/", "audio/speech"), "https://voice.example.com/v1/audio/speech");
  assert.equal(resolveOpenAiUrl("https://x.test/v1/audio/speech", "audio/speech"), "https://x.test/v1/audio/speech");
  assert.equal(resolveOpenAiUrl("https://x.test/whisper", "audio/transcriptions"), "https://x.test/whisper/v1/audio/transcriptions");
  assert.equal(resolveOpenAiUrl("", "audio/speech"), null);
  assert.equal(resolveOpenAiUrl("ftp://x.test", "audio/speech"), null);
  assert.equal(resolveOpenAiUrl(undefined, "audio/speech"), null);
});

test("TTS-Eingabe: Steuerzeichen raus, Länge begrenzt am Satzende", () => {
  assert.equal(ttsInput("Hallo\u0007  Welt\n"), "Hallo Welt");
  const long = "Das ist ein Satz. ".repeat(200);
  const out = ttsInput(long);
  assert.ok(out.length <= TTS_MAX_CHARS);
  assert.ok(out.endsWith("."));
});

test("Absender sprechbar machen", () => {
  assert.equal(senderName("Max Muster <max@example.de>"), "Max Muster");
  assert.equal(senderName('"Arval Service" <no-reply@arval.de>'), "Arval Service");
  assert.equal(senderName("no-reply@arval.de"), "Arval");
  assert.equal(senderName("vendor-central@amazon.de"), "Amazon");
  assert.equal(senderName("anna.berg@firma.de"), "anna.berg");
  assert.equal(senderName(""), "unbekannt");
});

test("Aufgabentitel aus gesprochener Erinnerung", () => {
  assert.equal(taskTitleFromSpeech("die Sixt-Rechnung anzufordern"), "Die Sixt-Rechnung anfordern");
  assert.equal(taskTitleFromSpeech("daran, Reifen zu wechseln."), "Reifen wechseln");
  assert.equal(taskTitleFromSpeech("Steuerbüro anrufen"), "Steuerbüro anrufen");
  assert.equal(taskTitleFromSpeech("den Vertrag zurückzuschicken"), "Den Vertrag zurückschicken");
});

test("ElevenLabs: nur saubere Voice-IDs in die URL", async () => {
  const { elevenLabsUrl } = await import("../lib/arion-tts.ts");
  assert.equal(
    elevenLabsUrl("JBFqnCBsd6RMkjVDRZzb"),
    "https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/stream?output_format=mp3_44100_128"
  );
  assert.equal(elevenLabsUrl("../../v1/user"), null);
  assert.equal(elevenLabsUrl(""), null);
});

test("Weckruf: „Hey ARION“ und Varianten, aber nicht mitten im Satz", async () => {
  const { isWakePhrase, greetingClip } = await import("../lib/arion-wake.ts");
  for (const t of ["Hey Arion", "hey arion wie ist der Kontostand", "Arion", "Hallo Orion", "okay Ariane", "Hey ARION!"]) {
    assert.equal(isWakePhrase(t), true, t);
  }
  for (const t of ["Wir fahren nach Orion morgen", "der Termin mit Aaron", "Hey", "Marion"]) {
    assert.equal(isWakePhrase(t), false, t);
  }
  assert.equal(greetingClip(7), "guten-morgen");
  assert.equal(greetingClip(13), "guten-tag");
  assert.equal(greetingClip(20), "guten-abend");
});
