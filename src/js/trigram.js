/**
 * trigram.js — title similarity for the Deja-vu check.
 *
 * A title is compared to other titles in the same workspace by the Jaccard similarity
 * of its character-trigram sets. Trigrams (rather than whole words) are what makes
 * "Meeting notes" and "Meeting note" score as near-duplicates while "Meeting notes"
 * and "Grocery list" score near zero: small edits move a few trigrams, different words
 * move almost all of them.
 *
 * Pure functions, no DOM, no storage: app.js owns when the check runs (title commit
 * only, never per keystroke) and ui.js owns how a hit is shown.
 */
window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  /**
   * Words that carry no identity: articles, prepositions, and the app's own default
   * titles. "Untitled note" and "New note" must never accuse each other — or anything
   * else — of being a duplicate.
   */
  var STOPWORDS = {
    a: 1, an: 1, the: 1, and: 1, or: 1, of: 1, to: 1, in: 1, on: 1, for: 1,
    with: 1, at: 1, by: 1, from: 1, my: 1, new: 1,
    untitled: 1,
  };

  /** Lowercase alphanumeric words, single-spaced. Everything else is a separator. */
  function normText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * The set of 3-character windows over the normalised text, padded with one space on
   * each side so the start and end of the title count too. Returned as an object set.
   */
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

  /**
   * |A ∩ B| / |A ∪ B| over the trigram sets. Accepts strings or precomputed sets.
   * Two empty titles score 0, not 1: nothing in common is not a resemblance.
   */
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

  /** Words that actually name the note: length 3+, not in the stoplist. */
  function significantWords(title) {
    return normText(title)
      .split(' ')
      .filter(function (word) { return word.length > 2 && !STOPWORDS[word]; });
  }

  /**
   * True when the title says too little to accuse anyone: very short, or fewer than
   * two significant words. Checked before any scan runs, so "Untitled note" and
   * single-word titles never produce a chip.
   */
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
