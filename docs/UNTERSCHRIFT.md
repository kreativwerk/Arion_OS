# Unterschreiben auf dem Server und Anhang-Kopie

Damit Claude Dokumente unterschreiben und an Mail-Entwürfe hängen kann, ohne dass
der Büro-Mac oder ein eingeloggter Browser laufen muss.

## 1. Anhang-Kopie (`mail_attachment_blobs`)

Der Mail-Cron (Postfach-Archiv) lädt PDFs und Bilder bis 10 MB der letzten
60 Tage (`MAIL_ATTACHMENT_DAYS`) als Kopie in die Datenbank – nur lesend, im
Postfach ändert sich nichts. `/api/mail/attachment` und das Weiterleiten nutzen
die Kopie, ältere Anhänge kommen wie bisher live per IMAP und werden dabei
gespeichert. Die Tabelle ist per RLS für die öffentliche Supabase-API gesperrt.

## 2. Unterschrift/Stempel (`sign_assets`)

Bilder (PNG mit transparentem Hintergrund) mit festen Schlüsseln, z. B.
`unterschrift_albert`, `stempel_arion`, `stempel_wohnwerk`. Hochladen mit
App-Login: `POST /api/sign-assets` (multipart: `key`, `file`), Übersicht per
`GET /api/sign-assets`.

## 3. Auftrag im Entwurf (`mail_drafts.sign_spec`)

JSON (ein Objekt oder Liste, max. 5). Koordinaten in Punkt ab **links oben**
(A4 = 595 × 842 pt):

```json
{
  "quelle": { "mail_id": 26199, "part": "2" },
  "dateiname": "Werkstattauftrag_33998_unterschrieben.pdf",
  "seite": 2,
  "unterschrift": { "x": 325, "y": 731, "breite": 160 },
  "stempel": { "key": "stempel_arion", "x": 420, "y": 720, "breite": 150 },
  "vermerk": { "zeilen": ["Unter Vorbehalt der Kostenaufstellung"], "x": 55, "y": 825, "groesse": 8 }
}
```

- `quelle`: Mail-Anhang (`mail_id` + `part`), Datei des Entwurfs (`datei_id`)
  oder Brief aus der Post (`brief_id`). PDF, PNG oder JPG (Bilder werden zur A4-Seite).
- `seite`: 1-basiert, `-1` = letzte Seite (Standard).
- `unterschrift.key`: Standard `unterschrift_albert`. Der Stempel liegt unter der Unterschrift.

Ablauf: Der Mail-Cron führt offene Aufträge aus (`sign_status` leer → `fertig`
oder `fehler`, Grund in `sign_error` und `error`). Das signierte PDF hängt dann
als Datei am Entwurf. Der Push „Entwurf wartet“ kommt erst danach. Spätestens
beim Senden wird ein offener Auftrag ausgeführt – schlägt er fehl, wird nicht
gesendet. Gesendet wird weiterhin nur nach Freigabe in der App.

Neu ausführen: `sign_status` wieder auf `''` setzen (hängt eine weitere Datei an).
