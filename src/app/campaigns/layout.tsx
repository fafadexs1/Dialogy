
import React from 'react';

// This layout ensures that any page within /campaigns has access to the main app layout.
export default function CampaignsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
