import { useRef } from "react";
import { useDropzone } from "react-dropzone";
import { FolderOpen, ImageUp } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

const MAX_MB = 5; // docs 8.3: JPG/PNG only, max 5 MB
const MAX_BYTES = MAX_MB * 1024 * 1024;
const IMAGE_RE = /\.(jpe?g|png)$/i;

/** Keep JPG/PNG ≤ 5 MB, sorted by folder path then file name (natural order: 2.jpg before 10.jpg) */
export function pickImages(files: File[]): { images: File[]; skipped: number } {
  const path = (f: File) => (f as File & { path?: string }).path ?? f.webkitRelativePath ?? f.name;
  const images = files
    .filter((f) => IMAGE_RE.test(f.name) && f.size <= MAX_BYTES)
    .sort((a, b) => path(a).localeCompare(path(b), undefined, { numeric: true }));
  return { images, skipped: files.length - images.length };
}

export function UploadZone({ onFiles, disabled }: { onFiles: (files: File[], skipped: number) => void; disabled?: boolean }) {
  const folderInput = useRef<HTMLInputElement>(null);

  // react-dropzone also walks dropped folders, so dragging a whole folder works
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: true,
    disabled,
    noClick: false,
    onDrop: (accepted, rejected) => {
      const all = [...accepted, ...rejected.map((r) => r.file)];
      const { images, skipped } = pickImages(all);
      onFiles(images, skipped);
    },
  });

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition",
          isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/60 hover:bg-muted/60",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <input {...getInputProps()} accept="image/jpeg,image/png" />
        <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
          <ImageUp className="size-6" />
        </div>
        <div>
          <p className="font-medium text-fg">{isDragActive ? "Thả ảnh hoặc thư mục vào đây" : "Kéo thả ảnh hoặc cả thư mục, hoặc bấm để chọn ảnh"}</p>
          <p className="mt-1 text-sm text-fg-muted">JPG hoặc PNG, tối đa {MAX_MB} MB mỗi ảnh</p>
        </div>
      </div>
      <div className="flex justify-center">
        <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => folderInput.current?.click()}>
          <FolderOpen className="size-4" /> Chọn thư mục
        </Button>
        <input
          ref={folderInput}
          type="file"
          className="hidden"
          multiple
          // folder picker (Chrome, Edge, Firefox, Safari)
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => {
            const { images, skipped } = pickImages(Array.from(e.target.files ?? []));
            e.target.value = "";
            onFiles(images, skipped);
          }}
        />
      </div>
    </div>
  );
}
