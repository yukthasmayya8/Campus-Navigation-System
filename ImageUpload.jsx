import { useId, useState } from "react";
import { adminApi } from "../adminApi";
import { useAdminAuth } from "../AuthContext";
import { errorMessage } from "../adminUtils";
import { Field, Status, styles } from "../ui";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Uploads one JPEG/PNG/WebP (size-limited) and reports the returned URL. The server also checks the real file content.
export default function ImageUpload({ value, onChange }) {
  const id = useId(), { onApiError } = useAdminAuth();
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState({ kind: "", text: "" });
  async function pick(e) {
    const file = e.target.files && e.target.files[0]; e.target.value = "";
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) return setMsg({ kind: "bad", text: "Choose a JPEG, PNG or WebP image." });
    if (file.size > MAX_IMAGE_BYTES) return setMsg({ kind: "bad", text: `That image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.` });
    setBusy(true); setMsg({ kind: "", text: "Uploading…" });
    try { const r = await adminApi.uploadImage(file); onChange(r.url); setMsg({ kind: "ok", text: "Image uploaded. Save the location to keep it." }); }
    catch (err) { if (!onApiError(err)) setMsg({ kind: "bad", text: errorMessage(err) }); else setMsg({ kind: "bad", text: errorMessage(err) }); }
    finally { setBusy(false); }
  }
  return (
    <Field label="Photograph (JPEG, PNG or WebP, up to 5 MB)" htmlFor={id}>
      <input id={id} type="file" accept={IMAGE_TYPES.join(",")} onChange={pick} disabled={busy} />
      {value && <><img className={styles.thumb} src={value} alt="Uploaded location" /><button type="button" onClick={() => { onChange(null); setMsg({ kind: "", text: "" }); }} style={{ marginTop: 6 }}>Remove photograph</button></>}
      <Status kind={msg.kind || undefined}>{msg.text}</Status>
    </Field>
  );
}
