import * as React from "react";

export type ToastVariant = "default" | "destructive";

export type ToastProps = {
  id?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  action?: React.ReactNode;
};

export type ToastActionElement = React.ReactElement;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function ToastViewport() {
  return null;
}

export function Toast({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export function ToastTitle({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export function ToastDescription({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export function ToastClose() {
  return null;
}

export function ToastAction({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}
