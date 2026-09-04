"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus, vs } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check } from "lucide-react";
import { useState, useEffect } from "react";
import type { ReactElement, ReactNode } from "react";
import { getTheme, THEME_UPDATED_EVENT } from "@/lib/profile";

type MarkdownRendererProps = {
  content: string;
};

type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
};

// Literal bullet glyphs some models emit instead of `-`/`*`/`+` marks.
const BULLET_GLYPHS = "•●◦‣▪■□◆◇▸▹⁃✦➤·";

// Normalize messy bullet output to a single clean `- ` markdown bullet so
// ReactMarkdown renders exactly ONE list marker per point. Models sometimes
// emit `• Point`, `- • Point`, `• • Point`, or `-- Point`, which otherwise
// show up as an extra literal dot/text beside the CSS list marker.
function normalizeBullets(raw: string): string {
  const lines = raw.split("\n");
  let inFence = false;
  const out = lines.map((line) => {
    // Skip fenced code blocks (never touch code content).
    const fence = line.match(/^\s*`{3,}|^\s*~{3,}/);
    if (fence) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;

    // Only normalize lines with <4 spaces of indent (4+ = indented code).
    if (/^\s{4,}\S/.test(line)) return line;

    // 1) Literal glyph(s) as the bullet: `• Point`, `• • Point` → `- Point`
    const glyph = line.match(`^(\\s*)(?:[${BULLET_GLYPHS}]+\\s+)+(\\S.*)$`);
    if (glyph) return `${glyph[1]}- ${glyph[2]}`;

    // 2) Dash/star bullet + stray glyph inside the item: `- • Point` → `- Point`
    const mixed = line.match(`^(\\s*)[-*+]\\s+[-*+${BULLET_GLYPHS}]+\\s+(\\S.*)$`);
    if (mixed) return `${mixed[1]}- ${mixed[2]}`;

    // 3) Doubled mark: `-- Point`, `** Point`, `++ Point` → `- Point`
    const doubled = line.match(/^(\s*)[-*+]{2,}\s+(\S.*)$/);
    if (doubled) return `${doubled[1]}- ${doubled[2]}`;

    return line;
  });
  return out.join("\n");
}

function hastToText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value || "";
  if (node.type === "element") {
    let acc = "";
    for (const child of node.children || []) acc += hastToText(child);
    if (node.tagName === "tr") acc += "\n";
    else if (node.tagName === "td" || node.tagName === "th") acc += "\t";
    return acc;
  }
  return "";
}

const CELL_SEP = "  ";

// Pull each row's cells out of the hast <table> as real arrays, so ragged or
// single-column tables are handled correctly.
function extractTableRows(node: HastNode | undefined): string[][] {
  const out: string[][] = [];
  if (!node) return out;

  const collectCells = (n: HastNode, cells: HastNode[]) => {
    for (const child of n.children || []) {
      if (child.tagName === "td" || child.tagName === "th") cells.push(child);
      else collectCells(child, cells);
    }
  };

  const walk = (n: HastNode) => {
    if (n.tagName === "tr") {
      const cells: HastNode[] = [];
      collectCells(n, cells);
      out.push(
        cells.map((c) =>
          hastToText(c).replace(/\s*\n+\s*/g, " ").trim()
        )
      );
    }
    for (const child of n.children || []) walk(child);
  };

  walk(node);
  return out;
}

// Render rows as a plain-text aligned grid (padded columns) so pasting into a
// plain-text editor like Notepad still looks like a table.
function alignRows(rows: string[][]): string {
  if (rows.length === 0) return "";
  const nCols = Math.max(...rows.map((r) => r.length));
  const colWidths = Array(nCols).fill(0) as number[];
  for (const row of rows) {
    row.forEach((cell, i) => {
      colWidths[i] = Math.max(colWidths[i], [...cell].length);
    });
  }
  return rows
    .map((row) =>
      Array.from({ length: nCols }, (_, i) => {
        const cell = row[i] ?? "";
        return cell + " ".repeat(Math.max(colWidths[i] - [...cell].length, 0));
      }).join(CELL_SEP)
    )
    .join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Build a real <table> so rich apps (Word, Sheets, Notion) keep the grid.
function buildRowsHtml(rows: string[][]): string {
  if (rows.length === 0) return "";
  const nCols = Math.max(...rows.map((r) => r.length));
  const body = rows
    .map(
      (row) =>
        `<tr>${Array.from({ length: nCols }, (_, i) => {
          const cell = row[i] ?? "";
          return `<td style="border:1px solid #c5c5c5;padding:3px 8px">${escapeHtml(cell)}</td>`;
        }).join("")}</tr>`
    )
    .join("");
  return `<table style="border-collapse:collapse;font-family:system-ui,'Segoe UI',sans-serif;font-size:12px">${body}</table>`;
}

function CopyChip({ text, html }: { text: string; html?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (html) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": new Blob([html], { type: "text/html" }),
              "text/plain": new Blob([text], { type: "text/plain" }),
            }),
          ]);
        } catch {
          await navigator.clipboard.writeText(text);
        }
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      console.error("Failed to copy");
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="dc-copy-chip flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition hover:bg-[#30363d] hover:text-[#c9d1d9]"
    >
      {copied ? (
        <>
          <Check size={12} className="text-[#3fb950]" />
          <span>Copied</span>
        </>
      ) : (
        <>
          <Copy size={12} />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

function TableBlock({
  rows,
  children,
}: {
  rows: string[][];
  children: ReactNode;
}) {
  return (
    <div className="dc-table my-4 overflow-hidden rounded-md border border-[#30363d] shadow-[0_8px_24px_rgba(0,0,0,0.24)]">
      <div className="dc-table-scroll overflow-x-auto w-full max-w-full min-w-0 whitespace-nowrap">
        <table className="w-max min-w-full border-collapse text-[13px]">
          {children}
        </table>
      </div>
      <div className="dc-table-footer flex items-center justify-end border-t border-[#30363d] bg-[#21262d] px-3.5 py-2">
        <CopyChip text={alignRows(rows)} html={buildRowsHtml(rows)} />
      </div>
    </div>
  );
}

function PreBlock({ text }: { text: string }) {
  return (
    <div className="dc-pre-block my-3 overflow-hidden rounded-md border border-[#30363d] shadow-[0_8px_24px_rgba(0,0,0,0.24)]">
      <div className="dc-table-bar flex items-center justify-between border-b border-[#30363d] bg-[#21262d] px-3.5 py-1.5">
        <span className="text-[11px] font-mono uppercase tracking-wider text-[#8b949e]">
          Output
        </span>
      </div>
      <pre
        className="overflow-x-auto bg-[#161b22] p-4 text-[13px] leading-relaxed text-[#c9d1d9] font-mono whitespace-pre-wrap break-words"
      >
        {text}
      </pre>
      <div className="dc-pre-footer flex items-center justify-end border-t border-[#30363d] bg-[#21262d] px-3.5 py-1.5">
        <CopyChip text={text} />
      </div>
    </div>
  );
}

function CodeBlock({
  language,
  code,
  style,
}: {
  language: string;
  code: string;
  style: typeof vscDarkPlus;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      console.error("Failed to copy");
    }
  };

  return (
    <div className="dc-code-block my-4 rounded-md border border-[#30363d] shadow-[0_8px_24px_rgba(0,0,0,0.24)] bg-[#161b22] overflow-hidden">
      <div className="dc-code-head flex items-center justify-between px-4 py-2 bg-[#21262d] border-b border-[#30363d]">
        <span className="dc-code-lang text-[11px] font-mono text-[#8b949e] uppercase tracking-wider">
          {language}
        </span>
        <button
          onClick={handleCopy}
          className="dc-code-copy flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] text-[#8b949e] transition hover:bg-[#30363d] hover:text-[#c9d1d9]"
        >
          {copied ? (
            <>
              <Check size={13} className="text-[#3fb950]" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy size={13} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={style}
        customStyle={{
          margin: 0,
          padding: "16px 16px 24px 16px",
          background: "transparent",
          fontSize: "13px",
          lineHeight: "1.6",
        }}
        codeTagProps={{
          style: {
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          },
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const [themeMode, setThemeMode] = useState(getTheme);

  useEffect(() => {
    const sync = () => setThemeMode(getTheme());
    window.addEventListener(THEME_UPDATED_EVENT, sync);
    return () => window.removeEventListener(THEME_UPDATED_EVENT, sync);
  }, []);

  const isLight = themeMode === "light";
  const codeStyle = isLight ? vs : vscDarkPlus;

  // ✅ Clean content - remove excessive newlines + normalize stray bullet glyphs
  const cleanContent = normalizeBullets(content)
    .trimStart()
    .replace(/\n{3,}/g, '\n\n');

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // ✅ Code blocks
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const code = String(children).replace(/^\s+|\s+$/g, "");
          if (match) {
            return <CodeBlock language={match[1]} code={code} style={codeStyle} />;
          }
          return (
            <code className="bg-[#21262d] px-1.5 py-0.5 rounded-md text-[13px] text-[#c9d1d9] font-mono" {...props}>
              {children}
            </code>
          );
        },

        // ✅ Tables
        table({ node, children }) {
          const rows = extractTableRows(node as HastNode);
          return <TableBlock rows={rows}>{children}</TableBlock>;
        },

        th({ children }) {
          return (
            <th className="dc-table-th px-3.5 py-2.5 text-left font-semibold text-[#e6edf3] bg-[#21262d] border-y border-[#30363d] whitespace-nowrap first:rounded-tl-md last:rounded-tr-md">
              {children}
            </th>
          );
        },

        td({ children }) {
          return (
            <td className="dc-table-td px-3.5 py-2.5 align-top text-[13px] leading-relaxed text-[#c9d1d9] border-t border-[#30363d] whitespace-nowrap min-w-[140px]">
              {children}
            </td>
          );
        },

        tr({ children }) {
          return <tr className="dc-table-row hover:bg-[#1c2128] transition-colors">{children}</tr>;
        },

        // ✅ Headers
        h1({ children }) {
          return <h1 className="text-2xl font-bold text-[#e6edf3] mt-4 mb-2">{children}</h1>;
        },
        h2({ children }) {
          return <h2 className="text-xl font-bold text-[#e6edf3] mt-3 mb-1.5">{children}</h2>;
        },
        h3({ children }) {
          return <h3 className="text-lg font-semibold text-[#e6edf3] mt-2 mb-1">{children}</h3>;
        },
        h4({ children }) {
          return <h4 className="text-base font-semibold text-[#e6edf3] mt-2 mb-0.5">{children}</h4>;
        },

        // ✅ Bold text
        strong({ children }) {
          return <strong className="font-semibold text-[#e6edf3]">{children}</strong>;
        },

        // ✅ Lists
        ul({ children }) {
          return (
            <ul className="list-disc list-outside pl-5 my-2 space-y-1.5 text-[#c9d1d9] marker:text-[#8b949e] [&>li>ul]:my-2 [&>li>ol]:my-2">
              {children}
            </ul>
          );
        },
        ol({ children }) {
          return (
            <ol className="list-decimal list-outside pl-5 my-2 space-y-1.5 text-[#c9d1d9] marker:text-[#8b949e] [&>li>ul]:mt-2 [&>li>ol]:mt-2">
              {children}
            </ol>
          );
        },
        li({ children }) {
          return <li className="leading-relaxed pl-1 text-[#c9d1d9]">{children}</li>;
        },

        // ✅ Paragraphs - clean spacing, aligned type
        p({ children }) {
          const text = typeof children === 'string' ? children.trim() : children;
          const cleanText = typeof text === 'string' 
            ? text.replace(/\n{2,}/g, ' ').trim() 
            : text;
          return (
            <p className="my-1 text-[15px] leading-relaxed text-[#c9d1d9] [text-wrap:pretty]">
              {cleanText}
            </p>
          );
        },

        // ✅ Line breaks (common in email / plain output)
        br() {
          return <br className="leading-relaxed" />;
        },

        // ✅ Blockquotes
        blockquote({ children }) {
          return (
            <blockquote className="border-l-4 border-[#1f6feb] pl-4 my-2 text-[#8b949e] italic">
              {children}
            </blockquote>
          );
        },

        // ✅ Horizontal rule
        hr() {
          return <hr className="border-[#30363d] my-3" />;
        },

        // ✅ Images
        img({ src, alt }) {
          // eslint-disable-next-line @next/next/no-img-element -- markdown images are remote passthrough
          return <img src={src} alt={alt} className="max-w-full rounded-md border border-[#30363d] my-2" />;
        },

        // ✅ Links
        a({ href, children }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#58a6ff] hover:text-[#79c0ff] underline transition"
            >
              {children}
            </a>
          );
        },

        // ✅ Pre tags - styled plain "output" blocks (no language = terminal output / email)
        pre({ children }) {
          const child = (Array.isArray(children) ? children[0] : children) as
            | (ReactElement & { props?: { className?: string; children?: unknown } })
            | undefined;
          const hasLang = /language-/.test(child?.props?.className || "");
          if (!hasLang) {
            const raw = String(child?.props?.children || "").trim();
            return <PreBlock text={raw} />;
          }
          return <div className="my-0">{children}</div>;
        },
      }}
    >
      {cleanContent}
    </ReactMarkdown>
  );
}