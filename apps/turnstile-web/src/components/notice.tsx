import { Alert, AlertDescription } from '@/components/ui/alert';

export function Notice({
  message,
  success = false,
  className,
}: {
  message: string;
  success?: boolean;
  className?: string;
}) {
  return (
    <Alert
      className={className}
      variant={success ? 'default' : 'destructive'}
      role={success ? 'status' : 'alert'}
    >
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
