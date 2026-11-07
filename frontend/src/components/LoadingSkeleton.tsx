import React from 'react';

interface LoadingSkeletonProps {
  count?: number;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({ count = 8 }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="rounded-2xl bg-white/75 dark:bg-slate-900/70 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 shadow-md overflow-hidden"
        >
          {/* Top bar */}
          <div className="h-1 w-full bg-gradient-to-r from-indigo-500/40 via-purple-500/40 to-pink-500/40 animate-pulse" />

          {/* Image placeholder */}
          <div className="aspect-[4/3] w-full bg-slate-200/80 dark:bg-slate-800/80 animate-pulse relative">
            <div className="absolute top-3 right-3 h-6 w-16 rounded-xl bg-slate-300/80 dark:bg-slate-700/80" />
          </div>

          {/* Content placeholder */}
          <div className="p-5 space-y-4">
            <div className="space-y-2">
              <div className="h-5 w-3/4 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse" />
              <div className="h-3.5 w-1/2 rounded-lg bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
            </div>

            <div className="pt-3.5 border-t border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between">
              <div className="h-4 w-24 rounded-md bg-slate-200 dark:bg-slate-800 animate-pulse" />
              <div className="h-6 w-28 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

