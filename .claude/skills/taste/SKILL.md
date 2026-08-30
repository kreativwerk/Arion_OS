---
name: taste
description: Design-System und Geschmacksregeln für Arion OS (dunkel, Supabase-Grün, Transparenzen, Material Symbols, mobile-first). Nutzen bei jeder UI-Änderung, neuen Seite oder Komponente.
---

# taste – Design-Regeln für Arion OS

Vorbild: Supabase-Studio-Ästhetik auf Apple-Niveau. Ruhe, Klarheit, ein grüner Akzent,
transluzente Flächen. **Dark-only** – es gibt keinen Light Mode.

## Tokens (definiert in `app/globals.css`, @theme)

- Seite `--color-ground` #0c0d0e mit dezentem grünem Radial-Glow (body-Gradient)
- **Transparenz-Flächen:** Karten `--color-card` rgba(255,255,255,0.045),
  vertiefte Flächen (Inputs, Code) `--color-inset` rgba(255,255,255,0.07),
  Trennlinien `--color-line` rgba(255,255,255,0.09)
- Text `--color-ink` #ededed, sekundär `ink-2` #a0a0a0, tertiär `ink-3` #666a6e
- **Akzent = Supabase-Grün `--color-accent` #3ecf8e**, Flächen `accent-soft`
  rgba(62,207,142,0.12). Auf grünen Flächen IMMER `text-on-accent` (#05130c),
  nie weiß. `good` = Akzentgrün, `warn` #f5a623, `bad` #f2545b nur als Status.
- Radius: Karten 14 px (`rounded-card`), Icon-Container 11–12 px, Inputs 10 px,
  Buttons/Pills voll rund. Schrift: SF-Stack, Basis 14 px. `color-scheme: dark`.
- Navigation (Sidebar, Bottom-Bar): rgba-Fläche + `backdrop-blur-xl`.

## Icons: Google Material Symbols, keine Emojis

Paket `material-symbols` (self-hosted), Stil Outlined, über `Icon`/`MaybeIcon` aus
`components/ui.tsx`. Emojis sind in der UI verboten; typografische Zeichen (✓ ✕ – →) erlaubt.
Icon-Farbe `ink-2`/`ink-3`; Akzent nur bei aktiver/wichtiger Bedeutung.

## Mobile-first (Pflicht)

- Sidebar nur `lg:` aufwärts; darunter **Bottom-Tab-Bar** (`components/MobileNav.tsx`:
  Heute, Aufgaben, Arion Bot (Logo-Button, mittig, ragt über die schwebende Leiste hinaus), Wissen, Mehr) mit `pb-[env(safe-area-inset-bottom)]`.
  Restliche Module über `/mehr`.
- Layout-Container: `px-4 sm:px-6 lg:px-8`, unten `pb-24 lg:pb-8` (Platz für die Bar).
- Jede neue Seite auf 390 px Breite prüfen: Grids `grid-cols-1`/`grid-cols-2` zuerst,
  `lg:` erweitert; Tabellen in `overflow-x-auto`; Vollhöhen mit `100dvh`, nicht `100vh`.

## Dashboard-Konzept („Heute" = erste und letzte Ansicht des Tages)

Feste Reihenfolge, nicht umbauen:
1. **Kopf:** Begrüßung (+ Name), Datum, Ein-Satz-Zusammenfassung; abends (ab 17 Uhr)
   wechselt die Semantik zu „Noch offen / Tagesabschluss".
2. **Triage:** 4 Kacheln (Benachrichtigungen, Mail, Briefpost, Portale) – Icon im
   grünen Soft-Container, große Zahl in `ink` (Zahl NIE in Akzentfarbe), Label `ink-2`;
   bei 0 gedämpft (opacity, `ink-3`). Kacheln sind Links in die Module.
3. **Fokus:** Aufgabenkarte mit Scroll (`max-h` + `overflow-y-auto`) und rundem
   grünem Plus-Button.
   **Aufgaben werden IMMER über `components/TaskQuickSheet.tsx` angelegt**
   (Bottom Sheet im Google-Tasks-Stil: schlichtes Eingabefeld, Icon-Zeile für
   Details/Datum/Wiederholung/Priorität, „Speichern"). Kein Formular-Grid bauen;
   auf Listen-Seiten öffnet ein Floating-Button (unten rechts, über der Tab-Bar)
   dasselbe Sheet.
4. **Rhythmus:** Gewohnheiten-Chips, nächste Termine.
5. **Risiken:** Vertragsfristen.

## Regeln

1. Komponenten aus `components/ui.tsx` verwenden; neue Varianten dort ergänzen.
2. Hierarchie über Typografie: 26–32 px Titel, 15 px Kartentitel, 13 px Inhalt,
   11–12 px `ink-3` Metadaten. Zahlen groß und in Textfarbe.
3. Flächenlogik: Ground → Karte (transluzent) → Inset. Keine vierte Stufe.
4. Aktionen leise: Destruktives erst bei Hover (`group`); eine Primäraktion pro Karte.
5. Status als Badge, deutsch, knapp. Nur Token-Farben, nie Hex in Komponenten.
6. Deutsch, Du-Form, knapp. Leere Zustände freundlich, ohne Emoji.
