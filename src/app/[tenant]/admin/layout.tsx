import type { ReactNode } from "react";
import { withAuth } from "@workos-inc/authkit-nextjs";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await withAuth({ ensureSignedIn: true });

  return <>{children}</>;
}
