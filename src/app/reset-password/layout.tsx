import { LocalizedPublicShell } from '@/components/layout/localized-public-shell';

export default async function ResetPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <LocalizedPublicShell>{children}</LocalizedPublicShell>;
}
