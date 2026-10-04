import { getAuth } from "@/lib/better-auth/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Lazy init so `next build` does not require a live MongoDB (Docker image build).
async function handlers() {
    const auth = await getAuth();
    return toNextJsHandler(auth);
}

export async function GET(req: Request) {
    const { GET } = await handlers();
    return GET(req);
}

export async function POST(req: Request) {
    const { POST } = await handlers();
    return POST(req);
}
