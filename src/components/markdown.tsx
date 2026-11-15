import ReactMarkdown from "react-markdown";

// Only these schemes keep their link (WT-03 decision 14). `javascript:`, `data:` and the rest
// lose their `href`; so does a relative link, which a task has no use for.
const SAFE_URL = /^(?:https?|mailto):/i;

function urlTransform(url: string): string {
  return SAFE_URL.test(url) ? url : "";
}

/**
 * Markdown as text written by a person (WS-038 section 3): no raw HTML, no images, and only
 * `http`, `https` and `mailto` links, which open in a new tab without an opener. It renders
 * React elements, never `dangerouslySetInnerHTML`, so the Content Security Policy is untouched.
 */
export function Markdown({ children }: Readonly<{ children: string }>) {
  return (
    <div className="grid gap-2 text-sm break-words [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        skipHtml
        disallowedElements={["img"]}
        unwrapDisallowed
        urlTransform={urlTransform}
        components={{
          a: ({ node: _node, href, children: label, ...rest }) => (
            <a
              {...rest}
              {...(href === undefined || href === "" ? {} : { href })}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              {label}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
