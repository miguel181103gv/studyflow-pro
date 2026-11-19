import { ProfileProvider } from '@/components/ProfileProvider';
import { AppShell } from '@/components/AppShell';

export default function ProfileLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { profileId: string };
}) {
  return (
    <ProfileProvider profileId={params.profileId}>
      <AppShell profileId={params.profileId}>{children}</AppShell>
    </ProfileProvider>
  );
}
