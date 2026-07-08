# STATUS.md

Wird nach jeder abgeschlossenen Phase aktualiziert. Einzige Quelle der Wahrheit für "wo stehen wir gerade" über Tool-/Session-Grenzen hinweg (Claude Code, Cowork, neue Chats).

## Aktueller Stand

**Zuletzt abgeschlossen:** Phase 3 (Automat 1 vertikaler Vollschnitt, "Greed Run")
**Läuft/als Nächstes:** Phase 4 (Reveal + Hallen-Grundgerüst)

## Verlauf

- [x] Phase 0 — Projekt-Setup — abgenommen
- [x] Phase 1 — Engine-Kern ohne UI — abgenommen (EconomyStore, SaveSystem, events.ts; 40 Vitest-Tests grün, Lint sauber, Build ok)
- [x] Phase 2 — PatternEngine + PushYourLuckEngine — abgenommen (39 neue Vitest-Tests grün, 79 Tests insgesamt, Lint + `tsc --noEmit` sauber)
- [x] Phase 3 — Automat 1 vertikaler Vollschnitt ("Greed Run") — abgenommen (siehe Details unten)
- [ ] Phase 4 — Reveal + Hallen-Grundgerüst
- [ ] Phase 5 — Attendant-System
- [ ] Phase 6 — Automaten 2–4
- [ ] Phase 7 — Hallen-Upgrades & Cross-Layer-Feedback
- [ ] Phase 8 — Politur / Juice
- [ ] Phase 9 — Abschluss-Erlebnis

## Offene Design-Fragen (noch nicht final entschieden)

- ~~Welcher Automat startet Layer 0~~ — entschieden: "Greed Run" (Automat 1), siehe game-spec.md Abschnitt 6
- Exakte Zahlenbalance (Payout-Tabellen, Schwellenwerte) — wird iterativ während Implementierung/Playtesting getunt

## Notizen für den nächsten Agenten

Phase 1 war bei Übernahme dieser Session bereits im Code/Git fertig, aber STATUS.md war nicht aktualisiert worden — nachgeholt. `node_modules` im Projektordner ist Windows-spezifisch installiert (win32-Binaries); `npm install` dort nicht erneut ausführen, sonst können die nativen Bindings auf Windows kaputtgehen. `npm test`/`npm run lint`/`npx tsc --noEmit` liefen in dieser Session direkt im Projektordner (node_modules war bereits vorhanden) problemlos.

**Phase 2 (abgeschlossen):** `src/engine/PatternEngine.ts` (Markov-Übergänge über `PatternConfig`, Validierung der Übergangssummen auf 1, `getVisibility`/`getVisibleDistribution` für progressive Teilaufdeckung — aufgedeckt wird die Verteilung, nicht das exakte nächste Ereignis, `sampleNext` mit injizierbarem `rng`) und `src/engine/PushYourLuckEngine.ts` (`PushYourLuckRun`: `resolveAction` gegen `RiskTier`, Meilenstein-Auswertung über `Milestone[]`, `bank()`/`canBank()`). Design-Entscheidung, die für Phase 3 relevant ist: Ein Fehlschlag (`resolveAction` mit `success: false`) setzt den Punktestand des laufenden Runs komplett auf 0 zurück (kein Teilschutz) — Banking ist der einzige Weg, Punkte zu sichern. Ob safe/balanced/risky pro Automat einen echten EV/Varianz-Trade-off ergeben (Baukasten Checkliste Punkt 5), muss beim Befüllen von `machines.config.ts` in Phase 3 sichergestellt werden, die Engine selbst prüft das nicht.

Bei Beginn von Phase 3: siehe `implementation-plan.md` Abschnitt 4 (`MachineScene.ts` generisch, erste Konfiguration für "Greed Run" in `src/data/machines.config.ts`, Layer-0-Erlebnis ohne Hallen-UI). PatternEngine/PushYourLuckEngine sind fertig und einsatzbereit, aber noch nicht an Phaser/React angebunden.

**Phase 3 (abgeschlossen):** `src/data/machines.config.ts` (Config `GREED_RUN`, id `greed-run`, `entryPoint: true`), `src/game/scenes/MachineScene.ts` (eine generische Szene, liest nur Config), `src/game/economy.ts` (Bruecke: haelt die eine `EconomyStore`-Instanz der Session, laedt/speichert ueber `SaveSystem`). Alter Phaser-Template-Boilerplate entfernt: `MainMenu.ts`, `Game.ts`, `GameOver.ts`, `Preloader.ts` sowie `TestCounter.tsx` geloescht, `Boot.ts` startet jetzt direkt `MachineScene` mit der `entryPoint`-Machine, `App.tsx` mountet nur noch `<PhaserGame />` (kein Demo-UI, kein Hallen-HUD).

Rundenstruktur-Design (generisch für alle 4 Automaten, nicht Greed-Run-spezifisch): Planungsphase = Spieler queued bis zu 6 Risiko-Tokens (safe/balanced/risky); Ausführungsphase spielt die Queue automatisch mit 700ms-Delay pro Schritt ab (kein Input möglich); pro Schritt sample ich zusätzlich den nächsten Musterzustand via `PatternEngine.sampleNext` rein zur Einordnung/Anzeige ("Muster stand auf X"), die tatsächliche Erfolg/Fehlschlag-Entscheidung inkl. Score-Reset kommt ausschließlich aus `PushYourLuckRun.resolveAction` (Engine unverändert, nur konsumiert). Die sichtbare Prognose (`getVisibleDistribution`) zeigt wie in der Engine vorgesehen nur den nächsten Schritt, nicht die ganze Route — passt exakt zu game-spec.md 4.2 ("Patrouillenrouten... nur teilweise sichtbar (nächster Schritt)"). Kausalitäts-Feedback bei Fehlschlag zitiert den beobachteten Musterzustand + die gewählte Risikostufe (z. B. `Fehlschlag bei "risky" (Fangchance 35%) – Muster stand auf "alarm", der Zug kam zu früh.`) statt nur "Fehlschlag". `upgradeLevel` ist in der Szene aktuell fest auf 0 (Sichtbarkeits-Upgrades werden erst als Hallen-Upgrade in Phase 7 kaufbar); `UpgradeDef[]` in der Config ist deshalb bewusst leer.

Trade-off-Check (design-toolbox.md Punkt 5) für die RiskTiers von "Greed Run", geprüft mit konkreten Zahlen (auch als Kommentar in `machines.config.ts`):

| Tier | payoutRange | failureChance | EV pro Aktion | Varianz |
|---|---|---|---|---|
| safe | 3–3 | 0 % | 3,0 | 0 (deterministisch) |
| balanced | 6–10 | 15 % | 0,85 × 8 = 6,8 | mittel |
| risky | 14–22 | 35 % | 0,65 × 18 = 11,7 | hoch |

EV und Risiko (failureChance) steigen gemeinsam streng monoton — kein Tier ist bei gleichem oder geringerem Risiko strikt besser als ein anderes. Da ein Fehlschlag (`PushYourLuckEngine`) den kompletten Punktestand des laufenden Runs auf 0 zurücksetzt, ist das eigentliche Risiko nicht nur die failureChance der einzelnen Aktion, sondern der bereits ungebankte Punktestand, den man riskiert — der Sicher-vs-Riskant-Strategiewechsel entsteht damit situativ (Baukasten 1.12), ohne dass er gescriptet werden musste.

Manuell im Browser verifiziert (Playwright-Treiberskript gegen `npm run dev`, Screenshots geprüft): Planung → Queue → animierte Ausführung mit Kausalitäts-Feedback bei Erfolg und Fehlschlag → Meilenstein-Entscheidung (Banking vs. Weitermachen) → Bust-Screen mit Neustart → finaler Checkpoint (Score 108 bei deterministischem Safe-Spam) löst `completed`-Screen aus, `economyStore.markMachineCompleted('greed-run')` wird gesetzt, und nach "Sichern & beenden" steht `ticketsByMachine.greed-run: "108"` korrekt im `localStorage`-Speicherstand. `npm test` (79/79 grün), `npm run lint` und `npx tsc --noEmit` laufen sauber, `npm run build-nolog` erfolgreich.

Offene Punkte für spätere Phasen, keine Blocker für Phase 3: Zahlenbalance (Payouts/Meilenstein-Schwellen) ist Platzhalter und wird laut game-spec.md Abschnitt 6 iterativ getunt; visuelle Politur (Phase 8) fehlt komplett (nur Phaser-Primitives); Score-Attack-Modus ist aktuell nur "gleiche Config nochmal spielen", kein eigenes High-Score-Tracking.
