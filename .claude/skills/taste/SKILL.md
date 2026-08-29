---
name: taste
description: Design-System und Geschmacksregeln für Arion OS (Apple-minimalistisch). Nutzen bei jeder UI-Änderung, neuen Seite oder Komponente.
---

# taste – Design-Regeln für Arion OS

Vorbild: Apple. Ruhe, Klarheit, keine Dekoration ohne Information.

## Tokens (definiert in `app/globals.css`, @theme)

- Fläche `--color-ground` #f5f5f7 (dark: #000), Karten `--color-card` weiß (dark: #1c1c1e)
- Text `--color-ink` #1d1d1f, sekundär `ink-2` #6e6e73, tertiär `ink-3` #a1a1a6
- Ein Akzent: `--color-accent` #0071e3 (dark: #0a84ff). Grün/Orange/Rot nur als Status.
- Radius: Karten 18 px (`rounded-card`), Inputs 10 px, Buttons/Pills voll rund
- Schrift: Systemschrift (SF-Stack), Basis 14 px, Tracking -0.01em
- Schatten: nur `--shadow-card` (sehr dezent), nie härter

## Regeln

1. **Komponenten aus `components/ui.tsx` verwenden** (Card, Row, Badge, Button,
   Segmented, Input …). Neue Varianten dort ergänzen, nicht inline erfinden.
2. **Hierarchie über Typografie**, nicht über Farben: 28 px fett für Seitentitel,
   15 px semibold für Kartentitel, 13 px für Inhalte, 11–12 px `ink-3` für Metadaten.
3. **Weißraum ist Feature.** max-w 1080 px, großzügige Kartenabstände (gap-5),
   nie mehr als zwei Spalten Inhaltskarten.
4. **Aktionen leise:** Destruktives (Löschen) erst bei Hover sichtbar (`group`),
   primäre Aktion pro Karte höchstens eine.
5. **Status als Badge**, deutsch und knapp („neu", „aktion", „noch 12 Tage").
6. **Dark Mode ist Pflicht:** nur Token-Farben verwenden, nie Hex-Werte in Komponenten.
7. **Deutsch, Du-Form, knapp.** Leere Zustände freundlich („Nichts fällig – freier Kopf. 🎉").
8. **Emojis nur als Icons** (Navigation, Habits), nie im Fließtext der UI.
