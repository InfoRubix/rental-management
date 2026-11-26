import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import jsQR from 'jsqr';
import { useAuth, useMe } from '../auth/AuthProvider';
import { Alert, Button, Field } from '../components/ui';
import { errorMessage } from '../lib/api';

/** Recognises this system's QR codes: item labels (/item/<id>) and admin handover codes (/handover/<code>). */
function parseScan(text: string): { kind: 'item' | 'handover'; id: string } | null {
  try {
    const u = new URL(text);
    const m = /^\/(item|handover)\/([^/]+)\/?$/.exec(u.pathname);
    return m ? { kind: m[1] as 'item' | 'handover', id: decodeURIComponent(m[2]!) } : null;
  } catch {
    return null;
  }
}

export default function ScanPage() {
  const navigate = useNavigate();
  const { call } = useAuth();
  const me = useMe();
  const isAdmin = me.role === 'admin';
  // Staff go to the borrowing page; admins go straight to the item's admin page.
  const itemPath = (itemId: string) => (isAdmin ? '/admin/items/' : '/item/') + encodeURIComponent(itemId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [scanned, setScanned] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  useEffect(() => stop, []);

  async function start() {
    setCamError(null);
    setScanned(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('Camera is not available in this browser. Use the item code search below. (Cameras need https or localhost.)');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      setScanning(true);
    } catch {
      setCamError('Could not open the camera. Allow camera access, or use the item code search below.');
    }
  }

  useEffect(() => {
    if (!scanning || !videoRef.current || !streamRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    void video.play().catch(() => undefined);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 200 || video.readyState < 2) return;
      last = t;
      const w = Math.min(video.videoWidth, 640);
      const h = Math.round((video.videoHeight / video.videoWidth) * w) || 480;
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const result = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      if (result?.data) {
        const hit = parseScan(result.data);
        stop();
        if (hit?.kind === 'handover') navigate(`/handover/${encodeURIComponent(hit.id)}`);
        else if (hit) navigate(itemPath(hit.id));
        else setScanned(result.data);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scanning, navigate]);

  async function lookup(e: FormEvent) {
    e.preventDefault();
    setLookupError(null);
    if (!code.trim()) return setLookupError('Enter an item code.');
    setBusy(true);
    try {
      const r = await call<{ type: 'item' | 'request'; id: string }>(`/lookup?code=${encodeURIComponent(code.trim())}`);
      navigate(r.type === 'item' ? itemPath(r.id) : `/admin/requests/${r.id}`);
    } catch (err) {
      setLookupError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>Scan an item</h1>
      <p className="muted">
        Scan the QR code on an item to open it, or scan the handover QR on the admin’s screen when you collect an item. Item labels
        never borrow or return anything by themselves.
      </p>

      <section className="panel">
        {scanning ? (
          <>
            <video ref={videoRef} className="scanner-video" playsInline muted aria-label="Camera preview" />
            <Button variant="secondary" block onClick={stop}>
              Stop camera
            </Button>
          </>
        ) : (
          <Button block onClick={() => void start()}>
            Start camera scanner
          </Button>
        )}
        {camError ? <Alert tone="warning">{camError}</Alert> : null}
        {scanned ? (
          <Alert tone="warning" title="Not an item QR code from this system">
            <span className="break">{scanned}</span>
          </Alert>
        ) : null}
      </section>

      <section className="panel">
        <h2>Search by code</h2>
        <form onSubmit={lookup} noValidate className="form">
          <Field label={isAdmin ? "Item code or request reference" : "Item code"} required error={lookupError ?? undefined}>
            {(p) => (
              <input
                {...p}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoCapitalize="characters"
                placeholder={isAdmin ? "PROJ-001 or RM-XXXX-XXXX" : "PROJ-001"}
              />
            )}
          </Field>
          <Button type="submit" busy={busy}>
            Find
          </Button>
        </form>
      </section>
    </div>
  );
}
