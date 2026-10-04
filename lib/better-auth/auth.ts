import { betterAuth } from "better-auth";
import {mongodbAdapter} from "better-auth/adapters/mongodb";
import {connectToDatabase} from "@/database/mongoose";
import {nextCookies} from "better-auth/next-js";
import { headers } from "next/headers";
import { cache } from "react";
import { sendPasswordResetEmail } from "@/lib/nodemailer/reset-password";


type MongoDb = Parameters<typeof mongodbAdapter>[0];

// Typed from the real config, so additional user fields (country, ...) show up in session types
const createAuth = (database: MongoDb) => betterAuth({
        database: mongodbAdapter(database),
       secret: process.env.BETTER_AUTH_SECRET,
        baseURL: process.env.BETTER_AUTH_URL,
        // Onboarding answers live on the user so the profile page can show and edit them
        user: {
            additionalFields: {
                country: { type: "string", required: false },
                investmentGoals: { type: "string", required: false },
                riskTolerance: { type: "string", required: false },
                preferredIndustry: { type: "string", required: false },
            },
        },
        emailAndPassword: {
            enabled: true,
            disableSignUp: false,
            requireEmailVerification: false,
            minPasswordLength: 8,
            maxPasswordLength: 128,
            autoSignIn: true,
            sendResetPassword: async ({ user, url }) => {
                void sendPasswordResetEmail({
                    email: user.email,
                    name: user.name,
                    resetUrl: url,
                }).catch((error) => {
                    console.error('Failed to queue password reset email:', error);
                });
            },
        },
        // Signed session cookie for 5 min: pages stop paying a MongoDB round trip per request.
        // Trade-off: a revoked session can stay valid for up to 5 minutes.
        session: {
            cookieCache: { enabled: true, maxAge: 5 * 60 },
        },
        // No account linking. Sign-up doesn't verify emails, so linking a Google/GitHub identity to an
        // existing account with the same email would let someone pre-register a victim's address and
        // later capture their social sign-in. In Better Auth 1.3 this switch also blocks explicit
        // linking; revisit (email verification or a newer Better Auth) when social sign-in ships.
        account: {
            accountLinking: { enabled: false },
        },
        // Providers stay disabled until their env vars are set
        socialProviders: {
            google: {
                enabled: !!process.env.GOOGLE_CLIENT_ID,
                clientId: process.env.GOOGLE_CLIENT_ID as string,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
            },
            github: {
                enabled: !!process.env.GITHUB_CLIENT_ID,
                clientId: process.env.GITHUB_CLIENT_ID as string,
                clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
            },
        },
        plugins: [nextCookies()],
});

type AuthInstance = ReturnType<typeof createAuth>;

let authInstance: AuthInstance | null = null;
let authPromise: Promise<AuthInstance> | null = null;

const isProductionBuild =
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.NEXT_PHASE === 'phase-export';

export const getAuth = async () => {
    if (authInstance) return authInstance;

    // Avoid connecting to Mongo during `next build` (Docker image build has no mongo hostname).
    if (isProductionBuild) {
        throw new Error('Auth is not initialized during production build');
    }

    if (!authPromise) {
        authPromise = (async () => {
            const mongoose = await connectToDatabase();
            const database = mongoose.connection.db;
            if (!database) {
                throw new Error("MongoDB connection not found!");
            }
            authInstance = createAuth(database);
            return authInstance;
        })().catch((err) => {
            authPromise = null;
            throw err;
        });
    }

    return authPromise;
}

// One session lookup per request, shared by layouts, pages and actions.
// Soft-fails during build / DB outage so page collection does not hard-crash the Docker build.
export const getSession = cache(async () => {
    try {
        const instance = await getAuth();
        return instance.api.getSession({ headers: await headers() });
    } catch {
        return null;
    }
});

// Server actions are public endpoints: never trust a userId sent from the client.
export const requireUserId = async () => {
    const session = await getSession();
    if (!session?.user) throw new Error("Unauthorized");
    return session.user.id;
}
