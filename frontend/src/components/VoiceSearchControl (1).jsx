import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Mic button using the Web Speech API.
 *
 * Reports state through onStateChange({ state, message }) so CampusSearch can show
 * one status line. States: idle | listening | recognised | nomatch | error |
 * denied | unsupported
 *
 * It only ever hands text to onTranscript(text). It never selects or navigates.
 */

const getCtor = () =>
  typeof window === 'undefined' ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null;

const MSG = {
  listening: 'Listening… say a building or place name.',
  nomatch: "Didn't catch that. Try again, or type the name.",
  denied:
    'Microphone access is blocked. Allow it in your browser or device settings to use voice, or type instead.',
  unsupported: "Voice search isn't supported in this browser. You can still type.",
  insecure: 'Voice search needs a secure (HTTPS) connection. You can still type.',
  micMissing: 'No microphone found. You can still type.',
  network: 'Voice search needs an internet connection. You can still type.',
};

export default function VoiceSearchControl({
  onTranscript,
  onStateChange,
  disabled = false,
  lang = 'en-IN',
  resetKey = 0,
}) {
  const Ctor = getCtor();
  const secure = typeof window === 'undefined' || window.isSecureContext !== false;
  const supported = Boolean(Ctor) && secure;

  const [state, setState] = useState(supported ? 'idle' : 'unsupported');
  const recRef = useRef(null);
  const cb = useRef({ onTranscript, onStateChange });
  cb.current = { onTranscript, onStateChange };

  const update = useCallback((next, message = '') => {
    setState(next);
    cb.current.onStateChange?.({ state: next, message });
  }, []);

  // Detach handlers first so a stopped recogniser can't report late events.
  const teardown = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    rec.onstart = rec.onresult = rec.onerror = rec.onend = rec.onnomatch = null;
    try {
      rec.abort();
    } catch {
      /* already stopped */
    }
    recRef.current = null;
  }, []);

  useEffect(() => {
    if (!supported) update('unsupported', Ctor ? MSG.insecure : MSG.unsupported);
    return teardown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Parent asked us to reset (e.g. the clear button).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (!supported) return;
    teardown();
    update('idle');
  }, [resetKey, supported, teardown, update]);

  const start = () => {
    teardown();
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    let gotResult = false;
    let failed = false;

    rec.onstart = () => update('listening', MSG.listening);

    rec.onresult = (e) => {
      const text = e.results?.[0]?.[0]?.transcript?.trim();
      if (!text) return;
      gotResult = true;
      update('recognised', `Heard “${text}”. Choose a suggestion below.`);
      cb.current.onTranscript?.(text);
    };

    rec.onnomatch = () => {
      failed = true;
      update('nomatch', MSG.nomatch);
    };

    rec.onerror = (e) => {
      failed = true;
      switch (e.error) {
        case 'not-allowed':
        case 'service-not-allowed':
          update('denied', MSG.denied);
          break;
        case 'no-speech':
          update('nomatch', MSG.nomatch);
          break;
        case 'audio-capture':
          update('error', MSG.micMissing);
          break;
        case 'network':
          update('error', MSG.network);
          break;
        case 'aborted':
          update('idle');
          break;
        default:
          update('error', `Voice search failed (${e.error || 'unknown'}). You can still type.`);
      }
    };

    rec.onend = () => {
      recRef.current = null;
      if (!gotResult && !failed) update('idle'); // stopped by the user before any speech
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      recRef.current = null;
      update('error', 'Voice search could not start. You can still type.');
    }
  };

  const toggle = () => {
    if (state === 'listening') {
      recRef.current?.stop(); // let any captured speech finish, then onend fires
    } else {
      start();
    }
  };

  const listening = state === 'listening';
  const label = !supported
    ? 'Voice search unavailable'
    : listening
      ? 'Stop voice search'
      : 'Search by voice';

  return (
    <button
      type="button"
      className={`cs-icon-btn cs-mic${listening ? ' is-listening' : ''}`}
      onClick={toggle}
      disabled={disabled || !supported}
      aria-label={label}
      aria-pressed={listening}
      title={label}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <path
          d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0M12 17v4m-3 0h6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
