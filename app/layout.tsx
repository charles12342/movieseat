import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MovieSeat | Cinema City Hall - Real-Time Movie & Seat Reservation',
  description: 'Single-cinema real-time movie seat reservation application for Cinema City Hall.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.className} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#0B0B0D] text-[#F3F4F6]">
        <Header />
        <main className="flex-1 flex flex-col">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
