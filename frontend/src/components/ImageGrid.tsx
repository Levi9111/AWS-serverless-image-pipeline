import React, { useRef, useState } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { ImageOff, SearchX, Sparkles } from 'lucide-react';
import type { ImageData } from '../types';
import { ImageCard } from './ImageCard';

gsap.registerPlugin(useGSAP);

interface ImageGridProps {
  images: ImageData[];
  searchQuery: string;
  onClearSearch?: () => void;
}

export const ImageGrid: React.FC<ImageGridProps> = ({
  images,
  searchQuery,
  onClearSearch,
}) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const hasAnimatedEntrance = useRef(false);
  const [displayedImages, setDisplayedImages] = useState<ImageData[]>(images);
  const [prevImagesRef, setPrevImagesRef] = useState<ImageData[]>(images);

  // Compute target filtered set
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const targetFiltered = images.filter(
    (img) =>
      img.original_key.toLowerCase().includes(normalizedQuery) ||
      img.image_id.toLowerCase().includes(normalizedQuery) ||
      img.thumbnail_key.toLowerCase().includes(normalizedQuery)
  );

  // Sync derived state when base `images` prop updates
  if (images !== prevImagesRef) {
    setPrevImagesRef(images);
    setDisplayedImages(targetFiltered);
  }

  // Initial Entrance Stagger Animation when ImageGrid mounts with data
  useGSAP(
    () => {
      if (!gridRef.current || displayedImages.length === 0) return;

      if (!hasAnimatedEntrance.current) {
        hasAnimatedEntrance.current = true;
        const cards = gridRef.current.querySelectorAll('.image-card');
        if (cards.length > 0) {
          gsap.fromTo(
            cards,
            { opacity: 0, y: 30 },
            {
              opacity: 1,
              y: 0,
              duration: 0.6,
              stagger: 0.1,
              ease: 'power3.out',
              clearProps: 'transform,opacity',
            }
          );
        }
      }
    },
    { scope: gridRef, dependencies: [displayedImages.length === 0] }
  );

  // Search Filter Animation: fade out filtered-out cards, then reveal matching cards
  useGSAP(
    () => {
      if (!hasAnimatedEntrance.current) {
        return;
      }

      if (!gridRef.current) {
        gsap.delayedCall(0, () => setDisplayedImages(targetFiltered));
        return;
      }

      const targetIds = new Set(targetFiltered.map((item) => item.image_id));
      const allCardNodes = Array.from(
        gridRef.current.querySelectorAll<HTMLElement>('.image-card')
      );

      const exitingNodes = allCardNodes.filter((node) => {
        const id = node.getAttribute('data-image-id');
        return id && !targetIds.has(id);
      });

      if (exitingNodes.length > 0) {
        gsap.to(exitingNodes, {
          opacity: 0,
          y: 16,
          scale: 0.95,
          duration: 0.22,
          stagger: 0.03,
          ease: 'power2.in',
          onComplete: () => {
            setDisplayedImages(targetFiltered);
          },
        });
      } else {
        gsap.delayedCall(0, () => setDisplayedImages(targetFiltered));
      }
    },
    { scope: gridRef, dependencies: [normalizedQuery] }
  );

  // Animate newly entering cards after search state updates
  useGSAP(
    () => {
      if (!hasAnimatedEntrance.current || !gridRef.current) return;
      const cards = gridRef.current.querySelectorAll('.image-card');
      if (cards.length > 0) {
        gsap.fromTo(
          cards,
          { opacity: 0, y: 20 },
          {
            opacity: 1,
            y: 0,
            duration: 0.38,
            stagger: 0.06,
            ease: 'power2.out',
            overwrite: 'auto',
            clearProps: 'transform,opacity',
          }
        );
      }
    },
    { scope: gridRef, dependencies: [displayedImages] }
  );

  // Empty State: No images in database at all
  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center rounded-2xl bg-white/70 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm max-w-xl mx-auto my-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500/15 via-purple-500/15 to-pink-500/15 dark:from-indigo-500/20 dark:to-pink-500/20 border border-indigo-500/20 flex items-center justify-center mb-5 text-indigo-600 dark:text-indigo-400">
          <ImageOff className="w-8 h-8 stroke-[1.5]" />
        </div>
        <h3 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white mb-2">
          No Processed Images Yet
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md leading-relaxed">
          Upload an image to your S3 source bucket to trigger the AWS Lambda thumbnail
          generator and populate DynamoDB metadata.
        </p>
        <div className="mt-5 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-xs font-mono text-slate-600 dark:text-slate-300 border border-slate-200/70 dark:border-slate-700/70">
          <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
          <span>aws s3 cp photo.jpg s3://image-uploads/</span>
        </div>
      </div>
    );
  }

  // Empty State: Search returned 0 matches
  if (targetFiltered.length === 0 && displayedImages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center rounded-2xl bg-white/70 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 shadow-sm max-w-xl mx-auto my-6">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4 text-amber-500">
          <SearchX className="w-7 h-7 stroke-[1.5]" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1.5">
          No Matching Assets Found
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
          No images matched <span className="font-semibold text-slate-700 dark:text-slate-200">"{searchQuery}"</span>. Try searching by another filename or ID.
        </p>
        {onClearSearch && (
          <button
            type="button"
            onClick={onClearSearch}
            className="mt-5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-500/25 transition-all cursor-pointer"
          >
            Reset Search Filter
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={gridRef}
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
    >
      {displayedImages.map((image) => (
        <ImageCard key={image.image_id} image={image} />
      ))}
    </div>
  );
};
