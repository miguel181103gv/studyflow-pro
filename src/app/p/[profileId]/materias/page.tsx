'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function MateriasRedirectPage() {
  const router = useRouter();
  const params = useParams<{ profileId: string }>();

  useEffect(() => {
    if (params?.profileId) {
      router.replace(`/p/${params.profileId}/estudos`);
    }
  }, [params?.profileId, router]);

  return null;
}
