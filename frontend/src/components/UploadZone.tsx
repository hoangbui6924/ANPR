import { useDropzone } from "react-dropzone";
import { ImageUp } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_MB = 5; // docs 8.3: JPG/PNG only, max 5 MB

export function UploadZone({ onFile, disabled }: { onFile: (f: File) => void; disabled?: boolean }) {
  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    accept: { "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"] },
    maxSize: MAX_MB * 1024 * 1024,
    multiple: false,
    disabled,
    onDropAccepted: ([f]) => onFile(f),
  });
  const rejection = fileRejections[0]?.errors[0];

  return (
    <div>
      <div
        {...getRootProps()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition",
          isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/60 hover:bg-muted/60",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <input {...getInputProps()} />
        <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
          <ImageUp className="size-6" />
        </div>
        <div>
          <p className="font-medium text-fg">{isDragActive ? "Thả ảnh vào đây" : "Kéo thả ảnh hoặc bấm để chọn"}</p>
          <p className="mt-1 text-sm text-fg-muted">JPG hoặc PNG, tối đa {MAX_MB} MB</p>
        </div>
      </div>
      {rejection && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {rejection.code === "file-too-large"
            ? `Ảnh lớn hơn ${MAX_MB} MB`
            : rejection.code === "file-invalid-type"
              ? "Chỉ nhận ảnh JPG hoặc PNG"
              : rejection.message}
        </p>
      )}
    </div>
  );
}
