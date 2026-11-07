import React from 'react';
import { Search, X, SlidersHorizontal } from 'lucide-react';

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  resultCount: number;
  totalCount: number;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  searchQuery,
  onSearchChange,
  resultCount,
  totalCount,
}) => {
  return (
    <div className="relative w-full max-w-3xl mx-auto mb-8">
      <div className="relative group">
        {/* Subtle glowing backdrop */}
        <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-2xl opacity-20 dark:opacity-30 blur-md group-focus-within:opacity-50 transition duration-300"></div>

        <div className="relative flex items-center bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl rounded-2xl border border-slate-200/80 dark:border-slate-800/90 shadow-lg shadow-slate-200/40 dark:shadow-black/30 transition-all duration-200">
          <div className="pl-4 pr-2 text-slate-400 dark:text-slate-500 flex items-center pointer-events-none shrink-0">
            <Search className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
          </div>

          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by filename, image_id, or thumbnail key..."
            className="flex-1 min-w-0 py-3.5 px-2 bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 text-sm sm:text-base focus:outline-none"
          />

          <div className="flex items-center gap-2 pr-3 shrink-0">
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear search"
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100/90 dark:bg-slate-800/90 text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60 whitespace-nowrap shrink-0">
              <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span className="tabular-nums">
                {resultCount} / {totalCount}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
