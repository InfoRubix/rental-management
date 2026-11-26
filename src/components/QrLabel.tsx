import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function itemPublicUrl(baseUrl: string, itemId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/item/${encodeURIComponent(itemId)}`;
}

export function useQrDataUrl(text: string, size = 512): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' })
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setUrl(null));
    return () => {
      cancelled = true;
    };
  }, [text, size]);
  return url;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/** Renders a printable PNG label: item name, item code and QR code. */
export async function renderLabelPng(name: string, code: string, url: string): Promise<string> {
  const W = 600;
  const qrSize = 420;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 34px system-ui, sans-serif';
  const nameLines = wrapText(ctx, name, W - 60);
  const H = 40 + nameLines.length * 42 + 50 + qrSize + 60;
  canvas.width = W;
  canvas.height = H;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, W - 12, H - 12);
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'center';
  ctx.font = 'bold 34px system-ui, sans-serif';
  let y = 60;
  for (const l of nameLines) {
    ctx.fillText(l, W / 2, y);
    y += 42;
  }
  ctx.font = '600 30px ui-monospace, Consolas, monospace';
  ctx.fillText(code, W / 2, y + 6);
  y += 30;
  const qr = await QRCode.toDataURL(url, { width: qrSize, margin: 1, errorCorrectionLevel: 'M' });
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('QR render failed'));
    img.src = qr;
  });
  ctx.drawImage(img, (W - qrSize) / 2, y, qrSize, qrSize);
  y += qrSize + 34;
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillStyle = '#374151';
  ctx.fillText('Scan to view this item', W / 2, y);
  return canvas.toDataURL('image/png');
}

export function QrLabel({ name, code, url }: { name: string; code: string; url: string }) {
  const qr = useQrDataUrl(url);
  return (
    <figure className="qr-label">
      <figcaption>
        <span className="qr-label-name">{name}</span>
        <span className="qr-label-code">{code}</span>
      </figcaption>
      {qr ? <img src={qr} alt={`QR code linking to ${url}`} /> : <div className="qr-placeholder">Generating…</div>}
      <span className="qr-label-hint">Scan to view this item</span>
    </figure>
  );
}
