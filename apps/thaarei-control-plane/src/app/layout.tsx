import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
export const metadata: Metadata = {
  title: 'Thaarei Control Plane',
  description: 'Private deployment administration',
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <a href="/">
            Thaarei <span>Control Plane</span>
          </a>
        </header>
        {children}
      </body>
    </html>
  );
}
