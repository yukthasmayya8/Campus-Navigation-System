import { useCallback, useRef, useState } from 'react';
import { captureBestPosition, geolocationErrorMessage } from '../lib/geolocation.js';

const IDLE = { status: 'idle', fix: null, quality: null, spreadMeters: null, message: '', error: '', attempts: 0 };

/**
 * React wrapper around the shared `captureBestPosition` implementation.
 * Keeps capture state separate from form state so a failed or stale GPS attempt
 * can never be mistaken for a saved building coordinate.
 */
export function useLocationCapture(options = {}) {
  const [state, setState] = useState(IDLE);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const controllerRef = useRef(null);

  const capture = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((s) => ({ ...s, status: 'waiting', error: '', message: 'Waiting for an acceptable GPS fix…', attempts: s.attempts + 1 }));
    try {
      const result = await captureBestPosition({ ...optionsRef.current, signal: controller.signal });
      setState((s) => ({
        ...s, status: 'captured', fix: result.fix, quality: result.quality, spreadMeters: result.spreadMeters ?? null,
        message: result.warning || `GPS fix captured (±${Math.round(result.fix.accuracy)} m). Review it before saving.`,
        error: '',
      }));
      return result;
    } catch (err) {
      if (err?.code === 'cancelled') return null;
      const message = geolocationErrorMessage(err);
      setState((s) => ({ ...s, status: 'error', error: message, message: '', fix: null, quality: null, spreadMeters: null }));
      return null;
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState((s) => ({ ...s, status: s.status === 'waiting' ? 'idle' : s.status, message: s.status === 'waiting' ? '' : s.message }));
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState(IDLE);
  }, []);

  return { ...state, capture, cancel, retry: capture, reset };
}
