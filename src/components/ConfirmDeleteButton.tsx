import { ReactNode, useState } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

type Props = {
  onConfirm: () => Promise<void> | void;
  itemLabel: string;
  description?: string;
  trigger?: ReactNode;
  buttonVariant?: ButtonProps['variant'];
  buttonSize?: ButtonProps['size'];
  iconOnly?: boolean;
  className?: string;
};

export function ConfirmDeleteButton({
  onConfirm, itemLabel, description, trigger, buttonVariant = 'ghost',
  buttonSize = 'sm', iconOnly = false, className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    setBusy(true);
    try {
      await onConfirm();
      toast.success(`Deleted ${itemLabel}`);
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message || `Failed to delete ${itemLabel}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <span
        className="inline-flex"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        onKeyDown={(e) => {
          // Only intercept when the wrapper itself receives the event from a
          // non-button trigger; the inner Button handles its own keys natively
          // so its focus ring stays visible and consistent.
          if (trigger && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }
        }}
      >
        {trigger ?? (
          <Button
            variant={buttonVariant}
            size={buttonSize}
            aria-label={`Delete ${itemLabel}`}
            className={className ?? (iconOnly
              ? 'row-action-destructive h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10'
              : 'row-action-destructive h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive hover:bg-destructive/10')}
          >
            <Trash2 className="h-3 w-3" />
            {!iconOnly && 'Delete'}
          </Button>
        )}
      </span>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {itemLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              {description ?? `This permanently removes the ${itemLabel} and any related data. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); handle(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
