'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * react-markdown + remark-gfm — typography প্লাগইন ছাড়াই
 * components প্রপস দিয়ে হালকা স্টাইলিং।
 */
const components: Components = {
  h1: ({ children }) => <h1 className="mt-4 text-lg font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-4 text-base font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => (
    <h3 className="mt-3 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-3 text-sm font-semibold first:mt-0">{children}</h4>
  ),
  p: ({ children }) => <p className="leading-relaxed break-words">{children}</p>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-emerald-700 underline underline-offset-2 transition-colors hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="ml-5 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="ml-5 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="rounded-r-md border-l-2 border-emerald-600/40 bg-emerald-600/5 px-3 py-1.5 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  img: ({ src, alt }) => (
    <img src={src} alt={alt ?? ''} className="my-2 max-h-96 w-auto rounded-lg border" loading="lazy" />
  ),
  code: ({ className, children }) => {
    const isBlock = /language-/i.test(className ?? '');
    if (isBlock) {
      return <code className={`font-mono text-xs ${className ?? ''}`}>{children}</code>;
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b px-3 py-1.5 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border-b px-3 py-1.5 align-top">{children}</td>,
};

export function Markdown({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
