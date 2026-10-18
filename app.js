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

  // ---------- Spracherkennung (gemeinsame Hilfen) ----------
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  function recognitionErrorText(error) {
    switch (error) {
      case 'not-allowed':
      case 'service-not-allowed':
        return 'Mikrofonzugriff verweigert. Bitte im Browser erlauben (Seite muss über HTTPS oder localhost laufen).';
      case 'audio-capture': return 'Kein Mikrofon gefunden.';
      case 'network': return 'Netzwerkfehler bei der Spracherkennung.';
      case 'language-not-supported': return 'Diese Sprache wird von der Spracherkennung des Browsers nicht unterstützt.';
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

  let recognition = null;
  let wantListening = false;
  let pausedForSpeech = false;

  function startRecognition() {
    if (recognition) return;
    const rec = recognition = new SpeechRecognition();
    rec.lang = LANGS[source].speech;
    rec.continuous = true;
    rec.interimResults = true;

    const existing = els.sourceText.value.trim();
    const base = existing ? existing + ' ' : '';
    let finals = '';

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript.trim();
        if (!transcript) continue;
        if (result.isFinal) {
          finals += transcript + ' ';
          onFinalSegment(transcript, source);
        } else {
          interim += transcript + ' ';
        }
      }
      els.sourceText.value = (base + finals + interim).trimEnd();
      els.sourceText.scrollTop = els.sourceText.scrollHeight;
      scheduleTranslate(interim ? 250 : 0);
    };

    rec.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      setStatus(recognitionErrorText(event.error), true);
      if (['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(event.error)) {
        stopListening();
      }
    };

    // Browser beenden die Erkennung nach einer Pause von selbst – solange der Nutzer
    // zuhören möchte, wird sie neu gestartet.
    rec.onend = () => {
      if (recognition === rec) recognition = null;
      // Nicht abgeschlossene Zwischenergebnisse verwerfen, damit sie beim Neustart nicht doppelt erscheinen.
      if (finals || els.sourceText.value !== existing) {
        els.sourceText.value = (base + finals).trimEnd();
        scheduleTranslate(0);
      }
      if (wantListening && !pausedForSpeech) setTimeout(() => wantListening && !pausedForSpeech && startRecognition(), 150);
    };

    try {
      rec.start();
    } catch (err) {
      recognition = null;
      setStatus(`Spracherkennung konnte nicht starten: ${err.message}`, true);
    }
  }

  async function onFinalSegment(text, lang) {
    if (!els.autoSpeak.checked) return;
    try {
      const translated = await translator.translate(text, lang, other(lang));
      speak(translated, other(lang));
    } catch (err) {
      setStatus(`Übersetzung fehlgeschlagen: ${err.message}`, true);
    }
  }

  function startListening() {
    if (!SpeechRecognition) return;
    wantListening = true;
    els.micBtn.classList.add('listening');
    els.micBtn.setAttribute('aria-pressed', 'true');
    els.micLabel.textContent = source === 'de' ? 'Hört zu … (Stopp)' : 'Слушам … (Стоп)';
    setStatus('');
    startRecognition();
  }

  function stopListening() {
    wantListening = false;
    els.micBtn.classList.remove('listening');
    els.micBtn.setAttribute('aria-pressed', 'false');
    els.micLabel.textContent = 'Sprechen';
    if (recognition) recognition.stop();
  }

  function pauseRecognitionForSpeech() {
    pausedForSpeech = true;
    if (recognition) recognition.stop();
    if (conversation.rec) conversation.rec.abort();
  }

  function resumeRecognitionAfterSpeech() {
    pausedForSpeech = false;
    if (wantListening) startRecognition();
  }

  els.sourceText.addEventListener('input', () => scheduleTranslate(400));

  els.swapBtn.addEventListener('click', () => {
    const wasListening = wantListening;
    if (wasListening) stopListening();
    source = other(source);
    const translated = els.targetText.textContent;
    els.sourceText.value = translated;
    renderLanguages();
    persist();
    runTranslate();
    if (wasListening) setTimeout(startListening, 300);
  });

  els.clearBtn.addEventListener('click', () => {
    const wasListening = wantListening;
    if (wasListening) stopListening();
    els.sourceText.value = '';
    runTranslate();
    els.sourceText.focus();
    if (wasListening) setTimeout(startListening, 300);
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
  const conversation = { rec: null, lang: null };

  function addBubble(lang) {
    const empty = els.chat.querySelector('.chat-empty');
    if (empty) empty.remove();
    const bubble = document.createElement('div');
    bubble.className = `bubble ${lang}`;
    bubble.innerHTML = '<div class="original interim" lang="' + lang + '"></div>' +
      '<div class="translation" lang="' + other(lang) + '"></div>';
    els.chat.appendChild(bubble);
    els.chat.scrollTop = els.chat.scrollHeight;
    return bubble;
  }

  function setTalkState(activeLang) {
    els.talkBtns.forEach((btn) => {
      const isActive = btn.dataset.lang === activeLang;
      btn.classList.toggle('listening', isActive);
      btn.disabled = activeLang !== null && !isActive;
    });
  }

  function talk(lang) {
    if (conversation.rec) {
      conversation.rec.stop();
      return;
    }
    cancelSpeech();

    const rec = new SpeechRecognition();
    rec.lang = LANGS[lang].speech;
    rec.continuous = false;
    rec.interimResults = true;
    conversation.rec = rec;
    conversation.lang = lang;
    setTalkState(lang);
    setStatus('');

    const bubble = addBubble(lang);
    const originalEl = bubble.querySelector('.original');
    const translationEl = bubble.querySelector('.translation');
    let finalText = '';

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      originalEl.textContent = (finalText + ' ' + interim).trim();
      els.chat.scrollTop = els.chat.scrollHeight;
    };

    rec.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setStatus(recognitionErrorText(event.error), true);
      }
    };

    rec.onend = async () => {
      conversation.rec = null;
      setTalkState(null);
      const text = (finalText || originalEl.textContent).trim();
      if (!text) {
        bubble.remove();
        return;
      }
      originalEl.textContent = text;
      originalEl.classList.remove('interim');
      translationEl.textContent = '…';
      try {
        const translated = await translator.translate(text, lang, other(lang));
        translationEl.textContent = translated;
        const replay = document.createElement('button');
        replay.className = 'small-btn';
        replay.textContent = '🔊';
        replay.title = 'Erneut vorlesen';
        replay.addEventListener('click', () => speak(translated, other(lang)));
        bubble.appendChild(replay);
        els.chat.scrollTop = els.chat.scrollHeight;
        if (els.autoSpeak.checked) speak(translated, other(lang));
      } catch (err) {
        translationEl.textContent = '';
        setStatus(`Übersetzung fehlgeschlagen: ${err.message}`, true);
      }
    };

    try {
      rec.start();
    } catch (err) {
      conversation.rec = null;
      setTalkState(null);
      bubble.remove();
      setStatus(`Spracherkennung konnte nicht starten: ${err.message}`, true);
    }
  }

  els.talkBtns.forEach((btn) => btn.addEventListener('click', () => talk(btn.dataset.lang)));

  // ---------- Tabs & Einstellungen ----------
  els.tabs.forEach((tab) => tab.addEventListener('click', () => {
    if (wantListening) stopListening();
    if (conversation.rec) conversation.rec.abort();
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
    setStatus('Spracherkennung wird von diesem Browser nicht unterstützt (Chrome, Edge oder Safari verwenden). Texteingabe funktioniert trotzdem.', true);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline-Cache optional */ });
  }
})();
