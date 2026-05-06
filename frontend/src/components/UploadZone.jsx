import { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function UploadZone({
  accept = ".gpx",
  onUpload,
  label = "Drop GPX file here",
  sublabel = "or click to browse",
  testid = "upload-zone",
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  async function handleFiles(files) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const f of files) {
        try {
          await onUpload(f);
          toast.success(`Uploaded ${f.name}`);
        } catch (e) {
          const msg = e?.response?.data?.detail || e.message || "Upload failed";
          toast.error(`${f.name}: ${msg}`);
        }
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div
      data-testid={testid}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handleFiles(Array.from(e.dataTransfer.files));
      }}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer border border-dashed p-10 text-center transition-colors duration-150 ${
        drag
          ? "border-[#00E5FF] bg-[#00E5FF]/5"
          : "border-white/15 hover:border-[#00E5FF] hover:bg-[#00E5FF]/5"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        onChange={(e) => handleFiles(Array.from(e.target.files || []))}
        className="hidden"
        data-testid={`${testid}-input`}
      />
      <div className="flex flex-col items-center gap-3">
        {busy ? (
          <Loader2 className="w-8 h-8 text-[#00E5FF] animate-spin" />
        ) : (
          <Upload className="w-8 h-8 text-[#00E5FF]" strokeWidth={1.5} />
        )}
        <div className="font-display font-bold uppercase tracking-tight text-lg">
          {busy ? "Processing..." : label}
        </div>
        <div className="text-xs tracking-[0.2em] uppercase text-white/40">{sublabel}</div>
      </div>
    </div>
  );
}
