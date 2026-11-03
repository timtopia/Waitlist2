import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import { cleanDisplayName, cleanText } from "@/lib/validate"

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "select_account",
        },
      },
      // The Google name lands in the queue list, "Now serving" and other
      // people's emails. Clean it like names edited on the profile page, so a
      // bidi override or an 80-character name can't garble those.
      profile(p) {
        const cleaned = cleanDisplayName(cleanText(p.name ?? "").slice(0, 50))
        return {
          id: p.sub,
          name: typeof cleaned === "string" ? cleaned : null,
          email: p.email,
          image: p.picture,
        }
      },
    }),
  ],
  // Our own page instead of the unstyled built-in one, so redirects from
  // /dashboard, /profile, etc. land somewhere that explains what's going on
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    session: async ({ session, user }) => {
      if (session.user) {
        session.user.id = user.id
      }
      return session
    },
  },
})
