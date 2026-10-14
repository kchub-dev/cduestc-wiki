// 生成扩展图标：圆角渐变底 + 白色对话气泡 + 三个点。
// 纯 Node 实现（zlib + 手工 PNG 编码），无第三方依赖。
// 运行：node extension/tools/gen-icons.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons')

// ---- PNG 编码 ----

const CRC_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
        table[n] = c >>> 0
    }
    return table
})()

function crc32(buffer) {
    let crc = 0xFFFFFFFF
    for (const byte of buffer)
        crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
    return (crc ^ 0xFFFFFFFF) >>> 0
}

function chunk(type, data) {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
}

function encodePNG(width, height, rgba) {
    const raw = Buffer.alloc((width * 4 + 1) * height)
    for (let y = 0; y < height; y++) {
        raw[y * (width * 4 + 1)] = 0
        rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8
    ihdr[9] = 6
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ])
}

// ---- 绘制 ----

function insideRoundedRect(x, y, x0, y0, x1, y1, radius) {
    if (x < x0 || x > x1 || y < y0 || y > y1)
        return false
    const cx = Math.max(x0 + radius, Math.min(x, x1 - radius))
    const cy = Math.max(y0 + radius, Math.min(y, y1 - radius))
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

function insideCircle(x, y, cx, cy, radius) {
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

function insideTriangle(x, y, ax, ay, bx, by, cx, cy) {
    const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3)
    const d1 = sign(x, y, ax, ay, bx, by)
    const d2 = sign(x, y, bx, by, cx, cy)
    const d3 = sign(x, y, cx, cy, ax, ay, bx, by)
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0
    return !(hasNeg && hasPos)
}

function drawIcon(size) {
    const rgba = Buffer.alloc(size * size * 4)
    // 品牌渐变：上 #2F6FEB -> 下 #6C5CE7
    const top = [0x2F, 0x6F, 0xEB]
    const bottom = [0x6C, 0x5C, 0xE7]
    const corner = size * 0.22
    const bubble = {
        x0: size * 0.20,
        y0: size * 0.22,
        x1: size * 0.80,
        y1: size * 0.58,
        r: size * 0.10,
    }
    const dotY = size * 0.40
    const dotR = size * 0.055

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const offset = (y * size + x) * 4
            if (!insideRoundedRect(x, y, 0, 0, size - 1, size - 1, corner)) {
                rgba[offset + 3] = 0
                continue
            }
            const t = y / (size - 1)
            let r = top[0] + (bottom[0] - top[0]) * t
            let g = top[1] + (bottom[1] - top[1]) * t
            let b = top[2] + (bottom[2] - top[2]) * t

            const inBubble = insideRoundedRect(x, y, bubble.x0, bubble.y0, bubble.x1, bubble.y1, bubble.r)
                || insideTriangle(
                    x,
                    y,
                    size * 0.28,
                    size * 0.56,
                    size * 0.40,
                    size * 0.56,
                    size * 0.28,
                    size * 0.70,
                )
            if (inBubble) {
                r = 255
                g = 255
                b = 255
            }
            const inDot = insideCircle(x, y, size * 0.33, dotY, dotR)
                || insideCircle(x, y, size * 0.50, dotY, dotR)
                || insideCircle(x, y, size * 0.67, dotY, dotR)
            if (inDot) {
                r = top[0]
                g = top[1]
                b = top[2]
            }

            rgba[offset] = Math.round(r)
            rgba[offset + 1] = Math.round(g)
            rgba[offset + 2] = Math.round(b)
            rgba[offset + 3] = 255
        }
    }
    return encodePNG(size, size, rgba)
}

mkdirSync(outDir, { recursive: true })
for (const size of [16, 32, 48, 128]) {
    const file = join(outDir, `icon${size}.png`)
    writeFileSync(file, drawIcon(size))
    console.log(`written ${file}`)
}
