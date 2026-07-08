# Implementierungsplan für Claude Code

Dieses Dokument beschreibt Architektur, Tech-Stack und Umsetzungsreihenfolge für die in `game-spec.md` beschriebene Spezifikation, geprüft gegen `design-toolbox.md`. Alle drei Dokumente sollten im Repository liegen (Vorschlag: `/docs/`) und von Claude Code bei Design-Entscheidungen konsultiert werden, die hier nicht abschließend geklärt sind.

---

## 1. Tech-Stack

| Bereich | Wahl | Begründung |
|---|---|---|
| Sprache | TypeScript (durchgängig) | Fehler bei großen Zahlen/State früh fangen, bessere Wartbarkeit bei mehreren generierten Modulen |
| Build/Dev-Server | Vite | Erzeugt einen statischen `dist`-Ordner, der 1:1 auf GitHub Pages passt; sehr schnelles Hot-Reload während Entwicklung |
| Arcade-Rendering | Phaser 3 | Etabliertes HTML5-Game-Framework mit riesigem Beispiel-Fundus, vollständigen TypeScript-Definitionen und einem offiziellen Phaser+React+TypeScript+Vite-Template als Ausgangspunkt |
| Hallen-/Menü-UI | React | Für Listen, Zahlen, Buttons, Modals besser geeignet als Phasers UI-Systeme; offizielles Template zeigt bereits die Integration beider |
| Große Zahlen | break_infinity.js | Speziell für Incremental Games gebaut (u. a. von Antimatter Dimensions verwendet), TypeScript-Typdefinitionen vorhanden, deutlich schneller als generische Decimal-Bibliotheken. Erweiterbar auf `break_eternity.js`, falls Layer 2 später extremere Zahlenbereiche braucht |
| Speicherstand | `localStorage` + JSON-Export/Import-Funktion | GitHub Pages ist rein statisch, kein Backend möglich; Export/Import als Textstring dient als manuelles Backup zwischen Geräten |
| Tests | Vitest | Läuft nativ mit Vite, keine zusätzliche Konfiguration; Kernlogik (Economy, PatternEngine) lässt sich ohne Browser testen |
| Hosting/Deployment | GitHub Pages via GitHub Actions | Bei jedem Push auf `main` automatischer Build + Deploy des `dist`-Ordners |

**Hinweis Phaser-Version:** Es existiert bereits Phaser 4 (neuer WebGL-Renderer), jedoch mit deutlich kleinerem Beispiel-/Tutorial-Fundus als Phaser 3. Für eine von Claude Code umgesetzte Implementierung ist Phaser 3 die sicherere Wahl (mehr Trainingsdaten, mehr dokumentierte Patterns, geringeres Risiko veralteter/fehlerhafter API-Annahmen). Umstieg auf Phaser 4 ist eine spätere Option, kein Startpunkt.

---

## 2. Architekturprinzip: Engine getrennt von Darstellung

Die Kernlogik (Wirtschaft, Zufallssystem, Speicherstand, Fortschrittsregeln) lebt in einem **framework-unabhängigen** TypeScript-Modul (`/src/engine`), das weder Phaser noch React kennt. Phaser-Szenen und React-Komponenten lesen/schreiben nur über eine definierte Schnittstelle auf diesen State. Vorteile:

- Kernlogik ist ohne Browser testbar (wichtig für Vitest + für Claude Code, um Wirtschafts-Balance ohne manuelles Klicken zu verifizieren)
- Ein Bug in der Darstellung kann die Wirtschaftslogik nicht korrumpieren
- Die 4 Automaten teilen sich dieselben Engine-Module (PatternEngine, PushYourLuckEngine, AttendantEngine) statt eigener Parallel-Implementierungen

```
/src
  /engine
    EconomyStore.ts       // Tickets, Credits, Umrechnung, Hallen-Upgrades
    PatternEngine.ts       // Markov-artige Zustandsübergänge, progressive Teilaufdeckung
    PushYourLuckEngine.ts  // Meilensteine, Banking, Safe/Balanced/Risky-Payouts
    AttendantEngine.ts     // Musterkenntnis-Wert, automatisierte Ausführung
    SaveSystem.ts          // localStorage + JSON Export/Import
    types.ts               // gemeinsame Typdefinitionen
    events.ts               // einfacher EventEmitter/Pub-Sub zwischen Engine und Darstellung

  /data
    machines.config.ts     // je Automat: Thema, Pattern-Parameter, Payout-Tabellen, Upgrade-Liste
    hall.config.ts          // Hallen-Upgrades, Freischalt-Schwellen

  /game                     // Phaser-Teil
    scenes/
      BootScene.ts
      MachineScene.ts       // eine parametrisierbare Szene für alle 4 Automaten (liest machines.config.ts)
      TransitionScene.ts    // Reveal-Übergang Layer 0 → Layer 1
    main.ts                 // Phaser-Bootstrapping

  /ui                        // React-Teil
    HallHub.tsx
    UpgradePanel.tsx
    MachineSelect.tsx
    AttendantPanel.tsx
    SettingsModal.tsx
    SaveExportImport.tsx

  App.tsx                    // mountet React um/neben den Phaser-Canvas (gemäß offiziellem Template)
  main.tsx                   // Einstiegspunkt
```

**Wichtig für Claude Code:** `machines.config.ts` sollte alle vier Automaten **datengetrieben** beschreiben (Pattern-Parameter, Payout-Tabellen, Upgrade-Listen als Konfigurationsobjekte), sodass `MachineScene.ts` eine einzige generische Szene ist, die per Konfiguration unterschiedlich aussieht/funktioniert – nicht vier separate Szenen-Klassen. Das reduziert Redundanz und macht Balancing-Änderungen zu reinen Datenänderungen.

---

## 3. Starter-Datentypen (Skelett)

Ausgangspunkt für `src/engine/types.ts`, Details werden bei Implementierung verfeinert. Zweck: den interpretationsanfälligsten Teil der Architektur (PatternEngine + PushYourLuckEngine + datengetriebene Automaten-Config) auf eine gemeinsame Struktur festlegen, bevor Code entsteht.

```typescript
interface MachineConfig {
  id: string;
  name: string;
  theme: string;
  entryPoint: boolean;              // true nur beim Layer-0-Automaten
  pattern: PatternConfig;
  riskTiers: RiskTier[];
  milestones: Milestone[];
  upgrades: UpgradeDef[];
}

interface PatternConfig {
  states: string[];                                      // z. B. ["aggressiv", "defensiv", "finte"]
  transitions: Record<string, Record<string, number>>;    // state -> state -> Wahrscheinlichkeit
  baseVisibility: number;                                 // 0–1, initial sichtbarer Anteil
  visibilityPerUpgrade: number[];                         // Freischalt-Stufen je Upgrade-Level
}

interface RiskTier {
  id: "safe" | "balanced" | "risky";
  payoutRange: [min: number, max: number];                // sichtbare Bandbreite (Baukasten 1.11)
  failureChance: number;                                    // 0 bei "safe"
}

interface Milestone {
  threshold: number;                                        // benötigte Punkte
  bankable: boolean;                                         // an diesem Punkt sicherbar
}

interface UpgradeDef {
  id: string;
  cost: number;                                              // in Credits
  effect: UpgradeEffect;                                     // z. B. { type: "visibility", value: 1 } | { type: "attendantSpeed", value: 0.1 }
}

interface EngineState {
  saveVersion: number;
  credits: Decimal;                                          // break_infinity.js Decimal
  ticketsByMachine: Record<string, Decimal>;
  unlockedMachines: string[];
  attendantKnowledge: Record<string, number>;                // 0–1 pro Automat
  hallUpgrades: string[];
  completedMachines: string[];                                // "durchgespielt" laut game-spec.md 4.1
}
```

## 4. Phasenplan

Jede Phase endet mit einem lauffähigen Zwischenstand. Vor Abschluss einer Phase: kurzer Check gegen `design-toolbox.md`, Abschnitt 4 (Prüf-Checkliste).

### Phase 0 — Projekt-Setup
- Vite + Phaser 3 + React + TypeScript Grundgerüst (offizielles Phaser-Template als Basis)
- `break_infinity.js` einbinden, einfacher Test-Zähler mit großen Zahlen
- GitHub Actions Workflow für Build + Deploy auf GitHub Pages
- **Abnahme:** Leere Seite lädt lokal und über GitHub Pages, zeigt eine hochzählende Testzahl

### Phase 1 — Engine-Kern (ohne UI)
- `EconomyStore`, `SaveSystem`, `events.ts`
- Vitest-Tests für Grundrechenoperationen, Speichern/Laden
- **Abnahme:** Engine-Logik läuft und ist per Unit-Test verifiziert, ganz ohne Phaser/React

### Phase 2 — PatternEngine + PushYourLuckEngine (Kernsysteme)
- Generische, wiederverwendbare Implementierung beider Systeme laut `game-spec.md` Abschnitt 4.1
- Unit-Tests: Verteilungs-Korrektheit, Banking-Logik, Meilenstein-Auswertung
- **Abnahme:** Beide Systeme lassen sich mit Test-Konfigurationsdaten (ohne echtes Grafik-Automat) durchspielen und liefern nachvollziehbare Ergebnisse

### Phase 3 — Automat 1 als vertikaler Vollschnitt ("Greed Run")
- `MachineScene.ts` generisch bauen, erste Konfiguration in `machines.config.ts`
- Layer-0-Erlebnis: Spiel startet direkt im Automaten, kein Hallen-UI sichtbar
- **Abnahme:** Automat 1 komplett spielbar von Planungsphase bis Durchspielen, inkl. Banking-Entscheidungen

### Phase 4 — Reveal + Hallen-Grundgerüst
- `TransitionScene.ts`, `HallHub.tsx`
- Übergang vom Durchbruch-Moment in die sichtbare Spielhalle
- **Abnahme:** Nach Erreichen der Durchbruch-Schwelle in Automat 1 wechselt das Spiel sichtbar in die Hallenansicht

### Phase 5 — Attendant-System
- `AttendantEngine`, `AttendantPanel.tsx`
- Freischaltung nach Durchspielen von Automat 1, Musterkenntnis-Fortschritt
- **Abnahme:** Automat 1 läuft im Hintergrund automatisiert weiter, während der Spieler in der Halle ist

### Phase 6 — Automaten 2–4
- Je Automat: neue Konfiguration in `machines.config.ts`, Freischalt-Logik in der Halle
- **Abnahme:** Alle 4 Automaten einzeln spielbar, unterscheidbar, jeweils mit eigenem Attendant nach Durchspielen

### Phase 7 — Hallen-Upgrades & Cross-Layer-Feedback
- `UpgradePanel.tsx`, `hall.config.ts`
- Hallen-Upgrades verbessern Ticket-Umrechnung UND Attendant-Trainingsgeschwindigkeit (Baukasten 1.14)
- **Abnahme:** Vollständiger Kreislauf Tickets → Credits → Hallen-Upgrades → verbesserte Automaten spielbar

### Phase 8 — Politur / Juice
- Animationen, Sound-Feedback, Kausalitäts-Anzeigen bei Fehlschlägen (Baukasten 1.10/1.11)
- Opt-in-Tiefe-UI (einfaches Ampel-Signal Standard, Detailwerte optional)
- **Abnahme:** Spiel fühlt sich vollständig an, alle Punkte der Prüf-Checkliste aus `design-toolbox.md` sind erfüllbar

### Phase 9 — Abschluss-Erlebnis
- Hallen-weiter Abschlussmoment nach Durchspielen aller 4 Automaten
- Andeutung von Layer 2, ohne ihn zu implementieren
- **Abnahme:** Spiel hat einen erkennbaren, befriedigenden Endpunkt für diese Spezifikation (Baukasten 1.6)

---

## 5. Deployment

```yaml
# .github/workflows/deploy.yml (Kurzskizze)
# - Trigger: push auf main
# - Schritte: npm ci → npm run build → Veröffentlichung des dist-Ordners auf GitHub Pages
```

GitHub Pages Zielzweig/Ordner je nach Repo-Einstellung konfigurieren (klassisch: `gh-pages`-Branch oder Pages-Actions-Deployment direkt aus `dist`).

---

## 6. Arbeitsanweisung für Claude Code

1. Immer zuerst `game-spec.md` für "Was soll gebaut werden" konsultieren
2. Bei Unklarheiten oder neuen Mechanik-Ideen gegen `design-toolbox.md` Abschnitt 4 (Checkliste) prüfen, bevor Code geschrieben wird
3. Engine-Module (`/src/engine`) immer zuerst mit Vitest-Tests absichern, bevor Phaser/React-Anbindung erfolgt
4. Keine Automaten-spezifische Logik hart in Szenen-Code schreiben – alles über `machines.config.ts` steuerbar halten
5. Bei Phasenabschluss: kurze Selbstprüfung anhand der jeweiligen "Abnahme"-Kriterien oben
