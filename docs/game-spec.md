# Spielspezifikation: Arcade-Incremental (Arbeitstitel)

Scope dieses Dokuments: **Layer 0 (Reveal) und Layer 1 (Spielhalle mit 4 Automaten)**. Layer 2 (Stadt/mehrere Hallen) ist bewusst nicht Teil dieser Spezifikation und wird erst nach Fertigstellung von Layer 1 geplant.

Dieses Dokument ist gegen `design-toolbox.md` geprüft. Bei Widersprüchen zwischen Spezifikation und Baukasten gilt: Baukasten hat Vorrang, Rücksprache mit dem Team.

---

## 1. Elevator Pitch

Der Spieler startet in einem scheinbar gewöhnlichen Arcade-Minispiel. Nach einem Fortschritts-Durchbruch offenbart sich: Er befindet sich in einer Spielhalle mit mehreren Automaten. Die Spielhalle wird zum Haupt-Layer, in dem der Spieler mit der gesammelten Automaten-Währung die Halle verbessert und weitere Automaten freischaltet – jeder mit einer eigenen, komplett anderen Mini-Spiel-Mechanik.

Kernprinzip aller Automaten: **Plan → Ausführung beobachten → Ergebnis.** Keiner der vier Automaten verlangt Echtzeit-Reflexe; alle basieren auf Vorab-Entscheidungen gegen ein teilweise bekanntes, teilweise unbekanntes Verhaltensmuster.

---

## 2. Layer 0: Der Durchbruch (Reveal)

- Spieler startet direkt im Minispiel von **Automat 1** (Vorschlag: "Greed Run", siehe 4.2 – wegen der intuitivsten Kernidee als Einstieg. Zu bestätigen.)
- Keine sichtbare Meta-UI zu Beginn (kein Hallen-HUD, kein Token-Zähler sichtbar oder nur minimal als "Punkte")
- Nach Erreichen eines Fortschritts-Schwellenwerts (konkreter Wert: TBD, Richtwert 10–20 Minuten Spielzeit) löst der Durchbruch aus: kurze Übergangs-Sequenz/Kamerafahrt, danach Wechsel in die `HallScene`
- **Wichtig laut Baukasten (1.8):** Dieser Überraschungseffekt wird nur hier verwendet. Automaten 2–4 bekommen jeweils einen eigenen kleinen Hook (siehe 4.x), keine Wiederholung des großen Reveals.

---

## 3. Layer 1: Die Spielhalle

### 3.1 Währungsfluss

```
Automat (Skill-Score) → Tickets → Credits (Hallen-Währung)
Credits → Hallen-Upgrades → verbessern Ticket-Rate & schalten neue Automaten frei
Credits → Attendant-Training pro Automat → verbessert Automatisierungs-Erfolgsquote
```

- Jeder Automat produziert **Tickets** nach eigener, in sich verständlicher Formel (kein direkter Vergleich zwischen Automaten nötig)
- Tickets werden zu **Credits** umgerechnet (Hallen-weite Einheitswährung), Umrechnungsrate ist ein Hallen-Upgrade
- Credits kaufen: Hallen-Upgrades (z. B. bessere Umrechnung), Freischaltung Automat 2/3/4, Attendant-Training pro Automat

### 3.2 Attendant-System (Automatisierung)

- Pro Automat gibt es einen eigenen **Attendant** (diegetisch: Hallenaufsicht)
- Attendant wird freischaltbar, sobald der Spieler den Automaten einmal "durchgespielt" hat (siehe 4.1, Abschluss-Kriterium)
- Attendant-Erfolgsquote basiert auf einem **"Musterkenntnis"-Wert** (0–100 %), der die tatsächliche, für diesen Automaten gelernte Wahrscheinlichkeitsverteilung repräsentiert – kein separater, unerklärter Zufallsfaktor (Baukasten 1.10 gilt auch für die Automatisierungs-Ebene)
- Musterkenntnis steigt durch: manuelles Spielen (primär) + optionales Credits-Training (sekundär, langsamer als eigenes Spielen)
- Attendant-Output ist immer spürbar geringer als optimales manuelles Spiel (Richtwert: max. ~85–90 % der Bestleistung bei voller Musterkenntnis) – aktives Spielen bleibt überlegen (Baukasten 1.3)

### 3.3 Hallen-Fortschritt

- 4 Automaten-Slots, initial nur Automat 1 sichtbar/spielbar
- Automat 2 schaltet frei nach Hallen-Upgrade-Schwelle X (basierend auf Credits aus Automat 1)
- Automat 3 und 4 analog, mit steigenden Schwellen
- Nach Freischaltung + Durchspielen aller 4 Automaten: Hallen-weiter Abschlussmoment, der den Übergang zu Layer 2 andeutet (Layer 2 selbst: **nicht Teil dieser Spezifikation**)

---

## 4. Die 4 Automaten

Alle vier teilen sich dieselben drei Kernsysteme (Details siehe `implementation-plan.md`, Abschnitt Engine):
- **PatternEngine** – probabilistische Zustandsübergänge, progressive Teilaufdeckung durch Upgrades
- **PushYourLuckEngine** – Meilenstein-Schwellen, Banking-Option, Safe/Balanced/Risky-Aktionswahl mit sichtbarer Payout-Spanne
- **AttendantEngine** – automatisierte Ausführung nach Musterkenntnis-Wert

### 4.1 Gemeinsame Rundenstruktur (gilt für alle 4 Automaten)

1. **Planungsphase:** Spieler wählt eine Sequenz von Aktionen/Tokens gegen ein teilweise sichtbares Verhaltensmuster
2. **Ausführungsphase:** Plan läuft automatisch/animiert ab (kein Reflex-Input nötig)
3. **Ergebnis + Kausalitäts-Feedback:** Punkte/Tickets, plus sichtbare Begründung bei Fehlschlag ("Block kam zu früh" statt nur "Fehlschlag")
4. **Meilenstein-Entscheidung:** An Checkpoints: Banking (Lauf sichern) oder Weitermachen (höheres Risiko für höheren Ertrag)
5. **Abschluss-Kriterium:** Erreichen des letzten Checkpoints = "durchgespielt" → schaltet Attendant für diesen Automaten frei. Danach optionaler Score-Attack-Modus für wiederholtes Spielen (Baukasten 1.6)

### 4.2 Automat 1 — "Greed Run" (Pac-Man-Twist)

- **Thema:** Kleine Figur bewegt sich auf vorab platzierten Richtungs-Tokens durch ein Raster, sammelt Punkte, muss Patrouillen-Gegnern ausweichen
- **Pattern-Basis:** Patrouillenrouten sind zu Beginn nur teilweise sichtbar (nächster Schritt), Upgrades zeigen mehr Vorschau
- **Risiko-Achse:** Wie weit ins Raster hinein plant der Spieler, bevor er umkehrt/den Lauf sichert
- **Warum Layer-0-Kandidat:** Kernidee (Risiko vs. Gier beim Sammeln) ist ohne Erklärung sofort verständlich

### 4.3 Automat 2 — "Trap Tunnels" (Dig-Dug/Q*bert-Twist)

- **Thema:** Fallen werden vorab in einem unterirdischen Raster platziert, Gegner bewegen sich deterministisch entlang ableitbarer Pfade
- **Pattern-Basis:** Am wenigsten Zufall der vier Automaten – nahezu vollständig aus dem Tunnellayout ableitbar, daher der "reinste" Skill-Test
- **Risiko-Achse:** Fallen früh/sicher platzieren vs. auf Ketten-Reaktionen mit mehreren Gegnern warten (höherer Multiplikator, höheres Fehlschlagsrisiko)

### 4.4 Automat 3 — "Beat Ledger" (DDR/Whac-a-Mole-Twist)

- **Thema:** Begrenzte Beat-Tokens werden vorab auf eine Zeitleiste/ein Notenraster gelegt, Runde läuft im Takt automatisch ab
- **Pattern-Basis:** Rhythmus/Pattern ist von Anfang an bekannt (wie Noten) – Herausforderung liegt in der Umsetzung der Planung, nicht im Erraten der Umgebung
- **Risiko-Achse:** Enge Kombo-Fenster (hoher Multiplikator, leicht zu verfehlen) vs. entspannte Abstände (sicher, geringerer Multiplikator)

### 4.5 Automat 4 — "Champion's Ledger" (Street-Fighter-Twist)

- **Thema:** Angriffs-/Block-/Konter-Tokens werden vorab gegen einen Gegner mit rotierendem Verhaltens-Zyklus geplant
- **Pattern-Basis:** Gegner rotiert durch Stances (aggressiv/defensiv/Finte) mit probabilistischen Übergängen, gelegentliche klar angekündigte Spezialmoves
- **Risiko-Achse:** Sichere Konter mit Grundschaden vs. riskante Kombo-Ketten mit hohem Schadenspotenzial bei Fehlschlagsrisiko
- **Hinweis:** Letzter Automat vor Hallen-Abschluss – bewusst als komplexester der vier positioniert (kombiniert Timing- und Vorhersage-Elemente der vorherigen drei)

---

## 5. Explizit nicht Teil dieser Spezifikation

- Layer 2 (Stadt, mehrere Hallen) – separates Dokument nach Abschluss von Layer 1
- Echtgeld-Monetarisierung jeder Art (siehe Baukasten 2: Bezahlpflicht für Macht/Tempo ist ausgeschlossen)
- Mehrspieler/PvP (siehe Baukasten 3: PvP + Chill-Solo schließt sich aus)
- Sound-/Art-Design-Details (separates Dokument)

## 6. Offene Design-Fragen

- Welcher Automat startet Layer 0 – Bestätigung von "Greed Run" oder anderer Automat?
- Exakte Zahlenbalance (Payout-Tabellen, Schwellenwerte) – wird während Implementierung/Playtesting iterativ getunt, nicht vorab fixiert
- Visueller Stil / Art Direction – nicht Teil dieser Spezifikation
