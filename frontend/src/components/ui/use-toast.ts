import * as React from "react";

export type ToastOptions = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: "default" | "destructive";
  action?: React.ReactNode;
  duration?: number;
};

type ToastState = {
  toasts: ToastOptions[];
};

const toast = (options: ToastOptions) => {
  return {
    id: String(Date.now()),
    dismiss: () => undefined,
    update: (_next: ToastOptions) => undefined,
    ...options,
  };
};

function useToast() {
  const [state] = React.useState<ToastState>({ toasts: [] });

  return {
    ...state,
    toast,
    dismiss: (_toastId?: string) => undefined,
  };
}

export { useToast, toast };
