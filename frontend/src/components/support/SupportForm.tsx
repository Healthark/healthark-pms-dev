/**
 * SupportForm — the "Report an Issue" intake form.
 *
 * Fields: Name (read-only, from the signed-in user), PMS Page + Tab (both
 * type-to-search comboboxes; Tab is dynamically populated from the chosen
 * page's real sub-tabs and hidden when the page has none), Issue/Query
 * Description, Remarks, and Attach Photos.
 *
 * Photos are downscaled + base64-encoded on the client (see
 * utils/imageCompression) and sent inline — the backend has no object
 * storage. Count/size caps mirror the backend and fail fast with a friendly
 * message.
 */

import { useMemo, useRef, useState } from "react";
import { ImagePlus, Loader2, Send, X } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import { useSubmitSupportTicket } from "../../queries/support";
import { getErrorMessage } from "../../utils/errors";
import { fileToCompressedDataUri } from "../../utils/imageCompression";
import { AutoGrowTextarea } from "../common/AutoGrowTextarea";
import { FreeTextCombobox } from "../common/FreeTextCombobox";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_PHOTOS,
  MAX_REMARKS_LENGTH,
  PMS_PAGES,
  tabsForPage,
} from "../../utils/supportOptions";

interface LocalPhoto {
  id: number;
  data_uri: string;
  filename: string | null;
}

const LABEL_CLS =
  "block text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1";
const FIELD_CLS =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main placeholder:text-text-muted outline-none focus:border-brand";

const PAGE_OPTIONS = PMS_PAGES.map((p) => p.page);

export function SupportForm() {
  const { user } = useAuth();
  const toast = useToast();
  const submit = useSubmitSupportTicket();

  const [pmsPage, setPmsPage] = useState("");
  const [tab, setTab] = useState("");
  const [description, setDescription] = useState("");
  const [remarks, setRemarks] = useState("");
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photoIdRef = useRef(0);

  const tabs = useMemo(() => tabsForPage(pmsPage), [pmsPage]);

  const resetForm = () => {
    setPmsPage("");
    setTab("");
    setDescription("");
    setRemarks("");
    setPhotos([]);
    setError("");
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError("");
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setError(`You can attach up to ${MAX_PHOTOS} photos.`);
      return;
    }
    const chosen = Array.from(files).slice(0, room);
    setProcessing(true);
    try {
      const encoded: LocalPhoto[] = [];
      for (const file of chosen) {
        // Sequential — canvas work is CPU-bound; parallel gains nothing.
        const photo = await fileToCompressedDataUri(file);
        encoded.push({
          id: (photoIdRef.current += 1),
          data_uri: photo.data_uri,
          filename: photo.filename ?? null,
        });
      }
      setPhotos((prev) => [...prev, ...encoded]);
      if (files.length > room) {
        setError(`Only the first ${room} photo(s) were added (max ${MAX_PHOTOS}).`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't process that image.");
    } finally {
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removePhoto = (id: number) =>
    setPhotos((prev) => prev.filter((p) => p.id !== id));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!pmsPage) {
      setError("Please select the PMS page where the issue occurred.");
      return;
    }
    if (!description.trim()) {
      setError("Please describe the issue.");
      return;
    }

    try {
      await submit.mutateAsync({
        pms_page: pmsPage.trim(),
        tab: tab.trim() || null,
        description: description.trim(),
        remarks: remarks.trim() || null,
        photos: photos.map((p) => ({ data_uri: p.data_uri, filename: p.filename })),
      });
      toast.success("Thanks! Your issue has been submitted.");
      resetForm();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const busy = submit.isPending || processing;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Name — read-only, from the signed-in user. */}
      <div>
        <label htmlFor="support-name" className={LABEL_CLS}>
          Name
        </label>
        <input
          id="support-name"
          type="text"
          value={user?.full_name ?? ""}
          readOnly
          disabled
          className={`${FIELD_CLS} bg-surface-muted/40`}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {/* PMS page — searchable, and accepts custom text. */}
        <div>
          <label htmlFor="support-page" className={LABEL_CLS}>
            PMS Page <span className="text-red-500">*</span>
          </label>
          <FreeTextCombobox
            id="support-page"
            options={PAGE_OPTIONS}
            value={pmsPage}
            onChange={setPmsPage}
            placeholder="Select or type a page…"
          />
        </div>

        {/* Tab — always available. Suggestions follow the chosen page's real
            sub-tabs, but any text is accepted (some pages have no tabs). */}
        <div>
          <label htmlFor="support-tab" className={LABEL_CLS}>
            Tab
          </label>
          <FreeTextCombobox
            id="support-tab"
            options={[...tabs]}
            value={tab}
            onChange={setTab}
            placeholder="Select or type a tab…"
          />
        </div>
      </div>

      {/* Description */}
      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="support-description" className={LABEL_CLS}>
            Issue / Query Description <span className="text-red-500">*</span>
          </label>
          <span className="text-[11px] text-text-muted">
            {description.length}/{MAX_DESCRIPTION_LENGTH}
          </span>
        </div>
        <AutoGrowTextarea
          id="support-description"
          value={description}
          minRows={4}
          maxLength={MAX_DESCRIPTION_LENGTH}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What went wrong? Steps to reproduce, what you expected, what happened…"
          className={FIELD_CLS}
        />
      </div>

      {/* Remarks */}
      <div>
        <div className="flex items-baseline justify-between">
          <label htmlFor="support-remarks" className={LABEL_CLS}>
            Remarks
          </label>
          <span className="text-[11px] text-text-muted">
            {remarks.length}/{MAX_REMARKS_LENGTH}
          </span>
        </div>
        <AutoGrowTextarea
          id="support-remarks"
          value={remarks}
          minRows={2}
          maxLength={MAX_REMARKS_LENGTH}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Anything else that might help (browser, timing, urgency)…"
          className={FIELD_CLS}
        />
      </div>

      {/* Attach Photos */}
      <div>
        <label className={LABEL_CLS}>
          Attach Photos{" "}
          <span className="font-normal normal-case">(up to {MAX_PHOTOS})</span>
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          disabled={busy || photos.length >= MAX_PHOTOS}
          onChange={(e) => void handleFiles(e.target.files)}
          className="hidden"
        />
        <div className="flex flex-wrap items-center gap-3">
          {photos.map((p) => (
            <div
              key={p.id}
              className="group relative h-20 w-20 overflow-hidden rounded-lg border border-border bg-surface-muted"
            >
              <img
                src={p.data_uri}
                alt={p.filename ?? "attachment"}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(p.id)}
                className="absolute right-0.5 top-0.5 rounded-full bg-slate-900/70 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                aria-label={`Remove ${p.filename ?? "photo"}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {photos.length < MAX_PHOTOS && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border text-text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-60"
            >
              {processing ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <ImagePlus className="h-5 w-5" />
                  <span className="text-[10px] font-semibold">Add</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand/90 disabled:opacity-60"
        >
          {submit.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {submit.isPending ? "Submitting…" : "Submit Issue"}
        </button>
      </div>
    </form>
  );
}
