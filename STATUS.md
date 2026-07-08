# STATUS.md

Wird nach jeder abgeschlossenen Phase aktualiziert. Einzige Quelle der Wahrheit für "wo stehen wir gerade" über Tool-/Session-Grenzen hinweg (Claude Code, Cowork, neue Chats).

## Aktueller Stand

**Zuletzt abgeschlossen:** Phase 2 (PatternEngine + PushYourLuckEngine)
**Läuft/als Nächstes:** Phase 3 (Automat 1 vertikaler Vollschnitt, "Greed Run")

## Verlauf

- [x] Phase 0 — Projekt-Setup — abgenommen
- [x] Phase 1 — Engine-Kern ohne UI — abgenommen (EconomyStore, SaveSystem, events.ts; 40 Vitest-Tests grün, Lint sauber, Build ok)
- [x] Phase 2 — PatternEngine + PushYourLuckEngine — abgenommen (39 neue Vitest-Tests grün, 79 Tests insgesamt, Lint + `tsc --noEmit` sauber)
- [ ] Phase 3 — Automat 1 vertikaler Vollschnitt ("Greed Run")
- [ ] Phase 4 — Reveal + Hallen-Grundgerüst
- [ ] Phase 5 — Attendant-System
- [ ] Phase 6 — Automaten 2–4
- [ ] Phase 7 — Hallen-Upgrades & Cross-Layer-Feedback
- [ ] Phase 8 — Politur / Juice
- [ ] Phase 9 — Abschluss-Erlebnis

## Offene Design-Fragen (noch nicht final entschieden)

- Welcher Automat startet Layer 0 (Vorschlag im Spec: "Greed Run", noch nicht final bestätigt)
- Exakte Zahlenbalance (Payout-Tabellen, Schwellenwerte) — wird iterativ während Implementierung/Playtesting getunt

## Notizen für den nächsten Agenten

Phase 1 war bei Übernahme dieser Session bereits im Code/Git fertig, aber STATUS.md war nicht aktualisiert worden — nachgeholt. `node_modules` im Projektordner ist Windows-spezifisch installiert (win32-Binaries); `npm install` dort nicht erneut ausführen, sonst können die nativen Bindings auf Windows kaputtgehen. `npm test`/`npm run lint`/`npx tsc --noEmit` liefen in dieser Session direkt im Projektordner (node_modules war bereits vorhanden) problemlos.

**Phase 2 (abgeschlossen):** `src/engine/PatternEngine.ts` (Markov-Übergänge über `PatternConfig`, Validierung der Übergangssummen auf 1, `getVisibility`/`getVisibleDistribution` für progressive Teilaufdeckung — aufgedeckt wird die Verteilung, nicht das exakte nächste Ereignis, `sampleNext` mit injizierbarem `rng`) und `src/engine/PushYourLuckEngine.ts` (`PushYourLuckRun`: `resolveAction` gegen `RiskTier`, Meilenstein-Auswertung über `Milestone[]`, `bank()`/`canBank()`). Design-Entscheidung, die für Phase 3 relevant ist: Ein Fehlschlag (`resolveAction` mit `success: false`) setzt den Punktestand des laufenden Runs komplett auf 0 zurück (kein Teilschutz) — Banking ist der einzige Weg, Punkte zu sichern. Ob safe/balanced/risky pro Automat einen echten EV/Varianz-Trade-off ergeben (Baukasten Checkliste Punkt 5), muss beim Befüllen von `machines.config.ts` in Phase 3 sichergestellt werden, die Engine selbst prüft das nicht.

Bei Beginn von Phase 3: siehe `implementation-plan.md` Abschnitt 4 (`MachineScene.ts` generisch, erste Konfiguration für "Greed Run" in `src/data/machines.config.ts`, Layer-0-Erlebnis ohne Hallen-UI). PatternEngine/PushYourLuckEngine sind fertig und einsatzbereit, aber noch nicht an Phaser/React angebunden.
