"use client";

import { ExternalLink, Globe, CheckCircle2 } from "lucide-react";
import { useState } from "react";

// Favicons come from arbitrary external URLs and need an onError fallback,
// which next/image doesn't support — keep the native <img> here.
/* eslint-disable @next/next/no-img-element */

export type Source = {
  title: string;
  url: string;
  domain?: string;
  favicon?: string;
};

type SourcesProps = {
  sources: Source[];
  className?: string;
};

export default function Sources({ sources, className = "" }: SourcesProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!sources || sources.length === 0) {
    return null;
  }

  // Extract domain from URL if not provided
  const getDomain = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace("www.", "");
    } catch {
      return url;
    }
  };

  // Get favicon URL
  const getFavicon = (url: string) => {
    try {
      const parsed = new URL(url);
      return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32`;
    } catch {
      return null;
    }
  };

  return (
    <div className={`mt-4 w-full ${className}`}>
      {/* Header with count */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#1f6feb]/10 border border-[#1f6feb]/20">
          <Globe size={12} className="text-[#58a6ff]" />
        </div>
        <span className="text-xs font-medium text-[#8b949e] tracking-wide uppercase">
          Sources
        </span>
        <span className="text-[10px] text-[#8b949e] bg-[#21262d] px-2 py-0.5 rounded-full">
          {sources.length}
        </span>
      </div>

      {/* Source Cards */}
      <div className="flex flex-wrap gap-2">
        {sources.map((source, index) => {
          const domain = source.domain || getDomain(source.url);
          const favicon = source.favicon || getFavicon(source.url);
          const isHovered = hoveredIndex === index;

          return (
            <a
              key={`${source.url}-${index}`}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              className={`
                dc-source-card
                group relative flex max-w-[280px] items-center gap-3 rounded-md
                border border-[#30363d] bg-[#161b22] px-3 py-2.5
                transition-all duration-200
                hover:border-[#1f6feb] hover:bg-[#1c2128]
                ${isHovered ? 'border-[#1f6feb] bg-[#1c2128]' : ''}
              `}
            >
              {/* Favicon / Icon */}
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#21262d] border border-[#30363d] overflow-hidden">
                {favicon ? (
                  <img
                    src={favicon}
                    alt=""
                    className="h-4 w-4 object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Globe size={14} className="text-[#8b949e]" />
                )}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-[#c9d1d9] group-hover:text-[#e6edf3] transition">
                  {source.title || domain}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="truncate text-[10px] text-[#8b949e]">
                    {domain}
                  </span>
                  {isHovered && (
                    <CheckCircle2 size={10} className="text-[#58a6ff] shrink-0" />
                  )}
                </div>
              </div>

              {/* External Link Icon */}
              <ExternalLink
                size={13}
                className={`
                  shrink-0 transition-all duration-200
                  ${isHovered ? 'text-[#58a6ff] translate-x-0.5' : 'text-[#8b949e]'}
                `}
              />
            </a>
          );
        })}
      </div>
    </div>
  );
}