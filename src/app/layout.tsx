import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { GlobalProvider } from '@/components/GlobalProvider';
import { PwaSupport } from '@/components/PwaSupport';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'StudyFlow — Plataforma Inteligente de Estudos',
  description:
    'Organize estudos para concursos, faculdade, escola, certificações ou projetos livres com ciclo de estudos, revisões espaçadas, flashcards e Gemini AI.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'StudyFlow',
  },
  icons: {
    icon: '/icon-studyflow.png',
    apple: '/icon-studyflow.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0d9488',
  colorScheme: 'light dark',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" data-theme="clean" suppressHydrationWarning>
      <body className={`${jakarta.className} min-h-screen antialiased`}>
        <GlobalProvider>{children}<PwaSupport /></GlobalProvider>
      </body>
    </html>
  );
}
