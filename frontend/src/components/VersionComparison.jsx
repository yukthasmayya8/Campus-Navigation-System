import { useEffect, useRef, useState } from "react";
import { compareVersions, getVersions } from "./historyApi";
import { formatValue, labelFor, messageFor } from "./historyUtils";
import "./History.css";

/*
  VersionComparison (admin)

  Props
    entityType  "location" | "route"
    entityId    number

  Assumes version numbers run 1..latest. Only the newest version is fetched
  to learn "latest", so the whole history is never loaded at once.
*/

export default function VersionComparison({ entityType, entityId }) {
  const [status, setStatus] = useState("loading"); // loading | error | ready
  const [error, setError] = useState("");
  const [latest, setLatest] = useState(0);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [result, setResult] = useState({ status: "idle", changes: [], error: "" });
  const [reloadKey, setReloadKey] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setStatus("loading");
    setResult({ status: "idle", changes: [], error: "" });

    getVersions(entityType, entityId, { limit: 1, offset: 0 })
      .then((res) => {
        if (mine !== seq.current) return;
        const newest = res.items && res.items[0] ? res.items[0].versionNumber : 0;
        setLatest(newest);
        setTo(newest);
        setFrom(Math.max(1, newest - 1));
        setStatus("ready");
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

  function runCompare() {
    if (from === to) return;
    const mine = ++seq.current;
    setResult({ status: "loading", changes: [], error: "" });
    compareVersions(entityType, entityId, from, to)
      .then((res) => {
        if (mine === seq.current)
          setResult({ status: "done", changes: res.changes || [], error: "" });
      })
      .catch((err) => {
        if (mine === seq.current)
          setResult({ status: "error", changes: [], error: messageFor(err) });
      });
  }

  if (status === "loading") {
    return (
      <section className="hv-card" aria-busy="true">
        <div className="hv-line" style={{ width: "50%", height: 20 }} />
        <div className="hv-line" style={{ width: "85%" }} />
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

  if (latest < 2) {
    return (
      <section className="hv-card">
        <p className="hv-note">There must be at least two versions to compare.</p>
      </section>
    );
  }

  const options = Array.from({ length: latest }, (_, i) => i + 1);
  const same = from === to;

  return (
    <section className="hv-card">
      <h3 className="hv-title">Compare versions</h3>

      <div className="hv-pickers">
        <label>
          From
          <select
            value={from}
            onChange={(e) => {
              setFrom(Number(e.target.value));
              setResult({ status: "idle", changes: [], error: "" });
            }}
          >
            {options.map((n) => (
              <option key={n} value={n}>
                Version {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          To
          <select
            value={to}
            onChange={(e) => {
              setTo(Number(e.target.value));
              setResult({ status: "idle", changes: [], error: "" });
            }}
          >
            {options.map((n) => (
              <option key={n} value={n}>
                Version {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {same && <p className="hv-note">Pick two different versions to compare.</p>}

      <button className="hv-btn" onClick={runCompare} disabled={same || result.status === "loading"}>
        {result.status === "loading" ? "Comparing..." : "Compare"}
      </button>

      {result.status === "error" && (
        <p className="hv-error" role="alert">
          {result.error}
        </p>
      )}

      {result.status === "done" && result.changes.length === 0 && (
        <p className="hv-note">No differences.</p>
      )}

      {result.status === "done" && result.changes.length > 0 && (
        <ul className="hv-changes">
          {result.changes.map((c) => (
            <li key={c.field}>
              <strong>{labelFor(c.field)}</strong>
              <div className="hv-diff">
                <span className="hv-old">{formatValue(c.field, c.from)}</span>
                <span aria-hidden="true">→</span>
                <span className="hv-new">{formatValue(c.field, c.to)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
