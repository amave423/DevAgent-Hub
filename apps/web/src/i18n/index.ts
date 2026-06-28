import { ru } from "./ru";
import { en } from "./en";
import type { AppLanguage } from "../types";
import type { CopyKey } from "./ru";

const copies: Record<AppLanguage, Record<CopyKey, string>> = { ru, en };

export function t(language: AppLanguage, key: CopyKey): string {
  return copies[language][key];
}
