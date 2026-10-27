import { useEffect, useRef } from 'react';
import { Moon, Sun, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme, isTheme, type Theme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

// The chosen theme is also kept on the signed-in user's account
// (auth user_metadata), so it follows them to other devices.
const META_KEY = 'pdhq_theme';

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolved, dialup, setTheme } = useTheme();
  const { user } = useAuth();
  const Icon = dialup ? Sparkles : resolved === 'dark' ? Moon : Sun;

  // On sign-in, adopt the theme saved on the account.
  const syncedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!user || syncedFor.current === user.id) return;
    syncedFor.current = user.id;
    const saved = user.user_metadata?.[META_KEY];
    if (isTheme(saved) && saved !== theme) setTheme(saved);
  }, [user, theme, setTheme]);

  const choose = (t: Theme) => {
    setTheme(t);
    if (user && user.user_metadata?.[META_KEY] !== t) {
      void supabase.auth.updateUser({ data: { [META_KEY]: t } });
    }
  };

  const item = (t: Theme, label: string, ItemIcon: typeof Sun) => (
    <DropdownMenuItem onClick={() => choose(t)} className={cn('text-xs gap-2', theme === t && 'bg-secondary')}>
      <ItemIcon className="h-3.5 w-3.5" /> {label}
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8', className)}
          aria-label="Toggle theme"
        >
          <Icon className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {item('light', 'Q Mode', Sun)}
        {item('dark', 'Parker Mode', Moon)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Dial-Up</DropdownMenuLabel>
        {item('dialup', 'Desktop', Sparkles)}
        {item('vaporwave', 'Vaporwave', Sparkles)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
