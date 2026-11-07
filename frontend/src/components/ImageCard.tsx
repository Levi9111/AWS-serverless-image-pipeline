import React, { useRef, useState } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import {
  Calendar,
  HardDrive,
  Hash,
  ExternalLink,
  ImageOff,
  Check,
  Copy,
} from 'lucide-react';
import type { ImageData } from '../types';

interface ImageCardProps {
  image: ImageData;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  if (bytes < k) return `${bytes} B`;
  const kb = bytes / k;
  if (kb < k) return `${kb.toFixed(1)} KB`;
  const mb = kb / k;
  return `${mb.toFixed(2)} MB`;
}

function formatUploadDate(dateString: string): string {
  try {
    const parsed = parseISO(dateString);
    if (isValid(parsed)) {
      return format(parsed, 'MMM d, yyyy');
    }
    const fallback = new Date(dateString);
    if (isValid(fallback)) {
      return format(fallback, 'MMM d, yyyy');
    }
    return dateString;
  } catch {
    return dateString;
  }
}

function truncateId(id: string): string {
  if (!id) return 'N/A';
  if (id.length <= 13) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export const ImageCard: React.FC<ImageCardProps> = ({ image }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [copied, setCopied] = useState(false);

  const baseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://35.87.135.224:5000').replace(
    /\/$/,
    ''
  );
  const thumbnailUrl = `${baseUrl}/thumb/${encodeURIComponent(image.thumbnail_key)}`;

  // Attach GSAP hover animations cleanly within useGSAP scope
  useGSAP(
    () => {
      const card = cardRef.current;
      if (!card) return;
      const img = card.querySelector('.card-thumbnail-img');

      const onEnter = () => {
        gsap.to(card, {
          y: -6,
          scale: 1.015,
          duration: 0.3,
          ease: 'power2.out',
          overwrite: 'auto',
        });
        if (img) {
          gsap.to(img, {
            scale: 1.07,
            duration: 0.45,
            ease: 'power2.out',
            overwrite: 'auto',
          });
        }
      };

      const onLeave = () => {
        gsap.to(card, {
          y: 0,
          scale: 1,
          duration: 0.35,
          ease: 'power2.out',
          overwrite: 'auto',
        });
        if (img) {
          gsap.to(img, {
            scale: 1,
            duration: 0.45,
            ease: 'power2.out',
            overwrite: 'auto',
          });
        }
      };

      card.addEventListener('mouseenter', onEnter);
      card.addEventListener('mouseleave', onLeave);

      return () => {
        card.removeEventListener('mouseenter', onEnter);
        card.removeEventListener('mouseleave', onLeave);
      };
    },
    { scope: cardRef }
  );

  const handleCopyId = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(image.image_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures cleanly
    }
  };

  return (
    <div
      ref={cardRef}
      data-image-id={image.image_id}
      className="image-card group relative flex flex-col rounded-2xl bg-white/80 dark:bg-slate-900/75 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 shadow-md hover:shadow-xl hover:shadow-indigo-500/10 dark:hover:shadow-indigo-500/15 hover:border-indigo-400/50 dark:hover:border-indigo-500/50 overflow-hidden transition-colors duration-300"
    >
      {/* Top gradient accent bar */}
      <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 opacity-75 group-hover:opacity-100 transition-opacity" />

      {/* Thumbnail Container */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100 dark:bg-slate-950/70">
        {!imgLoaded && !imgError && (
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-slate-200 via-slate-100 to-slate-200 dark:from-slate-800 dark:via-slate-900 dark:to-slate-800" />
        )}

        {!imgError ? (
          <img
            src={thumbnailUrl}
            alt={image.original_key}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            className={`card-thumbnail-img h-full w-full object-cover transition-opacity duration-500 ${
              imgLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full w-full text-slate-400 dark:text-slate-600 p-4 text-center">
            <ImageOff className="w-10 h-10 mb-2 stroke-[1.5]" />
            <span className="text-xs font-medium">Thumbnail unavailable</span>
            <span className="text-[11px] text-slate-400/80 dark:text-slate-600 truncate max-w-full mt-0.5">
              {image.thumbnail_key}
            </span>
          </div>
        )}

        {/* Glassmorphism Overlay Badge for Size */}
        <div className="absolute top-3 right-3 px-2.5 py-1 rounded-xl bg-slate-900/65 dark:bg-slate-950/75 backdrop-blur-md border border-white/15 text-white text-xs font-medium flex items-center gap-1.5 shadow-sm">
          <HardDrive className="w-3 h-3 text-indigo-400" />
          <span>{formatBytes(image.size_bytes)}</span>
        </div>

        {/* Hover Quick-Action Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-between p-3.5">
          <span className="text-[11px] font-mono text-slate-200 truncate max-w-[75%] bg-black/40 backdrop-blur-md px-2.5 py-1 rounded-lg border border-white/10">
            {image.thumbnail_key}
          </span>
          <a
            href={thumbnailUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open full thumbnail"
            className="p-2 rounded-xl bg-white/20 hover:bg-white/30 backdrop-blur-md text-white border border-white/20 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Card Body */}
      <div className="flex flex-col flex-1 p-5 justify-between gap-4 text-left">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3
              title={image.original_key}
              className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors"
            >
              {image.original_key}
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
            Key: <span className="font-mono">{image.thumbnail_key}</span>
          </p>
        </div>

        {/* Metadata Footer */}
        <div className="pt-3.5 border-t border-slate-200/70 dark:border-slate-800/80 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-1.5" title={`Uploaded: ${image.uploaded_at}`}>
            <Calendar className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
            <span>{formatUploadDate(image.uploaded_at)}</span>
          </div>

          <button
            type="button"
            onClick={handleCopyId}
            title={`Image ID: ${image.image_id} (Click to copy)`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/90 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-300 font-mono text-[11px] border border-slate-200/60 dark:border-slate-700/60 transition-colors cursor-pointer"
          >
            <Hash className="w-3 h-3 text-indigo-500" />
            <span>{truncateId(image.image_id)}</span>
            {copied ? (
              <Check className="w-3 h-3 text-emerald-500 ml-0.5" />
            ) : (
              <Copy className="w-2.5 h-2.5 opacity-60 ml-0.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
