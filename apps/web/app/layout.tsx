import React from 'react';
import './globals.css';
import QueryProvider from './components/QueryProvider';
import Navbar from './components/Navbar';

export const metadata = {
  title: 'Stock Market Simulation',
  description: 'Simulated real-time paper trading platform',
  icons: {
    icon: '/icon.jpg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 min-h-screen font-sans flex flex-col">
        <QueryProvider>
          <Navbar />
          <main className="flex-1">
            {children}
          </main>
        </QueryProvider>
      </body>
    </html>
  );
}
