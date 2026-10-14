'use client';

import { SecurityGate } from '@/components/auth/security-gate';
import { StudioHome } from '@/components/studio-home';

export default function Home() {
  return (
    <SecurityGate>
      <StudioHome />
    </SecurityGate>
  );
}
