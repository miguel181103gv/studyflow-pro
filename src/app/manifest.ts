import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'StudyFlow Pro — Plataforma de Estudos',
    short_name: 'StudyFlow',
    description:
      'Estude com ciclo de estudos, revisões espaçadas, flashcards, questões e Lei Seca — online e offline.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0b1120',
    theme_color: '#0d9488',
    icons: [
      {
        src: '/icon-studyflow.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-studyflow.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
