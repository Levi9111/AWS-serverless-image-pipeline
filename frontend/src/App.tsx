import { useState, useEffect, useCallback, useMemo } from 'react';
import { AlertTriangle, RotateCcw, ServerCrash } from 'lucide-react';
import type { ImageData } from './types';
import { Header } from './components/Header';
import { ImageUploader } from './components/ImageUploader';
import { SearchBar } from './components/SearchBar';
import { ImageGrid } from './components/ImageGrid';
import { LoadingSkeleton } from './components/LoadingSkeleton';

async function loadImagesFromApi(signal?: AbortSignal): Promise<ImageData[]> {
  const baseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://35.87.135.224:5000').replace(
    /\/$/,
    ''
  );

  const response = await fetch(`${baseUrl}/api/images`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `API request failed with status ${response.status} (${response.statusText})`
    );
  }

  const result: unknown = await response.json();

  if (!Array.isArray(result)) {
    throw new Error('Invalid response format: expected an array of ImageData.');
  }

  return [...(result as ImageData[])].sort((a, b) =>
    (b.uploaded_at || '').localeCompare(a.uploaded_at || '')
  );
}

export function App() {
  const [data, setData] = useState<ImageData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('dashboard_theme');
    if (saved === 'dark' || saved === 'light') {
      return saved === 'dark';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Sync dark mode class with document root
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('dashboard_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('dashboard_theme', 'light');
    }
  }, [darkMode]);

  // Initial fetch on mount
  useEffect(() => {
    const controller = new AbortController();

    loadImagesFromApi(controller.signal)
      .then((sorted) => {
        setData(sorted);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message =
          err instanceof Error
            ? err.message
            : 'Unable to connect to the image pipeline backend API.';
        setError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  // Manual refresh handler
  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sorted = await loadImagesFromApi();
      setData(sorted);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to connect to the image pipeline backend API.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const filteredCount = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return data.length;
    return data.filter(
      (img) =>
        img.original_key.toLowerCase().includes(q) ||
        img.image_id.toLowerCase().includes(q) ||
        img.thumbnail_key.toLowerCase().includes(q)
    ).length;
  }, [data, searchQuery]);

  const totalSizeBytes = useMemo(
    () => data.reduce((acc, item) => acc + (Number(item.size_bytes) || 0), 0),
    [data]
  );

  return (
    <div className={darkMode ? 'dark' : ''}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 relative overflow-x-hidden transition-colors duration-300">
        {/* Ambient Decorative Background Glows */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
          <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-indigo-500/15 dark:bg-indigo-500/10 blur-3xl" />
          <div className="absolute top-1/4 -right-40 w-96 h-96 rounded-full bg-purple-500/15 dark:bg-purple-500/10 blur-3xl" />
          <div className="absolute -bottom-40 left-1/3 w-96 h-96 rounded-full bg-pink-500/10 dark:bg-pink-500/5 blur-3xl" />
        </div>

        {/* Sticky Top Header */}
        <Header
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((prev) => !prev)}
          totalCount={data.length}
          totalSizeBytes={totalSizeBytes}
          onRefresh={handleRefresh}
          isRefreshing={loading}
        />

        {/* Main Dashboard Content */}
        <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          {/* Hero Intro, Upload Zone & Search Bar */}
          <div className="text-center max-w-2xl mx-auto mb-6">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white mb-2">
              Processed Media Gallery
            </h2>
            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400">
              Inspect automatically resized S3 thumbnails, payload sizes, and DynamoDB metadata records in real time.
            </p>
          </div>

          <ImageUploader onUploadSuccess={handleRefresh} />

          <SearchBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            resultCount={filteredCount}
            totalCount={data.length}
          />

          {/* Red Alert Error Banner */}
          {error && (
            <div
              role="alert"
              className="mb-8 rounded-2xl bg-red-500/10 dark:bg-red-950/50 backdrop-blur-xl border border-red-500/30 dark:border-red-500/40 p-5 text-left shadow-lg shadow-red-500/5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="p-2.5 rounded-xl bg-red-500/20 text-red-600 dark:text-red-400 shrink-0">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-red-900 dark:text-red-200 flex items-center gap-2">
                      <span>Failed to Load Pipeline Data</span>
                      <ServerCrash className="w-4 h-4 opacity-75" />
                    </h3>
                    <p className="mt-1 text-sm text-red-700 dark:text-red-300/90">
                      {error}
                    </p>
                    <p className="mt-1 text-xs font-mono text-red-600/80 dark:text-red-400/80">
                      Endpoint: {import.meta.env.VITE_API_BASE_URL || 'http://35.87.135.224:5000'}/api/images
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleRefresh}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-500 text-white shadow-sm shadow-red-600/30 transition-all shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retry Connection</span>
                </button>
              </div>
            </div>
          )}

          {/* Main Grid / Loading States */}
          {loading ? (
            <LoadingSkeleton count={8} />
          ) : !error ? (
            <ImageGrid
              images={data}
              searchQuery={searchQuery}
              onClearSearch={() => setSearchQuery('')}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}

export default App;
