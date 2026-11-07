import React from 'react';
import { Sparkles, Sun, Moon, RefreshCw, Activity } from 'lucide-react';

interface HeaderProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  totalCount: number;
  totalSizeBytes: number;
  onRefresh: () => void;
  isRefreshing: boolean;
}

function formatTotalBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export const Header: React.FC<HeaderProps> = ({
  darkMode,
  onToggleDarkMode,
  totalCount,
  totalSizeBytes,
  onRefresh,
  isRefreshing,
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 dark:border-slate-800/80 bg-white/75 dark:bg-slate-950/75 backdrop-blur-xl transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Brand & Title */}
          <div className="flex items-center gap-3.5">
            <div className="relative flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/30 dark:shadow-indigo-500/20">
              <Sparkles className="w-6 h-6" />
              <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-white dark:border-slate-950"></span>
              </span>
            </div>

            <div className="text-left">
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-800 dark:from-white dark:via-indigo-200 dark:to-slate-300 bg-clip-text text-transparent">
                  Image Pipeline Console
                </h1>
                <span className="hidden md:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60">
                  <Activity className="w-3 h-3" />
                  Serverless S3 + Lambda
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Real-time processed assets &amp; DynamoDB metadata explorer
              </p>
            </div>
          </div>

          {/* Stats & Actions */}
          <div className="flex items-center justify-between sm:justify-end gap-2.5 sm:gap-3">
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-slate-100/80 dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-800/80 text-xs sm:text-sm">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-slate-900 dark:text-white">{totalCount}</span>
                <span className="text-slate-500 dark:text-slate-400">assets</span>
              </div>
              <span className="text-slate-300 dark:text-slate-700">|</span>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                  {formatTotalBytes(totalSizeBytes)}
                </span>
              </div>
            </div>

            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refresh images"
              className="inline-flex items-center justify-center p-2.5 rounded-2xl bg-white/80 dark:bg-slate-900/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow transition-all duration-200 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-500' : ''}`} />
            </button>

            <button
              onClick={onToggleDarkMode}
              aria-label="Toggle Dark Mode"
              className="relative inline-flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-gradient-to-b from-white to-slate-50 dark:from-slate-900 dark:to-slate-900/90 hover:from-slate-50 hover:to-slate-100 dark:hover:from-slate-800 dark:hover:to-slate-800/90 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow transition-all duration-200 cursor-pointer"
            >
              {darkMode ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400 transition-transform duration-300 rotate-0 hover:rotate-45" />
                  <span className="text-xs font-medium hidden sm:inline">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-indigo-600 transition-transform duration-300" />
                  <span className="text-xs font-medium hidden sm:inline">Dark</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

