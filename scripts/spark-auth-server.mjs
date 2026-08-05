import { Buffer } from 'node:buffer'
import { createHmac, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { env, loadEnvFile } from 'node:process'
import { WebSocket, WebSocketServer } from 'ws'

const ENV_FILE = new URL('../server/.env.local', import.meta.url)
const SESSION_TTL_MS = 60_000
const sessions = new Map()

try {
    loadEnvFile(ENV_FILE)
}
catch (error) {
    if (error?.code !== 'ENOENT')
        throw error
}

const REQUIRED_ENV = [
    'SPARK_APP_ID',
    'SPARK_API_KEY',
    'SPARK_API_SECRET',
    'SPARK_ASSISTANT_URL',
]

const missingEnv = REQUIRED_ENV.filter(name => !env[name]?.trim())
if (missingEnv.length)
    throw new Error(`Missing Spark configuration: ${missingEnv.join(', ')}`)

const appId = env.SPARK_APP_ID.trim()
const apiKey = env.SPARK_API_KEY.trim()
const apiSecret = env.SPARK_API_SECRET.trim()
const allowedOrigins = new Set((env.SPARK_ALLOWED_ORIGINS || env.SPARK_ALLOWED_ORIGIN || 'http://127.0.0.1:5175')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean))
const port = Number.parseInt(env.SPARK_AUTH_PORT || '8787', 10)
const publicWebSocketUrl = env.SPARK_PUBLIC_WS_URL?.trim() || `ws://127.0.0.1:${port}/spark/chat`
const assistantUrl = new URL(env.SPARK_ASSISTANT_URL.trim())

if (assistantUrl.protocol === 'ws:')
    assistantUrl.protocol = 'wss:'
if (assistantUrl.protocol !== 'wss:')
    throw new Error('SPARK_ASSISTANT_URL must use wss://')
if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('SPARK_AUTH_PORT must be a valid TCP port')
if (!['ws:', 'wss:'].includes(new URL(publicWebSocketUrl).protocol))
    throw new Error('SPARK_PUBLIC_WS_URL must use ws:// or wss://')

function buildSignedSparkUrl() {
    const date = new Date().toUTCString()
    const signatureOrigin = `host: ${assistantUrl.host}\ndate: ${date}\nGET ${assistantUrl.pathname} HTTP/1.1`
    const signature = createHmac('sha256', apiSecret)
        .update(signatureOrigin)
        .digest('base64')
    const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`
    const authorization = Buffer.from(authorizationOrigin).toString('base64')
    const signedUrl = new URL(assistantUrl)

    signedUrl.searchParams.set('authorization', authorization)
    signedUrl.searchParams.set('date', date)
    signedUrl.searchParams.set('host', assistantUrl.host)
    return signedUrl.toString()
}

function getOrigin(request) {
    return request.headers.origin || ''
}

function isAllowedOrigin(request) {
    return allowedOrigins.has(getOrigin(request))
}

function createSession(origin, expiresAt) {
    const now = Date.now()
    for (const [token, session] of sessions) {
        if (session.expiresAt < now)
            sessions.delete(token)
    }

    const token = randomBytes(32).toString('base64url')
    sessions.set(token, { expiresAt, origin })
    return token
}

function hasValidSession(request, requestUrl) {
    const expiresAt = Number(requestUrl.searchParams.get('expires'))
    const token = requestUrl.searchParams.get('token') || ''
    const session = sessions.get(token)
    const now = Date.now()
    if (!session || !Number.isFinite(expiresAt) || session.expiresAt !== expiresAt
        || session.origin !== getOrigin(request) || expiresAt < now || expiresAt > now + SESSION_TTL_MS) {
        if (session?.expiresAt < now)
            sessions.delete(token)
        return false
    }

    sessions.delete(token)
    return true
}

function sendJson(response, statusCode, body, origin) {
    response.writeHead(statusCode, {
        'Access-Control-Allow-Origin': origin,
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'Vary': 'Origin',
        'X-Content-Type-Options': 'nosniff',
    })
    response.end(JSON.stringify(body))
}

function closeSocket(socket, code = 1011, reason = 'Proxy error') {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
        socket.close(code, reason)
}

const server = createServer((request, response) => {
    const origin = getOrigin(request)
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)

    if (requestUrl.pathname === '/health' && request.method === 'GET') {
        sendJson(response, 200, { status: 'ok' }, '*')
        return
    }

    if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { error: 'Origin not allowed' }, 'null')
        return
    }

    if (requestUrl.pathname !== '/spark/auth') {
        sendJson(response, 404, { error: 'Not found' }, origin)
        return
    }

    if (request.method === 'OPTIONS') {
        response.writeHead(204, {
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Max-Age': '600',
            'Vary': 'Origin',
        })
        response.end()
        return
    }

    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST, OPTIONS')
        sendJson(response, 405, { error: 'Method not allowed' }, origin)
        return
    }

    const expiresAt = Date.now() + SESSION_TTL_MS
    const socketUrl = new URL(publicWebSocketUrl)
    socketUrl.searchParams.set('expires', String(expiresAt))
    socketUrl.searchParams.set('token', createSession(origin, expiresAt))
    sendJson(response, 200, { url: socketUrl.toString(), appId }, origin)
})

const webSocketServer = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
    if (requestUrl.pathname !== '/spark/chat' || !isAllowedOrigin(request) || !hasValidSession(request, requestUrl)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
    }

    webSocketServer.handleUpgrade(request, socket, head, (browserSocket) => {
        const sparkSocket = new WebSocket(buildSignedSparkUrl())
        let pendingRequest = null
        let requestForwarded = false

        function forwardRequest(rawMessage) {
            if (requestForwarded) {
                closeSocket(browserSocket, 1008, 'Only one request is allowed')
                closeSocket(sparkSocket, 1008, 'Only one request is allowed')
                return
            }

            try {
                const payload = JSON.parse(rawMessage.toString())
                payload.header = { ...payload.header, app_id: appId }
                sparkSocket.send(JSON.stringify(payload))
                requestForwarded = true
            }
            catch {
                closeSocket(browserSocket, 1003, 'Invalid JSON request')
                closeSocket(sparkSocket, 1003, 'Invalid JSON request')
            }
        }

        browserSocket.on('message', (message, isBinary) => {
            if (isBinary) {
                closeSocket(browserSocket, 1003, 'Binary requests are not supported')
                closeSocket(sparkSocket, 1003, 'Binary requests are not supported')
                return
            }

            if (sparkSocket.readyState === WebSocket.OPEN)
                forwardRequest(message)
            else if (!pendingRequest)
                pendingRequest = message
            else closeSocket(browserSocket, 1008, 'Only one request is allowed')
        })

        sparkSocket.on('open', () => {
            if (pendingRequest) {
                forwardRequest(pendingRequest)
                pendingRequest = null
            }
        })
        sparkSocket.on('message', (message, isBinary) => {
            if (browserSocket.readyState === WebSocket.OPEN)
                browserSocket.send(message, { binary: isBinary })
        })

        browserSocket.on('close', () => closeSocket(sparkSocket, 1000, 'Browser closed'))
        sparkSocket.on('close', (code, reason) => closeSocket(browserSocket, code === 1006 ? 1011 : code, reason.toString()))
        browserSocket.on('error', () => closeSocket(sparkSocket))
        sparkSocket.on('error', () => closeSocket(browserSocket))
    })
})

server.listen(port, '127.0.0.1', () => {
    console.log(`Spark proxy service listening on http://127.0.0.1:${port}`)
    console.log(`Allowed browser origins: ${[...allowedOrigins].join(', ')}`)
})
