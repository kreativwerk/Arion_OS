---
name: taste
description: Design-System und Geschmacksregeln für Arion OS (Apple-minimalistisch, dunkel, Material Symbols). Nutzen bei jeder UI-Änderung, neuen Seite oder Komponente.
---

# taste – Design-Regeln für Arion OS

Vorbild: Apple im Dark Mode. Ruhe, Klarheit, keine Dekoration ohne Information.
**Das Design ist bewusst dark-only** – es gibt keinen Light Mode.

## Tokens (definiert in `app/globals.css`, @theme)

- Seite `--color-ground` #000000, Karten `--color-card` #1c1c1e,
  vertiefte Flächen (Inputs, Code) `--color-inset` #2c2c2e
- Text `--color-ink` #f5f5f7, sekundär `ink-2` #a1a1a6, tertiär `ink-3` #6e6e73
- Trennlinien `--color-line` rgba(255,255,255,0.1)
- Ein Akzent: `--color-accent` #0a84ff. Grün #30d158 / Orange #ff9f0a / Rot #ff453a nur als Status.
- Radius: Karten 18 px (`rounded-card`), Inputs 10 px, Buttons/Pills voll rund
- Schrift: Systemschrift (SF-Stack), Basis 14 px, Tracking -0.01em
- `color-scheme: dark` ist gesetzt, damit native Controls (Datum/Zeit) dunkel rendern

## Icons: Google Material Symbols, keine Emojis

- Paket `material-symbols` (self-hosted, offline-fähig), Stil **Outlined**, opsz 20.
- Immer über die `Icon`-Komponente aus `components/ui.tsx` (`<Icon name="calendar_month" />`);
  für Nutzerdaten, die alte Emojis enthalten könnten, `MaybeIcon`.
- Emojis sind in der UI verboten – auch in Empty States und Überschriften.
  Typografische Zeichen (✓ ✕ – →) sind erlaubt.
- Icon-Farbe standardmäßig `ink-2`; Akzentfarbe nur, wenn das Icon eine aktive/wichtige
  Bedeutung trägt (z.B. gepinnt, Jarvis).

## Regeln

1. **Komponenten aus `components/ui.tsx` verwenden** (Card, Row, Badge, Button,
   Segmented, Input, Icon …). Neue Varianten dort ergänzen, nicht inline erfinden.
2. **Hierarchie über Typografie**, nicht über Farben: 28 px fett für Seitentitel,
   15 px semibold für Kartentitel, 13 px für Inhalte, 11–12 px `ink-3` für Metadaten.
3. **Flächenlogik:** Seite schwarz → Karte #1c1c1e → vertiefte Fläche #2c2c2e.
   Nie eine vierte Helligkeitsstufe einführen.
4. **Weißraum ist Feature.** max-w 1080 px, großzügige Kartenabstände (gap-5),
   nie mehr als zwei Spalten Inhaltskarten.
5. **Aktionen leise:** Destruktives (Löschen) erst bei Hover sichtbar (`group`),
   primäre Aktion pro Karte höchstens eine.
6. **Status als Badge**, deutsch und knapp („neu", „aktion", „noch 12 Tage").
7. **Nur Token-Farben verwenden**, nie Hex-Werte in Komponenten.
8. **Deutsch, Du-Form, knapp.** Leere Zustände freundlich, ohne Emoji.
