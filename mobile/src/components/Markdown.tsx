import ReactMarkdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import rehypeSanitize from "rehype-sanitize"
import remarkGfm from "remark-gfm"
import "highlight.js/styles/github.min.css"

export function Markdown({
  children,
}: {
  children: string
}) {
  const text = children.replace(/\\n/g, "\n")
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize, rehypeHighlight]}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
