import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, ArrowRight, Link as LinkIcon } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { toast } from 'sonner';

/**
 * Wraps a row-like element with a right-click context menu that offers
 * Open / Open in new tab / Copy link — matching native anchor behavior
 * even when the row isn't a real `<a>`.
 */
export function RowContextMenu({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const absolute = () =>
    typeof window !== 'undefined' ? new URL(path, window.location.origin).toString() : path;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={() => navigate(path)}>
          <ArrowRight className="mr-2 h-4 w-4" /> Open
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => window.open(path, '_blank', 'noopener,noreferrer')}
        >
          <ExternalLink className="mr-2 h-4 w-4" /> Open in new tab
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={async () => {
            try {
              await navigator.clipboard.writeText(absolute());
              toast.success('Link copied');
            } catch {
              toast.error('Could not copy link');
            }
          }}
        >
          <LinkIcon className="mr-2 h-4 w-4" /> Copy link
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
