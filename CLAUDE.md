# CLAUDE.md

## Projekt

Arcade-Incremental-Browserspiel (Arbeitstitel). Spieler startet in einem einzelnen Arcade-Minispiel, entdeckt nach einem Durchbruch eine Spielhalle mit mehreren Automaten, verbessert die Halle mit der gesammelten Automaten-Währung. Statisches Browserspiel, gehostet auf GitHub Pages, kein Backend.

## Voraussetzungen

Node.js 18+, npm als Paketmanager (kein yarn/pnpm-Mix). Falls das Phaser+React+TS+Vite-Template eigene Befehle/Konventionen vorgibt, dessen Konvention übernehmen statt hier künstlich zu überschreiben.

## Zuerst lesen

Zuerst `STATUS.md` (Repo-Root) für den aktuellen Fortschritt, danach in dieser Reihenfolge:

1. `docs/game-spec.md` — was gebaut werden soll (Layer 0 + Layer 1, 4 Automaten)
2. `docs/implementation-plan.md` — Tech-Stack, Architektur, Ordnerstruktur, Phasenplan mit Abnahmekriterien
3. `docs/design-toolbox.md` — Prüfkatalog für jede neue oder unklare Mechanik-Entscheidung (Abschnitt 4: Checkliste)

Diese Datei hier dupliziert deren Inhalt nicht. Bei Widerspruch zwischen dieser Datei und den drei Dokumenten: die drei Dokumente gewinnen.

## Architektur-Kurzregel

Kernlogik (`/src/engine`) kennt weder Phaser noch React. Phaser (`/src/game`) und React (`/src/ui`) lesen/schreiben nur über die Engine-Schnittstelle. Automaten-spezifische Werte gehören in `/src/data/machines.config.ts`, nicht hart in Szenen-Code. Details: `docs/implementation-plan.md` Abschnitt 2.

## UI-Grundsatz: Barrierefreiheit bei Farbcodierung

Gilt für JEDE Mechanik, die Zustände/Aktionen/Kategorien über Farbe
unterscheidbar macht (nicht nur Phase 7e) — dauerhaft zu beachten, nicht nur
einmalig abzuhaken:

- Farbpaletten farbenblind-sicher wählen (z. B. Okabe-Ito-Palette statt
  beliebiger Rot/Grün-Kontraste).
- Farbe ist niemals das EINZIGE Unterscheidungsmerkmal. Immer mit einem
  zweiten, farbunabhängigen Merkmal koppeln: Symbol/Icon-Form, Position/
  Anordnung, Buchstabe/Nummer, Muster.
- Bei neuen Mechaniken mit Farbcodierung diesen Grundsatz genauso prüfen wie
  die Checkliste in `docs/design-toolbox.md` Abschnitt 4.

## Befehle

```
npm run dev       # lokaler Dev-Server mit Hot-Reload
npm run build      # Produktions-Build nach dist/
npm run test        # Vitest — vor allem für /src/engine
npm run lint         # falls eingerichtet, vor Commit ausführen
```

## Workflow-Regeln

- Neue Engine-Logik zuerst mit Vitest absichern, danach erst an Phaser/React anbinden
- Neue Mechanik-Idee, die nicht eindeutig in `game-spec.md` steht → erst gegen `design-toolbox.md` Abschnitt 4 prüfen, dann implementieren
- Automaten dürfen eigene, genre-spezifische Darstellungs-/Interaktionslogik (eigene Phaser-Szene) bekommen, wenn ihre Mechanik strukturell vom gemeinsamen Zyklus-Modell abweicht (siehe `game-spec.md` 4.2 für Automat 1 als erstes Beispiel, Stand 2026-07-10). Die gemeinsame Buchhaltung (`EconomyStore`, `SaveSystem`, Tickets-/Meilenstein-Anbindung) bleibt trotzdem geteilt und darf nicht dupliziert werden. Automaten, die weiterhin dem gemeinsamen Zyklus-Modell aus `game-spec.md` 4.1/4.1b/4.1c folgen (aktuell 2–4), bleiben über die bestehende generische `MachineScene.ts`
- Phasenreihenfolge aus `implementation-plan.md` Abschnitt 3 einhalten; jede Phase hat eigene Abnahmekriterien
- Es existieren noch keine Grafik-/Sound-Assets. Bis einschließlich Phase 8 (Politur) Platzhalter verwenden (Phaser Graphics-Primitives: Rechtecke, Kreise, Text) statt Bild- oder Audio-Dateipfade zu erfinden
- Nach Abschluss jeder Phase anhalten, die Abnahmekriterien der Phase kurz zusammenfassen und auf Rückmeldung warten – nicht automatisch mit der nächsten Phase weitermachen

## Hinweis: manueller Schritt außerhalb von Claude Code

GitHub Pages muss einmalig unter *Settings → Pages* auf "GitHub Actions" als Source gestellt werden – das kann nur der Mensch im Web-Interface erledigen. Schlägt der Deploy-Workflow fehl, obwohl der Build lokal funktioniert, ist das wahrscheinlich die Ursache. Nicht den Workflow deswegen umschreiben, sondern nachfragen.

## Bekannte offene Fragen

Siehe `game-spec.md` Abschnitt 6 (u. a. welcher Automat Layer 0 startet, exakte Zahlenbalance). Nicht raten — bei Unsicherheit nachfragen statt willkürlich festlegen.
