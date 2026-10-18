/*
 * Translator – kleine, eigenständige Übersetzungsbibliothek (Deutsch ⇄ Bulgarisch).
 *
 * Kann unabhängig von der Oberfläche in jede Web-App eingebunden werden:
 *
 *   <script src="translator.js"></script>
 *   const t = new Translator({ provider: 'google' });
 *   const bg = await t.translate('Guten Morgen', 'de', 'bg');
 *
 * Unterstützte Dienste (beide ohne API-Schlüssel nutzbar):
 *   - 'google'   : inoffizieller Google-Translate-Endpunkt (schnell, gute Qualität)
 *   - 'mymemory' : MyMemory API (Tageslimit ~5000 Zeichen pro IP)
 * Fällt der gewählte Dienst aus, wird automatisch der andere versucht.
 */
(function (global) {
  'use strict';

  const MYMEMORY_MAX_BYTES = 450; // API-Limit liegt bei 500 Bytes pro Anfrage

  const providers = {
    async google(text, from, to, signal) {
      const url = 'https://translate.googleapis.com/translate_a/single' +
        `?client=gtx&dt=t&sl=${from}&tl=${to}&q=${encodeURIComponent(text)}`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Google: HTTP ${res.status}`);
      const data = await res.json();
      return data[0].map((part) => part[0]).join('');
    },

    async mymemory(text, from, to, signal) {
      const chunks = splitIntoChunks(text, MYMEMORY_MAX_BYTES);
      const results = [];
      for (const chunk of chunks) {
        const url = 'https://api.mymemory.translated.net/get' +
          `?langpair=${from}|${to}&q=${encodeURIComponent(chunk)}`;
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error(`MyMemory: HTTP ${res.status}`);
        const data = await res.json();
        if (Number(data.responseStatus) !== 200) {
          throw new Error(`MyMemory: ${data.responseDetails || data.responseStatus}`);
        }
        results.push(decodeEntities(data.responseData.translatedText));
      }
      return results.join(' ');
    },
  };

  // Teilt Text an Satzgrenzen (notfalls an Wortgrenzen) in Stücke unter maxBytes.
  function splitIntoChunks(text, maxBytes) {
    const byteLength = (s) => new TextEncoder().encode(s).length;
    if (byteLength(text) <= maxBytes) return [text];

    const pieces = text.match(/[^.!?…\n]+[.!?…\n]*\s*/g) || [text];
    const chunks = [];
    let current = '';
    const push = (piece) => {
      if (byteLength(current + piece) <= maxBytes) {
        current += piece;
        return;
      }
      if (current) chunks.push(current.trim());
      current = '';
      if (byteLength(piece) <= maxBytes) {
        current = piece;
        return;
      }
      const words = piece.split(/(\s+)/).filter(Boolean);
      if (words.length > 1) {
        words.forEach(push);
        return;
      }
      // Einzelnes überlanges Wort: hart nach Zeichen teilen.
      let part = '';
      for (const ch of piece) {
        if (byteLength(part + ch) > maxBytes) {
          chunks.push(part);
          part = '';
        }
        part += ch;
      }
      current = part;
    };
    pieces.forEach(push);
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  function decodeEntities(s) {
    return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
      .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  class Translator {
    constructor({ provider = 'google', cacheSize = 500 } = {}) {
      this.provider = provider;
      this.cacheSize = cacheSize;
      this.cache = new Map();
    }

    async translate(text, from, to, { signal } = {}) {
      const input = text.trim();
      if (!input || from === to) return input;

      const key = `${from}|${to}|${input}`;
      if (this.cache.has(key)) return this.cache.get(key);

      const order = [this.provider, ...Object.keys(providers).filter((p) => p !== this.provider)];
      let lastError;
      for (const name of order) {
        try {
          const result = await providers[name](input, from, to, signal);
          this.remember(key, result);
          return result;
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          lastError = err;
        }
      }
      throw lastError;
    }

    remember(key, value) {
      if (this.cache.size >= this.cacheSize) {
        this.cache.delete(this.cache.keys().next().value);
      }
      this.cache.set(key, value);
    }
  }

  Translator.providers = providers;
  Translator.splitIntoChunks = splitIntoChunks;

  if (typeof module !== 'undefined' && module.exports) module.exports = Translator;
  else global.Translator = Translator;
})(typeof window !== 'undefined' ? window : globalThis);
