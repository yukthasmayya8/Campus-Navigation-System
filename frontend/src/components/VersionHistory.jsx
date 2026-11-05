import { useEffect, useRef, useState } from "react";
import { getVersions } from "./historyApi";
import { formatTime, messageFor } from "./historyUtils";
import "./History.css";

/*
  VersionHistory (admin)

  Props
    entityType  "location" | "route"
    entityId    number
    canRestore  boolean                 Restore is shown only when true
    onRestore   (versionNumber) => void Member 4 supplies the action behind it
*/

const PAGE_SIZE = 10;

export default function VersionHistory({ entityType, entityId, canRestore = false, onRestore }) {
  const [status, setStatus] = useState("loading"); // loading | error | success
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const seq = useRef(0); // ignore responses that arrive after a newer request

  useEffect(() => {
    const mine = ++seq.current;
    setStatus("loading");
    setItems([]);
    setMoreError("");

    getVersions(entityType, entityId, { limit: PAGE_SIZE, offset: 0 })
      .then((res) => {
        if (mine !== seq.current) return;
        setItems(res.items || []);
        setTotal(res.total || 0);
        setStatus("success");
      })
      .catch((err) => {
        if (mine !== seq.current) return;
        setError(messageFor(err));
        setStatus("error");
      });

    return () => {
      seq.current++;
    };
  }, [entityType, entityId, reloadKey]);

  function loadMore() {
    const mine = seq.current;
    setLoadingMore(true);
    setMoreError("");
    getVersions(entityType, entityId, { limit: PAGE_SIZE, offset: items.length })
      .then((res) => {
        if (mine !== seq.current) return;
        setItems((prev) => {
          const seen = new Set(prev.map((v) => v.versionNumber));
          return [...prev, ...(res.items || []).filter((v) => !seen.has(v.versionNumber))];
        });
        setTotal(res.total || 0);
      })
      .catch((err) => {
        if (mine === seq.current) setMoreError(messageFor(err));
      })
      .finally(() => {
        if (mine === seq.current) setLoadingMore(false);
      });
  }

  if (status === "loading") {
    return (
      <section className="hv-card" aria-busy="true">
        <div className="hv-line" style={{ width: "40%", height: 20 }} />
        <div className="hv-line" style={{ width: "90%" }} />
        <div className="hv-line" style={{ width: "75%" }} />
      </section>
    );
  }

  if (status === "error") {
    return (
      <section className="hv-card">
        <p className="hv-error" role="alert">
          {error}
        </p>
        <button className="hv-btn hv-btn-quiet" onClick={() => setReloadKey((k) => k + 1)}>
          Try again
        </button>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="hv-card">
        <p className="hv-note">No versions recorded yet.</p>
      </section>
    );
  }

  return (
    <section className="hv-card">
      <h3 className="hv-title">Version history</h3>
      <ol className="hv-list">
        {items.map((v, index) => {
          const isCurrent = index === 0;
          return (
            <li key={v.versionNumber} className="hv-item">
              <div className="hv-row">
                <strong>Version {v.versionNumber}</strong>
                {isCurrent && <span className="hv-tag">Current</span>}
              </div>
              <p className="hv-meta">
                {formatTime(v.modifiedAt)} by {v.modifiedByName || "Unknown administrator"}
              </p>
              <p className="hv-desc">{v.changeDescription || "No change description."}</p>
              {canRestore && !isCurrent && (
                <button
                  className="hv-btn hv-btn-quiet"
                  onClick={() => onRestore && onRestore(v.versionNumber)}
                >
                  Restore version {v.versionNumber}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {moreError && (
        <p className="hv-error" role="alert">
          {moreError}
        </p>
      )}
      {items.length < total && (
        <button className="hv-btn" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading..." : `Load more (${total - items.length} older)`}
        </button>
      )}
    </section>
  );
}
