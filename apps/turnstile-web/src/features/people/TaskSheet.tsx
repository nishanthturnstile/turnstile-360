import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { usePeopleActivity } from './activity';

const TaskContext = createContext<{
  dismiss: { current: () => void };
  confirm: (message: string, action: () => void) => void;
} | null>(null);

/** Keeps the owning draft/recovery mounted when authorization temporarily hides a task. */
export function TaskSheet({ children, label }: { children: ReactNode; label: string }) {
  const active = usePeopleActivity();
  const dismiss = useRef(() => {});
  const [origin] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const [pending, setPending] = useState<{ message: string; action: () => void }>();
  return (
    <TaskContext value={{ dismiss, confirm: (message, action) => setPending({ message, action }) }}>
      <Sheet
        open={active}
        onOpenChange={(open) => {
          if (!open && !pending) dismiss.current();
        }}
      >
        <SheetContent
          className="users-task-sheet data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
          keepMounted
          inert={!active}
          style={active ? undefined : { display: 'none' }}
          showCloseButton={false}
          aria-describedby={undefined}
          finalFocus={() => (origin?.isConnected ? origin : false)}
        >
          <SheetTitle className="sr-only">{label}</SheetTitle>
          {children}
        </SheetContent>
      </Sheet>
      <AlertDialog
        open={active && !!pending}
        onOpenChange={(open) => {
          if (!open) setPending(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>{pending?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = pending?.action;
                setPending(undefined);
                action?.();
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TaskContext>
  );
}

export function useTaskDismiss(handler: () => void) {
  const context = useContext(TaskContext);
  useLayoutEffect(() => {
    if (context) context.dismiss.current = handler;
  });
}
export function useTaskConfirm() {
  const context = useContext(TaskContext);
  return context?.confirm ?? ((_message: string, action: () => void) => action());
}
