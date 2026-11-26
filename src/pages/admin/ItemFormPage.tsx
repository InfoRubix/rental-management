import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { StaffItem } from '../../../shared/types';
import { useAuth } from '../../auth/AuthProvider';
import { Alert, Button, Field, ItemImage, Loading } from '../../components/ui';
import { ApiError, errorMessage } from '../../lib/api';

interface Form {
  itemCode: string;
  name: string;
  category: string;
  description: string;
  conditionNotes: string;
  externalImageUrl: string;
  brand: string;
  model: string;
  serialNumber: string;
  location: string;
  purchaseDate: string;
  warrantyExpiry: string;
}

const EMPTY: Form = {
  itemCode: '',
  name: '',
  category: '',
  description: '',
  conditionNotes: '',
  externalImageUrl: '',
  brand: '',
  model: '',
  serialNumber: '',
  location: '',
  purchaseDate: '',
  warrantyExpiry: '',
};

/** Shrinks a photo in the browser so it fits comfortably in the database (max ~450 KB JPEG). */
async function resizeImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  let maxSide = 1000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.55]) {
      const url = canvas.toDataURL('image/jpeg', quality);
      if (url.length * 0.75 < 450 * 1024) return url;
    }
    maxSide = Math.round(maxSide * 0.75);
  }
  throw new Error('Could not make this photo small enough. Try a different photo.');
}

export default function ItemFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const { call } = useAuth();
  const [form, setForm] = useState<Form>(EMPTY);
  const [item, setItem] = useState<StaffItem | null>(null);
  const [loading, setLoading] = useState(editing);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [codePreview, setCodePreview] = useState<string | null>(null);

  // New items: show which code will be generated if the box is left blank (nothing is reserved yet).
  useEffect(() => {
    setCodePreview(null); // never show a preview for an older name
    if (editing || form.itemCode.trim() || !form.name.trim()) return;
    let cancelled = false;
    const t = setTimeout(() => {
      call<{ code: string }>(`/admin/next-item-code?name=${encodeURIComponent(form.name)}`)
        .then((r) => !cancelled && setCodePreview(r.code))
        .catch(() => !cancelled && setCodePreview(null));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [editing, form.name, form.itemCode, call]);

  useEffect(() => {
    if (!id) return;
    call<{ item: StaffItem }>(`/admin/items/${encodeURIComponent(id)}`)
      .then(({ item: i }) => {
        setItem(i);
        setForm({
          itemCode: i.itemCode,
          name: i.name,
          category: i.category ?? '',
          description: i.description,
          conditionNotes: i.conditionNotes,
          externalImageUrl: i.externalImageUrl ?? '',
          brand: i.brand ?? '',
          model: i.model ?? '',
          serialNumber: i.serialNumber,
          location: i.location,
          purchaseDate: i.purchaseDate,
          warrantyExpiry: i.warrantyExpiry,
        });
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [id, call]);

  const bind = (k: keyof Form) => ({
    value: form[k],
    onChange: (e: { target: { value: string } }) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      setErrors(({ [k]: _x, ...rest }) => rest);
    },
  });

  async function onPhoto(file: File | undefined) {
    setPhotoError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) return setPhotoError('Choose an image file.');
    try {
      setPhoto(await resizeImage(file));
      setRemovePhoto(false);
    } catch (e) {
      setPhotoError((e as Error).message);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const v: Record<string, string> = {};
    const code = form.itemCode.trim();
    if ((editing || code) && !/^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/.test(code))
      v.itemCode = editing
        ? 'Use 2–32 letters, numbers, "-" or "_" (example: PROJ-001).'
        : 'Use 2–32 letters, numbers, "-" or "_" (example: PROJ-001), or leave blank to generate one.';
    if (!form.name.trim()) v.name = 'Name is required.';
    if (form.externalImageUrl && !/^https:\/\//i.test(form.externalImageUrl.trim())) v.externalImageUrl = 'Must start with https://';
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setError(null);
    try {
      const saved = editing
        ? await call<{ item: StaffItem }>(`/admin/items/${id}`, { method: 'PATCH', body: form })
        : await call<{ item: StaffItem }>('/admin/items', { body: form });
      const itemId = saved.item.id;
      if (photo) await call(`/admin/items/${itemId}/image`, { method: 'PUT', body: { dataUrl: photo } });
      else if (removePhoto) await call(`/admin/items/${itemId}/image`, { method: 'DELETE' });
      navigate(`/admin/items/${itemId}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      if (err instanceof ApiError && err.code === 'DUPLICATE_ITEM_CODE') setErrors({ itemCode: err.message });
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (editing && !item) return <Alert tone="error">{error ?? 'Item not found.'}</Alert>;

  const currentImage = photo ?? (removePhoto ? null : (item?.imageUrl ?? null));

  return (
    <>
      <p className="breadcrumb">
        <Link to={editing ? `/admin/items/${id}` : '/admin/items'}>← Back</Link>
      </p>
      <h1>{editing ? `Edit ${item?.itemCode}` : 'Register an item'}</h1>
      <p className="muted">Register each physical unit separately (for example PROJ-001 and PROJ-002), so each has its own QR code.</p>
      <form className="form" onSubmit={submit} noValidate>
        <Field label="Name" required error={errors.name} hint={editing ? undefined : 'e.g. Projector, Folding chair, Bluetooth speaker.'}>
          {(p) => <input {...p} {...bind('name')} maxLength={120} />}
        </Field>
        {editing ? (
          <Field label="Item code" required error={errors.itemCode} hint="Unique code on the label. If you change it, the QR code keeps working, but reprint the label so the printed code matches.">
            {(p) => <input {...p} {...bind('itemCode')} autoCapitalize="characters" maxLength={32} />}
          </Field>
        ) : (
          <Field
            label="Item code"
            error={errors.itemCode}
            hint={
              form.itemCode.trim() ? (
                'Using your own code. Clear the box to generate one automatically.'
              ) : codePreview ? (
                <>
                  Leave blank and it will be <strong>{codePreview}</strong> (generated automatically). Or type your own, e.g. an
                  existing label number.
                </>
              ) : (
                'Leave blank to generate one automatically from the name (e.g. PROJ-001), or type your own.'
              )
            }
          >
            {(p) => (
              <input
                {...p}
                {...bind('itemCode')}
                autoCapitalize="characters"
                maxLength={32}
                placeholder={codePreview ?? 'Automatic'}
              />
            )}
          </Field>
        )}
        <Field label="Category" error={errors.category}>
          {(p) => <input {...p} {...bind('category')} maxLength={60} />}
        </Field>
        <Field label="Description (public)" error={errors.description} hint="Shown to customers on the item page.">
          {(p) => <textarea {...p} {...bind('description')} rows={4} maxLength={4000} />}
        </Field>
        <Field label="Condition notes (staff only)" error={errors.conditionNotes} hint="Never shown to customers.">
          {(p) => <textarea {...p} {...bind('conditionNotes')} rows={3} maxLength={4000} />}
        </Field>

        <div className="field-row">
          <Field label="Brand (public)" error={errors.brand}>
            {(p) => <input {...p} {...bind('brand')} maxLength={80} />}
          </Field>
          <Field label="Model (public)" error={errors.model}>
            {(p) => <input {...p} {...bind('model')} maxLength={80} />}
          </Field>
        </div>

        <fieldset className="field form-group">
          <legend>Staff-only details</legend>
          <p className="hint">Never shown to customers.</p>
          <div className="field-row">
            <Field label="Serial number" error={errors.serialNumber}>
              {(p) => <input {...p} {...bind('serialNumber')} maxLength={80} autoCapitalize="characters" />}
            </Field>
            <Field label="Storage location" error={errors.location} hint="Where it is kept, e.g. Store room B, shelf 2.">
              {(p) => <input {...p} {...bind('location')} maxLength={120} />}
            </Field>
          </div>
          <div className="field-row">
            <Field label="Purchase date" error={errors.purchaseDate}>
              {(p) => <input {...p} {...bind('purchaseDate')} type="date" />}
            </Field>
            <Field label="Warranty expiry" error={errors.warrantyExpiry}>
              {(p) => <input {...p} {...bind('warrantyExpiry')} type="date" />}
            </Field>
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>Photo (optional)</legend>
          {currentImage ? <ItemImage src={currentImage} alt="Item photo preview" size="md" /> : null}
          <label htmlFor="photo" className="btn btn-secondary file-btn">
            {currentImage ? 'Replace photo' : 'Upload photo'}
          </label>
          <input id="photo" type="file" accept="image/*" className="sr-only" onChange={(e) => void onPhoto(e.target.files?.[0])} />
          {currentImage && (photo || item?.hasUploadedImage) ? (
            <Button
              variant="ghost"
              onClick={() => {
                setPhoto(null);
                setRemovePhoto(true);
              }}
            >
              Remove uploaded photo
            </Button>
          ) : null}
          {photoError ? <p className="error-text" role="alert">{photoError}</p> : null}
          <p className="hint">Photos are resized automatically. An uploaded photo replaces the image link below.</p>
        </fieldset>
        <Field label="…or image link (https)" error={errors.externalImageUrl}>
          {(p) => <input {...p} {...bind('externalImageUrl')} type="url" inputMode="url" placeholder="https://" />}
        </Field>

        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" busy={busy} block>
          {editing ? 'Save changes' : 'Register item'}
        </Button>
      </form>
    </>
  );
}
