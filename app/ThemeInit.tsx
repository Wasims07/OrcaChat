"use client";

import { useEffect } from "react";
import { getTheme, applyTheme, THEME_UPDATED_EVENT } from "@/lib/profile";

export default function ThemeInit() {
  useEffect(() => {
    applyTheme(getTheme());
    const onTheme = () => applyTheme(getTheme());
    window.addEventListener(THEME_UPDATED_EVENT, onTheme);
    return () => window.removeEventListener(THEME_UPDATED_EVENT, onTheme);
  }, []);

  return null;
}
