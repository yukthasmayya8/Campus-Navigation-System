import { useEffect, useState } from "react";
import { getLocation } from "./locationDetailsApi";
import "./LocationDetails.css";

/*
  LocationDetails (public, no login needed)

  Props
    locationId  number              id of the selected location
    onNavigate  (locationId) => void  called when Navigate is pressed
*/

function messageFor(err) {
  if (err && err.status === 404) return "This location is not available.";
  if (err && err.code === "NETWORK")
    return "Cannot reach the server. Check your connection and try again.";
  return (err && err.message) || "Something went wrong. Try again.";
}

export default function LocationDetails({ locationId, onNavigate }) {
  const [state, setState] = useState({ status: "idle", location: null, error: "" });
  const [imageFailed, setImageFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (locationId == null) {
      setState({ status: "idle", location: null, error: "" });
      return undefined;
    }

    let ignore = false; // an older response must never overwrite a newer one
    setState({ status: "loading", location: null, error: "" });
    setImageFailed(false);

    getLocation(locationId)
      .then((location) => {
        if (!ignore) setState({ status: "success", location, error: "" });
      })
      .catch((err) => {
        if (!ignore) setState({ status: "error", location: null, error: messageFor(err) });
      });

    return () => {
      ignore = true;
    };
  }, [locationId, reloadKey]);

  const { status, location, error } = state;

  return (
    <section className="ld-card" aria-live="polite">
      {status === "idle" && (
        <p className="ld-note">Select a building to see its details.</p>
      )}

      {status === "loading" && (
        <div aria-busy="true">
          <div className="ld-photo ld-skeleton" />
          <div className="ld-body">
            <div className="ld-line" style={{ width: "55%", height: 26 }} />
            <div className="ld-line" style={{ width: "100%" }} />
            <div className="ld-line" style={{ width: "80%" }} />
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="ld-body">
          <p className="ld-error" role="alert">
            {error}
          </p>
          <button className="ld-btn ld-btn-quiet" onClick={() => setReloadKey((k) => k + 1)}>
            Try again
          </button>
        </div>
      )}

      {status === "success" && location && (
        <>
          <div className="ld-photo">
            {location.imageUrl && !imageFailed ? (
              <img
                src={location.imageUrl}
                alt={`Photo of ${location.name}`}
                onError={() => setImageFailed(true)}
              />
            ) : (
              <div className="ld-nophoto">
                {location.imageUrl ? "Photo could not load" : "No photo available"}
              </div>
            )}
          </div>

          <div className="ld-body">
            <h2>{location.name}</h2>
            <p className="ld-desc">{location.description || "No description added yet."}</p>
            <button className="ld-btn" onClick={() => onNavigate && onNavigate(locationId)}>
              Navigate to {location.name}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
