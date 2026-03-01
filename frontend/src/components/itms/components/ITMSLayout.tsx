import { type ReactNode } from 'react';

type ITMSLayoutProps = {
  children: ReactNode;
};

export function ITMSLayout({ children }: ITMSLayoutProps) {
  return (
    <div className="h-full w-full bg-background text-foreground relative overflow-hidden">
      <div className="relative z-10 h-full w-full overflow-y-auto overflow-x-hidden p-4 iris-scroll-area [&>*]:overflow-visible">
        {children}
      </div>
    </div>
  );
}
