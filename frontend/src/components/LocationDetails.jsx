import { useEffect, useState } from 'react';
import { getLocation } from '../api.js';

/**
 * Public location details (no login required).
 * Props: locationId, onNavigate(id), onClose()
 */
export default function LocationDetails({ locationId, onNavigate, onClose }) {
  const [state, setState] = useState({ status: 'idle', location: null, error: '' });
  const [imageFailed, setImageFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (locationId == null) {
      setState({ status: 'idle', location: null, error: '' });
      return undefined;
    }
    let ignore = false;
    setState({ status: 'loading', location: null, error: '' });
    setImageFailed(false);
    getLocation(locationId)
      .then((location) => { if (!ignore) setState({ status: 'success', location, error: '' }); })
      .catch((err) => {
        if (ignore) return;
        const message = err?.status === 404 ? 'This location is not available.'
          : err?.code === 'NETWORK' ? 'Cannot reach the server. Check your connection.'
            : err?.message || 'Something went wrong. Try again.';
        setState({ status: 'error', location: null, error: message });
      });
    return () => { ignore = true; };
  }, [locationId, reloadKey]);

  const { status, location, error } = state;

  return (
    <section aria-live="polite">
      <div className="sheet-head">
        <div>
          <div className="sheet-title">{status === 'success' ? location.name : 'Location details'}</div>
          <div className="sheet-sub">Building information and directions</div>
        </div>
        {onClose && <button type="button" className="icon ghost" onClick={onClose} aria-label="Close details">✕</button>}
      </div>

      {status === 'idle' && <p className="muted">Select a building on the map or in the list.</p>}

      {status === 'loading' && (
        <div aria-busy="true" className="stack sm">
          <div className="skeleton" style={{ height: 150, borderRadius: 16 }} />
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-text" />
          <div className="skeleton skeleton-text" style={{ width: '75%' }} />
        </div>
      )}

      {status === 'error' && (
        <div className="stack sm">
          <div className="alert error" role="alert">{error}</div>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)}>Try again</button>
        </div>
      )}

      {status === 'success' && location && (
        <div className="stack sm">
          <div className="loc-card">
            {location.imageUrl && !imageFailed ? (
              <img className="loc-card-img" src={location.imageUrl} alt={`Photo of ${location.name}`} onError={() => setImageFailed(true)} />
            ) : (
              <div className="loc-card-img-placeholder" role="img" aria-label={location.imageUrl ? 'Photo unavailable' : 'No photo available'}>🏢</div>
            )}
            <div className="loc-card-body">
              <div className="loc-card-name">{location.name}</div>
              <div className="loc-card-desc">{location.description || 'No description added yet.'}</div>
              <div className="loc-meta">
                <span className="chip blue">📍 {Number(location.latitude).toFixed(5)}, {Number(location.longitude).toFixed(5)}</span>
                {location.versionNumber != null && <span className="chip">v{location.versionNumber}</span>}
              </div>
            </div>
          </div>
          {onNavigate && (
            <button type="button" className="primary" onClick={() => onNavigate(location.locationId)}>
              Navigate to {location.name}
            </button>
          )}
          <p className="muted">Outdoor building-to-building directions only. Indoor navigation is not available.</p>
        </div>
      )}
    </section>
  );
}
