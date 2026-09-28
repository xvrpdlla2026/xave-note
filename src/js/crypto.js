/**
 * crypto.js — the vault: password-derived encryption for note bodies and stored file bytes.
 *
 * WHAT THIS PROTECTS, EXACTLY. Note bodies and attachment contents are sealed with a key
 * derived from a password the user types. Note titles, file names, folder names, dates and
 * sizes are NOT encrypted, deliberately: the tree, the sort orders and half of search are
 * built on those columns, and encrypting them would make the notebook unnavigable rather
 * than safer. The threat this answers is the data at rest — the SQLite snapshot sitting in
 * IndexedDB, and any .db file exported from Settings.
 *
 * WHY THERE IS NO "ENCRYPT" FLAG ON A ROW. Ciphertext and plaintext have to coexist for the
 * whole life of the feature. Enabling encryption is a conversion of a notebook that already
 * exists, it is interruptible by a crashed tab, and the user can turn it off again later. A
 * separate "is this encrypted" column could therefore disagree with the column beside it,
 * and the disagreement is precisely the bug that would hand a caller ciphertext as if it
 * were prose, or re-encrypt ciphertext and lose the note. So every sealed value carries its
 * own marker, in the value itself: "enc:v1:" followed by base64 of iv || ciphertext. A value
 * without the marker IS plaintext, by definition. That makes the two states impossible to
 * confuse, makes double-encryption impossible to express, and leaves legacy rows readable
 * with no migration step of their own.
 *
 * WHY THE IV IS INSIDE THE STRING RATHER THAN A COLUMN. AES-GCM requires a fresh nonce per
 * message; reusing one under the same key is the failure that breaks GCM catastrophically
 * (it leaks the authentication key). Deriving the nonce anywhere but "inside the value the
 * nonce belongs to" would put that requirement on every caller, and a caller that forgot
 * would be silently, severely wrong. Here the only way to produce an envelope is
 * seal(), which always generates one.
 *
 * WHY AES-GCM AND NOT AES-CBC + HMAC. GCM is authenticated: a wrong key, a truncated value
 * or a flipped bit all fail the tag check instead of decrypting to garbage. That property is
 * what lets unlock() treat the tag as the password verification (see below) and what lets
 * every read path distinguish "damaged" from "empty" rather than rendering a blank note.
 *
 * WHY PBKDF2 AND 600,000 ITERATIONS. The password is the only secret and it is human, so the
 * cost of guessing it has to be paid in work rather than in entropy. 600,000 iterations of
 * HMAC-SHA-256 is the current OWASP figure for PBKDF2-SHA-256. The iteration count is stored
 * WITH each vault so it can be raised later without invalidating existing notebooks: an old
 * vault is unlocked with its own recorded count, and a re-key could seal with a new one.
 *
 * WHY THE KEY IS NON-EXTRACTABLE. subtle.deriveKey() is called with extractable = false, so
 * the CryptoKey can encrypt and decrypt but cannot be exported back out through
 * crypto.subtle.exportKey. Nothing in this app could then exfiltrate the key material — not a
 * bug, not an injected script running in the page — and the key never exists as bytes in JS
 * memory where it could be logged or persisted by accident.
 *
 * The one thing the key is allowed to do is outlive a reload. adoptKey() installs a key the
 * data layer kept for this tab, and that record holds the CryptoKey OBJECT itself rather than
 * any bytes (see App.storage.saveVaultKey), so it is usable by this origin and readable by
 * nobody. Everything else about the key is unchanged: it is never exported, and it is dropped
 * by lock(), by turning encryption off, and by any tab that is not the one that unlocked.
 *
 * THE ONE THING THIS FILE DELIBERATELY DOES NOT DO: changePassword(). Re-keying a vault means
 * decrypting and re-sealing every stored payload while keeping the notebook usable if it
 * fails, which is a bigger design than "derive a new key" — half of it would be worse than
 * none of it, so it is left out rather than approximated.
 */
window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  // The envelope marker. The version number is in the marker so a future format can be
  // distinguished on sight: a value starting with "enc:v2:" would be rejected here as
  // unreadable rather than mis-parsed as a v1 string.
  var PREFIX = 'enc:v1:';

  // A 16-byte salt is the PBKDF2 recommendation: it only has to be unique per notebook,
  // since it exists to stop one derived key from being reused across two vaults, and to stop
  // a rainbow table from being precomputed against a password alone.
  var SALT_BYTES = 16;

  // 96 bits is the size GCM itself recommends for a nonce. It is short because GCM's
  // security proof is tightest there, not because it is cheap — so it is generated fresh
  // per message and never derived from anything about the message.
  var IV_BYTES = 12;

  // The GCM authentication tag. Only used to reject truncated values before WebCrypto is
  // asked to decrypt them, so the error names the real problem instead of "operation failed".
  var TAG_BYTES = 16;

  var DEFAULT_ITERATIONS = 600000;

  // The range of key derivation counts this module will honour. Below the floor the derivation
  // is cheap enough that the salt already sitting in the vault row makes guessing the password
  // worth the attacker's time; above the ceiling a single unlock would occupy the tab for
  // minutes. Both ends are orders of magnitude away from anything this app writes, so a stored
  // count outside them is evidence of damage or tampering rather than a preference to respect.
  // 600,000 sits inside the range and is what a new vault is sealed with.
  var MIN_ITERATIONS = 1000;
  var MAX_ITERATIONS = 10000000;

  /**
   * The known string sealed into the vault row.
   *
   * It is a fixed public constant, not a secret: its only job is to give unlock() something
   * to decrypt whose success proves the derived key. It is versioned alongside the marker so
   * a future format can tell an old vault's check from a new one.
   */
  var CHECK_TEXT = 'notebook-vault-check-v1';

  // ------------------------------------------------------------------ module state
  // The live key. Held as a CryptoKey object (not bytes) and dropped on lock(). A reload
  // starts with it null unless the data layer kept it for this tab (adoptKey), which is the
  // only way it ever comes back.
  var key = null;

  // True once a vault row exists. Kept here rather than read from the database on every call
  // because db.js is the only thing allowed to touch SQL, and encrypt()/decrypt() must not
  // reach back into it — that would make the crypto module depend on the layer that calls it.
  var vaultExists = false;

  // True only while enableVault() is mid-conversion: the key is usable, but no vault row has
  // been committed yet, so status() must not claim the notebook is encrypted.
  var enrolling = false;

  function subtle() {
    return window.crypto && window.crypto.subtle ? window.crypto.subtle : null;
  }

  /**
   * Whether this browser can do the whole job.
   *
   * Checked rather than assumed because the app runs from file://, where the availability of
   * crypto.subtle is a browser policy decision rather than a language guarantee. If it is
   * missing the feature must REFUSE to enable: falling back to storing plaintext while
   * claiming the notebook is encrypted would be a lie with the worst possible consequence.
   * (Verified present in the Chromium the checks run in: file:// is a secure context, so
   * subtle is exposed there.)
   */
  function isSupported() {
    return !!subtle()
      && typeof window.TextEncoder === 'function'
      && typeof window.TextDecoder === 'function'
      && !!(window.crypto && typeof window.crypto.getRandomValues === 'function');
  }

  function unsupportedMessage() {
    return 'This browser does not expose WebCrypto (crypto.subtle), so notes cannot be '
      + 'encrypted or decrypted here. Nothing has been changed.';
  }

  // --------------------------------------------------------------------- encoding
  var encoder = null;
  var decoder = null;

  function encodeUtf8(text) {
    if (!encoder) encoder = new window.TextEncoder();
    return encoder.encode(text);
  }

  function decodeUtf8(bytes) {
    if (!decoder) decoder = new window.TextDecoder();
    return decoder.decode(bytes);
  }

  /** 32 KiB per call: the argument list of Function.prototype.apply has a hard ceiling, and
   *  a whole attachment passed in one go would exceed it on anything but a tiny file. */
  var BASE64_CHUNK = 0x8000;

  function bytesToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i += BASE64_CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK));
    }
    return window.btoa(binary);
  }

  function base64ToBytes(text) {
    var binary = window.atob(text);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function randomBytes(count) {
    var bytes = new Uint8Array(count);
    window.crypto.getRandomValues(bytes);
    return bytes;
  }

  /**
   * Coerce whatever a caller has into bytes, without inventing data.
   *
   * A BLOB read back by sql.js is a Uint8Array; a caller may hand us the ArrayBuffer it came
   * off disk as, and an empty file arrives as null or a zero-length array. All three mean the
   * same thing to this module.
   */
  function toBytes(value) {
    if (!value) return new Uint8Array(0);
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value.buffer instanceof ArrayBuffer && typeof value.byteLength === 'number') {
      return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
    }
    return new Uint8Array(value);
  }

  // -------------------------------------------------------------------- envelope
  /** A stored value that carries the marker. Everything else is plaintext, by definition. */
  function isEnvelope(value) {
    return typeof value === 'string' && value.indexOf(PREFIX) === 0;
  }

  /** The complement, stated as its own function so callers read as what they mean. Note that
   *  raw bytes (a Uint8Array) are plaintext too: the vault only ever seals to a string. */
  function isPlaintext(value) {
    return !isEnvelope(value);
  }

  /**
   * Split an envelope into its nonce and its ciphertext, refusing anything that cannot be
   * one. Every failure here is a distinct, named error: a damaged record has to be reported
   * as damaged, because the alternative — returning an empty string — would look exactly
   * like a note the user never wrote.
   */
  function decodeEnvelope(value) {
    var bytes;
    try {
      bytes = base64ToBytes(value.slice(PREFIX.length));
    } catch (err) {
      throw new Error('An encrypted record could not be read: its stored form is not valid base64. It may be damaged.');
    }
    if (bytes.length < IV_BYTES + TAG_BYTES) {
      throw new Error('An encrypted record is truncated (' + bytes.length + ' bytes; at least '
        + (IV_BYTES + TAG_BYTES) + ' are needed). It may have been cut short by a failed write.');
    }
    return { iv: bytes.subarray(0, IV_BYTES), body: bytes.subarray(IV_BYTES) };
  }

  function damageError() {
    return new Error('An encrypted record could not be decrypted: its contents do not match this '
      + 'key. It may be damaged, or it may have been written with a different password.');
  }

  function lockedError() {
    return new Error('This notebook is locked. Unlock it with your password first.');
  }

  function noVaultError() {
    return new Error('A record in this notebook is encrypted, but there is no vault key to read it '
      + 'with. Nothing has been changed.');
  }

  // ------------------------------------------------------------------ primitives
  /**
   * PBKDF2-HMAC-SHA-256 -> a non-extractable AES-GCM-256 key.
   *
   * importKey with extractable = false on the *password* too: nothing needs the raw password
   * bytes again, and the less they appear as a buffer the less there is to leak.
   */
  function deriveKey(password, salt, iterations) {
    return subtle().importKey('raw', encodeUtf8(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return subtle().deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          // extractable = false: the derived key can be used but can never be exported back
          // out, so the key material does not exist as bytes anywhere in this page.
          false,
          ['encrypt', 'decrypt']);
      });
  }

  /** Seal bytes into an envelope: a fresh nonce, then iv || ciphertext, base64 encoded. */
  function seal(withKey, bytes) {
    var iv = randomBytes(IV_BYTES);
    return subtle().encrypt({ name: 'AES-GCM', iv: iv }, withKey, bytes).then(function (cipher) {
      var packed = new Uint8Array(iv.length + cipher.byteLength);
      packed.set(iv, 0);
      packed.set(new Uint8Array(cipher), iv.length);
      return PREFIX + bytesToBase64(packed);
    });
  }

  /** The raw bytes inside an envelope, with every failure named. */
  function openBytes(withKey, value) {
    var parts;
    try {
      parts = decodeEnvelope(value);
    } catch (err) {
      return Promise.reject(err);
    }
    // The two-argument form on purpose: a rejection handler that also caught a decode error
    // thrown further down the chain would relabel an encoding bug as a corruption.
    return subtle().decrypt({ name: 'AES-GCM', iv: parts.iv }, withKey, parts.body)
      .then(function (plain) { return new Uint8Array(plain); }, function () { throw damageError(); });
  }

  function openText(withKey, value) {
    return openBytes(withKey, value).then(function (bytes) { return decodeUtf8(bytes); });
  }

  /**
   * Whether encrypt() will seal rather than pass through.
   *
   * Enrolling counts: during a conversion the key exists and the values must be sealed, even
   * though the vault row has not been committed yet.
   */
  function sealing() {
    return !!key && (vaultExists || enrolling);
  }

  // ------------------------------------------------------- string entry points
  /**
   * Encrypt a string. With the vault off the text is returned UNCHANGED, which is what lets
   * every caller in db.js stay branch-free: the data layer always calls encrypt() on the way
   * in, and whether that means anything is a property of the notebook, not of the call site.
   *
   * With a vault present but locked this REJECTS rather than passing the text through. That
   * is the difference between "no encryption" and "encryption is off for a moment": passing
   * plaintext through here would write readable prose into an encrypted notebook, which is
   * the one outcome this whole module exists to prevent.
   */
  function encrypt(text) {
    var plain = text === null || text === undefined ? '' : String(text);
    if (!sealing()) {
      if (vaultExists) return Promise.reject(lockedError());
      return Promise.resolve(text);
    }
    return seal(key, encodeUtf8(plain));
  }

  /**
   * Decrypt a stored string. Plaintext passes straight through: a row written before the
   * vault existed, or after it was turned off, is already the answer.
   */
  function decrypt(value) {
    if (!isEnvelope(value)) return Promise.resolve(value);
    if (!sealing()) {
      return Promise.reject(vaultExists ? lockedError() : noVaultError());
    }
    return openText(key, value);
  }

  // -------------------------------------------------------- bytes entry points
  /**
   * Encrypt attachment bytes. Same contract as encrypt(), including the passthrough: with
   * the vault off the caller gets back the Uint8Array it handed in, so the BLOB on disk is
   * byte-for-byte what it has always been and the file round-trip does not change shape.
   *
   * The sealed form is a STRING (the envelope), which is stored in the BLOB column as text.
   * That costs base64's 33% while encrypted, and it is what buys the coexistence marker: raw
   * ciphertext in a BLOB column would be indistinguishable from a plaintext file whose bytes
   * happened to start that way. The plaintext size is kept in its own column so the UI and
   * the folder byte totals stay honest about what the file actually is.
   */
  function encryptBytes(value) {
    var bytes = toBytes(value);
    if (!sealing()) {
      if (vaultExists) return Promise.reject(lockedError());
      return Promise.resolve(value);
    }
    return seal(key, bytes);
  }

  /** Decrypt a stored attachment value. Plaintext bytes (or a legacy string) pass through. */
  function decryptBytes(value) {
    if (!isEnvelope(value)) return Promise.resolve(value);
    if (!sealing()) {
      return Promise.reject(vaultExists ? lockedError() : noVaultError());
    }
    return openBytes(key, value);
  }

  // ----------------------------------------------------------------------- vault
  /**
   * The count to seal a NEW vault with. An unusable caller value falls back to the default,
   * because nothing has been sealed with it yet and what the caller is asking for is "the
   * current cost" rather than a specific number.
   */
  function normaliseIterations(value) {
    var n = Number(value);
    return n >= MIN_ITERATIONS && n <= MAX_ITERATIONS ? Math.floor(n) : DEFAULT_ITERATIONS;
  }

  /**
   * The count read back out of a stored vault row: validated, never repaired.
   *
   * This number is NOT authenticated. It sits in the vault row in the clear, nothing about it is
   * covered by the check string or by any tag, and it is therefore the field tampering or bit
   * rot would move. Quietly substituting the default would derive a key the notebook was never
   * sealed under and then report the failure as a wrong password — a misleading error and a
   * silent downgrade of the derivation cost in the same move, when that cost is the one thing
   * standing between a stolen file and the password. So an unreadable, non-integral or
   * out-of-range count (MIN_ITERATIONS to MAX_ITERATIONS) is refused, and the refusal says the
   * metadata is damaged rather than blaming the password.
   */
  function readStoredIterations(value) {
    var n = Number(value);
    if (!isFinite(n) || Math.floor(n) !== n || n < MIN_ITERATIONS || n > MAX_ITERATIONS) {
      throw new Error('The vault metadata in this notebook is damaged: the stored key '
        + 'derivation count is missing or out of range, so the key cannot be derived.');
    }
    return n;
  }

  /**
   * Derive a brand-new vault from a password, and install the key provisionally.
   *
   * Returns the row the caller must commit, but does NOT write it: the vault row and the
   * conversion of every payload have to land in one transaction, and only the layer that
   * owns SQL can promise that. Until finishEnrollment() is called, status() still reports
   * the notebook as unencrypted — which is true, because nothing has been committed.
   *
   * The check string is sealed HERE, into its own iv/ciphertext pair, and stored as
   * ciphertext rather than as a hash of the password for a specific reason: the check then
   * proves the KEY, which is the thing the data is actually sealed with. A stored hash would
   * be a second, independent artefact that could be verified without ever deriving the key —
   * two things to keep in step, and a password-equivalent value sitting in the database beside
   * the ciphertext it is supposed to guard. Here there is one derivation, one key, and the
   * only way to "pass" the check is to reproduce the key that decrypts the data.
   */
  function beginEnrollment(password, iterations) {
    if (!isSupported()) return Promise.reject(new Error(unsupportedMessage()));
    if (vaultExists || enrolling) return Promise.reject(new Error('This notebook already has a vault.'));

    var iters = normaliseIterations(iterations);
    var salt = randomBytes(SALT_BYTES);
    return deriveKey(String(password), salt, iters).then(function (derived) {
      var iv = randomBytes(IV_BYTES);
      return subtle().encrypt({ name: 'AES-GCM', iv: iv }, derived, encodeUtf8(CHECK_TEXT))
        .then(function (cipher) {
          key = derived;
          enrolling = true;
          return {
            salt: bytesToBase64(salt),
            iterations: iters,
            check_iv: bytesToBase64(iv),
            check_ct: bytesToBase64(new Uint8Array(cipher)),
          };
        });
    });
  }

  /** The vault row was committed: the enrollment is now a fact about the notebook. */
  function finishEnrollment() {
    if (!enrolling) return;
    enrolling = false;
    vaultExists = true;
  }

  /**
   * The enrollment failed and nothing was committed. Drop the provisional key so the notebook
   * goes back to being exactly what it was — the whole point of doing the conversion inside
   * one transaction is that this path has nothing to undo.
   */
  function cancelEnrollment() {
    enrolling = false;
    key = null;
  }

  /**
   * Verify a password against an existing vault and install the derived key.
   *
   * The verification IS the decryption: the check string is opened with the derived key, and
   * AES-GCM's authentication tag makes that succeed only under the right key. Nothing here
   * compares the password, or a hash of it, to anything — a comparison could disagree with
   * the decryption (different parameters, a stale hash), and the decryption is what matters.
   */
  function unlock(row, password) {
    if (!isSupported()) return Promise.reject(new Error(unsupportedMessage()));
    if (!row) return Promise.reject(new Error('This notebook has no vault.'));

    var salt, iv, ct;
    try {
      salt = base64ToBytes(row.salt);
      iv = base64ToBytes(row.check_iv);
      ct = base64ToBytes(row.check_ct);
    } catch (err) {
      return Promise.reject(new Error('The vault record is damaged: its stored salt or check value is not readable.'));
    }
    if (salt.length !== SALT_BYTES) {
      return Promise.reject(new Error('The vault record is damaged: the stored salt is the wrong length.'));
    }
    if (iv.length !== IV_BYTES || ct.length <= TAG_BYTES) {
      return Promise.reject(new Error('The vault record is damaged: the stored check value is the wrong length.'));
    }

    // The stored count goes through the validating reader rather than being normalised: see
    // readStoredIterations() for why a default here would be a lie and a downgrade at once.
    var iterations;
    try {
      iterations = readStoredIterations(row.iterations);
    } catch (err) {
      return Promise.reject(err);
    }

    return deriveKey(String(password), salt, iterations).then(function (derived) {
      return subtle().decrypt({ name: 'AES-GCM', iv: iv }, derived, ct).then(function () {
        key = derived;
        vaultExists = true;
        enrolling = false;
        return true;
      }, function () {
        // The tag check failed, which for a well-formed vault means one thing.
        return Promise.reject(new Error('That password is not the one this notebook was encrypted with.'));
      });
    });
  }

  /** Drop the key. The notebook stays encrypted; it is simply no longer readable. */
  function lock() {
    key = null;
  }

  /**
   * Install the key this tab unlocked the notebook with, without asking for a password.
   *
   * The only caller is the data layer, and it hands over a record only after matching it to
   * THIS tab's own session id: a key left behind by a tab that is gone is dropped, not
   * adopted. Nothing is validated here — the key was proved against the vault's check string
   * when it was derived, and a key that has since stopped opening the data is reported by the
   * pass that reads it.
   */
  function adoptKey(restored) {
    if (!restored) return false;
    key = restored;
    vaultExists = true;
    enrolling = false;
    return true;
  }

  /**
   * The live key, as an object. Exposed for the one caller that has to hand it to the session
   * store; being a CryptoKey, what it gets back cannot be turned into bytes or printed.
   */
  function currentKey() {
    return key;
  }

  /** Told by the data layer whether a vault row exists — after boot, and after enable/disable. */
  function setVaultExists(exists) {
    vaultExists = !!exists;
    if (!vaultExists) {
      key = null;
      enrolling = false;
    }
  }

  function isActive() {
    return vaultExists || enrolling;
  }

  function isUnlocked() {
    return !!key;
  }

  function status() {
    if (enrolling) return 'unlocked';
    if (!vaultExists) return 'off';
    return key ? 'unlocked' : 'locked';
  }

  App.crypto = {
    // The constants are exposed for the check tools, which have to assert the on-disk format
    // (the marker, the recorded iteration count) rather than take the module's word for it.
    ENVELOPE_PREFIX: PREFIX,
    DEFAULT_ITERATIONS: DEFAULT_ITERATIONS,
    CHECK_TEXT: CHECK_TEXT,

    isSupported: isSupported,
    unsupportedMessage: unsupportedMessage,

    isEnvelope: isEnvelope,
    isPlaintext: isPlaintext,

    status: status,
    isActive: isActive,
    isUnlocked: isUnlocked,
    setVaultExists: setVaultExists,

    beginEnrollment: beginEnrollment,
    finishEnrollment: finishEnrollment,
    cancelEnrollment: cancelEnrollment,
    unlock: unlock,
    lock: lock,
    adoptKey: adoptKey,
    currentKey: currentKey,

    encrypt: encrypt,
    decrypt: decrypt,
    encryptBytes: encryptBytes,
    decryptBytes: decryptBytes,
  };
})(window.NoteApp);
