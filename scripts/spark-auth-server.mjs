import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { env, loadEnvFile } from 'node:process'

const ENV_FILE = new URL('../server/.env.local', import.meta.url)

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
const allowedOrigin = env.SPARK_ALLOWED_ORIGIN?.trim() || 'http://127.0.0.1:5175'
const port = Number.parseInt(env.SPARK_AUTH_PORT || '8787', 10)
const assistantUrl = new URL(env.SPARK_ASSISTANT_URL.trim())

if (assistantUrl.protocol === 'ws:')
    assistantUrl.protocol = 'wss:'
if (assistantUrl.protocol !== 'wss:')
    throw new Error('SPARK_ASSISTANT_URL must use wss://')
if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('SPARK_AUTH_PORT must be a valid TCP port')

function buildSignedUrl() {
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

const server = createServer((request, response) => {
    const origin = request.headers.origin
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)

    if (origin !== allowedOrigin) {
        sendJson(response, 403, { error: 'Origin not allowed' }, 'null')
        return
    }

    if (requestUrl.pathname !== '/spark/auth') {
        sendJson(response, 404, { error: 'Not found' }, allowedOrigin)
        return
    }

    if (request.method === 'OPTIONS') {
        response.writeHead(204, {
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Origin': allowedOrigin,
            'Access-Control-Max-Age': '600',
            'Vary': 'Origin',
        })
        response.end()
        return
    }

    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST, OPTIONS')
        sendJson(response, 405, { error: 'Method not allowed' }, allowedOrigin)
        return
    }

    sendJson(response, 200, { url: buildSignedUrl(), appId }, allowedOrigin)
})

server.listen(port, '127.0.0.1', () => {
    console.log(`Spark auth service listening on http://127.0.0.1:${port}`)
    console.log(`Allowed browser origin: ${allowedOrigin}`)
})
