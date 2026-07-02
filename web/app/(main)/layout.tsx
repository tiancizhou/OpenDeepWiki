import type { ReactNode } from "react";
import { AssistantOnlyGuard } from "./assistant-only-guard";

export default function MainLayout({ children }: { children: ReactNode }) {
  return <AssistantOnlyGuard>{children}</AssistantOnlyGuard>;
}
