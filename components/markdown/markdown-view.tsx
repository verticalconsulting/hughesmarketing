"use client";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { splitFrontMatter } from "@/lib/domain/front-matter";
import { Mermaid } from "./mermaid";

export function MarkdownView({ source }: { source: string }) {
  const { data, body } = splitFrontMatter(source);
  return (
    <article className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-display prose-a:text-primary prose-table:text-xs">
      {data && (
        <table className="not-prose mb-4 w-full rounded-md border text-xs">
          <tbody>
            {Object.entries(data).map(([k, v]) => (
              <tr key={k} className="border-b last:border-0">
                <th className="w-32 bg-muted px-2 py-1 text-left align-top font-medium">{k}</th>
                <td className="px-2 py-1 break-words">{typeof v === "string" ? v : JSON.stringify(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { plainText: ["mermaid"] }]]}
        components={{
          code({ className, children, ...props }) {
            if (/language-mermaid/.test(className ?? "")) return <Mermaid chart={String(children).trim()} />;
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </article>
  );
}
