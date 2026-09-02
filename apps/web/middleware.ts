import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // sw.js and manifest.webmanifest are excluded on purpose. Both are fetched
  // by the browser itself, outside any session: running them through
  // updateSession would redirect them to /login for a signed-out visitor, which
  // silently breaks service-worker registration and manifest parsing — and so
  // installability — on exactly the page where install is first offered.
  // (Icons are already covered by the image-extension exclusion.)
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
