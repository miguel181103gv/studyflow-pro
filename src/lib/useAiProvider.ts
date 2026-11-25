'use client';

import { useEffect, useState } from 'react';

let cachedDeepseekEnabled: boolean | null = null;
let pendingCheck: Promise<boolean> | null = null;

async function fetchDeepseekStatus(): Promise<boolean> {
  if (cachedDeepseekEnabled !== null) return cachedDeepseekEnabled;
  if (pendingCheck) return pendingCheck;
  pendingCheck = fetch('/api/gemini', { method: 'GET' })
    .then((r) => r.json())
    .then((d) => {
      cachedDeepseekEnabled = Boolean(d?.deepseekEnabled);
      return cachedDeepseekEnabled;
    })
    .catch(() => {
      cachedDeepseekEnabled = false;
      return false;
    });
  return pendingCheck;
}

export function useAiProviderName(): 'DeepSeek' | 'Gemini' {
  const [isDeepseek, setIsDeepseek] = useState<boolean>(cachedDeepseekEnabled === true);

  useEffect(() => {
    let active = true;
    void fetchDeepseekStatus().then((val) => {
      if (active) setIsDeepseek(val);
    });
    return () => {
      active = false;
    };
  }, []);

  return isDeepseek ? 'DeepSeek' : 'Gemini';
}
