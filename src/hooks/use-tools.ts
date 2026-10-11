'use client';

import { useEffect, useState } from 'react';

import { TOOL_CATALOG, type ToolInfo } from '@/lib/types';

/**
 * GET /api/tools → ToolInfo[]
 * ফেচ ব্যর্থ হলে TOOL_CATALOG-এই fallback।
 */
export function useTools(): ToolInfo[] {
  const [tools, setTools] = useState<ToolInfo[]>(TOOL_CATALOG);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tools')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('tools fetch failed'))))
      .then((data: ToolInfo[]) => {
        if (!cancelled && Array.isArray(data) && data.length > 0) setTools(data);
      })
      .catch(() => {
        // fallback হিসেবে TOOL_CATALOG ইতিমধ্যে initial state-এ আছে
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return tools;
}
