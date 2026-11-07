import React, { useState, useRef, useCallback } from 'react';
import {
  UploadCloud,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ImagePlus,
  X,
  Sparkles,
} from 'lucide-react';

interface ImageUploaderProps {
  onUploadSuccess: () => Promise<void> | void;
}

type UploadStage =
  | 'idle'
  | 'requesting_url'
  | 'uploading_s3'
  | 'waiting_lambda'
  | 'success'
  | 'error';

interface PresignedUrlResponse {
  upload_url?: string;
  filename?: string;
  error?: string;
}

const STAGE_PROGRESS: Record<UploadStage, number> = {
  idle: 0,
  requesting_url: 25,
  uploading_s3: 60,
  waiting_lambda: 88,
  success: 100,
  error: 0,
};

const STAGE_LABELS: Record<UploadStage, string> = {
  idle: '',
  requesting_url: 'Requesting S3 presigned URL from Flask API...',
  uploading_s3: 'Uploading raw image binary directly to Amazon S3...',
  waiting_lambda: 'Waiting 3s for AWS Lambda thumbnail & DynamoDB indexing...',
  success: 'Image processed and added to the gallery!',
  error: 'Upload failed',
};

export const ImageUploader: React.FC<ImageUploaderProps> = ({ onUploadSuccess }) => {
  const [stage, setStage] = useState<UploadStage>('idle');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isBusy =
    stage === 'requesting_url' ||
    stage === 'uploading_s3' ||
    stage === 'waiting_lambda';

  const processFile = useCallback(
    async (file: File) => {
      setErrorMessage(null);

      // 1. Validate that the file is an image
      const isImageMime = file.type.startsWith('image/');
      const isImageExt = /\.(jpe?g|png|webp|gif)$/i.test(file.name);
      if (!isImageMime && !isImageExt) {
        setStage('error');
        setSelectedFileName(file.name);
        setErrorMessage(
          `Invalid file "${file.name}". Please select a valid image file (JPEG, PNG, or WebP).`
        );
        return;
      }

      setSelectedFileName(file.name);
      const baseUrl = (
        import.meta.env.VITE_API_BASE_URL || 'http://35.87.135.224:5000'
      ).replace(/\/$/, '');

      try {
        // Step 1: Request presigned S3 upload URL from Flask backend
        setStage('requesting_url');
        const presignResponse = await fetch(`${baseUrl}/api/upload-url`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ filename: file.name }),
        });

        const presignData: PresignedUrlResponse = await presignResponse
          .json()
          .catch(() => ({}));

        if (!presignResponse.ok || !presignData.upload_url) {
          throw new Error(
            presignData.error ||
              `Failed to get presigned upload URL (HTTP ${presignResponse.status})`
          );
        }

        // Step 2: PUT raw binary directly to S3 with ONLY Content-Type: image/jpeg
        setStage('uploading_s3');
        const s3PutResponse = await fetch(presignData.upload_url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'image/jpeg',
          },
          body: file,
        });

        if (!s3PutResponse.ok) {
          throw new Error(
            `Direct S3 PUT upload failed with status ${s3PutResponse.status} (${s3PutResponse.statusText})`
          );
        }

        // Step 3: Wait 3 seconds for S3 Event -> Lambda -> Thumbnail + DynamoDB
        setStage('waiting_lambda');
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Step 4: Re-fetch /api/images in parent
        await onUploadSuccess();

        setStage('success');
        setTimeout(() => {
          setStage((current) => (current === 'success' ? 'idle' : current));
          setSelectedFileName(null);
        }, 3500);
      } catch (err: unknown) {
        setStage('error');
        const msg =
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred while uploading the image.';
        setErrorMessage(msg);
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [onUploadSuccess]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && !isBusy) {
      void processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isBusy) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (isBusy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processFile(file);
    }
  };

  const handleResetError = (e: React.MouseEvent) => {
    e.stopPropagation();
    setStage('idle');
    setErrorMessage(null);
    setSelectedFileName(null);
  };

  return (
    <div className="w-full max-w-2xl mx-auto mb-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        onChange={handleFileChange}
        disabled={isBusy}
        className="hidden"
        aria-label="Upload image file"
      />

      <div
        onClick={() => {
          if (!isBusy) fileInputRef.current?.click();
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !isBusy) {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={`group relative overflow-hidden rounded-2xl border-2 border-dashed transition-all duration-300 backdrop-blur-xl px-5 py-5 sm:px-6 sm:py-5 ${
          isBusy
            ? 'border-indigo-500/60 bg-indigo-500/5 dark:bg-indigo-950/30 cursor-wait'
            : isDragging
              ? 'border-indigo-500 bg-indigo-500/10 dark:bg-indigo-500/15 scale-[1.01] shadow-lg shadow-indigo-500/15 cursor-copy'
              : stage === 'error'
                ? 'border-red-500/50 bg-red-500/5 dark:bg-red-950/30 hover:border-red-500/70 cursor-pointer'
                : stage === 'success'
                  ? 'border-emerald-500/60 bg-emerald-500/5 dark:bg-emerald-950/30 cursor-pointer'
                  : 'border-slate-300/80 dark:border-slate-800 bg-white/75 dark:bg-slate-900/70 hover:border-indigo-500/70 dark:hover:border-indigo-500/60 hover:bg-white dark:hover:bg-slate-900/90 shadow-sm hover:shadow-md cursor-pointer'
        }`}
      >
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Left Icon + Status Copy */}
          <div className="flex items-center gap-4 text-center sm:text-left flex-col sm:flex-row">
            <div
              className={`flex items-center justify-center w-12 h-12 rounded-2xl shrink-0 transition-colors duration-300 ${
                isBusy
                  ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400'
                  : stage === 'success'
                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                    : stage === 'error'
                      ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                      : 'bg-indigo-50 dark:bg-slate-800/90 text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white'
              }`}
            >
              {isBusy ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : stage === 'success' ? (
                <CheckCircle2 className="w-6 h-6" />
              ) : stage === 'error' ? (
                <AlertCircle className="w-6 h-6" />
              ) : (
                <UploadCloud className="w-6 h-6" />
              )}
            </div>

            <div className="min-w-0">
              {isBusy ? (
                <>
                  <div className="flex items-center justify-center sm:justify-start gap-2">
                    <p className="text-sm font-semibold text-indigo-950 dark:text-indigo-200 truncate">
                      Uploading {selectedFileName}
                    </p>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/15 text-indigo-600 dark:text-indigo-300">
                      <Sparkles className="w-3 h-3" />
                      {STAGE_PROGRESS[stage]}%
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    {STAGE_LABELS[stage]}
                  </p>
                </>
              ) : stage === 'success' ? (
                <>
                  <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                    {STAGE_LABELS.success}
                  </p>
                  <p className="text-xs text-emerald-600/90 dark:text-emerald-400/80 mt-0.5">
                    {selectedFileName} was resized by Lambda and indexed in DynamoDB.
                  </p>
                </>
              ) : stage === 'error' ? (
                <>
                  <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                    Upload Failed
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 break-words">
                    {errorMessage}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    Drag &amp; drop an image here, or click to upload
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Uploads directly to S3 via Presigned URL &bull; Triggers Lambda 128&times;128 thumbnailer
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Right Action Button */}
          <div className="shrink-0">
            {stage === 'error' ? (
              <button
                type="button"
                onClick={handleResetError}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-500 text-white shadow-sm transition-all cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Try Again</span>
              </button>
            ) : (
              <span
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                  isBusy
                    ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-300'
                    : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-md shadow-indigo-500/25'
                }`}
              >
                <ImagePlus className="w-4 h-4" />
                <span>{isBusy ? 'Processing...' : 'Upload Image'}</span>
              </span>
            )}
          </div>
        </div>

        {/* Animated Progress Bar during active upload stages */}
        {(isBusy || stage === 'success') && (
          <div className="mt-4 w-full h-1.5 bg-slate-200/80 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                stage === 'success'
                  ? 'bg-emerald-500'
                  : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-400'
              }`}
              style={{ width: `${STAGE_PROGRESS[stage]}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

