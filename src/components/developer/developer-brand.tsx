import Link from 'next/link';
import { Code2 } from 'lucide-react';

export function DeveloperBrand() {
  return (
    <Link href="/developer" className="flex items-center gap-2 text-xl font-bold tracking-tight">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600">
        <Code2 className="h-5 w-5 text-white" />
      </div>
      <span>
        Dialogy <span className="font-normal text-white/40">Docs</span>
      </span>
    </Link>
  );
}
