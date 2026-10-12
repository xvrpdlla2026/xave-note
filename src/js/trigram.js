window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  var STOPWORDS = {
    a: 1, an: 1, the: 1, and: 1, or: 1, of: 1, to: 1, in: 1, on: 1, for: 1,
    with: 1, at: 1, by: 1, from: 1, my: 1, new: 1,
    untitled: 1,
  };

  function normText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function trigrams(text) {
    var clean = normText(text);
    var set = {};
    if (!clean) return set;
    if (clean.length < 3) {
      set[clean] = 1;
      return set;
    }
    var padded = ' ' + clean + ' ';
    for (var i = 0; i + 3 <= padded.length; i++) {
      set[padded.slice(i, i + 3)] = 1;
    }
    return set;
  }

  function jaccard(a, b) {
    var left = typeof a === 'string' ? trigrams(a) : (a || {});
    var right = typeof b === 'string' ? trigrams(b) : (b || {});
    var inter = 0;
    var union = 0;
    Object.keys(left).forEach(function (gram) {
      if (right[gram]) inter++;
      union++;
    });
    Object.keys(right).forEach(function (gram) {
      if (!left[gram]) union++;
    });
    return union ? inter / union : 0;
  }

  function significantWords(title) {
    return normText(title)
      .split(' ')
      .filter(function (word) { return word.length > 2 && !STOPWORDS[word]; });
  }

  function isGenericTitle(title) {
    var text = String(title || '').trim();
    if (text.length < 4) return true;
    return significantWords(text).length < 2;
  }

  App.trigram = {
    trigrams: trigrams,
    jaccard: jaccard,
    isGenericTitle: isGenericTitle,
    significantWords: significantWords,
    STOPWORDS: STOPWORDS,
  };
})(window.NoteApp);
