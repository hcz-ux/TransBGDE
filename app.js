(function () {
  'use strict';

  const LANGS = {
    de: { label: '🇩🇪 Deutsch', speech: 'de-DE' },
    bg: { label: '🇧🇬 Bulgarisch', speech: 'bg-BG' },
  };
  const other = (lang) => (lang === 'de' ? 'bg' : 'de');

  const $ = (sel) => document.querySelector(sel);
  const els = {
    tabs: document.querySelectorAll('.tab'),
    sourceLabel: $('#sourceLabel'),
    targetLabel: $('#targetLabel'),
    swapBtn: $('#swapBtn'),
    sourceText: $('#sourceText'),
    targetText: $('#targetText'),
    charCount: $('#charCount'),
    clearBtn: $('#clearBtn'),
    speakBtn: $('#speakBtn'),
    copyBtn: $('#copyBtn'),
    micBtn: $('#micBtn'),
    micLabel: $('#micLabel'),
    chat: $('#chat'),
    talkBtns: document.querySelectorAll('.talk-btn'),
    autoSpeak: $('#autoSpeak'),
    provider: $('#provider'),
    status: $('#status'),
  };

  // ---------- Einstellungen (lokal gespeichert, falls möglich) ----------
  const settings = {
    load() {
      try { return JSON.parse(localStorage.getItem('dbg-settings')) || {}; } catch { return {}; }
    },
    save(values) {
      try { localStorage.setItem('dbg-settings', JSON.stringify(values)); } catch { /* egal */ }
    },
  };
  const saved = settings.load();
  let source = saved.source === 'bg' ? 'bg' : 'de';
  if (typeof saved.autoSpeak === 'boolean') els.autoSpeak.checked = saved.autoSpeak;
  if (saved.provider) els.provider.value = saved.provider;

  const translator = new Translator({ provider: els.provider.value });

  function persist() {
    settings.save({ source, autoSpeak: els.autoSpeak.checked, provider: els.provider.value });
  }

  function setStatus(text, isError = false) {
    els.status.textContent = text;
    els.status.classList.toggle('error', isError);
  }

  // ---------- Sprachausgabe ----------
  const synth = window.speechSynthesis;
  let speechQueue = Promise.resolve();
  let speaking = 0;
  let speechGeneration = 0;
  const warnedVoices = new Set();

  function findVoice(lang) {
    if (!synth) return null;
    const voices = synth.getVoices();
    const prefix = lang.slice(0, 2);
    return voices.find((v) => v.lang === lang) ||
      voices.find((v) => v.lang.replace('_', '-').toLowerCase().startsWith(prefix)) || null;
  }

  function speakNow(text, lang) {
    return new Promise((resolve) => {
      if (!synth || !text) return resolve();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = LANGS[lang].speech;
      const voice = findVoice(utter.lang);
      if (voice) utter.voice = voice;
      else if (synth.getVoices().length && !warnedVoices.has(lang)) {
        warnedVoices.add(lang);
        setStatus(`Hinweis: Keine ${lang === 'bg' ? 'bulgarische' : 'deutsche'} Stimme auf diesem Gerät installiert – die Ausgabe klingt evtl. falsch.`);
      }
      utter.onend = utter.onerror = () => resolve();
      synth.speak(utter);
    });
  }

  // Sätze nacheinander vorlesen; während des Vorlesens wird das Mikrofon pausiert,
  // damit die eigene Sprachausgabe nicht wieder erkannt wird.
  function speak(text, lang) {
    speaking++;
    pauseRecognitionForSpeech();
    const generation = speechGeneration;
    speechQueue = speechQueue
      .then(() => generation === speechGeneration && speakNow(text, lang))
      .finally(() => {
        speaking--;
        if (!speaking) resumeRecognitionAfterSpeech();
      });
    return speechQueue;
  }

  function cancelSpeech() {
    speechGeneration++;
    if (synth) synth.cancel();
  }

  // iOS spielt Sprachausgabe erst ab, nachdem sie einmal direkt durch ein Tippen gestartet wurde.
  let speechUnlocked = false;
  function unlockSpeech() {
    if (speechUnlocked || !synth) return;
    speechUnlocked = true;
    const utter = new SpeechSynthesisUtterance(' ');
    utter.volume = 0;
    synth.speak(utter);
  }

  // ---------- Spracherkennung (gemeinsame Hilfen) ----------
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  // iPadOS meldet sich wie ein Mac, hat aber einen Touchscreen.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIOSNonSafari = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
  const IOS_HINT = 'Auf iPad/iPhone: Seite in Safari öffnen und unter Einstellungen → Allgemein → ' +
    'Tastatur die „Diktierfunktion“ einschalten.';

  function recognitionErrorText(error) {
    switch (error) {
      case 'not-allowed':
      case 'service-not-allowed':
        return isIOS
          ? `Spracherkennung nicht erlaubt. ${IOS_HINT}`
          : 'Mikrofonzugriff verweigert. Bitte im Browser erlauben (Seite muss über HTTPS oder localhost laufen).';
      case 'audio-capture': return 'Mikrofon nicht erreichbar – evtl. von einer anderen App belegt (Anruf, Sprachassistent, andere Browser-Tabs). Diese schließen und erneut tippen.';
      case 'network': return 'Netzwerkfehler bei der Spracherkennung.';
      case 'language-not-supported': return 'Diese Sprache wird von der Spracherkennung dieses Geräts nicht unterstützt.';
      default: return `Spracherkennung: ${error}`;
    }
  }

  // ---------- Tab 1: Übersetzer ----------
  let translateTimer = null;
  let translateController = null;

  function renderLanguages() {
    els.sourceLabel.textContent = LANGS[source].label;
    els.targetLabel.textContent = LANGS[other(source)].label;
    els.sourceText.lang = source;
    els.targetText.lang = other(source);
    els.sourceText.placeholder = source === 'de'
      ? 'Text eingeben oder Mikrofon antippen …'
      : 'Въведете текст или натиснете микрофона …';
  }

  function scheduleTranslate(delay) {
    clearTimeout(translateTimer);
    translateTimer = setTimeout(runTranslate, delay);
  }

  async function runTranslate() {
    const text = els.sourceText.value;
    els.charCount.textContent = text.length;
    if (translateController) translateController.abort();
    if (!text.trim()) {
      els.targetText.textContent = '';
      return;
    }
    const controller = translateController = new AbortController();
    try {
      const result = await translator.translate(text, source, other(source), { signal: controller.signal });
      if (controller !== translateController) return;
      els.targetText.textContent = result;
      if (els.status.classList.contains('error')) setStatus('');
    } catch (err) {
      if (err.name !== 'AbortError') setStatus(`Übersetzung fehlgeschlagen: ${err.message}`, true);
    }
  }

  // Eine Erkennungssitzung. Auf Android ohne "continuous"-Modus (dort unzuverlässig, es wird
  // stattdessen nach jedem Satz neu gestartet); auf iOS mit, weil iOS Neustarts ohne Tippen
  // oft blockiert. onDone wird genau einmal aufgerufen – auch ohne "end"-Ereignis.
  function listen(lang, { onText, onDone }) {
    const rec = new SpeechRecognition();
    rec.lang = LANGS[lang].speech;
    rec.continuous = isIOS;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let finalText = '';
    let interimText = '';
    let error = null;
    let done = false;

    const noAudioTimer = setTimeout(() => {
      if (!done) {
        setStatus(isIOS
          ? `Das Mikrofon liefert keinen Ton. ${IOS_HINT}`
          : 'Das Mikrofon liefert keinen Ton. Mikrofon in den Browser-Einstellungen erlauben und die Seite direkt in Chrome öffnen (nicht in einer anderen App).', true);
      }
    }, 4000);

    function finish(aborted = false) {
      if (done) return;
      done = true;
      clearTimeout(noAudioTimer);
      onDone({ text: (finalText + ' ' + interimText).trim(), error, aborted });
    }

    rec.onaudiostart = rec.onspeechstart = () => {
      clearTimeout(noAudioTimer);
      if (els.status.classList.contains('error')) setStatus('');
    };

    rec.onresult = (event) => {
      // Immer alle Ergebnisse neu zusammensetzen – robuster als event.resultIndex.
      finalText = '';
      interimText = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript + ' ';
        else interimText += result[0].transcript + ' ';
      }
      clearTimeout(noAudioTimer);
      onText(finalText.trim(), interimText.trim());
    };

    rec.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') error = event.error;
    };
    rec.onend = () => finish();

    try {
      rec.start();
    } catch (err) {
      error = err.message;
      finish();
    }

    // Beides beendet sofort (synchron), damit direkt danach – noch im selben Tippen –
    // eine neue Aufnahme gestartet werden kann. Nicht auf "end" warten: manche Geräte
    // schicken es spät oder nie.
    return {
      // Beenden und das bisher Gesagte (auch unsichere Wörter) behalten.
      stop() {
        finish();
        try { rec.abort(); } catch { /* bereits beendet */ }
      },
      // Beenden und das Gesagte verwerfen.
      abort() {
        finish(true);
        try { rec.abort(); } catch { /* bereits beendet */ }
      },
    };
  }

  // Hört fortlaufend zu, bis stop() aufgerufen wird: nach jedem Satz wird eine neue Sitzung
  // gestartet. Mikrofonfehler wie "audio-capture" treten oft nur kurz auf (das Mikrofon ist
  // von der vorigen Aufnahme oder der Sprachausgabe noch belegt) – dann wird es mit kurzer
  // Pause erneut versucht, statt sofort einen Fehler anzuzeigen.
  const PERMISSION_ERRORS = ['not-allowed', 'service-not-allowed', 'language-not-supported'];
  const MAX_RETRIES = 3;
  const MIC_RELEASE_DELAY = 300;

  function listenContinuously(lang, { onText, onSegment, onFatal }) {
    let active = true;
    let paused = false;
    let session = null;
    let failures = 0;
    let timer = null;

    function schedule(delay) {
      clearTimeout(timer);
      timer = setTimeout(run, delay);
    }

    function run() {
      if (!active || paused || session) return;
      let ended = false;
      const current = listen(lang, {
        onText,
        onDone({ text, error, aborted }) {
          ended = true;
          if (session === current) session = null;
          if (text && !aborted) onSegment(text);
          if (!active || aborted) return;
          if (!error) {
            failures = 0;
            schedule(MIC_RELEASE_DELAY);
            return;
          }
          failures++;
          if (PERMISSION_ERRORS.includes(error) || failures > MAX_RETRIES) {
            active = false;
            onFatal(error);
            return;
          }
          schedule(MIC_RELEASE_DELAY * 2 * failures);
        },
      });
      if (!ended) session = current;
    }

    // Erster Start sofort – iOS erlaubt das Mikrofon nur direkt beim Tippen.
    run();

    return {
      // Beenden; das zuletzt Gesagte wird noch (synchron) über onSegment geliefert.
      stop() {
        active = false;
        clearTimeout(timer);
        if (session) session.stop();
      },
      // Beenden und das gerade Gesagte verwerfen.
      abort() {
        active = false;
        clearTimeout(timer);
        if (session) session.abort();
      },
      pause() {
        paused = true;
        clearTimeout(timer);
        if (session) session.stop();
      },
      resume() {
        paused = false;
        if (active) schedule(MIC_RELEASE_DELAY);
      },
    };
  }

  let listener = null;
  let wantListening = false;

  function onFinalSegment(text, lang) {
    if (!els.autoSpeak.checked) return;
    translator.translate(text, lang, other(lang))
      .then((translated) => speak(translated, other(lang)))
      .catch((err) => setStatus(`Übersetzung fehlgeschlagen: ${err.message}`, true));
  }

  function startListening() {
    if (!SpeechRecognition) return;
    wantListening = true;
    els.micBtn.classList.add('listening');
    els.micBtn.setAttribute('aria-pressed', 'true');
    els.micLabel.textContent = source === 'de' ? 'Hört zu … (Stopp)' : 'Слушам … (Стоп)';
    setStatus('');
    cancelSpeech();
    unlockSpeech();

    const lang = source;
    const existing = els.sourceText.value.trim();
    let base = existing ? existing + ' ' : '';
    let current = null;
    current = listener = listenContinuously(lang, {
      onText(finalText, interim) {
        if (listener !== current) return;
        els.sourceText.value = (base + finalText + ' ' + interim).trim();
        els.sourceText.scrollTop = els.sourceText.scrollHeight;
        els.targetText.classList.toggle('interim', Boolean(interim));
        scheduleTranslate(interim ? 250 : 0);
      },
      onSegment(text) {
        if (listener !== current) return;
        base += text + ' ';
        els.sourceText.value = base.trim();
        els.targetText.classList.remove('interim');
        scheduleTranslate(0);
        onFinalSegment(text, lang);
      },
      onFatal(error) {
        setStatus(recognitionErrorText(error), true);
        if (wantListening && (current === null || listener === current)) stopListening();
      },
    });
  }

  // discard: gerade Gesagtes verwerfen (beim Leeren/Tauschen), sonst behalten.
  function stopListening({ discard = false } = {}) {
    wantListening = false;
    els.micBtn.classList.remove('listening');
    els.micBtn.setAttribute('aria-pressed', 'false');
    els.micLabel.textContent = 'Sprechen';
    if (!listener) return;
    if (discard) {
      listener.abort();
      listener = null;
    } else {
      listener.stop();
    }
  }

  // Während der Sprachausgabe nicht zuhören, damit die App sich nicht selbst erkennt.
  function pauseRecognitionForSpeech() {
    if (listener && wantListening) listener.pause();
  }

  function resumeRecognitionAfterSpeech() {
    if (listener && wantListening) listener.resume();
  }

  els.sourceText.addEventListener('input', () => scheduleTranslate(400));

  els.swapBtn.addEventListener('click', () => {
    const wasListening = wantListening;
    if (wasListening) stopListening({ discard: true });
    source = other(source);
    const translated = els.targetText.textContent;
    els.sourceText.value = translated;
    renderLanguages();
    persist();
    runTranslate();
    if (wasListening) startListening();
  });

  els.clearBtn.addEventListener('click', () => {
    const wasListening = wantListening;
    if (wasListening) stopListening({ discard: true });
    els.sourceText.value = '';
    runTranslate();
    els.sourceText.focus();
    if (wasListening) startListening();
  });

  els.speakBtn.addEventListener('click', () => {
    cancelSpeech();
    speak(els.targetText.textContent, other(source));
  });

  els.copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(els.targetText.textContent);
      setStatus('In die Zwischenablage kopiert.');
    } catch {
      setStatus('Kopieren nicht möglich.', true);
    }
  });

  els.micBtn.addEventListener('click', () => (wantListening ? stopListening() : startListening()));

  // ---------- Tab 2: Gespräch ----------
  // Antippen startet die Aufnahme, die bis zum erneuten Antippen weiterläuft. Jedes erkannte
  // Wort erscheint sofort, der Satz baut sich in der Blase auf und die Übersetzung wächst mit.
  // Antippen der anderen Sprache wechselt direkt.
  let talking = null; // { lang, listener, finish }

  function addBubble(lang) {
    const empty = els.chat.querySelector('.chat-empty');
    if (empty) empty.remove();
    const bubble = document.createElement('div');
    bubble.className = `bubble ${lang} live`;
    bubble.innerHTML = '<div class="original" lang="' + lang + '"></div>' +
      '<div class="translation interim" lang="' + other(lang) + '"></div>';
    bubble.querySelector('.original').innerHTML = '<span class="interim">…</span>';
    els.chat.appendChild(bubble);
    els.chat.scrollTop = els.chat.scrollHeight;
    return bubble;
  }

  function setTalkState(activeLang) {
    els.talkBtns.forEach((btn) => {
      const isActive = btn.dataset.lang === activeLang;
      btn.classList.toggle('listening', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }

  function startTalking(lang) {
    const bubble = addBubble(lang);
    const originalEl = bubble.querySelector('.original');
    const translationEl = bubble.querySelector('.translation');
    let committed = '';
    let finished = false;
    let liveTimer = null;
    let liveController = null;

    // Erkannter Text: fertige Wörter normal, noch unsichere Wörter grau.
    function show(confirmed = '', pending = '') {
      const solid = (committed + ' ' + confirmed).trim();
      originalEl.textContent = solid;
      const rest = pending.trim();
      if (rest) {
        const span = document.createElement('span');
        span.className = 'interim';
        span.textContent = (solid ? ' ' : '') + rest;
        originalEl.appendChild(span);
      }
      if (!solid && !rest) originalEl.innerHTML = '<span class="interim">…</span>';
      els.chat.scrollTop = els.chat.scrollHeight;
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => translateLive((solid + ' ' + rest).trim()), 350);
    }

    async function translateLive(text) {
      if (finished || !text) return;
      if (liveController) liveController.abort();
      const controller = liveController = new AbortController();
      try {
        const translated = await translator.translate(text, lang, other(lang), { signal: controller.signal });
        if (!finished && controller === liveController) {
          translationEl.textContent = translated;
          els.chat.scrollTop = els.chat.scrollHeight;
        }
      } catch { /* Live-Vorschau: Fehler erst beim Abschluss melden */ }
    }

    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(liveTimer);
      if (liveController) liveController.abort();
      bubble.classList.remove('live');
      finishBubble(bubble, lang, committed);
    }

    let failed = false;
    let current = null;
    current = listenContinuously(lang, {
      onText(finalText, interim) {
        if (!finished) show(finalText, interim);
      },
      onSegment(text) {
        if (finished) return;
        committed = (committed + ' ' + text).trim();
        show();
      },
      onFatal(error) {
        failed = true;
        setStatus(recognitionErrorText(error), true);
        if (talking && talking.listener === current) {
          talking = null;
          setTalkState(null);
        }
        finish();
      },
    });
    if (failed) return null;
    return { lang, listener: current, finish };
  }

  async function finishBubble(bubble, lang, text) {
    const originalEl = bubble.querySelector('.original');
    const translationEl = bubble.querySelector('.translation');
    if (!text) {
      bubble.remove();
      return;
    }
    originalEl.textContent = text;
    translationEl.classList.remove('interim');
    if (!translationEl.textContent) translationEl.textContent = '…';
    try {
      const translated = await translator.translate(text, lang, other(lang));
      translationEl.textContent = translated;
      const replay = document.createElement('button');
      replay.className = 'small-btn';
      replay.textContent = '🔊';
      replay.title = 'Erneut vorlesen';
      replay.addEventListener('click', () => { cancelSpeech(); speak(translated, other(lang)); });
      bubble.appendChild(replay);
      els.chat.scrollTop = els.chat.scrollHeight;
      if (els.autoSpeak.checked) speak(translated, other(lang));
    } catch (err) {
      translationEl.textContent = '';
      setStatus(`Übersetzung fehlgeschlagen: ${err.message}`, true);
    }
  }

  // Alles synchron im Klick-Handler: iOS startet das Mikrofon nur direkt beim Tippen.
  function talk(lang) {
    const previous = talking;
    stopTalking();
    if (previous && previous.lang === lang) return;
    cancelSpeech();
    unlockSpeech();
    setStatus('');
    talking = startTalking(lang);
    if (talking) setTalkState(lang);
  }

  function stopTalking({ discard = false } = {}) {
    if (!talking) return;
    const previous = talking;
    talking = null;
    setTalkState(null);
    if (discard) previous.listener.abort();
    else previous.listener.stop();
    previous.finish();
  }

  els.talkBtns.forEach((btn) => btn.addEventListener('click', () => talk(btn.dataset.lang)));

  // ---------- Tabs & Einstellungen ----------
  els.tabs.forEach((tab) => tab.addEventListener('click', () => {
    if (wantListening) stopListening();
    stopTalking();
    els.tabs.forEach((t) => {
      const active = t === tab;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
      document.getElementById(t.dataset.tab).hidden = !active;
    });
  }));

  els.autoSpeak.addEventListener('change', persist);
  els.provider.addEventListener('change', () => {
    translator.provider = els.provider.value;
    translator.cache.clear();
    persist();
    runTranslate();
  });

  // ---------- Start ----------
  renderLanguages();
  if (synth) synth.getVoices(); // Stimmenliste vorladen
  if (!SpeechRecognition) {
    els.micBtn.disabled = true;
    els.talkBtns.forEach((btn) => { btn.disabled = true; });
    setStatus(isIOS
      ? `Spracheingabe ist in diesem Browser nicht verfügbar. ${IOS_HINT} Texteingabe funktioniert trotzdem.`
      : 'Spracherkennung wird von diesem Browser nicht unterstützt (Chrome, Edge oder Safari verwenden). Texteingabe funktioniert trotzdem.', true);
  } else if (isIOSNonSafari) {
    setStatus(`Hinweis: Falls das Mikrofon nicht reagiert – ${IOS_HINT}`);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline-Cache optional */ });
  }
})();
