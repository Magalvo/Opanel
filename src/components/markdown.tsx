import ReactMarkdown, { type Components, type UrlTransform } from "react-markdown";

import { cn } from "@/lib/utils";

const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Keeps a link only for `http`, `https` and `mailto` (WT-03 decision 14). Anything else,
 * `javascript:`, `data:` and relative paths among them, loses its URL.
 */
const safeUrl: UrlTransform = (url, key) => {
  if (key !== "href" || !URL.canParse(url)) return null;
  return SAFE_SCHEMES.has(new URL(url).protocol) ? url : null;
};

const components: Components = {
  a: ({ href, children }) =>
    href === undefined ? (
      <span>{children}</span>
    ) : (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-4"
      >
        {children}
      </a>
    ),
  // Images are shown as their alt text, never loaded (WS-038 section 3).
  img: ({ alt }) => <span>{alt}</span>,
  h1: ({ children }) => <h3 className="text-lg font-semibold">{children}</h3>,
  h2: ({ children }) => <h4 className="text-base font-semibold">{children}</h4>,
  h3: ({ children }) => <h5 className="font-semibold">{children}</h5>,
  h4: ({ children }) => <h6 className="font-semibold">{children}</h6>,
  h5: ({ children }) => <h6 className="font-semibold">{children}</h6>,
  h6: ({ children }) => <h6 className="font-semibold">{children}</h6>,
};

/**
 * Markdown written by people and agents, rendered safely (WT-03 decision 14, WS-038): raw
 * HTML is ignored, images are not loaded, and only `http`, `https` and `mailto` links are
 * kept. It renders React elements, never raw HTML, so it needs nothing from the Content
 * Security Policy.
 */
export function Markdown({
  children,
  className,
}: Readonly<{ children: string; className?: string }>) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-2 text-sm break-words",
        "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs",
        "[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3",
        "[&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
        className,
      )}
    >
      <ReactMarkdown skipHtml urlTransform={safeUrl} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
