# Übersetzer Deutsch ⇄ Bulgarisch (Echtzeit)

Eine Web-App, die Deutsch und Bulgarisch in Echtzeit übersetzt, getippt oder gesprochen.
Sie läuft komplett im Browser, braucht keinen eigenen Server und keinen API-Schlüssel und
lässt sich auf Handy oder PC als App installieren (PWA).

## Funktionen

- **Live-Übersetzung beim Tippen**: Die Übersetzung erscheint, während du schreibst.
- **Spracheingabe**: Mikrofon antippen und sprechen. Der Text wird live erkannt und übersetzt.
- **Sprachausgabe**: Die Übersetzung kann automatisch vorgelesen werden.
- **Gesprächsmodus**: Zwei Personen sprechen abwechselnd. Jede tippt auf ihre Sprache
  (🇩🇪 / 🇧🇬). Der Text erscheint Wort für Wort und die Übersetzung wächst live mit. Erneutes
  Antippen beendet die Aufnahme und liest die Übersetzung vor, Antippen der anderen Sprache
  wechselt direkt.
- **Sprachen tauschen** (⇄), Kopieren, Vorlesen auf Knopfdruck.
- Zwei kostenlose Übersetzungsdienste (Google, MyMemory). Fällt einer aus, wird automatisch
  der andere benutzt.
- Heller und dunkler Modus, für Handy und Desktop.

## Schnellstart: eine einzige Datei

`uebersetzer.html` enthält die ganze App in einer Datei. Herunterladen und per Doppelklick
in **Chrome** oder **Edge** öffnen, fertig. Neu erzeugen nach Änderungen:
`python3 build-single-file.py`.

## Starten (Projektordner)

Die Spracherkennung funktioniert nur über **HTTPS** oder **localhost**. Ein Doppelklick auf
`index.html` reicht daher nicht. Starte stattdessen einen kleinen lokalen Server im Projektordner:

```bash
# Python
python3 -m http.server 8000
# oder Node.js
npx serve .
```

Dann im Browser <http://localhost:8000> öffnen.

### Veröffentlichen / auf dem Handy nutzen

Da es nur statische Dateien sind, kannst du den Ordner auf jeden Static-Hoster legen,
z. B. **GitHub Pages** (Repository → Settings → Pages → Branch auswählen), Netlify oder Vercel.
Öffne die HTTPS-Adresse auf dem Handy und wähle **„Zum Startbildschirm hinzufügen“**
bzw. **„App installieren“**. Danach verhält sich die Seite wie eine normale App.

## Browser-Unterstützung

| Funktion             | Chrome / Edge | Safari (iOS/macOS) | Firefox |
|----------------------|:-------------:|:------------------:|:-------:|
| Text-Übersetzung     | ✅            | ✅                 | ✅      |
| Spracheingabe        | ✅            | ✅                 | ❌      |
| Sprachausgabe        | ✅            | ✅                 | ✅      |

- Für die **bulgarische Sprachausgabe** muss auf dem Gerät eine bulgarische Stimme vorhanden
  sein. Microsoft Edge bringt eine mit, unter Android und iOS lässt sie sich in den
  Systemeinstellungen nachladen. Fehlt sie, zeigt die App einen Hinweis an.
- Im Übersetzer-Tab pausiert das Mikrofon, während die Übersetzung vorgelesen wird, damit die
  App sich nicht selbst „zuhört“. Mit Kopfhörern klappt es am besten.

## In eine eigene App einbinden

Die Übersetzungslogik steckt in `translator.js` und hängt nicht von der Oberfläche ab:

```html
<script src="translator.js"></script>
<script>
  const translator = new Translator({ provider: 'google' }); // oder 'mymemory'

  translator.translate('Guten Morgen, wie geht es dir?', 'de', 'bg')
    .then((text) => console.log(text)); // → "Добро утро, как си?"
</script>
```

Für hybride Apps (z. B. **Capacitor**, **Cordova** oder eine Android-/iOS-**WebView**) lässt sich
der ganze Ordner unverändert als Web-Inhalt verwenden. In WebViews muss der
Mikrofonzugriff für die Spracherkennung freigegeben sein.

## Dateien

| Datei                  | Inhalt                                               |
|------------------------|------------------------------------------------------|
| `index.html`           | Oberfläche                                           |
| `style.css`            | Gestaltung (hell/dunkel, mobil)                      |
| `translator.js`        | Wiederverwendbare Übersetzungsbibliothek             |
| `app.js`               | Spracherkennung, Sprachausgabe, Live-Übersetzung, UI |
| `manifest.webmanifest`, `sw.js`, `icons/` | Installierbare App (PWA)          |

## Hinweise

- Die kostenlosen Dienste haben Nutzungsgrenzen: MyMemory erlaubt etwa 5000 Zeichen pro Tag
  und IP, der Google-Endpunkt ist inoffiziell. Für den produktiven Einsatz empfiehlt sich ein
  offizieller Dienst mit API-Schlüssel (z. B. DeepL, Google Cloud Translation). Dafür muss in
  `translator.js` nur ein weiterer Eintrag in `providers` ergänzt werden.
- Die eingegebenen Texte werden zur Übersetzung an den gewählten Dienst gesendet. Die
  Spracherkennung von Chrome läuft ebenfalls über Google-Server.
