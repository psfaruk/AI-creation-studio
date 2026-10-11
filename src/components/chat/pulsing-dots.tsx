'use client';

/** ক্রমান্বয়ে পালস করা তিনটি বিন্দু — "এজেন্ট কাজ করছে…" অ্যানিমেশন */
export function PulsingDots({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className ?? ''}`} aria-hidden="true">
      {[0, 160, 320].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-pulse rounded-full bg-current"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
