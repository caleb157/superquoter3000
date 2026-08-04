import { RefreshCw } from 'lucide-react';
import { useAppVersionCheck } from '@/hooks/use-app-version-check';

export function UpdateAvailableBanner() {
  const { updateAvailable } = useAppVersionCheck();
  if (!updateAvailable) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center gap-3 border-t border-primary/40 bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-lg">
      <span>A new version of Product HQ is available.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary-foreground/15 px-3 py-1 font-medium transition-colors hover:bg-primary-foreground/25"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Reload now
      </button>
    </div>
  );
}
