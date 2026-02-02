import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const isAuthPage = request.nextUrl.pathname.startsWith("/auth");
  const isMainPage = request.nextUrl.pathname === "/";
  const isBrowsePage = request.nextUrl.pathname === "/browse";

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    if (!isAuthPage && !isMainPage && !isBrowsePage) {
      return NextResponse.redirect(new URL("/auth", request.url));
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { data } = await supabase.auth.getUser();
    const user = data.user;

    if (!user && !isAuthPage && !isMainPage && !isBrowsePage) {
      return NextResponse.redirect(new URL("/auth", request.url));
    }

    if (user && isAuthPage) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  } catch {
    if (!isAuthPage && !isMainPage && !isBrowsePage) {
      return NextResponse.redirect(new URL("/auth", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
