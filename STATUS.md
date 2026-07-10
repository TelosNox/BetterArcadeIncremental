# STATUS.md

Wird nach jeder abgeschlossenen Phase aktualiziert. Einzige Quelle der Wahrheit für "wo stehen wir gerade" über Tool-/Session-Grenzen hinweg (Claude Code, Cowork, neue Chats).

## Aktueller Stand

**Zuletzt abgeschlossen:** Phase 7h (Greed Run Rundenstruktur-Korrektur, siehe "Ergebnis"-Abschnitt unten) — ein Run besteht jetzt aus genau EINER Planungs-+Ausführungsphase, "Los" beendet ihn immer, unabhängig vom Restbudget; der nächste Run startet direkt wieder im Mittelfeld. `npm test`/`npm run lint`/`npx tsc --noEmit` grün (Testcount unverändert 273, wie erwartet — reine Scene-Verhaltenskorrektur), per Playwright-Smoke-Test visuell bestätigt (Teil-Plan mit 2 von 4 Zügen ausgeführt → Run endet sofort, neuer Run startet frisch im Zentrum mit vollem Budget) — **noch nicht vom Nutzer im erneuten Playtest bestätigt**.
**Läuft/als Nächstes:** Erneuten Playtest der Rundenstruktur-Korrektur abwarten, erst danach Entscheidung über Trap Tunnels/Beat Ledger/Champion's Ledger im selben Stil. Bekannte, bewusst weiterhin nicht behobene Punkte: (1) Progression/Balance-Tuning bleibt zurückgestellt; (2) Aktionsbudget-Upgrades wirken erst ab dem NÄCHSTEN Run (unverändert gültig, jetzt sogar konsistenter, da ein Run ohnehin nur noch eine Planungsphase umfasst). Phase 8 (Politur) bleibt zurückgestellt.

## NEUE PHASE 7h: Greed Run Rundenstruktur-Korrektur (2026-07-10)

Playtest-Feedback: Wenn nicht das volle Aktionsbudget verplant und "Los" gedrückt wird, blieb die Position bisher an der Stelle stehen, an der die Ausführung endete, und eine ZWEITE Planungsphase mit dem Restbudget begann von dort aus (ursprüngliches Phase-7f-Design: ein Run = mehrere Planungsrunden bis das Budget erschöpft ist). Das fühlt sich falsch an — ein Run soll IMMER im Mittelfeld starten.

**Korrigierte Regel (ersetzt den bisherigen "mehrere Planungsrunden pro Run"-Ansatz vollständig, siehe game-spec.md 4.2 "Rundenstruktur"):**

- Ein Run besteht aus GENAU EINER Planungsphase + EINER Ausführungsphase.
- Spieler plant 1 bis zu (aktuelles Aktionsbudget) Schritte.
- "Los" führt die geplanten Schritte aus UND beendet damit den Run unwiderruflich — unabhängig davon, ob das volle Aktionsbudget verplant wurde. Nicht genutztes Budget verfällt ersatzlos, es gibt keine Fortführung aus der Endposition.
- Direkt nach Ausführungsende startet immer der nächste Run im Mittelfeld mit frisch generiertem Feld (Fokus-Popup oder automatischer Neustart je nach "beibehalten"-Checkbox — dieser Teil bleibt unverändert aus Phase 7f/7g).
- Dadurch entsteht eine zusätzliche echte Entscheidung: früh mit "Los" abbrechen (weniger Risiko, kürzerer Weg ab dem bekannten Zentrum) vs. das volle Aktionsbudget ausreizen (mehr Ertrag, aber tiefer in ungesicherte, evtl. nicht mehr sichtbare Zonen vordringen).

**Technische Konsequenz (Ermessen Claude Code bei der genauen Umsetzung):** In `GreedRunScene.finishExecution()` die bisherige Fallunterscheidung `if (this.runEngine.isFinished())` (Run fortsetzen vs. beenden) entfernen — der Run endet nach `runQueueStep` IMMER, unabhängig vom verbleibenden `actionsRemaining`-Stand der `GridRunEngine`-Instanz. Prüfen, ob `GridRunEngine.isFinished()`/`actionsRemaining` dadurch nur noch die Queue-Längen-Begrenzung während der Planung braucht (Obergrenze für `plannedMoves`), nicht mehr eine "läuft der Run weiter"-Bedingung — ggf. vereinfachen, aber nicht zwingend, falls die bestehende Struktur ohne Verhaltensänderung weiterverwendet werden kann.

**Bewusst NICHT Teil dieser Korrektur:** keine Änderung an Sichtweite/Präzision (Phase 7g bleibt gültig), keine Balance-Änderungen, keine neuen Mechaniken.

### Ergebnis: Phase 7h umgesetzt (2026-07-10)

In `GreedRunScene.finishExecution()` die Fallunterscheidung
`if (this.runEngine.isFinished())` entfernt — der Run endet jetzt nach
`runQueueStep` IMMER (Bank/Meilenstein-Check läuft unverändert davor,
danach direkt Feedback-Ergänzung "Lauf beendet." + entweder
`startNewRun()` (Checkbox aktiv) oder Fokus-Popup). Der bisherige
`this.phase = 'planning'`-Fortsetzungspfad (Run mit Restbudget von der
aktuellen Position weiterlaufen lassen) ist damit vollständig entfallen.

`GridRunEngine.ts`/`AttendantEngine.ts` und ihre Tests bewusst NICHT
angefasst, wie gefordert: `isFinished()` bleibt Teil der Engine-API (samt
Test, prüft weiterhin korrekt Budget-Erschöpfung auf Engine-Ebene), wird
von der Szene nur nicht mehr aufgerufen. `getActionsRemaining()` bleibt
in `canQueueDirection`/der Statusanzeige unverändert die Obergrenze für
die Planungs-Warteschlange — da ein Run jetzt strukturell nie mit
verbrauchtem Teilbudget weiterläuft, entspricht `getActionsRemaining()`
während der Planungsphase immer exakt dem vollen, aktuell gekauften
Aktionsbudget.

**Verifiziert:** `npm test` (**273/273 grün, unverändert**, wie erwartet
bei einer reinen Scene-Verhaltenskorrektur ohne Engine-Änderung),
`npm run lint` sauber, `npx tsc --noEmit` sauber. Zusätzlich per
Playwright-Skript gegen `npm run dev-nolog` (Skript + temporäre
Playwright-Installation danach wieder entfernt) visuell bestätigt: nur 2
von 4 möglichen Zügen geplant, "Los!" gedrückt — Feedback zeigt "Lauf
beendet." nach Schritt 2, direkt im Anschluss zeigt die Szene wieder
"Aktionen 4 verbleibend", die aktuelle Position ist zurück im Mittelfeld,
die "Bereits besucht"-Markierung des vorherigen Laufs ist verschwunden
(neues Feld, neuer `GridRunEngine`), keine Konsolenfehler. **Noch nicht
vom Nutzer selbst erneut gespielt/bestätigt.**

## NEUE PHASE 7g: Greed Run Korrekturen nach Playtest (2026-07-10)

Nutzer-Feedback nach dem ersten echten Playtest von Phase 7f, zwei gezielte Korrekturen (kein neues Feature, Feinschliff an Bestehendem):

1. **Sichtweite fix am Startsektor verankern, nicht an der aktuellen Position.** Bisher (`GreedRunScene.renderGrid` → `this.runEngine.getVisibleSectors(sightRange)`) wandert der sichtbare Bereich bei jeder Bewegung mit der Spielerposition mit — im Spiel verwirrend. Korrektur: der sichtbare Bereich ist ein Manhattan-Radius um den STARTSEKTOR (`getStartPosition(gridSize)`), bleibt für den gesamten Run unverändert. Wer den sichtbaren Bereich verlässt, läuft komplett blind weiter (das ist gewollt, kein zusätzlicher Constraint nötig). `docs/game-spec.md` 4.2 bereits entsprechend korrigiert.
2. **Präzisions-Symbole zeigen künftig die noch MÖGLICHEN Kategorien, nicht die ausgeschlossenen.** Bisher (`renderGrid`, `knowledge.excluded.forEach(...)`) wurden pro Sektor kleine Punkte für bereits ausgeschlossene Kategorien gezeichnet — für den Spieler nicht eindeutig, ob die Punkte "das ist es noch" oder "das ist es NICHT" bedeuten. Korrektur: stattdessen die noch möglichen Kategorien zeigen (`SECTOR_CATEGORIES` minus `knowledge.excluded`), mit Farbe UND Kategorie-Buchstabe (nicht nur Farbe, wie beim übrigen Barrierefreiheits-Grundsatz). Bei Präzision 0 (noch nichts ausgeschlossen) weiterhin nur das neutrale "?" ohne Symbole zeigen, sonst zu viel Unordnung ohne Informationsgewinn. Legende (`renderLegend`) um eine kurze erklärende Zeile ergänzen, die diese Konvention explizit benennt.

**Bewusst NICHT Teil dieser Korrektur:** keine neuen Mechaniken, keine Balance-Änderungen — reine Klarheits-/Verhaltenskorrektur an der bestehenden Phase-7f-Implementierung.

### Ergebnis: Phase 7g umgesetzt (2026-07-10)

Beide Korrekturen ausschließlich in `src/game/scenes/GreedRunScene.ts`
(`renderGrid`/`renderLegend`) — `GridRunEngine.ts`, `AttendantEngine.ts`
und deren Tests bewusst NICHT angefasst (Kern-Logik unverändert, reine
Darstellungs-Korrektur), wie gefordert.

**Fix 1 (Sichtweite fix am Startsektor):** `renderGrid` berechnet
`visibleKeys` jetzt über die freie Funktion `getVisibleSectors(
getStartPosition(gridSize), sightRange, gridSize)` (beide neu aus
`GridRunEngine.ts` importiert) statt über `this.runEngine.getVisibleSectors
(sightRange)` (die intern die AKTUELLE Position nutzt). Die
`GridRunEngine`-Instanzmethode `getVisibleSectors` selbst bleibt
unverändert im Engine-Code stehen (samt ihrem bestehenden Test, der
explizit ihr "um die aktuelle Position"-Verhalten prüft) — sie wird von der
Szene schlicht nicht mehr aufgerufen, aber als legitimer Teil der
Engine-API nicht entfernt, um den Test nicht anfassen zu müssen.

**Fix 2 (mögliche statt ausgeschlossene Kategorien):** im
"sichtbar, aber nicht vollständig bekannt"-Zweig wird jetzt
`SECTOR_CATEGORIES.filter(c => !knowledge.excluded.includes(c))`
berechnet und pro verbleibender Kategorie ein kleines Ecken-Symbol
gezeichnet (`addPossibleCategoryTick`, neue private Methode) — Farbe
(`getSectorColor`) UND Buchstabe (`SECTOR_SYMBOLS`) gekoppelt, `'empty'`
zeigt wie in der Legende nur die Farbfläche ohne Buchstabe. Bei
`knowledge.excluded.length === 0` (Präzision 0) weiterhin nur das neutrale
"?" ohne Symbole. `renderLegend` um eine erklärende Zeile ergänzt ("Kleine
Symbole in Zelle = dort noch mögliche Kategorien") — bewusst mit schmalem
`wordWrap` (155px), damit sie links vom Fokus-HUD-Chip bleibt statt ihn zu
überlappen (beim ersten Verifikations-Durchlauf per Screenshot als
Layout-Kollision aufgefallen und direkt korrigiert).

**Verifiziert:** `npm test` (**273/273 grün, unverändert** — wie gefordert
keine Test-Deltas, da nur Scene-Darstellung betroffen), `npm run lint`
sauber, `npx tsc --noEmit` sauber. Zusätzlich per Playwright-Skript gegen
`npm run dev-nolog` (Skript + temporäre Playwright-Installation danach
wieder entfernt, nicht Teil des Repos) mit Screenshots visuell geprüft:
frischer Run mit Fokus "Sicher" zeigt die 4 Start-Nachbarn korrekt (1
davon voll aufgedeckt als Geist, die übrigen 3 mit je 2 Ecken-Symbolen
"P"/"B" = Punkte oder Bonus noch möglich, Geist bereits ausgeschlossen);
nach zwei ausgeführten "Rechts"-Zügen bleibt der sichtbare Bereich
sichtbar UNVERÄNDERT um die ursprüngliche Mitte (nicht um die neue
Position) — Fix 1 bestätigt. Keine Konsolenfehler. **Noch nicht vom
Nutzer selbst erneut gespielt/bestätigt.**

## NEUE PHASE 7f: Greed Run Genre-Rework (2026-07-10, mit Nutzer abgestimmt, Experiment)

Hintergrund: Alle vier Automaten liefen bisher über dasselbe generische Zyklus-Modell (5 Aktionen kontern 5 Pattern-Zustände, siehe 4.1b/4.1c) — nur Thema/Optik unterschieden sich. Das fühlt sich laut Nutzer-Feedback wie eine austauschbare Skin an, nicht wie vier verschiedene Automaten-Genres. Statt alle vier gleichzeitig umzubauen, wird zuerst NUR Automat 1 ("Greed Run") grundlegend neu gebaut, um den Ansatz "von der Genre-Essenz her denken statt Skin über bestehende Mechanik" an einem Beispiel zu verproben, bevor Trap Tunnels/Beat Ledger/Champion's Ledger angefasst werden.

Vollständige Spezifikation: `docs/game-spec.md` Abschnitt 4.2 (komplett neu geschrieben) — bitte von dort übernehmen, hier nur die Zusammenfassung der wichtigsten Punkte für Claude Code:

1. **5×5-Sektorenfeld, Start im Mittelfeld (3,3), Bewegung in 4 Richtungen.** Kein Diagonal-, kein Stehenbleiben-Zug in dieser Version.
2. **Fester, einmalig pro Run generierter Sektorinhalt** (weiterhin "festes Pattern pro Run"): 24 Nicht-Start-Sektoren, je einer von 4 Kategorien — Geist (negativ), Punkte (klein positiv, Mehrheitsfall), Leer (0), Bonus-Frucht (größer positiv, selten). Keine Powerpille in dieser Version.
3. **Verbrauchsregel:** Betretener Sektor wird für den Rest des Runs zu Leer — gilt für alle vier Kategorien inklusive Geist (keine zweite Strafe an derselben Stelle).
4. **Sicherheits-Constraint (weich, keine Garantie):** unter den bis zu 4 direkten Nachbarn des Startfelds höchstens 1 Geist.
5. **Blind-Erwartungswert-Garantie automatisiert prüfen:** über die Kategorien-Häufigkeit gemittelter Payout eines komplett unvorbereiteten Zugs muss positiv bleiben (gleiches Prinzip wie bei den anderen Automaten, nur jetzt über Kategorien-Verteilung statt Markov-Verteilung).
6. **Drei unabhängige, ticket-finanzierte Upgrade-Achsen:**
   - Sichtweite 1–4 (Start 1): Manhattan-Distanz-Radius ab AKTUELLER Position, nach jedem Zug neu zentriert. Bei 4 sind ab der Mitte alle Ecken erreichbar (Distanz Mitte→Ecke = 4 auf einem 5×5-Feld).
   - Präzision 0–3 (Start 1): wie viele der 4 Kategorien pro sichtbarem Sektor aufgelöst sind, Reihenfolge fokus-abhängig (siehe Punkt 7), bei 3 vollständig bekannt.
   - Aktionsbudget (Start 4, Obergrenze offen/iterativ): Züge pro Run — bewusst UNABHÄNGIG von der Sichtweite (Abweichung von der 4.1c-Regel "Warteschlangenlänge = Sichtweite", hier bewusst, weil man weiter laufen kann als man sieht).
7. **Fokus-Wahl Sicher/Gier, pro Run fix, kostenlos wechselbar zwischen Runs:**
   - Sicher-Fokus: Präzision 1 deckt zuerst zuverlässig "Geist ja/nein" auf.
   - Gier-Fokus: Präzision 1 deckt zuerst zuverlässig "Bonus ja/nein" auf.
   - Präzision 2/3 lösen weitere Kategorien in fester, fokus-abhängiger Reihenfolge auf (Ermessen Claude Code für genaue Sekundär-Reihenfolge, Vorschlag in game-spec.md 4.2).
8. **UI-Ablauf Fokus-Wahl:** Popup VOR Rundenstart mit den zwei Optionen, KEINE Checkbox im Popup. Permanenter HUD-Chip während des Laufs zeigt aktiven Fokus + Checkbox "für nächsten Lauf beibehalten" (Standard an). Checkbox aktiv → nächster Run startet direkt ohne Popup. Checkbox deaktiviert → Popup erscheint beim nächsten Rundenstart wieder.
9. **Ausdrücklich zurückgestellt (Backlog, nicht vergessen):** Powerpille, bewegliche Geister, Zeitlimit in der Planungsphase.
10. **Attendant-Automatisierung:** bestehende Markov-EV-Mathematik passt nicht mehr. Grob vereinfachte Platzhalter-Schätzung reicht für dieses Experiment (z. B. Erwartungswert aus Kategorien-Grundverteilung + Fokus/Präzision, ohne echte Pfadplanung) — bitte als bewusste Vereinfachung dokumentieren.
11. **Architektur-Konsequenz:** Automat 1 bekommt eine eigene Phaser-Szene (nicht mehr die generische `MachineScene.ts`) — CLAUDE.md wurde entsprechend angepasst (Abschnitt "Workflow-Regeln"). `EconomyStore`/`SaveSystem`/Meilenstein-Anbindung bleiben geteilt, NICHT duplizieren. Automaten 2–4 bleiben unverändert auf der bestehenden `MachineScene.ts` mit dem Zyklus-Modell aus 4.1b/4.1c.
12. **Speicherstand:** `CURRENT_SAVE_VERSION` erneut erhöhen, alte Spielstände beim Laden ablehnen statt migrieren (etabliertes Vorgehen).

**Bewusst NICHT Teil dieser Phase:** Trap Tunnels/Beat Ledger/Champion's Ledger bleiben unangetastet auf dem alten Zyklus-Modell, bis dieses Experiment sich im Playtest bewährt hat. Progression/Balance-Tuning (siehe Nutzer-Feedback oben) bleibt ebenfalls bewusst zurückgestellt.

### Ergebnis: Phase 7f umgesetzt (2026-07-10)

Reihenfolge wie in CLAUDE.md gefordert: Engine-Logik zuerst mit Vitest
abgesichert, danach erst an Phaser angebunden, mehrere Zwischen-Commits
vorgesehen (siehe unten).

**`src/engine/types.ts`:** `CURRENT_SAVE_VERSION` 3 → 4 (neues Pflichtfeld
`gridFocusPreference`, siehe unten — wie immer bewusst KEINE Migration,
alte Saves werden beim Laden abgelehnt). Grössere strukturelle Änderung:
`MachineConfig` ist jetzt eine diskriminierte Union
`CyclicMachineConfig | GridMachineConfig` (gemeinsame Felder in einem neuen
`MachineIdentity`-Interface: `id`/`name`/`theme`/`entryPoint`/`milestones`/
`ticketYieldFactor` — das sind genau die Felder, die maschinen-agnostischer
Code wie `getReachedMilestones`, `hall.config.ts::MACHINE_UNLOCK_UPGRADES`
oder `HallHub.tsx` braucht, und die bleiben dadurch OHNE Anpassung
funktionsfähig). `CyclicMachineConfig` (`kind: 'cyclic'`) trägt `pattern`/
`actions`/`depthUpgrades`/`precisionUpgrades` wie bisher — Automaten 2-4
sind unverändert davon betroffen, nur die Typannotation kam dazu.
`GridMachineConfig` (`kind: 'grid'`) ist neu: `grid: GridSectorConfig`
(Feldgrösse, Kategorien-Anzahlen, Payout-Spannen, Sicherheits-Constraint)
plus drei Upgrade-Leitern (`sightRangeUpgrades`/`gridPrecisionUpgrades`/
`actionBudgetUpgrades`). Neue Typen `SectorCategory`
(`'ghost'|'points'|'empty'|'bonus'`), `GridFocus` (`'safe'|'greedy'`),
`GridFocusPreference` (`{focus, keepForNextRun}`). `MachineUpgradeEffect`
um drei neue Varianten erweitert (`gridSightRange`/`gridPrecision`/
`gridActionBudget`), additiv, ändert nichts an den bestehenden
`previewDepth`/`previewPrecision`-Varianten. `EngineState` bekommt
`gridFocusPreference: Record<string, GridFocusPreference>` (pro Automat-id,
falls später ein zweiter Grid-Automat entsteht).

**`src/engine/GridRunEngine.ts`+Test (neu, 35 Tests):** Komplett neues,
framework-unabhängiges Modul (kennt weder Phaser noch React noch
`/src/data`, Architektur-Kurzregel) — ersetzt `PatternEngine`/
`PushYourLuckEngine` für Greed Run vollständig. Reine Funktionen (RNG per
Parameter injizierbar, `Math.random` als Default, dieselbe Konvention wie
`PatternEngine.sampleNext`): `generateGrid` (Fisher-Yates-Shuffle der
Kategorien-Pool über die 24 Nicht-Start-Sektoren, danach
`enforceStartNeighborSafety` — tauscht überzählige Geister-Nachbarn des
Startfelds mit einer zufälligen Nicht-Geist-Zelle, bis das
Sicherheits-Constraint `maxGhostAmongStartNeighbors` eingehalten ist),
`getVisibleSectors` (Manhattan-Radius, neu zentriert um die aktuelle
Position), `getFocusResolutionOrder`/`resolveSectorKnowledge`
(fokus-abhängige Kategorien-Auflösungsreihenfolge: Sicher → Geist zuerst,
Gier → Bonus zuerst, beide dann Leer; bei Präzision 3 ist die 4. Kategorie
"Punkte" durch Ausschluss automatisch bekannt), `computeBlindExpectedValue`
(Blind-EV-Garantie, über die Kategorien-HÄUFIGKEIT gemittelt statt über eine
stationäre Markov-Verteilung), `drawCategoryPayout` (dieselbe
Ziehungs-Mathematik wie `PushYourLuckEngine.drawPayout`, nur direkt auf
Kategorien). Neue Klasse `GridRunEngine` (bewusst zustandsbehaftet, anders
als das zustandslose `PatternEngine`/`PushYourLuckEngine`-Duo — dieser
Automat hat genuin über mehrere Züge hinweg mutierenden Zustand: Nebel des
Krieges + Verbrauchsregel) hält Feld/Position/Restbudget, `move()` löst
einen Zug auf und wandelt den betretenen Sektor unabhängig von seiner
ursprünglichen Kategorie zu `'empty'` (Verbrauchsregel, game-spec.md 4.2,
gilt auch für Geister — keine zweite Strafe an derselben Stelle). Blind-EV
der finalen Konfiguration (siehe unten) ≈ 2.5, per Test verifiziert; 200
Seeds mit echtem `Math.random()` bestätigen das Sicherheits-Constraint
(≤ 1 Geist unter den Start-Nachbarn) hält in jedem Fall.

**`src/engine/AttendantEngine.ts`+Test (+8 Tests, bewusste Vereinfachung
wie in game-spec.md 4.2 gefordert):** Neue Funktionen
`getGridPerfectInfoExpectedValue`/`getGridAttendantExpectedValuePerMove`/
`getGridAttendantMachinePointsRate` — dieselbe Interpolations-IDEE wie beim
zyklischen Modell (linear zwischen Blind-EV und einer "Perfekt-Info"-EV,
gewichtet mit dem Anteil genutzter Präzisions-Stufen), aber mit einer
KATEGORIEN- statt ZUSTANDS-basierten Perfekt-Info-Definition: bei
vollständiger Kenntnis weicht der Attendant jedem Geist-Sektor aus, die
übrigen drei Kategorien werden proportional zu ihrem Anteil unter den
Nicht-Geist-Sektoren neu gewichtet — explizit OHNE echte Pfadplanung UND
OHNE Sichtweiten-Faktor (anders als beim zyklischen Modell gibt es keine
feste Sequenz, an der ein Lookahead hängen könnte). Als bewusste,
dokumentierte Vereinfachung im Code-Kommentar gekennzeichnet, wie vom Prompt
gefordert.

**`src/engine/EconomyStore.ts`/`SaveSystem.ts` (+3 bzw. +1 Test):** Neue
Methoden `getGridFocusPreference`/`setGridFocusPreference` (reiner
State-Zugriff, kein Event nötig — analog zu `getAttendantPool`/
`setAttendantPool`, kein React-Konsument). `SaveSystem.ts`
serialisiert/deserialisiert das neue Feld; alter Phase-7e-Save (saveVersion
3, ohne `gridFocusPreference`) wird beim Laden korrekt abgelehnt (`null`,
sauberer Reset), per Test verifiziert.

**`src/data/machines.config.ts`+Test (Netto 90 Tests in
`machines.config.test.ts`, gegenüber vorher aufgespalten):** `GREED_RUN`
komplett neu als `GridMachineConfig` — `GREED_RUN_GRID`: 5×5, 24
Nicht-Start-Sektoren als 5 Geist / 14 Punkte / 3 Leer / 2 Bonus, Payout-
Spannen Geist `[-10,-6]`, Punkte `[3,6]`, Bonus `[15,22]`, Leer `[0,0]` —
Blind-EV ≈ 2.5 (positiv mit spürbarem Abstand, siehe oben). Meilensteine
UNVERÄNDERT (`20/50/100`, bleiben die Skalierungs-Basis für die anderen drei
Automaten), `ticketYieldFactor` unverändert 1.0. Drei neue Upgrade-Leitern
(bewusst OHNE Kreuz-Preis-Kopplung wie beim zyklischen Modell — nicht Teil
der Spezifikation dieses Experiments): `sightRangeUpgrades` (1→2→3→4,
Kosten 3/7/15 Automaten-Punkte), `gridPrecisionUpgrades` (1→2→3, Kosten
4/10), `actionBudgetUpgrades` (4→6→9→13→18, Kosten 3/6/12/24). Neue
Farbtabelle `SECTOR_COLORS`/`getSectorColor` (Okabe-Ito-Teilmenge, eigene
Palette pro Kategorie statt der zyklus-positions-gebundenen
`STATE_COLORS`) + `SECTOR_SYMBOLS` (Buchstaben G/P/B, CLAUDE.md-
Barrierefreiheits-Grundsatz: Farbe nie alleiniges Merkmal).
`getMachineAttendantRate` dispatcht jetzt nach `machine.kind` (grid nutzt
die neuen `AttendantEngine`-Grid-Funktionen, cyclic bleibt exakt wie vorher)
— einziger Ort im gesamten Code, an dem zwischen den beiden
`MachineConfig`-Varianten unterschieden wird, alle Aufrufer
(`economy.ts::tickAttendants`, `AttendantPanel.tsx`, `MachineScene.ts`)
bleiben dadurch kind-agnostisch und unverändert. `TRAP_TUNNELS`/
`BEAT_LEDGER`/`CHAMPIONS_LEDGER` bekommen nur `kind: 'cyclic'` dazu, sonst
unverändert. `getPreviewDepth`/`getPreviewPrecision`/`getMachineUpgradeCost`/
`getMachineUpgrade`/`computeInterleavedUpgradeCost`/
`getUpgradeCostToMilestoneRatio` sind jetzt auf `CyclicMachineConfig`
typisiert (greifen auf Felder zu, die nur dort existieren) —
`machines.config.test.ts` entsprechend aufgeteilt: generische Tests
(Meilensteine, `ticketYieldFactor`, Farben) laufen weiter über alle 4
Automaten, zyklus-spezifische Tests laufen jetzt über eine neue
`CYCLIC_MACHINES`-Konstante (nur Automat 2-4) statt über `MACHINES`, neuer
Testblock "Greed Run (Grid-Automat)" prüft Kategorien-Summe, Blind-EV,
Upgrade-Leitern-Längen/-Preise und die Grid-Ableitungsfunktionen.
Netto-Testcount insgesamt (alle Dateien) **273** (vorher 220 nach Phase
7e) — Zuwachs durch das komplett neue `GridRunEngine.test.ts` (35), neue
Grid-Zweige in `AttendantEngine.test.ts`/`EconomyStore.test.ts`/
`SaveSystem.test.ts` sowie den neuen Greed-Run-Block in
`machines.config.test.ts`.

**`src/game/sceneRouting.ts` (neu):** `getSceneKeyForMachine(machineId)` —
EINE zentrale Zuordnung Automat-id → Phaser-Szenen-Key (`'GreedRun'` für
Greed Run, sonst `'Machine'`), statt den Vergleich an vier Stellen zu
duplizieren (`Boot.ts`, `TransitionScene.ts`, `MachineScene.ts`s
`'request-machine'`-Listener, `GreedRunScene.ts`s eigener
`'request-machine'`-Listener — jede Szene muss den Fall behandeln können,
dass der Spieler aus der Halle heraus einen ANDEREN Automaten anwählt, auch
wenn der andere in einer anderen Szenen-Familie lebt).

**`src/game/scenes/milestonePips.ts` (neu, kleiner geteilter Helfer):**
`createMilestonePips`/`updateMilestonePips` — dieselbe Meilenstein-Pip-Logik
(ein Kreis pro Meilenstein, letzter als 45°-Raute, siehe Phase 7e) wird
jetzt von `MachineScene.ts` UND `GreedRunScene.ts` genutzt, statt
dupliziert zu werden. Reine Phaser-Zeichenlogik, die eigentliche
Meilenstein-Auswertung (`getReachedMilestones`) bleibt unverändert in
`machines.config.ts`.

**`src/game/scenes/MachineScene.ts`:** `init()` prüft jetzt zusätzlich
`config.kind !== 'cyclic'` und wirft (defensive Absicherung — dank
`sceneRouting.ts` sollte Greed Run diese Szene nie erreichen). Feld-Typ
`this.config` von `MachineConfig` auf `CyclicMachineConfig` verschärft.
`request-machine`-Listener routet jetzt über `getSceneKeyForMachine` statt
immer `'Machine'` zu starten. Lokale `createMilestonePips`/
`updateMilestonePips`-Methoden entfernt, nutzt jetzt `milestonePips.ts`.
Sonst inhaltlich unverändert — Automaten 2-4 spielen sich exakt wie vor
Phase 7f.

**`src/game/scenes/Boot.ts`/`TransitionScene.ts`:** Starten den
Layer-0-Automaten jetzt über `getSceneKeyForMachine(entryPointId)` statt
hart `'Machine'` zu verwenden.

**`src/game/scenes/GreedRunScene.ts` (neu, größtes neues Stück dieser
Phase):** Eigene Szene (Key `'GreedRun'`), ersetzt `MachineScene.ts` für
Automat 1 vollständig — Buchhaltung (`economyStore`/`persist`/
`getReachedMilestones`/Meilenstein-Pips) bleibt exakt dieselbe geteilte
Infrastruktur, nur Zug-Auflösung/Vorschau/Darstellung sind neu, wie von
CLAUDE.md gefordert.
- *Rundenstruktur:* ein "Run" (5×5-Feld, feste Zug-Sequenz-Analogie zum
  alten Modell: EINMAL bei Run-Start generiert) läuft über MEHRERE
  Planungsrunden hinweg (1 bis Restbudget-viele Züge pro Runde), bis das
  gesamte Aktionsbudget verbraucht ist — anders als beim alten Modell, wo
  jede Planungsrunde für sich stand. Danach startet automatisch ein neuer
  Run (Checkbox "für nächsten Lauf beibehalten" aktiv) oder das Fokus-Popup
  erscheint erneut.
- *Fokus-Wahl (game-spec.md 4.2 "UI-Ablauf"):* Popup mit den zwei Optionen
  VOR Rundenstart, keine Checkbox im Popup selbst. Permanenter HUD-Chip
  während des Laufs (Fokus-Name + Farbe) plus eigener Checkbox-Button
  "Für nächsten Lauf beibehalten" (Standard aktiv) — Toggle persistiert
  sofort in `EconomyStore.gridFocusPreference` + `persist()`.
- *Feld-Darstellung (CLAUDE.md-Barrierefreiheits-Grundsatz, IMMER Farbe +
  zweites Merkmal):* außerhalb der Sichtweite → grauer "?"-Sektor;
  innerhalb der Sichtweite, aber Präzision reicht nicht → neutraler Sektor
  mit "?" PLUS kleinen farbigen Punkten für jede bereits ausgeschlossene
  Kategorie (Farbe der jeweiligen Kategorie); vollständig bekannt → voll
  eingefärbter Sektor mit Kategorie-Buchstabe (G/P/B, Leer ohne Buchstabe).
  Aktuelle Position zusätzlich mit weißer Rahmen-Markierung (Form, nicht nur
  Farbe) hervorgehoben, bereits besuchte Sektoren mit einer dezenten
  "besucht"-Markierung (Verbrauchsregel macht ihren ursprünglichen Inhalt im
  Engine-State ohnehin zu `'empty'`). Statische Legende (einmalig erzeugt)
  erklärt alle Symbole inkl. Payout-Spannen pro Kategorie.
- *Bewegungsplanung:* 4-Wege-D-Pad, Buttons zeigen über Farbe an, ob der
  Zug aktuell gültig ist (Restbudget UND Feldrand geprüft via
  `applyDirection` auf die PROJIZIERTE Position nach bereits geplanten
  Zügen) — Klick auf einen ungültigen Zug tut nichts (Guard in der
  Klick-Callback, dieselbe Konvention wie `MachineScene.queueAction`).
- *Upgrade-Achsen:* Sichtweite/Präzision werden LIVE bei jedem Render aus
  `EconomyStore.getMachineUpgrades` gelesen — ein mitten im Run gekauftes
  Upgrade wirkt SOFORT (wie beim zyklischen Modell). Aktionsbudget ist
  dagegen bei `GridRunEngine`-Konstruktion fest gebacken (ein Run braucht
  ein bestimmtes Budget für ein wohldefiniertes Ende) — ein mitten im Run
  gekauftes Budget-Upgrade wirkt daher erst ab dem NÄCHSTEN Run. Bewusste,
  strukturell bedingte Design-Entscheidung, im Code dokumentiert.
- *Attendant-Status:* zeigt die Rate wie bei `MachineScene.ts`, Text
  ergänzt um "(vereinfachte Schätzung ohne Pfadplanung)" als Hinweis auf die
  bewusste Vereinfachung.

**`src/game/main.ts`:** `GreedRunScene` zur `scene`-Liste hinzugefügt.

**Verifiziert:** `npm test` (**273/273 grün**), `npm run lint` sauber,
`npx tsc --noEmit` sauber, `npm run build-nolog` erfolgreich. Zusätzlich
per Playwright-Skript gegen `npm run dev-nolog` (Skript + temporäre
Playwright-Installation nach dem Lauf wieder entfernt, nicht Teil des
Repos/package.json) mit Screenshots visuell geprüft: frischer Start (leerer
`localStorage`) zeigt sofort das Fokus-Popup; Klick auf "Sicher" startet
den Run und zeigt das 5×5-Feld korrekt (Sichtweite 1 um die Mitte, ein
Nachbar korrekt als Geist aufgedeckt gemäß Sicher-Fokus-Reihenfolge, die
übrigen als "?" mit ausgeschlossenem-Geist-Punkt); zwei "Rechts"-Züge
geplant, "Los!" ausgeführt → Feedback-Text zeigt Schritt-für-Schritt-
Ergebnis korrekt (u. a. ein Verlust-Fall bei Geist-Treffer, Punktestand
korrekt bei 0 gekappt), Aktionsbudget-Zähler sinkt korrekt, Plan wird nach
Ausführung geleert, besuchte Felder korrekt markiert; Klick auf ein
Upgrade ohne ausreichende Automaten-Punkte kauft korrekt NICHT (kein
Crash). Keine Konsolenfehler über den gesamten Testlauf. **Noch nicht vom
Nutzer selbst gespielt/bestätigt** — das ist der nächste Schritt, kein
automatisierter Ersatz dafür.

## NEUE PHASE 7e: Erkennbarkeit + Banking-Streichung (2026-07-09, mit Nutzer abgestimmt)

Playtest-Feedback (Screenshot einer voll ausgebauten Greed-Run-Runde, Tiefe
5/Präzision 4/4): Aktionen visuell kaum unterscheidbar, Konter-Beziehungen
nicht erkennbar, Aktions-Buttons verraten die Auflösung gegen den aktuell
bekannten Zustand direkt ("GROSSER GEWINN sicher") statt dass der Spieler
Vorschau + Zyklus-Wissen selbst kombinieren muss. Zusätzlich: Tiefe 5 (Maximum)
lässt Position 6 der Warteschlange trotzdem als "??" stehen — Bug, siehe
unten. Siehe game-spec.md 4.1c für die spielerseitige Beschreibung.

Verbindliche Entscheidungen (beide mit Empfehlung bestätigt):

1. **Kreisanordnung der 5 Aktions-Buttons** (Fünfeck, gleiche Zyklus-
   Reihenfolge wie die Pattern-Zustände) statt Reihe — Nachbarschaft im Kreis
   = Konter-Beziehung, räumlich lernbar.
2. **Konsistente Farbcodierung:** Zustand i und Aktion i teilen sich eine
   feste Farbe (5 unterscheidbare Farben pro Automat, in `machines.config.ts`
   oder einer neuen Farbzuordnungs-Funktion festgelegt). Preview-Anzeige
   nutzt dieselben Farben (farbige Chips/Icons statt Text-Zeilen pro
   Position) statt der aktuellen dichten Text-Liste.
   **Barrierefreiheit (verbindlich, siehe auch CLAUDE.md-Grundsatz):** die 5
   Farben aus einer farbenblind-sicheren Palette wählen (z. B. Okabe-Ito),
   NICHT aus reinem Rot/Grün-Kontrast. Zusätzlich jede Farbe mit einem
   zweiten, farbunabhängigen Merkmal koppeln (Symbol/Icon-Form, Position im
   Fünfeck, Buchstabe/Nummer im Chip) — Farbe allein darf nie die einzige
   Unterscheidung zwischen den 5 Zuständen/Aktionen sein.
3. **Statische Referenz-Grafik** (immer sichtbar, ändert sich nie): zeigt die
   Konter-Reihenfolge (z. B. Fünfeck mit Pfeilen). Reine Nachschlage-Info.
4. **Keine Live-Verhaltensanzeige auf den Buttons.** Aktuell zeigen Buttons
   die Auflösung gegen den bekannten Zustand direkt an ("GROSSER GEWINN
   sicher (Zustand X)") — das entfernen. Buttons zeigen nur Name, Farbe,
   generische Payout-Spannen (Groß/Einfach/Verlust). Backlog-Vormerkung
   (NICHT jetzt bauen): ein späterer, freischaltbarer "Hilfe"-Modus (Phase 8)
   kann diese Live-Anzeige optional wieder einblenden.
5. **Banking entfällt komplett, PushYourLuckRun wird zurückgebaut** (bestätigt
   als "jetzt aufräumen", nicht nur UI-Änderung): Da jede Aktion bereits
   sofort Automaten-Punkte UND Tickets persistent verbucht (Phase 7d/game-spec
   3.1), ist der Zweck von Banking (Absicherung vor Totalverlust eines
   ungesicherten Laufs) bereits erledigt. Konkret:
   - `PushYourLuckRun`/`PushYourLuckEngine` auf das reduzieren, was noch
     gebraucht wird (vermutlich nur noch: eine Aktion auflösen und den Payout
     zurückgeben — die reine `resolveAction`-Funktionalität aus Phase 7c
     bleibt evtl. sinnvoll, aber OHNE Run-Objekt mit Score/Peak/Bank/
     Milestone-Status). Falls die Klasse dadurch komplett überflüssig wird,
     entfernen, nicht künstlich am Leben halten.
   - Meilenstein-Prüfung wandert dorthin, wo der PERSISTENTE Punktestand
     dieses Automaten tatsächlich lebt (`EconomyStore`), nicht mehr in einem
     ephemeren Run-Objekt.
   - "Meilenstein erreicht" wird zu einer reinen Fortschritts-Meldung (kein
     Entscheidungsbildschirm mehr, keine Bank/Weitermachen-Buttons).
   - "Durchgespielt" = der persistente Punktestand hat einmalig die letzte
     Meilenstein-Schwelle erreicht (ersetzt das bisherige "letzten Checkpoint
     im aktuellen Run erreicht + gebankt").
   - Bitte in STATUS.md dokumentieren, welche Tests dadurch wegfallen/sich
     ändern (erwartet: die meisten `PushYourLuckEngine.test.ts`-Tests für
     Bank/Milestone/Peak-Score betreffen jetzt EconomyStore statt der alten
     Engine-Klasse).
   - **Fortschritt darf nicht komplett unsichtbar werden (mit Nutzer
     abgestimmter Nachtrag):** Ohne Entscheidungsbildschirm gibt es sonst
     KEINE Anzeige mehr, wie nah der Spieler an einem Meilenstein oder am
     "Durchspielen" ist. Lösung: eine dezente, permanente Fortschritts-
     anzeige (z. B. eine Reihe kleiner Meilenstein-Pips/Punkte nahe der
     Punktestand-Anzeige, ein Pip pro Schwelle, gefüllt sobald erreicht),
     NICHT ein großer Fortschrittsbalken mit exakten Zahlen — das würde zu
     viel vorwegnehmen. Der letzte Pip (= "Durchspielen") visuell distinkt
     markieren (andere Form, z. B. Stern/Diamant statt Kreis — nicht nur
     andere Farbe, siehe Barrierefreiheits-Grundsatz oben). Exakte
     Schwellenwerte bleiben optional/verborgen (z. B. erst bei Hover oder
     nie exakt angezeigt) — Baukasten 1.13 (Opt-in-Tiefe): einfaches
     qualitatives Signal per Default, Details nur auf Wunsch.

**Bug-Fix (unabhängig von den Design-Entscheidungen oben):** `MAX_QUEUE_LENGTH`
(bisher 6, alter Wert aus Phase 3) und der Tiefe-Deckel (`d≤5`, Anzahl
Zustände) sind zwei unabhängige, nie abgeglichene Konstanten — bei voller
Tiefe bleibt Position 6 der Warteschlange strukturell IMMER unsichtbar.
Vereinheitlichen: Warteschlangen-Länge = maximale Tiefe (eine Konstante als
einzige Quelle der Wahrheit), damit volle Tiefe wirklich die gesamte geplante
Warteschlange sichtbar macht.

### Ergebnis: Phase 7e umgesetzt (2026-07-09)

**`src/engine/types.ts`:** `CURRENT_SAVE_VERSION` 2 → 3 (`Milestone` verliert
`bankable`, `EngineState` bekommt `machinePeakScore` als neues
Pflichtfeld — wie bei Phase 7d bewusst KEINE Migration, alte Saves werden
beim Laden abgelehnt, siehe SaveSystem.ts). `Milestone` ist jetzt nur noch
`{ threshold: number }`.

**`src/engine/EconomyStore.ts` (+Test):** Neue Methode
`applyMachineScoreDelta(machineId, delta: number)` — ersetzt
`PushYourLuckRun.resolveAction()`+`bank()`: verbucht einen (ggf. negativen)
Payout SOFORT und DAUERHAFT direkt am persistenten `machinePoints`-Wert
dieses Automaten (bei 0 geklemmt via `Decimal.clampMin(0)`, exakt dieselbe
Bodenklemmung wie vorher in `PushYourLuckRun`). Neues Feld
`machinePeakScore` + `getMachinePeakScore` + private `bumpMachinePeakScore`
(steigt NIE durch Ausgeben `spendMachinePoints` oder einen Verlust, nur
durch tatsächliche Gewinne über den bisherigen Peak hinaus) — sowohl
`addMachinePoints` (Attendant-Pfad) als auch `applyMachineScoreDelta`
(manueller Pfad) aktualisieren ihn, damit der Peak unabhängig von der
Ertragsquelle konsistent bleibt. Neues Event `machine-peak-score-changed`.

**`src/engine/PushYourLuckEngine.ts` (radikal verschlankt, wie im Prompt
vorgeschlagen):** `PushYourLuckRun`-Klasse (Score/Peak/Status/Bank/
Milestone-Verwaltung) komplett entfernt — ihr Zweck (Absicherung eines
"ungesicherten Laufs" vor Totalverlust) existiert nicht mehr, da jede Aktion
bereits sofort permanent verbucht wird. Übrig bleibt NUR eine reine
Funktion `drawPayout(tier, rng)` (zieht einen Wert aus der Payout-Spanne) —
bewusst NICHT inline in MachineScene.ts verschoben, sondern als eigene,
winzige Datei erhalten, damit diese Zufalls-Mathematik weiterhin isoliert
mit Vitest testbar bleibt (CLAUDE.md: "Neue Engine-Logik zuerst mit Vitest
absichern") und die Engine/Scene-Trennung bestehen bleibt.

**Testverschiebung (wie im Prompt gefordert dokumentiert):**
`PushYourLuckEngine.test.ts` schrumpft von 20 auf 5 Tests (nur noch
`drawPayout`). Die inhaltlich äquivalenten Tests wandern nach
`EconomyStore.test.ts` (neue Describe-Blöcke `machinePeakScore (Phase 7e)`
und `applyMachineScoreDelta`, 9 neue Tests) bzw. nach
`machines.config.test.ts` (`getReachedMilestones`/`isFinalMilestoneReached`,
3 neue Tests) — Meilenstein-Auswertung und Peak-Stickiness werden jetzt
exakt dort getestet, wo die jeweilige Logik tatsächlich lebt. Netto-Testcount
220 (vorher 219 nach Phase 7d), da mehr neue Tests hinzukamen als alte
entfielen.

**`src/data/machines.config.ts` (+Test):** `bankable: true` aus allen
Meilenstein-Einträgen aller vier Automaten entfernt (reine Datenänderung,
Schwellenwerte unverändert). Neue Ableitungsfunktionen
`getReachedMilestones(machine, peakScore)`/
`isFinalMilestoneReached(machine, peakScore)` — reine Funktionen, werten
gegen den von `EconomyStore.getMachinePeakScore()` gelieferten Wert aus,
ersetzen `PushYourLuckRun.getReachedMilestones()`/`canBank()`. Neu:
`STATE_COLORS` (5 Werte, Teilmenge der Okabe-Ito-Palette:
Orange/SkyBlue/BluishGreen/Vermillion/ReddishPurple) + `getStateColor(index)`
— EINE gemeinsame Palette für alle vier Automaten (Kopplung an die
Zyklus-POSITION, nicht an ein automaten-spezifisches Thema), `UNKNOWN_COLOR`
für "außerhalb der Sichtweite"/ausgeschlossene Kandidaten.

**`src/game/scenes/MachineScene.ts` (größte Änderung, praktisch komplett
neu aufgebaut):**
- *Fünfeck statt Reihe:* `pentagonPoint(cx, cy, radius, index, count)`
  (reine Geometrie-Hilfsfunktion) platziert sowohl die 5 interaktiven
  Aktions-Buttons (Zentrum 512/415, Radius 145) als auch die Vertices der
  statischen Referenz-Grafik — dieselbe räumliche Sprache für beide.
- *Farbcodierung + Barrierefreiheit:* jeder Aktions-Button UND jeder
  Vorschau-Chip verwendet `getStateColor(index)` PLUS eine 1-basierte
  Positionsnummer als Text (Button-Titel "1. sprint", Chip-Zahl im Kreis) —
  Farbe ist nirgends alleiniges Unterscheidungsmerkmal, wie vom
  CLAUDE.md-Grundsatz gefordert. Ausgeschlossene Kandidaten in der Vorschau
  zusätzlich über Füllung (blass/hohl statt voll) UND Farbe (Grau statt
  Zustandsfarbe) UND Nummer unterscheidbar — DREI redundante Signale statt
  eines.
- *Statische Referenz-Grafik:* `renderReferencePentagon()` + `drawArrow()`
  (Phaser Graphics: `lineStyle`/`moveTo`/`lineTo`/`strokePath`/
  `fillTriangle` für die Pfeilspitze — bleibt innerhalb der laut CLAUDE.md
  bis Phase 8 erlaubten Platzhalter-Primitive) werden EINMALIG in `create()`
  gezeichnet, nie in `renderPhase()`/`clearDynamic()` neu aufgebaut — zeigt
  dauerhaft, welche Aktion welchen Zustand kontert (Pfeil i → i+1).
- *Keine Live-Verhaltensanzeige mehr:* `describeAction()` (zeigte bisher
  "GROSSER GEWINN sicher (Zustand X)" direkt auf dem Button) komplett
  entfernt. Buttons zeigen nur noch Name+Nummer, Farbe, und die generischen
  Payout-Spannen (Groß/Einfach/Verlust) — der Spieler muss Vorschau +
  Referenz-Grafik selbst kombinieren (design-toolbox.md 1.5). Backlog
  (NICHT umgesetzt, wie im Prompt gefordert nur vorgemerkt): ein späterer,
  freischaltbarer "Hilfe"-Modus (Phase 8) könnte diese Live-Anzeige optional
  wieder einblenden.
- *Vorschau als farbige Chips statt Text-Liste:* `renderPreviewChips()`
  zeichnet pro sichtbarer Position eine Reihe aus `N_STATES` kleinen
  Kreisen (einer je Pattern-Zustand in fester Reihenfolge) — gefüllt+farbig+
  nummeriert für noch mögliche Kandidaten, blass+grau für ausgeschlossene;
  außerhalb der Sichtweite ein einzelner grauer "?"-Chip. Ersetzt die
  bisherige `describePreviewPosition()`-Textliste vollständig.
- *Meilenstein-Pips (game-spec.md 4.1c, mit Nutzer abgestimmter Nachtrag):*
  `createMilestonePips()` erzeugt EINMALIG einen Kreis pro
  Nicht-End-Meilenstein + eine um 45° gedrehte quadratische Raute für den
  LETZTEN ("Durchgespielt") — andere FORM, nicht nur andere Farbe
  (Barrierefreiheits-Grundsatz), beide bleiben innerhalb der Phaser-
  Rechteck/Kreis-Primitive-Konvention. `updateMilestonePips()` färbt sie nur
  um (kein Neuaufbau, kein Flackern), basierend auf
  `getReachedMilestones(config, peakScore).length`. Exakte Schwellenwerte
  werden bewusst NIRGENDS angezeigt (design-toolbox.md 1.13, Opt-in-Tiefe).
- *Banking/Score-Attack-Screens entfernt:* `renderMilestoneControls()`/
  `renderCompletedControls()`/`bankRun()` komplett entfernt, `Phase`-Typ
  von `'planning'|'executing'|'milestone'|'completed'` auf nur noch
  `'planning'|'executing'` reduziert. Design-Entscheidung (nicht explizit
  gefordert, aber direkte Konsequenz): da Fortschritt jetzt immer
  kontinuierlich/persistent ist, gibt es nach "Durchgespielt" keinen
  funktional unterscheidbaren "Score-Attack"-Modus mehr — Weiterspielen
  läuft nahtlos in derselben Planungsphase weiter (dokumentiert als
  bewusste Vereinfachung, nicht Baukasten-Verstoß: Abschluss-Gefühl
  bleibt über den Durchbruch-Moment/Attendant-Freischaltung + die
  "Durchgespielt"-Fortschritts-Meldung + den distinkten letzten Pip
  gewahrt, Baukasten 1.6).
- *`sequence`/`sequenceCursor` laufen jetzt für die gesamte Lebensdauer der
  Szene weiter* (vorher: Neustart bei jedem `bankRun()`) — folgerichtig, da
  es keine "Runs" mehr gibt, die neu gestartet werden könnten.
- *Bug-Fix `MAX_QUEUE_LENGTH`/Tiefe-Deckel:* die lokale Konstante
  `MAX_QUEUE_LENGTH = 6` ist komplett entfernt, jede Stelle, die vorher
  darauf verwies (Warteschlangen-Kappung, Vorschau-Zeilen-Anzahl), nutzt
  jetzt einheitlich `N_STATES` (= 5, aus `machines.config.ts`, derselbe Wert
  wie der Tiefe-Deckel) — bei voller Tiefe ist die GESAMTE Warteschlange
  jetzt sichtbar, keine strukturell blinde letzte Position mehr.
- *Layout-Iteration (Session-intern, per Screenshot verifiziert):* der
  erste Layout-Entwurf hatte die automaten-internen Upgrade-Kauf-Reihen
  direkt unter den Planungs-Buttons ("Letzten entfernen"/"Los!") platziert,
  was bei den finalen Fünfeck-Maßen zu sichtbarer Überlappung führte —
  behoben durch verkleinertes Fünfeck (Radius 150→145, Buttons 140×95→
  120×80) und neu berechnete, vertikal gestapelte Positionen mit
  ausreichendem Abstand (siehe Screenshots unten).

**Verifiziert:** `npm test` (**220/220 grün**), `npm run lint` sauber,
`npx tsc --noEmit` sauber, `npm run build-nolog` erfolgreich. Zusätzlich
per Playwright-Skript gegen `npm run dev-nolog` (Skripte + temporäre
Playwright-Installation nach dem Lauf wieder entfernt, nicht Teil des
Repos/package.json), mit Screenshots visuell geprüft:
- Frischer Start (Greed Run): Fünfeck-Anordnung mit 5 farbigen, nummerierten
  Aktions-Buttons korrekt gerendert, statische Referenz-Grafik (Fünfeck mit
  Pfeilen, oben rechts) zeigt die Konter-Reihenfolge, Vorschau-Chips (5
  Kreise pro sichtbarer Position, Rest "?") korrekt, Meilenstein-Pips (2
  Kreise + 1 Raute) sichtbar unter dem Punktestand, keine Konsolenfehler.
- 5 Runden Aktion-1-Queue+Ausführung: Punktestand akkumuliert korrekt über
  mehrere Runden hinweg PERSISTENT (56.1 nach 5 Runden, kein Reset
  zwischendurch) OHNE jeden Banking-Schritt; Feedback-Text zeigt "Meilenstein
  erreicht!" korrekt, sobald eine neue Schwelle überschritten wird; beide
  ersten Pips füllten sich sichtbar (Schwellen 20 und 50 beide unter 56.1);
  hallenweite Tickets wurden gleichzeitig und korrekt mitgeneriert (Phase
  7d-Verhalten unangetastet, "+6.76 Tickets" in derselben Feedback-Zeile).
- Kauf eines automaten-internen Upgrades (vorbereiteter Save mit 56.1
  Punkten/Peak): Punktestand sank korrekt auf 54.1 (Kosten abgezogen), Peak/
  Pips blieben UNVERÄNDERT gefüllt (Sticky-Verhalten funktioniert exakt wie
  gefordert — Ausgeben macht Meilenstein-Fortschritt nicht rückgängig);
  Kreuz-Preis-Kopplung weiterhin korrekt (Präzisions-Preis stieg von 3.0 auf
  3.6 nach dem Tiefe-Kauf); Vorschau-Zeile 2 zeigte danach sofort farbige
  Kandidaten statt "?".

## NEUE PHASE 7d: Attendant-Rate + Ticket-Ökonomie-Vereinfachung (2026-07-09, mit Nutzer abgestimmt)

Ausgangspunkt: (1) der Attendant simuliert aktuell echte Einzelrunden per
Tick-Timer — ressourcenintensiv UND überlebt kein Schließen des Tabs; (2) das
Tickets→Credits-Modell erzwingt manuelles Umwandeln ohne echte Entscheidung
dahinter; (3) Sorge, dass frühere Automaten nach Freischaltung späterer zu
"stillgelegten Zahlen" werden (Baukasten 1.14). Siehe game-spec.md 3.1/3.2/3.3
für die spielerseitige Beschreibung, hier die technische Herleitung.

**1. Kein "Credits" mehr, zwei getrennte Ausschüttungen pro Aktion:**
- **Automaten-Punkte** (lokal, pro Automat, nicht übertragbar): für
  Tiefe-/Präzisions-Upgrades DIESES Automaten (wie in Phase 7b/7c bereits
  etabliert — technisch vermutlich weiterhin `ticketsByMachine` oder
  Umbenennung, Implementierungsdetail).
- **Tickets** (hallenweit, gepoolt): NEUE, einzige Hallen-Währung. Ersetzt
  "Credits" komplett — `EconomyStore.credits`/`convertTicketsToCredits`
  entfallen, `hall.config.ts`'s "Ticket-Umrechnung"-Upgrade-Kategorie wird zu
  einer "Ticket-Ertragsrate"-Kategorie (direkter Multiplikator auf die
  Ticket-Ertragsrate, hallenweit, wirkt cross-layer auf alle Automaten).
- Jede Aktion (manuell oder Attendant) erzeugt BEIDE Werte gleichzeitig, kein
  manueller Umwandlungsschritt, kein sichtbarer Zwischenschritt.
- **Feste, nicht kaufbare Normalisierungs-Konstante pro Automat** (in
  `machines.config.ts`), damit alle vier Automaten trotz unterschiedlicher
  Rohzahlen-Skalen (Champion's Ledger deutlich höher als Greed Run) fair zum
  gemeinsamen Ticket-Pool beitragen — kein Spieler-Hebel, reiner
  Balance-Wert. Spätere Automaten dürfen und sollen dabei absolut mehr
  beitragen (das ist normales Incremental-Verhalten, kein Bug) — die
  Konstante sorgt nur für einen fairen BASIS-Vergleich, nicht für Gleichheit.

**2. Attendant: Rate statt Einzelsimulation, alle Automaten gleichzeitig:**
- Attendants aller freigeschalteten (durchgespielten) Automaten laufen
  GLEICHZEITIG im Hintergrund, nicht nur der des gerade geöffneten Automaten
  — löst das "stillgelegte Zahl"-Problem direkt in Layer 1, ohne Prestige/
  Reset zu benötigen (der Gedanke ist trotzdem valide, aber laut game-spec.md
  Abschnitt 5 explizit Layer-2-Scope und dort vorgemerkt, nicht jetzt bauen).
- Ertragsrate (Tickets/Sekunde UND Automaten-Punkte/Sekunde) deterministisch
  hergeleitet aus derselben Erwartungswert-Mathematik wie die Blind-EV-
  Garantie (Musterkenntnis + Attendant-eigener Tiefe/Präzision-Zugriff auf
  die feste Sequenz bestimmen den erwarteten Ertrag pro Aktion; Aktionen pro
  Sekunde als fester, konfigurierbarer Parameter).
- Anwendung über VERSTRICHENE ECHTZEIT (Zeitstempel beim letzten Update
  speichern, Differenz beim nächsten Laden/Fokussieren anwenden), NICHT über
  einen laufenden `setInterval`-Tick — ermöglicht Offline-/Tab-geschlossen-
  Fortschritt. Sinnvoll: Obergrenze für die maximal anrechenbare Abwesenheit
  einziehen (z. B. 24h), um absurde Sprünge/Exploits zu vermeiden — Wert
  selbst tunbar, aber ein Deckel sollte existieren.
- **Pool-Ausschüttung nur für die sichtbare Vordergrund-Optik** (damit der
  Attendant wie ein echt spielender Akteur wirkt): Rate fließt kontinuierlich
  in einen Pool, der zyklisch (Intervall tunbar, grob in der Größenordnung
  einer echten Spielrunde) mit einem zufälligen Faktor 0,8–1,2 ausgeschüttet
  wird. Formal: `Pool_neu = Pool_alt + Rate×Zyklusdauer − Ausschüttung`,
  `Ausschüttung = max(0, Pool_alt_nach_Fill × Faktor)`. Die Abweichung vom
  Faktor 1 bleibt im Pool (positiv wie negativ) — durch Teleskopsumme
  konvergiert die tatsächliche Gesamtausschüttung über N Zyklen exakt gegen
  `N × Rate × Zyklusdauer` (plus/minus Pool-Rest), nicht nur im Erwartungswert.
  Ausschüttung nach unten bei 0 kappen (kein sichtbarer negativer Betrag),
  Defizit bleibt intern im Pool und wird von künftiger Akkumulation
  aufgeholt. Für Offline-Berechnung NICHT den Pool-Mechanismus mit vielen
  Einzelzyklen durchrechnen — direkt Rate × verstrichene Zeit anwenden (Pool
  ist reine Vordergrund-Optik, keine Notwendigkeit für Offline-Konsistenz).
- Spieler-seitiges Framing (z. B. "Strategielevel"-Upgrade) darf sich anders
  anfühlen, als es unter der Haube berechnet wird (reiner Rate-Multiplikator)
  — bewusst so, solange die Mathematik konsistent bleibt.

**PM-Risikohinweise für die Umsetzung:**
- Das ist eine grössere Umbau-Phase (EconomyStore-Struktur, hall.config.ts,
  AttendantEngine, MachineScene/HallHub, App.tsx-Ticking-Mechanismus). Bitte
  in sinnvollen Zwischenschritten committen, nicht alles in einem Rutsch.
- `EngineState.credits`/`ticketsByMachine`-Umbenennung: SaveSystem/
  Serialisierung entsprechend anpassen, alte Spielstände MÜSSEN entweder
  migriert oder (da noch keine Nutzer mit echten Spielständen existieren)
  bewusst als inkompatibel behandelt werden — bitte kurz dokumentieren, was
  mit einem alten `localStorage`-Save beim Laden passiert (Absturz vs.
  sauberer Reset).
- Prestige/Reset-Gedanke NICHT umsetzen, nur als Vormerkung in game-spec.md
  Abschnitt 5 dokumentiert lassen (bereits erledigt).

### Ergebnis: Phase 7d umgesetzt (2026-07-09)

**`src/engine/types.ts`:** `CURRENT_SAVE_VERSION` 1 → 2 (inkompatible
`EngineState`-Form, siehe SaveSystem unten). `EngineState.credits` entfernt,
ersetzt durch `tickets: Decimal` (hallenweit, die neue einzige Hallen-
Währung). `ticketsByMachine` umbenannt zu `machinePoints: Record<string,
Decimal>` (Automaten-Punkte, lokal, nicht übertragbar — bewusste
Umbenennung, um die Verwechslung mit der neuen `tickets`-Währung
auszuschließen, wie im Prompt als "dein Ermessen" freigestellt). Neue
Pflichtfelder `attendantPools: Record<string, AttendantPoolState>` (Pool-
Zustand pro Automat, reine Vordergrund-Optik) und `lastAttendantUpdate:
number` (ein GLOBALER Zeitstempel für alle Automaten gemeinsam, keine
Pro-Automat-Zeitstempel — vereinfachend, da ohnehin bei jedem Tick alle
Automaten gleichzeitig verarbeitet werden). `UpgradeEffect.ticketConversionRate`
→ `ticketYieldRate` (direkter Multiplikator auf den Ticket-Ertrag pro Aktion
statt eines Umrechnungskurses).

**`src/engine/EconomyStore.ts` (+Test):** `getCredits`/`addCredits`/
`spendCredits`/`convertTicketsToCredits` vollständig entfernt, ersetzt durch
`getHallTickets`/`addHallTickets`/`spendHallTickets`. `getTickets`/
`addTickets`/`spendTickets` (pro Automat) umbenannt zu `getMachinePoints`/
`addMachinePoints`/`spendMachinePoints`. `purchaseHallUpgrade` spendet jetzt
`spendHallTickets` statt `spendCredits`, `purchaseMachineUpgrade` weiterhin
`spendMachinePoints` (vorher `spendTickets`) — reine Umbenennung, keine
Verhaltensänderung. Neue, reine State-Zugriffsmethoden `getAttendantPool`/
`setAttendantPool`/`getLastAttendantUpdate`/`setLastAttendantUpdate` (keine
Rate-/Pool-MATHEMATIK im Store, die lebt komplett in AttendantEngine.ts,
siehe Architektur-Kurzregel). Events umbenannt: `credits-changed` →
`hall-tickets-changed`, `tickets-changed` → `machine-points-changed`.

**`src/engine/SaveSystem.ts` (+Test):** Serialisierung an die neue
`EngineState`-Form angepasst. **Bewusst KEINE Migration von saveVersion 1**
(PM-Vorgabe: "da noch keine echten Nutzer-Spielstände existieren, sauberer
Reset bevorzugt gegenüber Absturz") — `deserializeState` akzeptiert nur noch
`saveVersion === CURRENT_SAVE_VERSION` exakt (vorher: `> CURRENT_SAVE_VERSION`
als einzige Fehlerbedingung), jede andere Version wirft. `SaveSystem.load()`
fängt das (wie jeden Deserialisierungsfehler) ab und gibt `null` zurück —
`economy.ts` fällt dann automatisch auf `new EconomyStore()` (frischer
`createInitialState()`) zurück. Verifiziert per Test (alter v1-Save mit
`credits`/`ticketsByMachine`-Feldern → `load()` liefert `null`, kein Crash)
UND per Browser-Verifikation (siehe unten).

**`src/engine/AttendantEngine.ts` (+Test, größte Änderung dieser Phase):**
Das komplette Schritt-für-Schritt-Auswahlmodell aus Phase 7c
(`chooseAttendantAction`/`getAttendantResolvedAction`) entfernt — beide
wurden mit dem Wegfall der diskreten Attendant-Runden-Simulation
tatsächlich ungenutzt (nicht nur oberflächlich ersetzt, echte Löschung statt
toten Code stehen zu lassen). Neu:
- `computeStationaryDistribution` (Power-Iteration): war bis Phase 7c ein
  reines Test-Werkzeug in `machines.config.test.ts` (Blind-EV-Garantie),
  jetzt zu Produktionscode befördert, weil die Attendant-Ertragsrate sie zur
  LAUFZEIT braucht. `machines.config.test.ts` importiert sie jetzt statt
  sie zu duplizieren.
- `getAttendantExpectedValuePerAction`: bewusst dokumentierte
  Vereinfachung statt exakter Nachbildung der alten Kandidaten-Ausschluss-
  Heuristik (die wäre kombinatorisch aufwändig über alle möglichen
  Ausschluss-Reihenfolgen je Präzisionsstufe) — lineare Interpolation
  zwischen Blind-EV (`actions[0]` unter der stationären Verteilung, exakt)
  und Perfekt-Info-EV (Zustand bekannt → garantierter Großer Gewinn, exakt),
  gewichtet mit dem Anteil der genutzten Präzisions-Stufen. Beide Endpunkte
  sind exakt, die Interpolation dazwischen ist streng monoton (mehr
  Präzision ist nie schlechter) — per Test abgesichert.
- `getAttendantMachinePointsRate`: kombiniert EV/Aktion mit Effizienz
  (unverändert `ATTENDANT_MAX_EFFICIENCY`) und `ATTENDANT_ACTIONS_PER_SECOND`
  (= 1, fester/tunbarer Parameter laut Prompt).
- `applyAttendantElapsed`: zwei Pfade je nach `elapsedMs`. Über
  `FOREGROUND_TICK_THRESHOLD_MS` (15s, bewusst deutlich über dem
  tatsächlichen UI-Tick-Intervall von 2s) → direkter Rate-×-Zeit-Pfad, Pool
  bleibt unverändert (Offline-Konsistenz, wie gefordert). Darunter → Pool-
  Pfad: Rate fließt in den Pool, bei `ATTENDANT_POOL_CYCLE_MS` (4000ms,
  "Größenordnung einer echten Spielrunde" — eine volle Warteschlange à 6
  Schritten × 700ms ≈ 4.2s) wird mit Faktor `[0.8, 1.2]` (rng injizierbar)
  ausgeschüttet, Abweichung vom Faktor 1 bleibt im Pool, Ausschüttung bei 0
  gekappt. Verarbeitet mehrere Zyklen pro Aufruf (Schleife), falls ein
  einzelner Tick mehrere Zyklusdauern überspannt. `MAX_OFFLINE_MS` = 24h wie
  im Prompt vorgeschlagen.
- Design-Entscheidung (nicht explizit gefordert): Angesichts dessen, dass
  jede Aktion seit Phase 7d SOFORT sowohl Automaten-Punkte als auch Tickets
  erzeugt (siehe unten, Punkt "Zwei Ausschüttungen"), behandelt die
  Attendant-Rate BEIDE Ströme symmetrisch als reine EV-Flüsse — es gibt für
  den Attendant kein Analogon zum (weiterhin nur manuell existierenden)
  Push-your-luck-Banking-Risiko; er produziert kontinuierlich, ohne
  Verlustrisiko für bereits erzeugten Fortschritt. Das ist konsistent mit
  game-spec.md 3.2 ("Attendant-Output immer spürbar geringer als optimales
  manuelles Spiel") — die Differenzierung entsteht über Effizienz
  (max. 87.5%) und reduzierten Lookahead/Präzision, nicht über Risiko.

**Zwei getrennte Ausschüttungen pro Aktion (game-spec.md 3.1):**
Automaten-Punkte bleiben über den bestehenden Push-your-luck-Mechanismus
gebankt (`PushYourLuckRun.bank()` → `economyStore.addMachinePoints`,
UNVERÄNDERT gegenüber Phase 7c — ein Verlust vor dem Banking kann den
In-Run-Punktestand weiterhin drücken, das Risiko/Belohnung-Element bleibt
also exakt erhalten). Hallenweite Tickets dagegen werden SOFORT bei JEDER
aufgelösten Aktion vergeben (`MachineScene.ts::runQueueStep`, direkt nach
`PushYourLuckRun.resolveAction`), proportional zum tatsächlich gezogenen,
bei 0 gekappten Payout dieser einen Aktion × `ticketYieldFactor` (Automat) ×
`ticketYieldRate` (Hallen-Upgrade) — unabhängig vom späteren Banking-Ausgang
des laufenden Runs. Bewusste Design-Entscheidung (im Prompt nicht exakt auf
Timing festgelegt, "dein Ermessen"): macht die beiden Währungen strukturell
verschieden (Baukasten 1.4) statt einer bloßen Verzögerung derselben Zahl —
Automaten-Punkte belohnen die Push-your-luck-Disziplin (Banking-Timing),
Tickets sind ein steadier, risikofreier Nebenertrag des Spielens selbst,
genau wie die Attendant-Rate (siehe oben) ihn kontinuierlich produziert. Das
erlaubt außerdem, dass die Attendant-Rate für BEIDE Ströme dieselbe
EV-Mathematik verwendet, ohne ein diskretes Banking-Ereignis nachbilden zu
müssen.

**Normalisierungs-Konstante (`ticketYieldFactor`, `machines.config.ts`):**
`factor = 1/sqrt(scalingFactor)`, wobei `scalingFactor` derselbe
Meilenstein-Skalierungsfaktor gegenüber Greed Run ist, der bereits Phase 7c
Payout-Ranges/Meilensteine bestimmt (1.0/1.2/1.4/1.8). Ergebnis: Greed Run
1.0, Trap Tunnels 0.913, Beat Ledger 0.845, Champion's Ledger 0.745 — dämpft
den Rohzahlen-Vorsprung von Champion's Ledger gegenüber Greed Run von ~1.8x
auf einen EFFEKTIVEN Vorsprung von ~1.34x (`1.8 × 0.745`), ohne ihn
vollständig auszugleichen (spätere Automaten tragen weiterhin absolut mehr
bei, wie gefordert). Wahl der sqrt-Dämpfung statt vollständiger oder gar
keiner Korrektur: dokumentierter Kompromiss, per Test abgesichert
(`ticketYieldFactor` streng monoton fallend, effektiver Vorsprung > 1 aber
< Rohzahlen-Vorsprung).

**`src/data/hall.config.ts` (+Test):** `TICKET_CONVERSION_UPGRADES`/
`getTicketConversionRate`/`BASE_TICKET_CONVERSION_RATE` →
`TICKET_YIELD_UPGRADES`/`getTicketYieldRate`/`BASE_TICKET_YIELD_RATE`.
Basis 1.0 (neutral, kein Malus mehr wie beim alten Umrechnungskurs-Startwert
0.5 — es gibt keine Zwischenwährung mehr, die absichtlich "unterbewertet"
starten müsste). Stufen 1.5×/2.25×/3.0× bei unveränderten Kosten (30/120/
350 Tickets). `MACHINE_UNLOCK_UPGRADES`/`ATTENDANT_SPEED_UPGRADES` inhaltlich
unverändert (nur Währung heißt jetzt Tickets statt Credits). **Bekannte,
nicht in dieser Phase behobene Vereinfachung:** die absoluten Kosten wurden
1:1 aus Phase 7 übernommen; da die neue direkte Ticket-Erzeugung (ohne
Umrechnungs-Zwischenschritt) tendenziell schneller Tickets liefert als das
alte zweistufige Modell, ist eine erneute Balance-Iteration beim Playtesting
zu erwarten (game-spec.md Abschnitt 6: Zahlenbalance wird iterativ getunt,
nicht vorab exakt fixiert) — insbesondere `ATTENDANT_ACTIONS_PER_SECOND = 1`
ist ein bewusst grob gewählter Startwert, der in der Browser-Verifikation
unten spürbar hohe Offline-Erträge erzeugt hat.

**`src/game/economy.ts`:** Neue Funktion `tickAttendants(now)` — iteriert
über ALLE `MACHINES`, wendet für jeden freigeschalteten UND durchgespielten
Automaten `applyAttendantElapsed` an (Rate aus
`machines.config.ts::getMachineAttendantRate`, das die reine
AttendantEngine-Mathematik mit den Data-Layer-Werten dieses Automaten UND
dem hallenweiten `ticketYieldRate` kombiniert — lebt in `machines.config.ts`
statt `AttendantEngine.ts`, weil letztere laut Architektur-Kurzregel nie aus
`/src/data` importieren darf), schreibt Automaten-Punkte/Tickets/Pool-Zustand
zurück, persistiert nur bei tatsächlichem Zuwachs.

**`src/App.tsx`:** Ruft `tickAttendants()` einmal sofort beim Mounten
(wendet ausstehenden Offline-Ertrag sofort an) und danach alle 2000ms
(`setInterval`), UNABHÄNGIG von `view` — löst die bisherige Kopplung
"Attendant tickt nur, während der Spieler in der Halle ist" bewusst auf
(Phase 5/7c-Verhalten), da alle Automaten jetzt global im Hintergrund laufen
sollen, auch während der Spieler manuell an einem beliebigen Automaten
spielt. Als Folge wurde `src/game/viewState.ts` (Race-Bridge zwischen React
und der EINEN aktiven `MachineScene`-Instanz für genau dieses
View-Attendant-Kopplungsproblem) komplett entfernt — sie hatte nach dem
Wegfall dieser Kopplung keinen verbleibenden Konsumenten mehr (verifiziert
per Grep über den gesamten `src`-Baum vor dem Löschen).

**`src/game/scenes/MachineScene.ts`:** Das komplette
Attendant-Tick-Subsystem entfernt (`tickAttendant`, `buildAttendantQueue`,
`executeAttendantQueue`, der `isAttendant`-Parameter durch
`runQueueStep`/`finishExecution`, `attendantTicking`-Feld, der
`'view-changed'`-Listener) — die Szene behandelt jetzt ausschließlich
manuelles Spielen, der Attendant läuft komplett separat (economy.ts). Neu in
`runQueueStep`: sofortige `economyStore.addHallTickets(...)`-Ausschüttung
pro Aktion (siehe oben). `updateAttendantStatusText` zeigt jetzt nur noch
informativ die aktuell geltende Rate (dieselbe Formel wie economy.ts) an,
tickt selbst nichts mehr.

**`src/ui/HallHub.tsx`/`UpgradePanel.tsx`/`AttendantPanel.tsx`:** Credits-
Anzeige und der "In Credits umwandeln"-Button vollständig entfernt.
HallHub zeigt die hallenweite Ticket-Summe sowie pro Automat die
Automaten-Punkte. UpgradePanel kauft über `purchaseHallUpgrade`
(spendet jetzt Tickets), zeigt die "Ticket-Ertragsrate"-Kategorie statt
"Ticket-Umrechnung". AttendantPanel trainiert für Tickets (statt Credits)
und zeigt zusätzlich die aktuelle Attendant-Rate (Automaten-Punkte/s,
Tickets/s) an. CSS-Klasse `.hall-hub__credits` → `.hall-hub__tickets`
(public/style.css).

**Geänderte/neue Tests:** `EconomyStore.test.ts` (Credits-Tests entfernt,
Tickets/Automaten-Punkte-Äquivalente ergänzt, neue Pool/Zeitstempel-Tests),
`SaveSystem.test.ts` (neuer Test: alter v1-Save wird beim Laden abgelehnt,
kein Crash), `AttendantEngine.test.ts` (komplett neu für Rate-/Pool-
Funktionen, inkl. Konvergenz-Test über 500 simulierte Zyklen mit
Pseudo-RNG), `hall.config.test.ts` (Umbenennung), `machines.config.test.ts`
(nutzt jetzt `computeStationaryDistribution` aus AttendantEngine statt
eigener Kopie, neue Tests für `ticketYieldFactor`/`getMachineAttendantRate`).

**Verifiziert:** `npm test` (**219/219 grün**, +22 gegenüber Phase 7c),
`npm run lint` sauber, `npx tsc --noEmit` sauber, `npm run build-nolog`
erfolgreich. Zusätzlich zwei eigenständige Verifikationsskripte (Session-
intern, nicht Teil des Repos):
- Ein Node/tsx-Skript gegen die echten Engine-/Data-Module direkt (kein
  Browser nötig): bestätigt, dass `convertTicketsToCredits` nicht mehr
  existiert, zwei gleichzeitig laufende Automaten unabhängig positive Raten
  liefern, ein 1h-Offline-Sprung exakt `Rate × Zeit` ohne Pool-Overhead
  liefert und den Pool unverändert lässt, eine 10-Tage-Lücke exakt auf den
  24h-Deckel gekappt wird, und die Pool-Ausschüttung über 200 simulierte
  Zyklen mit echtem `Math.random()` sowohl sichtbare Varianz (200 von 200
  Ausschüttungen unterschiedlich) als auch Konvergenz zur echten Rate
  (0.03% relative Abweichung) zeigt.
- Ein Playwright-Skript gegen `npm run dev-nolog` (echter Browser, echtes
  `localStorage`): ein vorbereiteter Speicherstand (saveVersion 2, 2 fertig
  durchgespielte Automaten, letztes Attendant-Update 30 Minuten in der
  Vergangenheit) wird geladen → HallHub erscheint direkt (kein Replay nötig),
  Tickets steigen SOFORT beim Laden von 12.5 auf ~15990 (Offline-Ertrag über
  30 Minuten bei zwei gleichzeitig produzierenden Automaten — spürbar hoch,
  siehe Balance-Hinweis oben zu `ATTENDANT_ACTIONS_PER_SECOND`), kein
  "Credits"/"umwandeln"-Text mehr sichtbar, "Automaten-Punkte" wird korrekt
  pro Automat angezeigt, AttendantPanel zeigt eine laufende Rate
  ("~4.65 Automaten-Punkte/s, ~4.65 Tickets/s" bei Musterkenntnis 80%),
  Tickets steigen über 4.5s Beobachtung weiter (16025.8), keine
  Konsolenfehler. Skript + temporäre Playwright-Installation wurden nach dem
  Lauf wieder entfernt (nicht Teil des Repos/package.json).

## NEUE PHASE 7c: Kernmechanik-Revision v2 (2026-07-09, mit Nutzer abgestimmt)

Phase 7b (2 harte Konter-Aktionen + Zwischenstufen) hat sich im Playtest immer
noch nicht wie eine planbare Entscheidung angefühlt. Nutzer-Vorschlag: ein
reiner ZYKLISCHER Konter ohne sichere Option. Nach Rückfrage folgende
verbindliche Entscheidungen (siehe auch game-spec.md 4.1b für die
spielerseitige Beschreibung — 4.1a bleibt als Historie stehen, nur das
Aktionsmodell wird ersetzt, "festes Pattern pro Run" und "ticket-finanzierte
automaten-interne Vorschau-Upgrades" aus 4.1a gelten unverändert weiter):

1. **n=5 Aktionen, zyklisch, jede kontert genau die nächste** (A→kontert→B,
   B→C, C→D, D→E, E→A). Damit auch: alle vier Automaten brauchen 5
   Pattern-Zustände statt bisher 3 (1:1 zu den 5 Aktionen), inkl. komplett
   neuer Transitions-Matrizen — reines Rework von `machines.config.ts`, keine
   Wiederverwendung der alten 3-Zustands-Configs.
2. **Drei Ergebnis-Stufen statt Erfolg/Fehlschlag:** Großer Gewinn (Zustand =
   der von der Aktion gekonterte Nachbar), Verlust (Zustand = der Vorgänger,
   der DIESE Aktion kontert), Einfacher Treffer (die übrigen 3 Zustände).
   Verlust ist ein EIGENER, fester Payout-Bereich (negativ), KEIN
   Prozentabzug vom aktuellen Punktestand mehr — löst `FAILURE_PENALTY_FRACTION`
   aus Phase 7b vollständig ab.
3. **Kein Erfolg/Fehlschlag-Konzept in der Engine mehr nötig:** Jede Aktion
   trifft immer, nur die Payout-Spanne variiert (kann negativ sein). Das
   erlaubt eine ECHTE Vereinfachung von `PushYourLuckEngine.resolveAction()`
   — die bisherige `failureChance`-Bernoulli-Rolle entfällt komplett, es wird
   nur noch ein Wert aus einer (ggf. negativen) Payout-Spanne gezogen und auf
   den Punktestand addiert. Bitte diese Vereinfachung tatsächlich umsetzen,
   nicht nur die alte failureChance-basierte Struktur mit failureChance=0
   nachbilden — das wäre unnötig komplizierter Code für ein jetzt einfacheres
   Modell.
4. **Blind-Erwartungswert-Garantie, automatisiert geprüft:** Für jede Aktion
   jedes Automaten muss der Erwartungswert unter der ECHTEN stationären
   Verteilung des Patterns (per Power-Iteration bestimmen, wie schon in Phase
   7b für den alten Trade-off-Check gemacht — NICHT einfach 1/n annehmen,
   falls die Übergangswahrscheinlichkeiten nicht gleichverteilt sind) positiv
   sein. Zusätzlich prüfen: keine Aktion darf allein aufgrund der stationären
   Verteilung (ganz ohne Vorschau) einen klar höheren Blind-EV haben als die
   anderen — sonst gäbe es eine "immer diesen einen Knopf drücken"-
   Dominanzstrategie, die den Lese-Skill entwertet (siehe Risiko-Notiz unten).
5. **Peak-Score-Sticky-Milestone-Logik aus Phase 7b bleibt** (unverändert
   sinnvoll, jetzt sogar einfacher zu begründen: ein einzelner Verlust ist
   jetzt ein fixer Betrag statt eines Prozentsatzes).
6. **Zwei-Achsen-Vorschau statt einfachem "zeige d Positionen exakt"
   (Ergänzung 2026-07-09, siehe game-spec.md 4.1b):** Ersetzt die ursprünglich
   in dieser Phase geplante einfache Sichtweiten-Vorschau. Präzision `p`
   (0 bis n−1) schließt `p` garantiert falsche Kandidaten pro sichtbarer
   Position aus (wahrer Zustand bleibt unter den `n−p` verbleibenden
   versteckt); Sichtweite `d` (1 bis n) bestimmt, wie viele kommende
   Positionen überhaupt eine solche Teilinformation bekommen. ZWEI separate,
   wiederholt kaufbare, im Preis steigende `MachineUpgradeDef`-Leitern pro
   Automat (ticket-finanziert), `p` gedeckelt bei n−1 (= Zustand de facto
   bekannt), `d` gedeckelt bei n. `p` gilt einheitlich für alle sichtbaren
   Positionen (keine dritte Dimension "Präzision je Tiefe"). Die pro Position
   ausgeschlossenen Kandidaten werden EINMAL bei Run-Start zusammen mit der
   festen Sequenz ermittelt und bleiben für den gesamten Run stabil (keine
   erneute Zufallsziehung bei wiederholtem Hinsehen — vermeidet eine
   zusätzliche versteckte Zufallsebene, Baukasten 1.11).
7. **Startwerte + Kreuz-Preis-Kopplung (Ergänzung 2026-07-09):** Start bei
   `d=1, p=1` (nicht 0), damit der Spieler nie komplett blind startet.
   Da `p` auf ALLE sichtbaren Positionen wirkt, ist der Informationswert der
   Kombination quasi ein Produkt aus `d` und `p` (nicht additiv) — ohne
   Bremse würde einseitiges Rushen eines Pfads zu unkontrolliertem Wachstum
   führen. Deshalb: KEIN harter Ausschluss, aber ein multiplikativer
   Kreuz-Preis-Aufschlag, abhängig davon, wie viele Stufen des JEWEILS
   ANDEREN Pfads bereits über den Startwert hinaus gekauft wurden:
   ```
   Preis(nächste Tiefe-Stufe)      = Basispreis_Tiefe(Stufe)      × (1+k)^(gekaufte Präzisions-Stufen über Start)
   Preis(nächste Präzisions-Stufe) = Basispreis_Präzision(Stufe)  × (1+k)^(gekaufte Tiefe-Stufen über Start)
   ```
   `k = 0.2` als Startwert (20 % Aufschlag pro bereits gekaufter Stufe des
   anderen Pfads) — bei vollständig einseitigem Rushen ergibt das am Ende
   ca. 70–95 % Aufpreis auf die letzten Stufen des vernachlässigten Pfads
   (1.2³≈1.73, 1.2⁴≈2.07), bei ausgewogenem Einkauf bleibt der Effekt
   moderat. Basispreise pro Achse geometrisch wachsend, als Ausgangspunkt:
   Tiefe (Stufe 2/3/4/5): 10/22/48/107 Tickets (Wachstumsfaktor ~2.2);
   Präzision (Stufe 2/3/4): 15/38/94 Tickets (Wachstumsfaktor ~2.5, steiler,
   weniger Stufen bis Maximum). **Diese Basispreise MÜSSEN pro Automat
   proportional zur jeweiligen Ticket-Ökonomie skaliert werden** (Champion's
   Ledger hat z. B. deutlich höhere Meilenstein-Schwellen als Greed Run) —
   nicht die exakt gleichen absoluten Zahlen für alle vier Automaten
   übernehmen.
   **Pflicht-Zielwert-Check (automatisiert, nicht nur gefühlt passend):**
   Simuliere den erwarteten Ticket-Ertrag bis zum ERSTEN Erreichen des
   letzten Meilensteins (Erwartungswert-Rechnung über die Payout-Ranges,
   ähnlich der bereits vorhandenen Blind-EV-Berechnung) und prüfe, dass
   damit ~85–95 % der Gesamtkosten BEIDER Leitern (inkl. Kreuz-Kopplung bei
   ausgewogenem Einkauf) finanzierbar sind — "fast alle Upgrades bei
   Durchspielen gekauft" als Zielkorridor, nicht exakt 100 % und nicht
   deutlich darunter. Falls die Basispreise das nicht hergeben, anpassen
   und die finalen Zahlen in STATUS.md dokumentieren.

**PM-Risikohinweise für die Umsetzung (bitte aktiv gegenprüfen, nicht nur
Kenntnis nehmen):**
- Die Attendant-Logik aus Phase 7b (`chooseAttendantAction`,
  `getAttendantLookahead` etc.) basiert vollständig auf dem alten "harte
  Aktion vs. Zwischenstufe"-Modell und muss komplett neu gedacht werden: kennt
  der Attendant den Zustand an dieser Position (eigener Lookahead), wählt er
  die dort konternde Aktion (großer Gewinn); kennt er ihn nicht, sind laut
  Blind-EV-Garantie alle 5 Aktionen ungefähr gleichwertig -- eine einfache
  Fallback-Wahl (z. B. `chooseAttendantIntermediateTier`-Analogon) reicht,
  MUSS aber nicht mehr zwischen zwei Aktionsarten unterscheiden.
- `MAX_PREVIEW_MOVES` (bisher 3, an die alte Zustandsanzahl gekoppelt) muss
  auf 5 angepasst werden. Die bisherige EINE `MachineUpgradeDef`-Leiter
  (visibility) wird durch das Zwei-Achsen-Modell oben ersetzt: ZWEI separate
  Upgrade-Leitern pro Automat (Sichtweite `d` 1→5, Präzision `p` 0→4), neuer
  `UpgradeEffect`/`MachineUpgradeDef`-Typ mit zwei Effekt-Varianten statt
  einer. Siehe game-spec.md 4.1b, Abschnitt "Zwei-Achsen-Vorschau".
- `types.ts`: `HardActionDef`/`IntermediateActionDef`-Unterscheidung aus
  Phase 7b entfällt zugunsten eines einzigen, symmetrischen Aktionstyps
  (z. B. `CyclicActionDef` mit `payoutBig`/`payoutSimple`/`payoutLoss`
  Ranges) -- bitte selbst einen sauberen Typ entwerfen, keine
  Kompatibilitäts-Altlasten aus Phase 7b mitschleppen.

Betroffene Dateien voraussichtlich: `src/engine/types.ts` (Aktionstyp
ersetzen), `src/engine/PushYourLuckEngine.ts` (+Test, echte Vereinfachung),
`src/data/machines.config.ts` (alle vier Automaten komplett neu: 5
Zustände, 5 Aktionen, neue Resolutionsfunktion, Blind-EV-Test),
`src/engine/AttendantEngine.ts` (+Test, neues Auswahlmodell),
`src/game/scenes/MachineScene.ts` (Anzeige/Vorschau/Kaufoberfläche an n=5
anpassen).

### Ergebnis: Phase 7c umgesetzt (2026-07-09)

**`src/engine/types.ts`:** `HardActionDef`/`IntermediateActionDef` komplett
entfernt, ersetzt durch einen einzigen `CyclicActionDef` (`id`,
`counterState` = Grosser-Gewinn-Zustand, `losesToState` = Verlust-Zustand,
`payoutBig`/`payoutSimple`/`payoutLoss` Ranges). `ResolvedAction` verliert
`failureChance` komplett -- nur noch `id` + `payoutRange` (kann negativ
sein). `MachineUpgradeDef.effect` bekommt zwei Varianten (`previewDepth`/
`previewPrecision`) statt der bisherigen `visibility`. `MachineConfig`
tauscht das einzelne `upgrades`-Array gegen zwei unabhaengige Leitern
(`depthUpgrades`/`precisionUpgrades`).

**`src/engine/PushYourLuckEngine.ts` (echte Vereinfachung, wie gefordert):**
`resolveAction()` zieht jetzt nur noch EINEN rng()-Wert (Payout-Position in
der ggf. negativen Spanne) statt zwei (Fehlschlag-Bernoulli + Payout-
Position). `ActionResult` verliert `success`/`penalty`, nur noch
`payout`/`scoreAfter`. `FAILURE_PENALTY_FRACTION` und das gesamte
Erfolg/Fehlschlag-Konzept sind vollstaendig entfernt (nicht nur mit
failureChance=0 nachgebildet). Design-Entscheidung, nicht explizit
gefordert: Punktestand wird bei 0 nach unten geklemmt (`Math.max(0, ...)`)
-- ein Verlust ist jetzt ein fester Betrag statt eines Prozentabzugs und
koennte ohne Klemmung den ungebankten Punktestand negativ machen;
`EconomyStore.addTickets`/`bank()` wuerden dann bei einem negativen Betrag
werfen. Peak-Sticky-Meilenstein-Logik aus Phase 7b bleibt unveraendert
(canBank/getReachedMilestones basieren weiterhin auf `peakScore`, nicht dem
aktuellen, ggf. durch einen Verlust gedrueckten Punktestand).

**Geaenderte Tests in `PushYourLuckEngine.test.ts`:** alle FAILURE_PENALTY_
FRACTION-Tests entfernt/ersetzt durch Tests fuer negative Payout-Ranges
(Verlust zieht den festen Betrag direkt ab, Klemmung bei 0, mehrere
Verluste in Folge, Peak-Stickiness und Banking bleiben wie in Phase 7b
erhalten, nur ohne Prozentabzug-Semantik).

**`src/data/machines.config.ts` (komplett neu):** Alle vier Automaten haben
jetzt 5 Pattern-Zustaende und 5 zyklische Aktionen (thematisch benannt,
siehe Tabelle unten). `buildCyclicActions(states, templates)` leitet
`counterState`/`losesToState` STRUKTURELL aus der Zyklusposition ab (Aktion
an Index i gewinnt bei `states[i+1]`, verliert bei `states[i-1]`) statt von
Hand transkribiert zu werden -- schliesst Zuordnungsfehler aus, automatisiert
per Test geprueft (`buildCyclicActions`-Tests + "bilden je einen
vollstaendigen 5er-Zyklus"-Test ueber alle vier Automaten).

| Automat | Zustaende (Zyklus) | Aktionen (Zyklus, gleiche Reihenfolge) |
|---|---|---|
| Greed Run | fern, nah, alarm, sichtkontakt, rueckzug | sprint, schleicher, ablenker, versteck, vorstoss |
| Trap Tunnels | stabil, wackelig, einsturz, verschuettet, freigelegt | sprengladung, stuetzpfeiler, schaufelzug, tunnelblick, notausstieg |
| Beat Ledger | ruhig, treibend, doppelschlag, synkope, break | grundschlag, doppelkombo, synkopenkombo, breakbeat, standakkord |
| Champion's Ledger | finte, aggressiv, defensiv, ermuedet, spezialmove | angriff, konter, ausdauerschlag, spezialkonter, tempowechsel |

**Blind-EV-Garantie (automatisiert, Power-Iteration wie in Phase 7b, siehe
`machines.config.test.ts`):** stationaere Verteilung je Automat bewusst mild
(nicht perfekt uniform, aber auch nicht stark geskewt) gewaehlt:

| Automat | Blind-EV Bereich (min–max ueber die 5 Aktionen) | Dominanz-Verhaeltnis |
|---|---|---|
| Greed Run | 5.38 – 6.64 | 1.234 |
| Trap Tunnels | 7.68 – 8.96 | 1.167 |
| Beat Ledger | 9.46 – 10.33 | 1.092 |
| Champion's Ledger | 11.98 – 12.94 | 1.080 |

Alle Blind-EVs > 0 (Garantie erfuellt) und alle Verhaeltnisse unter der
gewaehlten Toleranzschwelle 1.25 (keine Aktion dominiert das blinde Spiel;
Champion's Ledger als komplexester Automat bewusst mit der flachsten
Verteilung/kleinsten Dominanz).

**Zwei-Achsen-Vorschau:** `computeCandidateExclusionOrder(states, trueState,
rng)` wuerfelt EINMAL pro Position eine stabile Ausschluss-Reihenfolge aller
falschen Kandidaten; `getExcludedCandidates(order, precision)` schneidet
die ersten `p` davon ab -- monoton (hoehere Praezision deckt strikt mehr
derselben Reihenfolge auf, nie eine neu gewuerfelte, widerspruechliche
Menge). Start `d=1, p=1` (nie komplett blind), Deckel `d<=5` (=`N_STATES`),
`p<=4` (=`N_STATES-1`, Zustand de facto bekannt).

**Kreuz-Preis-Kopplung:** `getMachineUpgradeCost(machine, upgrade, ownedIds)`
= Basispreis × `1.2^(bereits gekaufte Stufen der jeweils anderen Achse)`.
Basispreise MUSSTEN gegenueber der urspruenglichen Vorgabe (10/22/48/107 bzw.
15/38/94) deutlich nach unten skaliert werden -- die Vorgabe-Zahlen ergaben
unskaliert ~334% von Greed Runs letztem Meilenstein (100), weit ausserhalb
des 85-95%-Zielkorridors. Finale, per Skript verifizierte Basispreise (siehe
Zielwert-Tabelle unten), Greed Run als Skalierungs-Basis (Faktor 1.0), die
uebrigen drei proportional zum Verhaeltnis ihrer letzten Meilenstein-Schwelle
zu Greed Runs 100 skaliert (1.2 / 1.4 / 1.8):

| Automat | Tiefe-Basispreise (Stufe 2-5) | Praezisions-Basispreise (Stufe 2-4) | Meilenstein | Interleaved Gesamtkosten | Zielwert-Verhaeltnis |
|---|---|---|---|---|---|
| Greed Run | 2, 4, 8, 18 | 3, 6, 16 | 100 | 89.31 | 89.3% |
| Trap Tunnels | 2, 5, 10, 22 | 4, 7, 19 | 120 | 108.13 | 90.1% |
| Beat Ledger | 3, 6, 11, 25 | 4, 8, 22 | 140 | 123.58 | 88.3% |
| Champion's Ledger | 4, 7, 14, 32 | 5, 11, 29 | 180 | 159.81 | 88.8% |

Alle vier im Zielkorridor 85-95%, per `it.each`-Test automatisiert geprueft
(`getUpgradeCostToMilestoneRatio`). "Interleaved Gesamtkosten" = Summe bei
ausgewogenem Einkauf (Kaufreihenfolge Tiefe1, Praezision1, Tiefe2,
Praezision2, Tiefe3, Praezision3, Tiefe4 -- Tiefe hat eine Stufe mehr).
Modellannahme fuer den erwarteten Ticket-Ertrag: da 1 Punkt Score = 1 Ticket
(Banking sichert den Punktestand direkt), naehert der letzte Meilenstein-
Schwellenwert selbst den erwarteten Ertrag eines abgeschlossenen Laufs an
(ein Spieler bankt kurz NACH Erreichen der Schwelle, der Ueberschuss pro
Schritt ist klein relativ zur Schwelle).

**`src/engine/AttendantEngine.ts`:** `chooseAttendantAction(hardActions,
intermediateActions, ...)` ersetzt durch `chooseAttendantAction(actions,
remainingCandidates)` -- kennt der Attendant den Zustand an einer Position
EXAKT (`remainingCandidates.length === 1`), waehlt er immer die dort
konternde Aktion (garantierter Grosser Gewinn). Bei PARTIELLER Praezision
(mehrere, aber nicht alle Kandidaten uebrig) meidet er -- Ermessens-
entscheidung, hier bewusst getroffen -- jede Aktion, deren Verlust-Zustand
noch Kandidat ist, und bevorzugt unter den verbleibenden "sicheren" Aktionen
eine, deren Gewinn-Zustand ebenfalls noch moeglich ist. Begruendung: das
nutzt verfuegbare Teilinformation, ohne dass der Attendant dafuer die volle
PatternEngine-Verteilung kennen muesste (bleibt reine Kandidatenmengen-
Logik, konsistent mit der Blind-EV-Garantie, die sicherstellt, dass eine
komplett uninformierte Wahl -- Fallback `actions[0]` -- keine Aktion klar
benachteiligt). `getAttendantResolvedAction` skaliert die GESAMTE
Payout-Spanne einheitlich mit der Effizienz (auch im Verlust-Fall) --
bewusst keine Sonderregel fuer negative Payouts, da ein vorausschauend
spielender Attendant Verluste bereits durch seine Aktionswahl vermeidet.

**`src/game/scenes/MachineScene.ts`:** Zwei-Achsen-Vorschau-Anzeige (pro
sichtbarer Position: verbleibende Kandidaten als "moeglich [...]" mit
separat aufgelisteten "ausgeschlossen"-Kandidaten; ausserhalb der
Sichtweite weiterhin "??"). 5 Aktions-Buttons in einer Reihe (ersetzt die
alte Hart/Zwischenstufe-Zweiteilung), zeigen live GROSSER GEWINN/VERLUST
sicher bzw. "Gewinn/Verlust ausgeschlossen/moeglich" je nach aktuellem
Kandidatenstand. Zwei separate Kaufoberflaechen fuer Tiefe- und
Praezisions-Upgrades (je eigene Reihe, zeigt den aktuellen, kreuz-preis-
abhaengigen Preis live).

**Verifiziert:** `npm test` (197/197 gruen, +12 gegenueber Phase 7b), `npm
run lint` sauber, `npx tsc --noEmit` sauber, `npm run build-nolog`
erfolgreich. Manuell per Playwright-Treiberskript gegen `npm run dev`
(Skripte/Screenshots nicht Teil des Repos, nur Session-interne
Verifikation, keine Konsolenfehler in allen Laeufen):
- Greed Run frisch gestartet: Vorschau zeigt bei Start (d=1, p=1) korrekt
  "moeglich [fern, alarm, sichtkontakt, rueckzug] (ausgeschlossen: nah)" fuer
  Position 1, alle weiteren Positionen "??"; Aktions-Buttons zeigen korrekt
  "Gewinn ausgeschlossen, Verlust moeglich" fuer die Aktion, deren
  Gewinn-Zustand "nah" gerade ausgeschlossen wurde, und "Gewinn und Verlust
  beide noch moeglich" fuer die uebrigen.
- Aktion gequeued + ausgefuehrt: Feedback zeigt korrekt "Treffer" (nicht
  Gewinn/Verlust) beim tatsaechlich neutralen Zustand, Punktestand steigt um
  den gezogenen `payoutSimple`-Wert; Vorschau fuer die naechste Position
  danach mit NEU gewuerfelter, weiterhin stabiler Ausschluss-Reihenfolge.
- Tiefe- und Praezisions-Upgrade gekauft (Streckenkenntnis I: 200→198
  Tickets bei Kosten 2.0 ohne Praezisions-Kopplung; Scharfblick I:
  198→194.4 bei Kosten 3.6 = 3 × 1.2¹, da 1 Tiefe-Stufe bereits gekauft):
  Kreuz-Preis-Kopplung stimmt exakt mit der Formel ueberein, Vorschau-Fenster
  wuchs sofort sichtbar (Tiefe 1→2, Praezision 1→2, mehr ausgeschlossene
  Kandidaten pro Position, monotone Obermenge der vorherigen Ausschluesse).
- Attendant mit Musterkenntnis 0.9, 20s Leerlauf in der Halle: 0 → ~111.1
  Tickets, keine Konsolenfehler (Groessenordnung konsistent mit dem in
  Phase 5 verifizierten Wert von 83.9 Tickets/20s bei aehnlicher
  Musterkenntnis -- kein Ausreisser durch die neue Balance).

**Bewusst NICHT als eigene Aenderung behandelt:** `PatternEngine`-Klasse
selbst unangetastet (wie gefordert) -- `getVisibility()`/
`getVisibleDistribution()` sind seit dieser Phase funktional ungenutzt
(die Zwei-Achsen-Vorschau wird direkt ueber `depthUpgrades`/
`precisionUpgrades` gesteuert, nicht mehr ueber die PatternEngine-
Sichtbarkeits-Berechnung). `PatternConfig.baseVisibility`/
`visibilityPerUpgrade` bleiben im Typ (von `PatternEngine.
validatePatternConfig` weiterhin gefordert) und sind in allen vier Configs
auf einen neutralen Platzhalterwert (`1`/`[]`) gesetzt.

## BUG (behoben, 2026-07-09) — Rückweg Automat→Halle nach zweitem Durchlauf

**Ursache gefunden:** Es gab bis dahin GAR KEINEN manuellen Weg von einem
Automaten zurück in die Halle — nur das einmalige automatische Reveal
(`TransitionScene`) beim ERSTEN Durchspielen des entryPoint-Automaten setzte
`view` auf `'hall'`. Ein zweiter Durchlauf (Score-Attack) oder jeder Besuch
von Automat 2-4 endete deshalb zwangsläufig in einer Sackgasse — es war nie
ein Bug im `'request-machine'`-Listener, sondern ein von Anfang an fehlender
Rückweg, der nur beim allerersten Mal durch den automatischen Reveal
kaschiert wurde.

**Fix:** Neuer persistenter "Zur Halle"-Button in `MachineScene` (oben links,
`renderBackToHallButton()`, sichtbar sobald der entryPoint-Automat
durchgespielt ist — vorher gäbe es laut game-spec.md Abschnitt 2 noch keine
Meta-UI). Emittiert ein neues EventBus-Event `'return-to-hall'`, das
`App.tsx` genau wie `'hall-reveal'` behandelt (`setView('hall')`), OHNE die
laufende `MachineScene` zu beenden — der Automat läuft im Hintergrund weiter,
exakt wie beim Reveal-Übergang (Phase 5).

**Verifiziert (Playwright-Treiberskript gegen `npm run dev`):** Automat →
Zur Halle → Spielen (zweiter Durchlauf) → Zur Halle erneut — funktioniert
beide Male ohne Reload, keine Konsolenfehler.

## NEUE PHASE 7b: Kernmechanik-Revision (2026-07-09, mit Nutzer abgestimmt)

Nutzer-Playtest-Feedback zu Phase 3-7: die Muster-Vorschau ("Prognose") fühlte
sich wirkungslos an, weil sie nur eine Wahrscheinlichkeit anzeigt statt einer
konkreten, planbaren Entscheidung. Erwartungshaltung des Nutzers: ein festes
Pattern pro Run, von dem man den nächsten Zug sieht, plus zwei Aktionen, die
sich exakt kontern (schere-stein-papier-artig, aber nur EIN Konter-Paar, keine
volle Drei-Wege-Rotation), plus mehrere sicherere Zwischenstufen. Nach
Rückfrage folgende verbindliche Entscheidungen (siehe auch game-spec.md 4.1a
für die spielerseitige Beschreibung):

1. **Fixes Pattern pro Run:** Ganze Zug-Sequenz steht ab Run-Start fest
   (vorab durch wiederholtes `PatternEngine.sampleNext()` generiert und als
   Array eingefroren), nicht mehr live pro Schritt neu gewürfelt.
2. **Zwei harte Konter-Aktionen + mehrere Zwischenstufen:** Ersetzt das
   bisherige generische safe/balanced/risky-Dreiklang. Die zwei harten
   Aktionen sollen PRO AUTOMAT thematisch benannt werden (löst auch den
   vorherigen PM-Befund "alle vier Automaten fühlen sich gleich an").
3. **Auflösung ohne Engine-Änderung an PatternEngine:** Von den Pattern-
   Zuständen (aktuell 3 pro Automat) werden zwei als "Gegenstück zu harter
   Aktion X" bzw. "Gegenstück zu harter Aktion Y" deklariert, der/die
   übrigen als neutral. Harte Aktion scheitert NUR beim exakten eigenen
   Gegenstück-Zustand, trifft bei JEDEM anderen Zustand (auch beim
   Gegenstück der anderen harten Aktion und bei neutral). Zwischenstufen
   bleiben zustandsunabhängig (eigene feste Fangchance je Stufe, mehrere
   Abstufungen statt nur einer). `PatternEngine`-Klasse selbst bleibt
   unverändert (Rollenzuweisung ist Data-/Scene-Layer-Logik wie schon bei
   `getEffectiveFailureChance`); NUR die Interpretation von `getVisibility`
   ändert sich (Ergebnis wird jetzt als Anzahl vorausschaubarer Züge der
   FESTEN Sequenz interpretiert, nicht als Wahrscheinlichkeits-Reveal-Anteil
   der nächsten Transition).
4. **Fehlschlag = Teilstrafe, KEIN hartes Run-Ende mehr:** Das bisherige
   "busted"-Konzept (`PushYourLuckRun.resolveAction`: Fehlschlag → Status
   'busted', Score auf 0) entfällt. Stattdessen: Fehlschlag zieht einen Teil
   (Richtwert 30–50 %, iterativ zu tunen) des aktuellen, ungebankten
   Punktestands ab, der Run bleibt 'active' und läuft weiter. Das IST eine
   echte Aenderung an `PushYourLuckEngine` (nicht nur Data-Layer) —
   `resolveAction`s Fehlschlag-Semantik muss angepasst werden. Bestehende
   Tests in `PushYourLuckEngine.test.ts`, die das alte busted-Verhalten
   pruefen, muessen entsprechend aktualisiert werden (bewusste, gewollte
   Verhaltensaenderung, keine Regression).
5. **Automaten-interne Upgrades, bezahlt mit den EIGENEN Tickets des
   Automaten (nicht mit Hallen-Credits):** Neue Progression-Achse pro
   Automat — mehr Vorschau auf die feste Sequenz wird direkt mit den
   Tickets DIESES Automaten gekauft. Das erfordert eine neue
   `EconomyStore`-Faehigkeit (`spendTickets` o.ae., symmetrisch zu
   `spendCredits`, aber pro Automat) sowie eine neue Kaufoberflaeche
   (vermutlich in/bei `MachineScene`, nicht im hallenweiten
   `UpgradePanel.tsx` — das bleibt ausschliesslich fuer Hallen-Credits-
   Upgrades). `hall.config.ts`/`UpgradePanel.tsx` selbst bleiben
   unveraendert; dies ist eine PARALLELE, separate Wirtschaft pro
   Automat, keine Erweiterung der Hallen-Wirtschaft.

**Wichtig — Abweichung vom bisherigen Arbeitsmodus:** Bisher galt "Engines
(Phase 1+2) nicht veraendern, nur Data-/Scene-Layer". Fuer DIESE Phase ist das
ausdruecklich aufgehoben fuer `PushYourLuckEngine` (Punkt 4) und `EconomyStore`
(Punkt 5, neue Methode) -- beide Aenderungen sind hier bewusst angeordnet, kein
Abweichen von der Architektur-Kurzregel. `PatternEngine` selbst bleibt
unveraendert (Punkt 3). `AttendantEngine` muss an das neue Aktionsmodell
(harte Aktionen + Zwischenstufen statt generischer RiskTier-Skala) angepasst
werden -- wie der Attendant seine Aktionswahl trifft, ist Teil dieser Phase,
nicht spaeter.

Betroffene Dateien voraussichtlich: `src/engine/types.ts` (RiskTier/UpgradeDef-
Form ueberarbeiten), `src/engine/PushYourLuckEngine.ts` (+Test),
`src/engine/EconomyStore.ts` (+Test, neue Methode),
`src/engine/AttendantEngine.ts` (+Test), `src/data/machines.config.ts`
(komplett neue Aktions-/Rollenzuweisungs-Definitionen je Automat, neue
Resolutionsfunktion statt `getEffectiveFailureChance`), `src/game/scenes/
MachineScene.ts` (Ausfuehrung/Anzeige/neue Kaufoberflaeche fuer automaten-
interne Upgrades), Tests entsprechend ueberall.

### Ergebnis: Phase 7b umgesetzt (2026-07-09)

**`src/engine/types.ts`:** `RiskTier` komplett ersetzt durch drei neue Typen:
`HardActionDef` (`kind:'hard'`, `counterState`), `IntermediateActionDef`
(`kind:'intermediate'`, feste `failureChance`), `MachineAction` (Union
beider, Config-Zeit) und `ResolvedAction` (Engine-Zeit — das, womit
`PushYourLuckEngine.resolveAction()` tatsaechlich wuerfelt, kennt weder
"hart"/"Zwischenstufe" noch Pattern-Zustaende). `MachineConfig.riskTiers` ->
`actions: MachineAction[]`. Neuer `MachineUpgradeDef`-Typ (`cost` in Tickets
DIESES Automaten statt Credits, `effect: {type:'visibility', value}`) —
`MachineConfig.upgrades: MachineUpgradeDef[]` (vorher immer leeres
`UpgradeDef[]`, jetzt erstmals befuellt). `EngineState` um
`machineUpgrades: Record<string, string[]>` erweitert (SaveSystem/
EconomyStore entsprechend mitgezogen, kein Save-Versions-Bump noetig, da
additiv mit sicherem Default).

**`src/engine/PushYourLuckEngine.ts`:** `RunStatus` verliert `'busted'`
(nur noch `'active' | 'banked'`). `resolveAction()` zieht bei Fehlschlag
`FAILURE_PENALTY_FRACTION` (= 0.4, im geforderten Richtwert 30-50%, als
optionaler Parameter ueberschreibbar) vom AKTUELLEN Punktestand ab, Lauf
bleibt `'active'`. Design-Entscheidung (nicht explizit in der Vorgabe,
hier bewusst getroffen): Meilenstein-Erreichung ist jetzt "sticky"
(`peakScore`, historisches Maximum) statt score-basiert — ein einmal
erreichter bankbarer Meilenstein bleibt bankbar, auch wenn ein spaeterer
Fehlschlag den AKTUELLEN Punktestand darunter drueckt. Ohne das haette eine
Teilstrafe denselben Effekt auf die Banking-Berechtigung wie das alte harte
Run-Ende gehabt und die Revision teilweise unterlaufen. `bank()` sichert
weiterhin den tatsaechlichen (reduzierten) Punktestand, nicht den Peak.

**Bewusst geaenderte alte Tests in `PushYourLuckEngine.test.ts`:**
- *"Fehlschlag setzt Punktestand auf 0 zurueck und beendet den Lauf als
  'busted'"* → ersetzt durch *"Fehlschlag zieht FAILURE_PENALTY_FRACTION des
  aktuellen Punktestands ab, Lauf bleibt aktiv"*.
- *"wirft, wenn der Lauf bereits busted ist"* → entfernt (busted existiert
  nicht mehr).
- *"bank() wirft nach einem Fehlschlag (busted, Score bereits 0)"* → ersetzt
  durch *"bank() bleibt nach einem Fehlschlag moeglich, sichert aber nur den
  reduzierten aktuellen Punktestand"* (genau gegenteiliges, gewolltes
  Verhalten).
- Neu hinzugefuegt: Test fuer die Peak-Stickiness der Meilenstein-Erreichung,
  Test fuer mehrere aufeinanderfolgende Fehlschlaege, Test fuer den
  `penaltyFraction`-Parameter.

**`src/engine/EconomyStore.ts`:** Neue Methode `spendTickets(machineId,
amount)`, symmetrisch zu `spendCredits`, aber pro Automat. Neue Methoden
`getMachineUpgrades`/`hasMachineUpgrade`/`purchaseMachineUpgrade` (Pro-
Automat-Muster wie `attendantKnowledge`, Wert hier aber eine Liste gekaufter
Upgrade-ids statt einer Zahl) — kaufen ueber `spendTickets`, nicht
`spendCredits`. Neues Event `machine-upgrade-purchased`.

**`src/data/machines.config.ts`:** Fuer alle vier Automaten neu definiert —
je zwei thematisch benannte harte Aktionen mit Gegenstueck-Zustand + drei
Zwischenstufen (die alten safe/balanced/risky-Basiswerte, jetzt WIRKLICH
musterunabhaengig, keine `getEffectiveFailureChance`-Modulation mehr):

| Automat | Harte Aktion 1 (Gegenstueck) | Harte Aktion 2 (Gegenstueck) | Neutraler Zustand |
|---|---|---|---|
| Greed Run | Blitzlauf (alarm) | Schleichgang (nah) | fern |
| Trap Tunnels | Sprengladung (einsturz) | Stuetzpfeiler (wackelig) | stabil |
| Beat Ledger | Powermove (doppelschlag) | Punktlandung (treibend) | ruhig |
| Champion's Ledger | Angriff (defensiv) | Konter (aggressiv) | finte |

Neue Resolutionsfunktion `resolveMachineAction(action, currentState)`
ersetzt `getEffectiveFailureChance` vollstaendig (deterministisch: harte
Aktion → failureChance 0 oder 1 je nach Zustandsvergleich; Zwischenstufe →
unveraendert durchgereicht). `getVisibleMoveCount(visibility)` reinterpretiert
`PatternEngine.getVisibility()` (unveraendert, weiterhin 0-1) als Zug-Anzahl
(`* MAX_PREVIEW_MOVES=3`, gerundet, mindestens 1) — `PatternEngine`-Klasse
selbst dabei nicht angefasst, wie gefordert.

Trade-off-Check (design-toolbox.md Punkt 5) neu hergeleitet, da die alte
zustandsabhaengige EV-Tabelle nicht mehr passt: stationaere Verteilung jedes
Patterns per Power-Iteration bestimmt (Test-Hilfsfunktion, nicht Teil der
Produktions-Logik) als Proxy fuer die "Blind-EV" einer harten Aktion (ohne
Sichtbarkeit gespielt) — die liegt fuer beide harten Aktionen aller vier
Automaten NACHWEISLICH unter der besten Zwischenstufen-EV (keine Dominanz
beim Raten), waehrend die "Perfekt-Info-EV" (nur bei sichtbar sicherem
Zustand gespielt) darueber liegt (Vorschau lohnt sich echt, design-
toolbox.md 1.10) — beides per `it.each`-Test ueber alle vier Automaten
automatisiert geprueft, konkrete Zahlen als Kommentar in `machines.config.ts`.

Automaten-interne Upgrades (ticket-bezahlt): Greed Run 2 Stufen (15/40
Tickets), Trap Tunnels 1 Stufe (20 Tickets), Beat Ledger keine (schon volle
Sichtbarkeit), Champion's Ledger 2 Stufen (25/60 Tickets) — Anzahl
entspricht jeweils der Laenge von `pattern.visibilityPerUpgrade` (per Test
abgesichert).

**`src/engine/AttendantEngine.ts`:** `getAttendantFailureChance`/
`getAttendantTier` entfernt (basierten auf dem alten kontinuierlichen
Fangchance-Modell). Neu: `getAttendantLookahead(visibleMoveCount,
knowledge)` — wie viele der TATSAECHLICH sichtbaren Zuege der Attendant
nutzen kann (0 bei Musterkenntnis 0, das volle Fenster bei voller Kenntnis).
`chooseAttendantAction(hardActions, intermediateActions, knownState,
knowledge)` — kennt der Attendant den Zustand an dieser Position (innerhalb
seines Lookaheads), waehlt er IMMER eine dort garantiert sichere harte
Aktion (bevorzugt die mit hoeherem Payout, falls beide sicher sind); sonst
faellt er auf eine Zwischenstufe zurueck (rät nie blind auf eine harte
Aktion). `getAttendantResolvedAction` skaliert wie bisher nur noch den
Payout mit der Effizienz (`ATTENDANT_MAX_EFFICIENCY`, unveraendert) — die
Fangchance bleibt unveraendert (0/1 bei harten Aktionen, die er ohnehin nur
bei Erfolg spielt; fest bei Zwischenstufen, unabhaengig davon wer spielt).

**`src/game/scenes/MachineScene.ts`:** Feste Zug-Sequenz (`sequence: string[]`,
`sequenceCursor`) wird lazy per `PatternEngine.sampleNext()`-Kette erzeugt
und NIE mehr veraendert (nur verlaengert). Vorschau zeigt bis zu
`MAX_QUEUE_LENGTH` (6) kommende Positionen, davon `getVisibleMoveCount()`
viele als konkrete Zustandsnamen, der Rest als "??". Aktions-Buttons zeigen
bei harten Aktionen live, ob die Position (falls sichtbar) TRIFFT oder
SCHEITERT. Neue Kaufoberflaeche fuer automaten-interne Upgrades direkt in
der Szene (NICHT in `UpgradePanel.tsx`, das bleibt exklusiv Hallen-Credits).
"Busted"-Phase/-Controls vollstaendig entfernt — `finishExecution()` prueft
nur noch Meilenstein/Abschluss, kein `RunStatus`-Check auf Fehlschlag mehr
noetig. Zusaetzlich: `renderBackToHallButton()` (Bugfix, siehe oben).

**Verifiziert:** `npm test` (185/185 gruen, +46 gegenueber Phase 7), `npm run
lint` sauber, `npx tsc --noEmit` sauber, `npm run build` erfolgreich.
Manuell per Playwright-Treiberskript gegen `npm run dev` (Screenshots nicht
Teil des Repos, nur Session-interne Verifikation): Greed Run UND Champion's
Ledger geprueft — Vorschau zeigt konkrete kommende Zuege statt Wahrscheinlichkeit
("Naechster Zug: nah", "Feste Sequenz: nah -> ?? -> ..."); harte Aktionen
zeigen korrekt TRIFFT/SCHEITERT live im Button-Text und das tatsaechliche
Ausfuehrungsergebnis stimmt IMMER mit dieser Vorschau ueberein (deterministisch,
kein Zufall bei der Trefferfrage); mehrfache Fehlschlaege in Folge reduzieren
den Punktestand nur graduell (kein Reset auf 0, kein Busted-Screen); Meilenstein/
Score-Attack/automatischer Hallen-Uebergang bei Erstdurchspielen funktionieren
unveraendert; automaten-internes Upgrade "Streckenkenntnis I" fuer 15 Tickets
gekauft (100 -> 85 Tickets), Vorschau-Fenster wuchs sofort von 1 auf 2 Zuege;
Attendant lief mit dem neuen Aktionsmodell fehlerfrei automatisiert (Tickets
100 -> 146.9 nach 25s Leerlauf in der Halle, keine Konsolenfehler).

## Offene Design-Fragen (noch nicht final entschieden)

## Verlauf

- [x] Phase 0 — Projekt-Setup — abgenommen
- [x] Phase 1 — Engine-Kern ohne UI — abgenommen (EconomyStore, SaveSystem, events.ts; 40 Vitest-Tests grün, Lint sauber, Build ok)
- [x] Phase 2 — PatternEngine + PushYourLuckEngine — abgenommen (39 neue Vitest-Tests grün, 79 Tests insgesamt, Lint + `tsc --noEmit` sauber)
- [x] Phase 3 — Automat 1 vertikaler Vollschnitt ("Greed Run") — abgenommen (Blocker unten aufgelöst)
- [x] Phase 4 — Reveal + Hallen-Grundgerüst — abgenommen (PM-Review 2026-07-09)
- [x] Phase 5 — Attendant-System — abgenommen (PM-Review 2026-07-09)
- [x] Phase 6 — Automaten 2–4 — abgenommen (PM-Review 2026-07-09, siehe Bedingungen unten)
- [x] Phase 7 — Hallen-Upgrades & Cross-Layer-Feedback — Code steht, wartet auf Nutzer-Verifikation (siehe Abschnitt "Phase 7" unten)
- [x] Phase 7b — Kernmechanik-Revision — Code steht, wartet auf Nutzer-Verifikation (siehe Abschnitt "Ergebnis: Phase 7b umgesetzt" oben)
- [x] Phase 7c — Kernmechanik-Revision v2 — Code steht, wartet auf Nutzer-Verifikation (siehe Abschnitt "Ergebnis: Phase 7c umgesetzt" oben)
- [x] Phase 7d — Attendant-Rate + Ticket-Ökonomie-Vereinfachung — Code steht, wartet auf Nutzer-Verifikation (siehe Abschnitt "Ergebnis: Phase 7d umgesetzt" oben)
- [x] Phase 7e — Erkennbarkeit + Banking-Streichung — Code steht, wartet auf Nutzer-Verifikation (siehe Abschnitt "Ergebnis: Phase 7e umgesetzt" oben)
- [ ] Phase 8 — Politur / Juice
- [ ] Phase 9 — Abschluss-Erlebnis

## Workflow-Abweichung von CLAUDE.md (mit Nutzer abgestimmt, 2026-07-09)

Bis einschließlich Phase 6 gibt es für den Nutzer kaum sinnvoll manuell
testbare Ergebnisse (echte Upgrades/Cross-Layer-Feedback kommen erst in
Phase 7). Deshalb: Cowork (PM/Architekt-Rolle) prüft nach jeder Phase Spec-
Konformität, Architektur-Regeln und Tests/Build eigenständig und gibt bei
bestandener Prüfung den nächsten Claude-Code-Prompt direkt weiter, OHNE
jedes Mal auf explizites Nutzer-Go zu warten. Der Nutzer wird nur bei echten
Abweichungen (wie dem Phase-3-Blocker oben) oder offenen Design-Entscheidungen
einbezogen. Ab Phase 7 (erstes echtes Playtesting-Ergebnis für den Nutzer)
gilt die normale CLAUDE.md-Regel wieder: nach Phasenabschluss anhalten und
auf Rückmeldung warten.

## PM-Review: Phase 4–6 (2026-07-09)

Laut Workflow-Abweichung oben wurde nach Phase 4 und Phase 5 NICHT angehalten,
sondern direkt weitergearbeitet. Hier die Gesamtzusammenfassung aller drei
Phasen für die PM-Review. Alle drei liefen durch dieselbe Verifikationskette:
`npm test` / `npm run lint` / `npx tsc --noEmit` / `npm run build-nolog`
grün, plus manuelle Playwright-Treiberskripte gegen `npm run dev` mit
Screenshots (nicht Teil des Repos, nur zur Verifikation in der Session
verwendet). Aktueller Testcount: **128 Vitest-Tests, alle grün.**

### Phase 4 — Reveal + Hallen-Grundgerüst

**Design-Entscheidung (von dir als PM festgelegt, hier dokumentiert):**
Der Durchbruch aus game-spec.md Abschnitt 2 (dort als "TBD, Richtwert
10-20 Minuten" offengelassen) wird NICHT über eine neue Zeitmessung
ausgelöst, sondern ist ein und dasselbe Ereignis wie das Abschluss-Kriterium
aus game-spec.md 4.1 (erstmaliges Durchspielen von Automat 1). Umgesetzt in
`MachineScene.finishExecution()`: bei der ERSTEN Erreichung des letzten
Meilensteins für den `entryPoint`-Automaten wird der Lauf automatisch
gebankt und direkt `TransitionScene` gestartet, statt die normale
Banking/Score-Attack-Entscheidung anzuzeigen (die gibt es für Automat 2-4
weiterhin normal, siehe Phase 6).

**Neu:** `src/game/scenes/TransitionScene.ts` (Kamerazoom + Fade-Text
"Ein Blick hinter die Fassade...", ~2.2s, reine Phaser-Primitives), Reveal
wird via `EventBus.emit('hall-reveal')` an React gemeldet.
`src/ui/HallHub.tsx` (React, `/src/ui` wie in implementation-plan.md
vorgesehen): zeigt freigeschaltete Automaten, Credits, Rückkehr-Button.
`App.tsx` haelt jetzt einen `view`-State (`'machine' | 'hall'`) und rendert
`HallHub` als volldeckendes Overlay ÜBER dem Phaser-Canvas (`.game-shell`
mit `position: relative`, `HallHub` `position: absolute; inset: 0`) --
Phaser laeuft dabei WEITER im Hintergrund (wichtig fuer Phase 5).

**Stolperfalle (gefunden + behoben):** `game.scene.start(key, data)` auf der
globalen Phaser-SceneManager-Instanz crasht ("Cannot read properties of
null"), wenn er von AUSSERHALB des Phaser-Update-Loops aufgerufen wird (hier:
ein React-Klick-Handler in `HallHub`) und die Zielszene bereits laeuft.
Fix: Der `'request-machine'`-Listener sitzt jetzt IN `MachineScene.create()`
und ruft `this.scene.start(...)` auf der eigenen, garantiert gueltigen
ScenePlugin-Instanz auf, statt global in `main.ts` auf `game.scene`.

**Verifiziert:** Erstdurchspielen von Greed Run loest sichtbar Transition ->
HallHub aus; Reload mit bereits abgeschlossenem Save landet direkt in der
Halle (kein Replay der Reveal-Sequenz, Baukasten 1.8); "Spielen" aus der
Halle wechselt zurueck zum Automaten ohne Fehler.

### Phase 5 — Attendant-System

**Neu:** `src/engine/AttendantEngine.ts` + `AttendantEngine.test.ts` (21
Tests, framework-unabhaengig). Zwei Stellschrauben, beide an "Musterkenntnis"
(0-1, gespeichert in EconomyStore, existierte bereits seit Phase 1) gekoppelt:
- **Effizienz** (`getAttendantEfficiency`): Payout bei Erfolg wird auf
  `ATTENDANT_MAX_EFFICIENCY (0.875) * knowledge` geklemmt -- game-spec.md 3.2
  Richtwert "85-90% der Bestleistung bei voller Musterkenntnis" exakt
  getroffen und per Test abgesichert.
- **Zusatzrisiko** (`getAttendantFailureChance`): bei niedriger
  Musterkenntnis ein Aufschlag auf die (musterzustandsabhaengige)
  failureChance, der bei voller Musterkenntnis auf 0 sinkt (Attendant
  faengt dann exakt die failureChance eines Spielers). "safe" bleibt
  fuer den Attendant immer risikofrei, wie fuer einen Spieler.
- `getAttendantTier()` leitet daraus (wie beim Phase-3-Blocker-Fix) nur eine
  abgeleitete RiskTier-Kopie ab -- `PushYourLuckEngine.resolveAction`
  selbst unveraendert, keine Kopplung von PatternEngine/PushYourLuckEngine
  aneinander.
- `chooseAttendantTier()`: einfache Strategie, waehlt Tier-Index proportional
  zur Musterkenntnis (sicherster Tier bei 0, riskantester bei voller
  Musterkenntnis).
- Musterkenntnis-Wachstum: `gainKnowledgeFromManualPlay` (+0.02/Aktion,
  primaer) vs. `gainKnowledgeFromTraining` (+0.01/Kauf, sekundaer/langsamer)
  -- game-spec.md 3.2 explizit gefordertes Verhaeltnis, per Test geprueft.

**MachineScene-Integration:** `runQueueStep`/`finishExecution` bekamen einen
`isAttendant`-Parameter. Manuelles Spielen erhoeht Musterkenntnis, Attendant-
Runs nicht (sonst Feedback-Loop-Risiko: Attendant spielt sich selbst besser).
Attendant trifft Meilenstein-/Bust-Entscheidungen unbeaufsichtigt immer sicher
(Bank statt weiterspielen). Ein wiederkehrender Timer (`ATTENDANT_TICK_INTERVAL_MS
= 1000`) startet automatisiert neue Runden, SOLANGE `attendantTicking === true`.

**`attendantTicking` haengt an `view` aus App.tsx** (`'hall'` = Attendant
aktiv, `'machine'` = pausiert -- Baukasten 1.3, aktives Spielen bleibt die
bewusste Wahl). Kommuniziert per `EventBus`-Event `'view-changed'`.

**Stolperfalle (gefunden + behoben):** Ein rein event-basierter Ansatz fuer
den Anfangszustand von `attendantTicking` hat eine Race Condition: React
(App.tsx, mountet sofort) kann `'view-changed'` emittieren, BEVOR Phaser
(bootet ueber eigenen rAF-Tick) die `MachineScene` ueberhaupt erzeugt und
ihren Listener registriert hat -- das erste Event geht dann spurlos verloren
(Phaser-EventEmitter puffert nichts), Attendant blieb dauerhaft inaktiv.
**Fix:** `src/game/viewState.ts`, eine minimale geteilte Zelle (kein
State-Speicher parallel zu EconomyStore -- dupliziert keine Wirtschafts-
daten, haelt nur das UI-Navigationsflag "welche Ansicht ist sichtbar").
Ihr Default wird SYNCHRON beim Modul-Laden aus `economyStore.isMachineCompleted(...)`
berechnet (dieselbe Regel wie zuvor in `App.tsx`), nicht erst reaktiv per
Event gesetzt. `MachineScene.create()` liest `getCurrentView()` direkt,
race-frei; das Event bleibt fuer alle SPÄTEREN Wechsel zustaendig.

**Bekannte, bewusste Lücke:** Der Trainings-Button in `AttendantPanel.tsx`
kostet Credits, aber die Tickets->Credits-Umrechnung ist laut
implementation-plan.md ein Hallen-Upgrade (Phase 7). Bis Phase 6 (siehe
unten) waren Credits daher permanent 0 und der Button entsprechend meist
deaktiviert -- kein Bug, sondern eine erwartete Konsequenz der
Phasenreihenfolge, jetzt durch die Phase-6-Platzhalterloesung entschärft.

**Verifiziert:** Mit hoher Musterkenntnis (0.9, per Save-Injection) erzeugte
der Attendant in der Halle **83.9 Tickets in 20s ohne einen einzigen Klick**;
nach Rueckwechsel zum Automaten blieb der Ticketstand exakt eingefroren
(0 neue Tickets in weiteren 5s) -- Automatisierung pausiert korrekt.
Training verifiziert: 25 Credits -> 15 Credits, Musterkenntnis 0.42 -> 0.43.

### Phase 6 — Automaten 2–4

**Neu in `machines.config.ts`:** `TRAP_TUNNELS` ("Trap Tunnels", Dig-Dug-
Twist), `BEAT_LEDGER` ("Beat Ledger", DDR-Twist), `CHAMPIONS_LEDGER`
("Champion's Ledger", Street-Fighter-Twist) -- alle `entryPoint: false`.
**Keine Code-Aenderung an `MachineScene.ts` noetig** -- die Szene war seit
Phase 3 tatsaechlich vollstaendig generisch, das war der Praxistest dafuer.

Trade-off-Check je Musterzustand fuer alle drei (Formel identisch zu Greed
Run, siehe Kommentare in `machines.config.ts`, automatisiert geprueft in
`machines.config.test.ts` per `it.each(MACHINES)` ueber alle 4 Automaten):

| Automat | Pattern-Philosophie (game-spec.md) | baseVisibility | Milestones |
|---|---|---|---|
| Trap Tunnels | "am wenigsten Zufall, nahezu vollstaendig ableitbar" | 0.8 (+0.2 Upgrade) | 25/60/120 |
| Beat Ledger | "von Anfang an bekannt wie Noten" | 1.0 (voll sichtbar, kein Upgrade noetig) | 30/70/140 |
| Champion's Ledger | komplexester/letzter Automat | 0.3 (+0.35+0.35 Upgrades) | 40/90/180 |

Fuer alle drei gilt je Musterzustand streng safe < balanced < risky bei EV
UND Risiko (kein Tier dominiert) -- exakte Zahlen als Kommentar in
`machines.config.ts`, automatisiert verifiziert.

**Bewusst NICHT abgebildet:** Champion's Ledger's "gelegentliche klar
angekündigte Spezialmoves" (game-spec.md 4.5) wurde als reine Fiktions-Farbe
ausgelassen, nicht als eigener Mechanismus. Eine "klare Ankündigung" wuerde
eine PRO-ZUSTAND-Sichtbarkeit in `PatternEngine` voraussetzen
(`getVisibility` ist aktuell global pro Upgrade-Level, nicht pro Zustand) --
das ist eine echte Engine-Luecke, kein Implementierungsdetail. Statt sie zu
umgehen oder die Engine dafuer zu erweitern, habe ich sie ausgelassen und
melde sie hiermit: falls "angekündigte Spezialmoves" mechanisch wichtig
sind, braucht `PatternEngine` eine neue Faehigkeit (z. B. `states` mit
individueller Sichtbarkeit), das waere ein Engine-Change und keine reine
Config-/Scene-Arbeit mehr.

**Freischalt-Logik + PLATZHALTER-Wirtschaft (bewusste Vorgriff-Entscheidung,
bitte gegenpruefen):** game-spec.md 3.3 verlangt "Automat 2 schaltet frei
nach Hallen-Upgrade-Schwelle X (basierend auf Credits aus Automat 1)". Genau
wie beim Attendant-Training in Phase 5 gilt: Credits sind ohne
IRGENDEINE Tickets->Credits-Umrechnung permanent 0, und ohne Credits waeren
Automat 2-4 fuer immer unerreichbar -- Phase 6 liesse sich dann nicht wie
gefordert durchspielen ("Alle 4 Automaten einzeln spielbar"). Deshalb, klar
als PROVISORISCH markiert (Kommentare in `machines.config.ts`/`HallHub.tsx`):
- `MACHINE_UNLOCK_COST` (`machines.config.ts`): feste Credit-Kosten pro
  Automat, steigend: trap-tunnels 50, beat-ledger 150, champions-ledger 400.
  Nutzt `economyStore.purchaseHallUpgrade()` (existierte bereits seit
  Phase 1, ungenutzt) fuer den eigentlichen Kauf.
- `HallHub.tsx`: fester Umrechnungskurs `TICKET_CONVERSION_RATE = 1` ueber
  einen neuen "In Credits umwandeln"-Button, nutzt
  `economyStore.convertTicketsToCredits()` (ebenfalls bereits seit Phase 1
  vorhanden).
Beides ist explizit als Uebergangsloesung dokumentiert und soll in Phase 7
durch das echte, konfigurierbare Hallen-Upgrade-System (`hall.config.ts`,
`UpgradePanel.tsx`) ersetzt werden (z. B. Umrechnungskurs selbst als
Upgrade, wie game-spec.md 3.1 es vorsieht). **Bitte als PM bestaetigen, dass
dieser Vorgriff so in Ordnung ist**, sonst muesste Phase 6 ohne echten
Freischalt-Test abgenommen werden.

**Verifiziert:** Mit 700 Credits (Save-Injection) alle drei Automaten nach-
einander freigeschaltet (700 -> 100 Credits, exakt 50+150+400 abgezogen);
alle vier Automaten-Karten korrekt in der Halle sichtbar/gesperrt; "Trap
Tunnels" gespielt -- Szene zeigt korrekt eigenen Namen, eigene
Musterzustaende (stabil/wackelig/einsturz) mit 85%/15%-Prognose (passend zu
baseVisibility 0.8) und die exakt konfigurierten Payout-/Fangchance-Werte;
Meilenstein-Erreichen bei Trap Tunnels zeigt korrekt die normale
Bank/Weitermachen-Entscheidung OHNE die grosse Reveal-Sequenz auszuloesen
(die ist `entryPoint`-exklusiv, Baukasten 1.8).

### PM-Entscheidungen (2026-07-09, nach unabhaengiger Verifikation: 128/128 Tests, Lint, tsc --noEmit, Build alle gruen in isolierter Kopie; Engine-Dateien seit Phase 3 nur additiv veraendert, keine Phaser/React-Importe in /src/engine)

1. **Platzhalter-Wirtschaft (Freischalt-Kosten, Umrechnungskurs) genehmigt.**
   Bedingung fuer Phase 7: muss dort VOLLSTAENDIG durch `hall.config.ts`
   ersetzt werden, nicht nur ergaenzt -- sonst existieren zwei
   Wirtschaftssysteme parallel.
2. **Champion's Ledger "angekuendigte Spezialmoves" -- Auslassen bestaetigt.**
   Kein Blocker. Backlog-Punkt fuer Phase 8 oder spaeter, keine
   PatternEngine-Erweiterung jetzt noetig.
3. **Neuer Befund (PM):** Alle vier Automaten nutzen aktuell identische,
   generische Risiko-Tier-Labels ("safe"/"balanced"/"risky") statt
   thematischer Bezeichnungen (z. B. Angriffs-/Block-/Konter-Tokens fuer
   Champion's Ledger laut game-spec.md 4.5). Mechanisch korrekt
   unterschiedlich (Zahlen, Sichtbarkeit), aber fuer den Spieler fuehlen
   sich alle vier Automaten aktuell gleich an -- nur die Zahlen drumherum
   unterscheiden sich. Kein Blocker fuer Phase 7 (Kernstruktur ist laut
   game-spec.md 4.1 bewusst geteilt), aber VERBINDLICHER Punkt fuer
   Phase 8 (Politur): thematische Beschriftung der Tokens/Tiers pro
   Automat, sonst Redundanz-Risiko (Baukasten 1.4/4.2).

### Phase 7 — Hallen-Upgrades & Cross-Layer-Feedback (2026-07-09)

Neu: `src/data/hall.config.ts` (reine Daten + kleine Ableitungsfunktionen,
analog zu `getEffectiveFailureChance` in `machines.config.ts` -- keine
Aenderung an EconomyStore/PatternEngine/PushYourLuckEngine/AttendantEngine).
`UpgradeDef`/`UpgradeEffect` (`src/engine/types.ts`) um `name`/`description`
sowie die Effect-Varianten `ticketConversionRate` und `unlockMachine`
erweitert (reine Typ-Erweiterung, keine Engine-Logik). Drei Upgrade-Kategorien,
alle ueber die bereits seit Phase 1 vorhandene
`economyStore.purchaseHallUpgrade(id, cost)` gekauft:

1. **Ticket->Credits-Umrechnung** (`TICKET_CONVERSION_UPGRADES`, 3 Stufen,
   0.5 Basis -> 0.75 -> 1.1 -> 1.5 Credits/Ticket). Ersetzt
   `TICKET_CONVERSION_RATE = 1` aus `HallHub.tsx` VOLLSTAENDIG -- die Basis-
   rate ohne jedes Upgrade ist bewusst niedriger als der alte Platzhalter
   (0.5 statt 1), damit die Stufen eine echte, spuerbare Verbesserung sind
   statt nur ein Reskin des alten Fixwerts.
2. **Automaten-Freischaltung** (`MACHINE_UNLOCK_UPGRADES`, aus `MACHINES`
   generiert). Ersetzt `MACHINE_UNLOCK_COST` aus `machines.config.ts`
   VOLLSTAENDIG -- Kosten unveraendert uebernommen (50/150/400, bereits in
   Phase 6 verifiziert), nur der Mechanismus wandert von einer fest
   codierten Konstante in ein echtes Upgrade. Kein Symbol/keine Konstante
   mit diesem Namen existiert mehr in `machines.config.ts`.
3. **Attendant-Trainingsgeschwindigkeit** (`ATTENDANT_SPEED_UPGRADES`, 2
   Stufen, Multiplikator 1x -> 1.4x -> 1.8x auf
   `AttendantEngine.TRAINING_KNOWLEDGE_GAIN`, hallenweit fuer ALLE Automaten
   gleichzeitig). Neu in Phase 7, kein Platzhalter-Vorgaenger.
   Cross-Layer-Feedback (Baukasten 1.14): ein mit Credits aus
   Automat 2-4 gekauftes Hallen-Upgrade verbessert rueckwirkend Automat 1s
   Attendant-Training -- Automat 1 bleibt dadurch nach Freischaltung der
   anderen drei relevant statt eine "stillgelegte Zahl" zu werden.
   Obergrenze bewusst < `MANUAL_KNOWLEDGE_GAIN / TRAINING_KNOWLEDGE_GAIN`
   (1.8x < 2x), per Test abgesichert (`hall.config.test.ts`), damit
   manuelles Spielen laut game-spec.md 3.2 auch bei voll gekauftem Training
   weiterhin schneller Musterkenntnis aufbaut als Credits-Training.

**AttendantEngine.ts/EconomyStore.ts/PatternEngine.ts/PushYourLuckEngine.ts
unveraendert** (Vorgabe fuer diese Phase). Die Verzahnung passiert an den
Aufrufstellen: `AttendantPanel.tsx` multipliziert
`AttendantEngine.TRAINING_KNOWLEDGE_GAIN` mit dem gekauften Multiplikator
(`hall.config.ts::getEffectiveTrainingGain`), genau wie schon
`machines.config.ts::getEffectiveFailureChance` PatternEngine/
PushYourLuckEngine verzahnt, ohne sie aneinander zu koppeln.

**UI:** Neues `src/ui/UpgradePanel.tsx` -- einzige Kaufoberflaeche fuer alle
drei Kategorien, in `HallHub.tsx` unterhalb der Automaten-Karten eingebettet.
`HallHub.tsx` selbst kauft nichts mehr direkt (der alte
`handleUnlock`-Button pro gesperrter Karte ist entfernt) -- gesperrte Karten
zeigen nur noch Status/Kosten und verweisen aufs UpgradePanel. Damit gibt es
nur noch EINEN Kaufpfad pro Upgrade-Typ (PM-Vorgabe: "am Ende darf es nur
noch einen Wirtschafts-Mechanismus geben, keine zwei parallelen").
Gemeinsamer `useEconomyRevision`-Hook aus `HallHub.tsx` nach
`src/ui/useEconomyRevision.ts` extrahiert (wird jetzt von `HallHub` UND
`UpgradePanel` genutzt, Event-Liste nur an einer Stelle zu pflegen).

**Bewusst NICHT Teil dieser Phase:** Pattern-Sichtbarkeits-Upgrades
(`MachineConfig.upgrades`, `visibilityPerUpgrade`) bleiben weiterhin leere
Arrays -- der PM-Auftrag fuer Phase 7 nannte explizit nur die drei Kategorien
oben (Umrechnungskurs, Freischalt-Schwellen, Attendant-Trainingsgeschwindigkeit).
`MachineScene.ts` hat dafuer keinen Platzhalter, der zu ersetzen waere (die
feste `upgradeLevel = 0` betrifft Sichtbarkeit, nicht Umrechnung/Training) --
deshalb bleibt `MachineScene.ts` in dieser Phase unveraendert. Falls
Sichtbarkeits-Upgrades gewuenscht sind, waere das ein eigener,
noch nicht spezifizierter Kaufmechanismus (pro Automat statt hallenweit) fuer
eine spaetere Phase.

**Verifiziert:** `npm test` (139/139 gruen, 11 neue Tests in
`hall.config.test.ts`), `npm run lint` sauber, `npx tsc --noEmit` sauber,
`npm run build` erfolgreich. Manuell per Playwright-Treiberskript gegen
`npm run dev` (Save-Injection: 1000 Credits, 200 Tickets bei Greed Run,
Greed Run durchgespielt): Wechselstube I gekauft (1000 -> 970 Credits, Kurs
0.50 -> 0.75 im UI sichtbar) -> 200 Tickets zum NEUEN Kurs umgewandelt (970
-> 1120 Credits, exakt +150 = 200*0.75) -> Trap Tunnels ueber das
UpgradePanel freigeschaltet (Karte wechselt von "Gesperrt" zu spielbar) ->
Schulungsprogramm I gekauft (Multiplikator-Anzeige 1.00x -> 1.40x) ->
Training bei Greed Run ausgefuehrt (Musterkenntnis 50% -> 51%, +1.4% statt
vorher +1%) -- kompletter Kreislauf Tickets -> Credits -> Hallen-Upgrades ->
spuerbar verbesserte Automaten (Automat 1 UND neu freigeschalteter Automat 2)
bestaetigt lauffaehig. Screenshots nicht Teil des Repos (nur Session-interne
Verifikation, wie in Phase 4-6).

### Offene Punkte fuer spaetere Phasen (keine Blocker, nur Merkposten)

- Pattern-Sichtbarkeits-Upgrades (`MachineConfig.upgrades`) sind weiterhin
  ueberall leere Arrays -- kein Kaufmechanismus fuer
  `visibilityPerUpgrade` existiert bisher (bewusst ausserhalb des Phase-7-
  Auftrags, siehe Abschnitt "Phase 7" oben).
- Attendant-Automatisierung laeuft aktuell nur fuer den GERADE AKTIVEN
  Automaten (ein einzelnes MachineScene-Objekt fuer alle 4 Automaten,
  Architektur-Kurzregel). "Mehrere Automaten gleichzeitig im Hintergrund"
  (impliziert von game-spec.md 3.1 fuer eine ausgereifte Idle-Erfahrung)
  ist damit noch nicht abgebildet -- Phase 5s Abnahmekriterium
  ("Automat 1 laeuft im Hintergrund weiter, waehrend der Spieler in der
  Halle ist") ist erfuellt, eine echte Mehrfach-Idle-Simulation waere aber
  ein groesseres architektonisches Thema fuer eine spaetere Phase.
- Champion's Ledger "angekündigte Spezialmoves" -- siehe oben, echte
  Engine-Luecke (pro-Zustand-Sichtbarkeit), aktuell nicht abgebildet.
- Score-Attack-Modus weiterhin nur "gleiche Config nochmal spielen", kein
  eigenes High-Score-Tracking (bereits aus Phase 3 bekannt).

## Offene Design-Fragen (noch nicht final entschieden)

- ~~Welcher Automat startet Layer 0~~ — entschieden: "Greed Run" (Automat 1), siehe game-spec.md Abschnitt 6
- Exakte Zahlenbalance (Payout-Tabellen, Schwellenwerte) — wird iterativ während Implementierung/Playtesting getunt

## BLOCKER: Phase 3 Spec-Abweichung — AUFGELÖST (2026-07-09)

~~Im Spiel gibt es zwar eine Muster-Prognose-Anzeige (`getVisibleDistribution`), aber
sie ist wirkungslos: `MachineScene.runQueueStep` sampled den Musterzustand nur zur
Anzeige/Feedback-Text, die tatsächliche Erfolg/Fehlschlag-Entscheidung kommt
ausschließlich aus `PushYourLuckRun.resolveAction(tier)`, die nur mit der fest
angezeigten `tier.failureChance` würfelt — komplett unabhängig vom Musterzustand.~~

**Fix:** Neue reine Funktion `getEffectiveFailureChance(tier, states, currentState, sensitivity)`
in `src/data/machines.config.ts` (nicht in den Engines — siehe Begründung unten).
`MachineScene.runQueueStep` sampled den Musterzustand jetzt VOR dem Aufruf von
`resolveAction`, berechnet daraus die effektive failureChance und ruft
`resolveAction` mit einer abgeleiteten Kopie der RiskTier auf (`{ ...tier,
failureChance: effective }`) — die Engine-Klasse `resolveAction()` selbst bleibt
unverändert und weiß nichts von `PatternEngine`. `PatternEngine`/`PushYourLuckEngine`
kennen sich weiterhin nicht gegenseitig (Architektur-Kurzregel CLAUDE.md); die
Verzahnung ist reine MachineScene-/Data-Layer-Logik.

Mechanik: `pattern.states` ist jetzt als Danger-Achse von sicher (Index 0) nach
gefährlich (letzter Index) definiert (Konvention, dokumentiert in `machines.config.ts`).
`getEffectiveFailureChance` verschiebt `tier.failureChance` um `(dangerFactor - 0.5) *
PATTERN_RISK_SENSITIVITY` (Sensitivity = 0.25, dangerFactor = index/(n-1)), geklemmt
auf [0, 1]. Ausnahme: `failureChance === 0` ("safe") bleibt IMMER exakt 0, unabhängig
vom Muster — sonst gäbe es keine garantiert risikofreie Aktion mehr und der
Trade-off-Check wäre verletzt.

Trade-off-Check (design-toolbox.md Punkt 5), jetzt MIT Musterzustand-Einfluss:

| Tier | fern (eff.) | nah (eff.) | alarm (eff.) | EV fern | EV nah | EV alarm |
|---|---|---|---|---|---|---|
| safe | 0% | 0% | 0% | 3.0 | 3.0 | 3.0 |
| balanced | 2.5% | 15% | 27.5% | 7.8 | 6.8 | 5.8 |
| risky | 22.5% | 35% | 47.5% | 13.95 | 11.7 | 9.45 |

Innerhalb jedes einzelnen Musterzustands gilt weiterhin streng safe < balanced <
risky bei EV UND Risiko (kein Tier dominiert ein anderes) — geprüft zusätzlich per
Vitest (`machines.config.test.ts`, Test "haelt fuer jeden Musterzustand die
Reihenfolge safe < balanced < risky ein"). Neu gegenüber der ursprünglichen Phase-3-
Version: der Musterzustand ist jetzt ein zweiter, aus der Prognose lernbarer
Faktor für die Sicher-vs-Riskant-Entscheidung — "risky" bei "fern" spielen (EV 13.95,
22.5% Fangchance) ist spürbar besser als "risky" bei "alarm" spielen (EV 9.45, 47.5%
Fangchance), die Prognose-Anzeige hat dadurch echten strategischen Wert
(design-toolbox.md 1.10), statt wirkungslose Deko zu sein.

Transparenz (Baukasten 1.11, sichtbares statt verstecktes Risiko): Die Risiko-Tier-
Buttons zeigen jetzt die EFFEKTIVE Fangchance für den aktuellen Musterzustand plus
Basis-Wert und Musterzustand als Begründung (z. B. "Fangchance 28% (Basis 15%,
Muster 'alarm')"), nicht nur die statische Basis-Zahl. Die Fangchance gilt
garantiert nur für den nächsten ausgeführten Schritt (das Muster bewegt sich
während der Ausführung weiter, siehe game-spec.md 4.2 "nur der nächste Schritt ist
vorhersagbar") — das ist eine bewusste Grenze, keine versteckte Varianz: tiefere
Vorschau kommt erst mit Sichtbarkeits-Upgrades (Phase 7).

Manuell im Browser nachgeprüft (Playwright gegen `npm run dev`): Bei Musterzustand
"fern" zeigten die Buttons balanced 2%/risky 22% (Rundungsartefakt durch
Gleitkomma-Subtraktion, korrekte Wahrscheinlichkeit ist 2.5%/22.5%), bei "alarm"
balanced 28%/risky 48% (korrekt 27.5%/47.5%) — die Zahl ändert sich sichtbar mit
dem Musterzustand, safe blieb konstant bei 0% ("musterunabhängig"). Neue Tests:
`src/data/machines.config.test.ts` (12 Tests für `getEffectiveFailureChance`,
u. a. Monotonie pro Zustand, Clamping, safe-Invarianz, unbekannter/einzelner
Zustand). `npm test` (91/91 grün), `npm run lint`, `npx tsc --noEmit` sauber.

## Notizen für den nächsten Agenten

Phase 1 war bei Übernahme dieser Session bereits im Code/Git fertig, aber STATUS.md war nicht aktualisiert worden — nachgeholt. `node_modules` im Projektordner ist Windows-spezifisch installiert (win32-Binaries); `npm install` dort nicht erneut ausführen, sonst können die nativen Bindings auf Windows kaputtgehen. `npm test`/`npm run lint`/`npx tsc --noEmit` liefen in dieser Session direkt im Projektordner (node_modules war bereits vorhanden) problemlos.

**Phase 2 (abgeschlossen):** `src/engine/PatternEngine.ts` (Markov-Übergänge über `PatternConfig`, Validierung der Übergangssummen auf 1, `getVisibility`/`getVisibleDistribution` für progressive Teilaufdeckung — aufgedeckt wird die Verteilung, nicht das exakte nächste Ereignis, `sampleNext` mit injizierbarem `rng`) und `src/engine/PushYourLuckEngine.ts` (`PushYourLuckRun`: `resolveAction` gegen `RiskTier`, Meilenstein-Auswertung über `Milestone[]`, `bank()`/`canBank()`). Design-Entscheidung, die für Phase 3 relevant ist: Ein Fehlschlag (`resolveAction` mit `success: false`) setzt den Punktestand des laufenden Runs komplett auf 0 zurück (kein Teilschutz) — Banking ist der einzige Weg, Punkte zu sichern. Ob safe/balanced/risky pro Automat einen echten EV/Varianz-Trade-off ergeben (Baukasten Checkliste Punkt 5), muss beim Befüllen von `machines.config.ts` in Phase 3 sichergestellt werden, die Engine selbst prüft das nicht.

Bei Beginn von Phase 3: siehe `implementation-plan.md` Abschnitt 4 (`MachineScene.ts` generisch, erste Konfiguration für "Greed Run" in `src/data/machines.config.ts`, Layer-0-Erlebnis ohne Hallen-UI). PatternEngine/PushYourLuckEngine sind fertig und einsatzbereit, aber noch nicht an Phaser/React angebunden.

**Phase 3 (abgeschlossen):** `src/data/machines.config.ts` (Config `GREED_RUN`, id `greed-run`, `entryPoint: true`), `src/game/scenes/MachineScene.ts` (eine generische Szene, liest nur Config), `src/game/economy.ts` (Bruecke: haelt die eine `EconomyStore`-Instanz der Session, laedt/speichert ueber `SaveSystem`). Alter Phaser-Template-Boilerplate entfernt: `MainMenu.ts`, `Game.ts`, `GameOver.ts`, `Preloader.ts` sowie `TestCounter.tsx` geloescht, `Boot.ts` startet jetzt direkt `MachineScene` mit der `entryPoint`-Machine, `App.tsx` mountet nur noch `<PhaserGame />` (kein Demo-UI, kein Hallen-HUD).

Rundenstruktur-Design (generisch für alle 4 Automaten, nicht Greed-Run-spezifisch): Planungsphase = Spieler queued bis zu 6 Risiko-Tokens (safe/balanced/risky); Ausführungsphase spielt die Queue automatisch mit 700ms-Delay pro Schritt ab (kein Input möglich); pro Schritt sample ich zunächst den nächsten Musterzustand via `PatternEngine.sampleNext`, berechne daraus die effektive failureChance (`getEffectiveFailureChance`, siehe aufgelöster Blocker oben) und rufe erst DANN `PushYourLuckRun.resolveAction` mit einer daraus abgeleiteten RiskTier-Kopie auf (Engine-Klassen selbst unverändert, nur konsumiert). Die sichtbare Prognose (`getVisibleDistribution`) zeigt wie in der Engine vorgesehen nur den nächsten Schritt, nicht die ganze Route — passt exakt zu game-spec.md 4.2 ("Patrouillenrouten... nur teilweise sichtbar (nächster Schritt)"). Kausalitäts-Feedback bei Fehlschlag zitiert den beobachteten Musterzustand + die tatsächlich verwendete (musterabhängige) Fangchance (z. B. `Fehlschlag bei "risky" (Fangchance 48% – Muster stand auf "alarm") – der Zug kam zu früh.`). `upgradeLevel` ist in der Szene aktuell fest auf 0 (Sichtbarkeits-Upgrades werden erst als Hallen-Upgrade in Phase 7 kaufbar); `UpgradeDef[]` in der Config ist deshalb bewusst leer.

Trade-off-Check (design-toolbox.md Punkt 5) für die RiskTiers von "Greed Run": ursprünglich nur mit der statischen `failureChance` gerechnet (EV safe/balanced/risky = 3,0/6,8/11,7 bei 0%/15%/35%) — das war unvollständig, siehe aufgelöster Blocker oben für die aktuelle, musterzustandsabhängige Version der Tabelle (jetzt die maßgebliche).

Manuell im Browser verifiziert (Playwright-Treiberskript gegen `npm run dev`, Screenshots geprüft): Planung → Queue → animierte Ausführung mit Kausalitäts-Feedback bei Erfolg und Fehlschlag → Meilenstein-Entscheidung (Banking vs. Weitermachen) → Bust-Screen mit Neustart → finaler Checkpoint (Score 108 bei deterministischem Safe-Spam) löst `completed`-Screen aus, `economyStore.markMachineCompleted('greed-run')` wird gesetzt, und nach "Sichern & beenden" steht `ticketsByMachine.greed-run: "108"` korrekt im `localStorage`-Speicherstand. `npm test` (79/79 grün), `npm run lint` und `npx tsc --noEmit` laufen sauber, `npm run build-nolog` erfolgreich.

Offene Punkte für spätere Phasen, keine Blocker für Phase 3: Zahlenbalance (Payouts/Meilenstein-Schwellen) ist Platzhalter und wird laut game-spec.md Abschnitt 6 iterativ getunt; visuelle Politur (Phase 8) fehlt komplett (nur Phaser-Primitives); Score-Attack-Modus ist aktuell nur "gleiche Config nochmal spielen", kein eigenes High-Score-Tracking.
