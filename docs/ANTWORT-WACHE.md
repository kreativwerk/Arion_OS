# Antwort-Wächter

Merkt sich gesendete Mails und meldet, wenn eine Antwort kommt – oder wenn nach 5 Tagen nichts kam.

**Ablauf** (im Mail-Cron `/api/cron/mail`, nach dem Abruf, `lib/antwort-wache.ts`):

1. **Erfassen:** Alle Mails der letzten 8 Tage aus den Gesendet-Ordnern aller Postfächer und die aus Arion OS
   gesendeten Entwürfe landen in `antwort_wache`. Beobachtet werden nur externe Empfänger – nicht:
   eigene Adressen/Domains, no-reply-Adressen, Weiterleitungen (WG/Fwd) an private Adressen (Mitarbeiter).
   Mehrere Mails im selben Verlauf (gleicher Empfänger + Betreff) zählen einmal; die ältere wird `ersetzt`.
2. **Antwort erkennen:** eingehende Mail mit unserer Message-ID in `In-Reply-To`/`References`
   (auch wenn ein Kollege antwortet), sonst gleicher Betreff vom selben Absender bzw. derselben Firma.
   Abwesenheitsnotizen, Lesebestätigungen und Unzustellbar-Meldungen zählen nicht.
   → Status `beantwortet` + Push „Antwort von …“.
3. **Erinnern:** nach 5 Tagen ohne Antwort einmal je Verlauf, nur 8–20 Uhr: Push und **eine** Sammel-Mail an
   info@ (`mailSenden`, Quelle `antwort-wache`) → Status `erinnert`. Nach 30 Tagen → `abgelaufen`.

**Ansicht:** Leitstand → Bereich „Antworten“ und Karte „Wartet auf Antwort“ (neue Antworten der letzten 3 Tage
und offene Mails). Haken = „braucht keine Antwort“ (`POST /api/antwort-wache { id, aktion: "erledigt" }`).

Status: `wartet` · `erinnert` · `beantwortet` · `erledigt` · `ersetzt` · `abgelaufen` · `ignoriert`.
