'use client';

import { AlertTriangle } from 'lucide-react';
import type { MatchKind } from '@/lib/similarity';

export interface DuplicatePreviewItem {
  id: string;
  label: string;
  detail?: string;
  kind: MatchKind;
}

export function DuplicateWarningBanner({
  title,
  items,
  pendingConfirm,
  onConfirmAnyway,
  onCancelConfirm,
}: {
  title: string;
  items: DuplicatePreviewItem[];
  pendingConfirm?: boolean;
  onConfirmAnyway?: () => void;
  onCancelConfirm?: () => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-2 text-xs">
      <div className="flex items-start gap-2 text-amber-800 dark:text-amber-300 font-semibold">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
        <span>{title}</span>
      </div>
      <ul className="space-y-1 pl-6">
        {items.map((it) => (
          <li key={it.id} className="text-[11px] leading-snug">
            <span
              className={`inline-block px-1.5 py-0.5 rounded font-bold mr-1.5 ${
                it.kind === 'exact'
                  ? 'bg-red-500/20 text-red-700 dark:text-red-300'
                  : 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
              }`}
            >
              {it.kind === 'exact' ? 'Igual' : 'Parecido'}
            </span>
            <span className="font-semibold">{it.label}</span>
            {it.detail && (
              <span className="text-muted-theme"> — {it.detail}</span>
            )}
          </li>
        ))}
      </ul>
      {pendingConfirm && onConfirmAnyway && (
        <div className="flex flex-wrap items-center gap-2 pt-1 pl-6">
          <button
            type="button"
            onClick={onConfirmAnyway}
            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold"
          >
            Salvar mesmo assim
          </button>
          {onCancelConfirm && (
            <button
              type="button"
              onClick={onCancelConfirm}
              className="px-3 py-1.5 rounded-lg subtle-surface text-[11px] font-semibold"
            >
              Cancelar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
