/**
 * Small, dependency-free platform capability helpers (browser only).
 * They only change *messaging* and optional browser APIs - never route logic.
 */
const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent || '');

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(ua()) ||
  (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isAndroid = () => /Android/i.test(ua());

export const isSafari = () => /^((?!chrome|android|crios|fxios).)*safari/i.test(ua());

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);

export const supportsWakeLock = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;

export const supportsSpeech = () =>
  typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

export const platformLabel = () => (isIOS() ? 'iPhone/iPad' : isAndroid() ? 'Android' : 'this device');

export const backgroundHint = () =>
  isIOS()
    ? 'On iPhone/iPad, Safari can pause GPS and suspend a background tab. Keep this tab open, keep the screen on, and avoid Low Power Mode while recording.'
    : isAndroid()
      ? 'Android Chrome can throttle GPS when the screen is off or the tab is in the background. Keep this tab open and the screen on.'
      : 'Mobile browsers can pause GPS when the screen is off or the tab is in the background. Keep this tab open and the screen on.';

export const wakeLockHint = () =>
  supportsWakeLock()
    ? 'The screen is kept awake while this is active.'
    : 'This browser cannot keep the screen awake automatically. Increase your auto-lock time and keep the app open.';

export const voiceHint = () =>
  isIOS()
    ? 'On iPhone/iPad, voice search uses Safari dictation and needs HTTPS plus microphone permission. You can always type instead.'
    : isAndroid()
      ? 'On Android Chrome, voice search uses the phone microphone and needs permission. You can always type instead.'
      : 'Voice search uses your browser microphone and needs permission. You can always type instead.';
