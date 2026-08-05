const SESSION_TTL_MS = 60_000
const MAX_REQUEST_CHARS = 128_000

function getAllowedOrigins(env) {
    return new Set(env.SPARK_ALLOWED_ORIGINS
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean))
}

function getOrigin(request) {
    return request.headers.get('Origin') || ''
}

function json(body, status = 200, origin = '*') {
    return Response.json(body, {
        status,
        headers: {
            'Access-Control-Allow-Origin': origin,
            'Cache-Control': 'no-store',
            'Vary': 'Origin',
            'X-Content-Type-Options': 'nosniff',
        },
    })
}

function bytesToBase64(bytes) {
    let binary = ''
    for (const byte of new Uint8Array(bytes))
        binary += String.fromCharCode(byte)
    return btoa(binary)
}

function bytesToBase64Url(bytes) {
    return bytesToBase64(bytes)
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '')
}

function base64UrlToBytes(value) {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const binary = atob(padded)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
}

async function importHmacKey(secret) {
    return crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
    )
}

function buildSessionMessage(origin, expiresAt, nonce) {
    return `${origin}\n${expiresAt}\n${nonce}`
}

async function createSessionToken(env, origin, expiresAt, nonce) {
    const key = await importHmacKey(env.SPARK_API_SECRET)
    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(buildSessionMessage(origin, expiresAt, nonce)),
    )
    return bytesToBase64Url(signature)
}

async function hasValidSession(request, env, url) {
    const origin = getOrigin(request)
    const expiresAt = Number(url.searchParams.get('expires'))
    const nonce = url.searchParams.get('nonce') || ''
    const token = url.searchParams.get('token') || ''
    const now = Date.now()

    if (!Number.isFinite(expiresAt) || expiresAt < now || expiresAt > now + SESSION_TTL_MS
        || !/^[\w-]{16,64}$/.test(nonce) || !/^[\w-]{43}$/.test(token)) {
        return false
    }

    try {
        const key = await importHmacKey(env.SPARK_API_SECRET)
        return crypto.subtle.verify(
            'HMAC',
            key,
            base64UrlToBytes(token),
            new TextEncoder().encode(buildSessionMessage(origin, expiresAt, nonce)),
        )
    }
    catch {
        return false
    }
}

async function buildSignedSparkUrl(env) {
    const assistantUrl = new URL(env.SPARK_ASSISTANT_URL)
    if (assistantUrl.protocol === 'ws:')
        assistantUrl.protocol = 'wss:'
    if (assistantUrl.protocol !== 'wss:')
        throw new Error('SPARK_ASSISTANT_URL must use wss://')

    const date = new Date().toUTCString()
    const signatureOrigin = `host: ${assistantUrl.host}\ndate: ${date}\nGET ${assistantUrl.pathname} HTTP/1.1`
    const key = await importHmacKey(env.SPARK_API_SECRET)
    const signature = bytesToBase64(await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(signatureOrigin),
    ))
    const authorizationOrigin = `api_key="${env.SPARK_API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`

    assistantUrl.searchParams.set('authorization', btoa(authorizationOrigin))
    assistantUrl.searchParams.set('date', date)
    assistantUrl.searchParams.set('host', assistantUrl.host)
    return assistantUrl.toString()
}

function safeClose(socket, code = 1011, reason = 'Proxy error') {
    if (socket.readyState > 1)
        return
    try {
        socket.close(code, reason.slice(0, 120))
    }
    catch {
        // The peer may already have closed between the state check and close().
    }
}

async function handleAuth(request, env, url, origin) {
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Origin': origin,
                'Access-Control-Max-Age': '600',
                'Vary': 'Origin',
            },
        })
    }

    if (request.method !== 'POST')
        return json({ error: 'Method not allowed' }, 405, origin)

    const expiresAt = Date.now() + SESSION_TTL_MS
    const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)))
    const socketUrl = new URL(url)
    socketUrl.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    socketUrl.pathname = '/spark/chat'
    socketUrl.search = ''
    socketUrl.searchParams.set('expires', String(expiresAt))
    socketUrl.searchParams.set('nonce', nonce)
    socketUrl.searchParams.set('token', await createSessionToken(env, origin, expiresAt, nonce))

    return json({ url: socketUrl.toString(), appId: env.SPARK_APP_ID }, 200, origin)
}

async function handleWebSocket(request, env) {
    const pair = new globalThis.WebSocketPair()
    const [browserSocket, workerSocket] = Object.values(pair)
    workerSocket.accept()

    const sparkSocket = new WebSocket(await buildSignedSparkUrl(env))
    let pendingRequest = null
    let requestForwarded = false

    function forwardRequest(rawMessage) {
        if (requestForwarded) {
            safeClose(workerSocket, 1008, 'Only one request is allowed')
            safeClose(sparkSocket, 1008, 'Only one request is allowed')
            return
        }

        if (typeof rawMessage !== 'string' || rawMessage.length > MAX_REQUEST_CHARS) {
            safeClose(workerSocket, 1003, 'Invalid request')
            safeClose(sparkSocket, 1003, 'Invalid request')
            return
        }

        try {
            const payload = JSON.parse(rawMessage)
            if (!payload || typeof payload !== 'object' || Array.isArray(payload))
                throw new TypeError('Payload must be an object')

            payload.header = { ...payload.header, app_id: env.SPARK_APP_ID }
            sparkSocket.send(JSON.stringify(payload))
            requestForwarded = true
        }
        catch {
            safeClose(workerSocket, 1003, 'Invalid JSON request')
            safeClose(sparkSocket, 1003, 'Invalid JSON request')
        }
    }

    workerSocket.addEventListener('message', (event) => {
        if (sparkSocket.readyState === WebSocket.OPEN)
            forwardRequest(event.data)
        else if (pendingRequest === null)
            pendingRequest = event.data
        else safeClose(workerSocket, 1008, 'Only one request is allowed')
    })

    sparkSocket.addEventListener('open', () => {
        if (pendingRequest !== null) {
            forwardRequest(pendingRequest)
            pendingRequest = null
        }
    })
    sparkSocket.addEventListener('message', (event) => {
        if (workerSocket.readyState === WebSocket.OPEN)
            workerSocket.send(event.data)
    })

    workerSocket.addEventListener('close', () => safeClose(sparkSocket, 1000, 'Browser closed'))
    sparkSocket.addEventListener('close', event => safeClose(
        workerSocket,
        event.code === 1006 ? 1011 : event.code,
        event.reason || 'Spark closed',
    ))
    workerSocket.addEventListener('error', () => safeClose(sparkSocket))
    sparkSocket.addEventListener('error', () => safeClose(workerSocket))

    return new Response(null, { status: 101, webSocket: browserSocket })
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url)
        if (url.pathname === '/health' && request.method === 'GET')
            return json({ status: 'ok' })

        const origin = getOrigin(request)
        if (!getAllowedOrigins(env).has(origin))
            return json({ error: 'Origin not allowed' }, 403, 'null')

        if (url.pathname === '/spark/auth')
            return handleAuth(request, env, url, origin)

        if (url.pathname === '/spark/chat') {
            const isUpgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
            if (!isUpgrade || !(await hasValidSession(request, env, url)))
                return json({ error: 'Unauthorized' }, 401, origin)
            return handleWebSocket(request, env)
        }

        return json({ error: 'Not found' }, 404, origin)
    },
}
