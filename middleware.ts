import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "kop_session";
// /book is the guest-facing booking page (Launch Path p0a/p2/p3) — anyone
// with the studio's link needs to reach it without a KOP staff login.
const PUBLIC_PATHS = ["/login", "/book"];

function secretKey() {
  return new TextEncoder().encode(process.env.SESSION_SECRET);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p)) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  try {
    await jwtVerify(token, secretKey());
    return NextResponse.next();
  } catch {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
}

export const config = {
  // icon.png / apple-icon.png are Next's file-convention favicon routes —
  // browsers fetch them with no session cookie (a fresh tab, a private
  // window, the home-screen icon), so without this exclusion the auth
  // check above redirects every one of those requests to /login and the
  // browser silently gets an HTML page back instead of the image.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)"],
};
