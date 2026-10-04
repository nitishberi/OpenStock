import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

// Optional DNS tweaks for MongoDB Atlas SRV on some local networks.
// Never override resolver servers in Docker Compose — that breaks service DNS
// (hostname `mongodb` is only resolvable via Docker's embedded DNS).
import dns from 'dns';
try {
    if (dns.setDefaultResultOrder) {
        dns.setDefaultResultOrder('ipv4first');
    }
    const forceGoogleDns = process.env.MONGODB_GOOGLE_DNS === 'true';
    const isSrv = Boolean(MONGODB_URI?.startsWith('mongodb+srv://'));
    const looksLikeComposeHost = Boolean(
        MONGODB_URI && /@mongodb(?::|\/|\?|$)/.test(MONGODB_URI)
    );
    if ((forceGoogleDns || isSrv) && !looksLikeComposeHost) {
        dns.setServers(['8.8.8.8', '1.1.1.1']);
        console.log('MongoDB: Custom DNS servers applied (Atlas/SRV)');
    }
} catch (e) {
    console.error('Failed to set custom DNS:', e);
}

declare global {
    var mongooseCache: {
        conn: typeof mongoose | null;
        promise: Promise<typeof mongoose> | null;
    }
}

let cached = global.mongooseCache;

if (!cached) {
    cached = global.mongooseCache = { conn: null, promise: null };
}

export const connectToDatabase = async () => {
    if (!MONGODB_URI) {
        throw new Error("MongoDB URI is missing");
    }

    if (cached.conn) return cached.conn;

    if (!cached.promise) {
        cached.promise = mongoose.connect(MONGODB_URI, { bufferCommands: false, family: 4 });
    }

    try {
        cached.conn = await cached.promise;
    }
    catch (err) {
        cached.promise = null;
        throw err;
    }

    console.log(`MongoDB Connected ${MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')} in ${process.env.NODE_ENV}`);
    return cached.conn;
}