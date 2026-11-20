import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { GlobalProvider } from '@/components/GlobalProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'StudyFlow Concursos — Plataforma Inteligente de Estudos',
  description:
    'Ciclo de estudos, edital verticalizado, revisões espaçadas, caderno de erros e mentor Gemini AI sincronizados na nuvem.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" data-theme="clean" suppressHydrationWarning>
      <body className={`${inter.className} min-h-screen antialiased`}><GlobalProvider>{children}</GlobalProvider></body>
    </html>
  );
}
